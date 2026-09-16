# Codex runtime and Telegram cancellation

Codex agents use the persistent `codex app-server --listen stdio://` protocol,
verified against CLI 0.154.0. Starting or resuming a thread preserves the Codex
session ID. An idle message starts a turn; a message during work uses
`turn/steer` with the active turn ID. The HTTP response confirms acceptance,
not completion. Rejected input stays available for retry in the UI. A missing
acknowledgement closes the transport instead of replaying possibly accepted input.

Stop uses `turn/interrupt` and waits for the specified turn's terminal event.
Telegram accepts `/stop` and `/stop@ThisBotsUsername` from the configured chat.
It clears older queued messages, album groups and downloads, and invalidates
media transcription already in progress. A stop barrier holds later input until
cancellation finishes. Failed cancellation produces an error, never a success
acknowledgement. Browser Stop uses the same cancellation path and clears pending
Telegram work for that agent.

Saved settings are returned by PATCH and included in agent snapshots. Settings
controls update only after confirmation. Changes made while working apply to the
next turn. Model and effort are sent explicitly on each new Codex turn; MCP
changes restart the idle transport and resume its existing session.

Codex Ultra uses native subagents. VA's agent-owned create, message-agent and
delegate-many endpoints reject requests while Ultra is configured or running.
Manual user creation remains available. Native subagent activity appears within
the parent conversation. Claude retains its existing turn-based transport and
Telegram queue; sending to a busy Claude process is rejected without replacing it.

## Verification

From the repository root:

```sh
cargo test -p virtual-agency-server
cargo build -p virtual-agency-server
python3 apps/server/tests/control_plane_smoke.py target/debug/virtual-agency-server
node --test apps/desktop/src/lib/*.test.cjs
cd apps/desktop && ./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/vite build
```

Rust tests use mock child processes for steering, fast completion, rejection,
lost acknowledgements, interruption and process failure. Telegram tests do not
contact Telegram. The Python harness launches an isolated loopback server with
temporary state and a fake Codex executable; it never reads production state or
calls a model. It also checks settings persistence/rollback and Ultra endpoint
guards. The normal release workflow runs the server tests and Linux smoke test.

The running server and packaged desktop app must be rebuilt/restarted to use
the transport. Updating source files does not migrate already-running CLI
processes. Coordinate that restart with active conversations.
