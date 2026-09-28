# DeepSeek on a Virtual Agency server

In the browser app, open **Settings → DeepSeek**, choose the Cloud Agents server
or connected local/remote server, and save your own DeepSeek API key. The same
key controls appear when creating a DeepSeek agent. Keys are verified against
DeepSeek before replacing the saved key. A connection test does not spend model
tokens or establish that the account has enough credits for a conversation.

Select **DeepSeek** when adding an agent. The default is **DeepSeek 4.1 Flash**
(`deepseek-flash[1m]`), with reasoning enabled at Max. V4 Pro is also selectable;
Pro does not accept images. Model, reasoning on/off, and effort are editable in
the conversation controls and persisted by the server. Unsupported provider
models and effort values are rejected. DeepSeek runs through Claude Code, so
tools, MCP integrations, scheduled tasks, Telegram updates and `/stop` share
the Claude runtime. Mid-turn steering is still a Codex capability.

The credential lives at `~/.virtual-agency/providers/deepseek/api-key`; its Unix
permissions are 0600 and the directory is 0700. It is never returned by the API
or included in agents/workspace exports. The Claude profile and resumable
sessions are isolated in that provider's `claude` directory. An administrator
can instead supply `DEEPSEEK_API_KEY` or set `VA_DEEPSEEK_CONFIG_DIR`. An
environment-managed credential is read-only in the UI. Every server has its own
credential; updating the software does not distribute anyone's API key.

## CLI updates and compatibility

The npm server launcher checks the latest official native Claude Code release
on the first start of each Virtual Agency package version. It downloads into
`~/.virtual-agency/claude-cli/<version>`, verifies the official SHA-256, and runs
an isolated loopback API fixture before switching `active.json`. The fixture
checks reasoning/effort, streamed content, completed task tool results, final
response, resume, and process termination. It uses no user key or project and
sends no Telegram messages. CI runs the same gate on Linux, macOS and Windows.

A failed download or compatibility check keeps the previous CLI active and
appears in DeepSeek settings. Failed updates retry on a later start, at most
hourly. The managed CLI's own updater is disabled for VA child processes so it
cannot bypass the gate. Existing running CLI processes retain their binary.
An explicit repair/check is available with:

```sh
node <server-package>/bin/ensure-claude-cli.js --force
```

The Rust runtime prefers the compatibility-checked managed binary. If none
exists, ordinary installed Claude Code remains discoverable. The npm launcher
performs automatic updates; a standalone Rust binary needs the helper run by
its administrator. Native desktop agents do not yet expose this provider;
connect to a server through the browser app.

Captured Claude Code 2.1.283 events are replayed against the actual browser
parser and Telegram renderer. Tests cover stable reasoning cards, no duplicated
replies, task checklists, child-agent isolation, API errors, credentials,
settings persistence, and stop/restart. These checks protect the supported
protocol; they cannot guarantee every behavior of a future CLI release.

Official references: [DeepSeek Claude Code setup](https://api-docs.deepseek.com/quick_start/agent_integrations/claude_code/),
[DeepSeek model IDs](https://api-docs.deepseek.com/quick_start/pricing/),
[Claude Code streaming](https://code.claude.com/docs/en/headless).
