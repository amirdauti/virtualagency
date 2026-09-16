#!/usr/bin/env python3
"""Exercise an isolated VA server using a fake Codex process; no model/network calls.

Run after `cargo build -p virtual-agency-server`:
  python3 apps/server/tests/control_plane_smoke.py target/debug/virtual-agency-server
"""
import json
import os
from pathlib import Path
import shlex
import socket
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def fake_codex():
    if "--version" in sys.argv:
        print("codex-cli 0.154.0")
        return
    assert "app-server" in sys.argv, "Expected persistent app-server transport"
    turn = 0

    def emit(value):
        print(json.dumps(value), flush=True)

    def event(method, **params):
        emit({"method": method, "params": {"threadId": "test-thread", **params}})

    for line in sys.stdin:
        request = json.loads(line)
        with open(os.environ["FAKE_CODEX_LOG"], "a") as log:
            log.write(json.dumps(request) + "\n")
        method, params = request.get("method"), request.get("params", {})
        result = {}
        if method == "initialized":
            continue
        if method in ("thread/start", "thread/resume"):
            result = {"thread": {"id": "test-thread", "turns": []}}
        elif method == "turn/start":
            turn += 1
            current = {"id": f"turn-{turn}", "status": "inProgress"}
            result = {"turn": current}
            event("turn/started", turn=current)
        elif method == "turn/steer":
            assert params["expectedTurnId"] == f"turn-{turn}"
            result = {"turnId": f"turn-{turn}"}
            event("item/completed", turnId=f"turn-{turn}", item={
                "type": "agentMessage", "id": "steering-reply", "text": "Follow-up received while working."
            })
        elif method == "turn/interrupt":
            assert params["turnId"] == f"turn-{turn}"
            event("turn/completed", turn={"id": f"turn-{turn}", "status": "interrupted"})
        emit({"id": request["id"], "result": result})


def smoke(binary):
    with tempfile.TemporaryDirectory(prefix="va-control-smoke-") as temporary:
        root = Path(temporary)
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        wrapper = root / "codex"
        wrapper.write_text("#!/bin/sh\nexec " + shlex.join([
            sys.executable, str(Path(__file__).resolve()), "--fake-codex"
        ]) + ' "$@"\n')
        wrapper.chmod(0o700)
        log_path = root / "requests.jsonl"
        state_path = root / "agents.json"
        env = {
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": temporary,
            "WORKSPACE_DIR": temporary, "VIRTUAL_AGENCY_PORT": str(port),
            "VIRTUAL_AGENCY_BIND_HOST": "127.0.0.1", "VA_CODEX_BIN": str(wrapper),
            "VA_AGENT_CONTROL_TOKEN": "isolated-test-token",
            "VA_AGENTS_STATE_PATH": str(state_path), "FAKE_CODEX_LOG": str(log_path),
            "RUST_LOG": "warn",
        }
        with (root / "server.log").open("w+") as server_log:
            server = subprocess.Popen([str(Path(binary).resolve())], cwd=root, env=env,
                                      stdout=server_log, stderr=subprocess.STDOUT)
            base = f"http://127.0.0.1:{port}"

            def request(method, path, data=None, expected=200):
                body = None if data is None else json.dumps(data).encode()
                req = Request(base + path, data=body, method=method, headers={
                    "Content-Type": "application/json", "x-va-agent-token": "isolated-test-token"
                })
                try:
                    response = urlopen(req, timeout=20)
                except HTTPError as error:
                    response = error
                raw = response.read().decode()
                assert response.code == expected, (method, path, response.code, raw)
                return json.loads(raw) if raw.startswith(("{", "[")) else raw

            def agent():
                return next(item for item in request("GET", "/api/agents") if item["id"] == "source")

            try:
                for _ in range(100):
                    if server.poll() is not None:
                        raise AssertionError("Isolated server exited")
                    try:
                        request("GET", "/api/health")
                        break
                    except URLError:
                        time.sleep(0.05)
                else:
                    raise AssertionError("Isolated server failed to start")
                definition = {"id": "source", "name": "Test", "working_dir": temporary,
                              "cli_type": "codex", "model": "gpt-6-astra", "reasoning_effort": "ultra"}
                assert request("POST", "/api/agents", definition)["reasoning_effort"] == "ultra"
                # Existing IDs report their actual settings, not the ignored request.
                assert request("POST", "/api/agents", {**definition, "reasoning_effort": "low"})["reasoning_effort"] == "ultra"
                assert agent()["reasoning_effort"] == "ultra"
                for endpoint, data in [
                    ("create-agent", {**definition, "id": "blocked"}),
                    ("message-agent", {"target_agent_id": "source", "message": "blocked"}),
                    ("delegate-many", {"tasks": [{"target_agent_id": "source", "message": "blocked"}]}),
                ]:
                    request("POST", f"/api/agent-tools/source/{endpoint}", data, 403)
                request("POST", "/api/agents/source/messages", {"message": "Start work"}, 202)
                request("POST", "/api/agents/source/messages", {"message": "A question during work"}, 202)
                methods = [json.loads(line)["method"] for line in log_path.read_text().splitlines()]
                assert methods.count("turn/start") == 1 and methods.count("turn/steer") == 1, methods
                assert agent()["status"] in ("working", "thinking")
                for _ in range(50):
                    events = request("GET", "/api/events")["events"]
                    if any(
                        event.get("type") == "agent-output"
                        and "Follow-up received while working." in event.get("data", "")
                        for event in events
                    ):
                        break
                    time.sleep(0.02)
                else:
                    raise AssertionError("Steering reply was not delivered while the turn remained active")
                # Changing the next-turn effort does not bypass the active Ultra guard.
                saved = request("PATCH", "/api/agents/source", {"reasoning_effort": "high"})
                assert saved["reasoning_effort"] == "high"
                assert json.loads(state_path.read_text())["agents"][0]["reasoning_effort"] == "high"
                request("POST", "/api/agent-tools/source/create-agent", {**definition, "id": "blocked"}, 403)
                request("POST", "/api/agents/source/stop")
                assert agent()["status"] == "idle"
                request("POST", "/api/agents/source/messages", {"message": "A new turn"}, 202)
                requests = [json.loads(line) for line in log_path.read_text().splitlines()]
                starts = [item for item in requests if item["method"] == "turn/start"]
                assert len(starts) == 2
                assert starts[0]["params"]["effort"] == "ultra"
                assert starts[1]["params"]["effort"] == "high"
                assert "Create agent:" not in starts[0]["params"]["input"][0]["text"]
                request("POST", "/api/agents/source/stop")
                # Force an atomic persistence failure and check both response and rollback.
                state_path.unlink()
                state_path.mkdir()
                request("PATCH", "/api/agents/source", {"reasoning_effort": "low"}, 500)
                assert agent()["reasoning_effort"] == "high"
                # Manual user creation remains available with Ultra settings.
                request("POST", "/api/agents", {**definition, "id": "manual"})
                request("DELETE", "/api/agents/source", expected=204)
                request("DELETE", "/api/agents/manual", expected=204)
                print("PASS: authoritative settings, idempotent creation, persistence rollback, Ultra guards, active steering, stop and next-turn settings")
            except BaseException:
                server_log.flush()
                server_log.seek(0)
                print(server_log.read(), file=sys.stderr)
                raise
            finally:
                server.terminate()
                try:
                    server.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait()


if __name__ == "__main__":
    if "--fake-codex" in sys.argv:
        fake_codex()
    else:
        smoke(sys.argv[1] if len(sys.argv) > 1 else "target/debug/virtual-agency-server")
