#!/usr/bin/env python3
"""Isolated provider/defaults/persistence/credential/stop regression test. No API calls."""
import json, os, shlex, socket, subprocess, sys, tempfile, time
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

def fake_claude():
    if "--version" in sys.argv:
        print("2.1.283 (Claude Code)"); return
    prompt = sys.stdin.read()
    model = sys.argv[sys.argv.index("--model") + 1]
    settings = json.loads(sys.argv[sys.argv.index("--settings") + 1])
    record = {"model": model, "thinking": settings["alwaysThinkingEnabled"],
              "effort": os.environ.get("CLAUDE_CODE_EFFORT_LEVEL"),
              "endpoint": os.environ.get("ANTHROPIC_BASE_URL"),
              "key_present": bool(os.environ.get("ANTHROPIC_AUTH_TOKEN")),
              "anthropic_key_present": "ANTHROPIC_API_KEY" in os.environ,
              "profile": os.environ.get("CLAUDE_CONFIG_DIR"),
              "thinking_tokens": os.environ.get("MAX_THINKING_TOKENS")}
    with open(os.environ["FAKE_CLAUDE_LOG"], "a") as f: f.write(json.dumps(record) + "\n")
    print(json.dumps({"type": "system", "subtype": "init", "session_id": "fixture-session"}), flush=True)
    if "hold" in prompt: time.sleep(30)
    print(json.dumps({"type": "assistant", "uuid": "reply", "message": {"id": "m", "content": [{"type": "text", "text": "OK"}]}}), flush=True)
    print(json.dumps({"type": "result", "session_id": "fixture-session", "result": "OK", "is_error": False}), flush=True)

def smoke(binary):
    with tempfile.TemporaryDirectory(prefix="va-deepseek-smoke-") as temp:
        root = Path(temp)
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]
        managed = root / ".virtual-agency/claude-cli"
        (managed / "2.1.283").mkdir(parents=True)
        wrapper = managed / "2.1.283/claude"
        wrapper.write_text("#!/bin/sh\nexec " + shlex.join([sys.executable, str(Path(__file__).resolve()), "--fake-claude"]) + ' "$@"\n')
        wrapper.chmod(0o700)
        (managed / "active.json").write_text('{"version":"2.1.283"}')
        config = root / "provider"
        config.mkdir(mode=0o700)
        secret = "sk-isolated-test-credential"
        (config / "api-key").write_text(secret); (config / "api-key").chmod(0o600)
        state = root / "agents.json"
        log = root / "cli.jsonl"
        env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": temp,
               "WORKSPACE_DIR": temp, "VIRTUAL_AGENCY_PORT": str(port), "VIRTUAL_AGENCY_BIND_HOST": "127.0.0.1",
               "VA_AGENTS_STATE_PATH": str(state), "VA_DEEPSEEK_CONFIG_DIR": str(config),
               "FAKE_CLAUDE_LOG": str(log), "RUST_LOG": "warn"}
        base = f"http://127.0.0.1:{port}"
        def request(method, path, data=None, expected=200):
            req = Request(base + path, data=None if data is None else json.dumps(data).encode(), method=method, headers={"Content-Type": "application/json"})
            try: response = urlopen(req, timeout=10)
            except HTTPError as error: response = error
            raw = response.read().decode()
            assert secret not in raw
            assert response.code == expected, (path, response.code, raw)
            return json.loads(raw) if raw.startswith(("{", "[")) else raw
        def wait_for(predicate):
            for _ in range(100):
                try:
                    if predicate(): return
                except (URLError, FileNotFoundError): pass
                time.sleep(0.05)
            raise AssertionError("Isolated test timed out")
        def agent(): return next(a for a in request("GET", "/api/agents") if a["id"] == "deepseek-test")
        def records(): return [json.loads(line) for line in log.read_text().splitlines()]
        def start():
            proc = subprocess.Popen([str(Path(binary).resolve())], cwd=root, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            wait_for(lambda: request("GET", "/api/health"))
            return proc
        proc = start()
        try:
            assert request("GET", "/api/providers/deepseek")["configured"]
            request("PUT", "/api/providers/deepseek", {"api_key": "bad"}, 400)
            created = request("POST", "/api/agents", {"id": "deepseek-test", "name": "Probe", "working_dir": temp, "cli_type": "deepseek"})
            assert created["model"] == "deepseek-flash[1m]" and created["thinking_enabled"] and created["reasoning_effort"] == "max"
            request("PATCH", "/api/agents/deepseek-test", {"reasoning_effort": "ultra"}, 400)
            assert agent()["reasoning_effort"] == "max"
            request("POST", "/api/agents/deepseek-test/messages", {"message": "hello"}, 202)
            wait_for(lambda: len(records()) == 1 and agent()["status"] == "idle")
            record = records()[0]
            assert record["model"] == "deepseek-flash[1m]" and record["effort"] == "max" and record["thinking"]
            assert record["endpoint"] == "https://api.deepseek.com/anthropic" and record["key_present"]
            assert not record["anthropic_key_present"] and record["profile"] == str(config / "claude")
            request("PATCH", "/api/agents/deepseek-test", {"model": "deepseek-v4-pro[1m]", "thinking_enabled": False, "reasoning_effort": "high"})
            request("POST", "/api/agents/deepseek-test/messages", {"message": "hold"}, 202)
            wait_for(lambda: len(records()) == 2)
            request("POST", "/api/agents/deepseek-test/stop")
            assert agent()["status"] == "idle"
            request("POST", "/api/agents/deepseek-test/messages", {"message": "hello again"}, 202)
            wait_for(lambda: len(records()) == 3 and agent()["status"] == "idle")
            assert records()[-1]["thinking_tokens"] == "0" and not records()[-1]["thinking"]
            request("POST", "/api/agents", {"id": "claude-test", "name": "Claude", "working_dir": temp, "cli_type": "claude"})
            request("POST", "/api/agents/claude-test/messages", {"message": "hello"}, 202)
            wait_for(lambda: len(records()) == 4)
            assert records()[-1]["endpoint"] is None and not records()[-1]["key_present"]
            proc.terminate(); proc.wait(timeout=10); proc = start()
            restored = agent()
            assert restored["cli_type"] == "deepseek" and restored["model"] == "deepseek-v4-pro[1m]"
            assert restored["reasoning_effort"] == "high" and not restored["thinking_enabled"]
            assert secret not in state.read_text() and secret not in log.read_text()
            request("DELETE", "/api/providers/deepseek")
            assert not request("GET", "/api/providers/deepseek")["configured"]
            request("POST", "/api/agents/deepseek-test/messages", {"message": "hello"}, 409)
            print("DeepSeek provider smoke passed: defaults, isolation, settings, stop, restart, key removal.")
        finally:
            proc.terminate(); proc.wait(timeout=10)

if __name__ == "__main__":
    if sys.argv[1] == "--fake-claude": fake_claude()
    else: smoke(sys.argv[1])
