// Exercise the actual CLI against a loopback-only Anthropic fixture. No user
// credentials, project files, model charges, or Telegram messages are involved.
const http = require("node:http");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

function run(binary, args, options, timeout = 45000) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {...options, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32"});
    let stdout = "", stderr = "", timedOut = false;
    const timer = setTimeout(() => { timedOut = true; stop(child); }, timeout);
    child.stdout.on("data", data => { stdout += data; });
    child.stderr.on("data", data => { stderr += data; });
    child.on("error", e => { clearTimeout(timer); reject(e); });
    child.on("close", code => { clearTimeout(timer); resolve({code, stdout, stderr, timedOut}); });
  });
}
function stop(child) {
  if (!child.pid) return;
  try {
    if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {stdio: "ignore"});
    else process.kill(-child.pid, "SIGKILL");
  } catch { try { child.kill("SIGKILL"); } catch {} }
}
function check(condition, message) { if (!condition) throw new Error(`Claude compatibility check: ${message}`); }

async function verifyClaude(binary, {capture} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "va-claude-compat-"));
  let requests = 0;
  let hold = false;
  let reasoningConfigured = false;
  const sockets = new Set();
  const server = http.createServer(async (req, res) => {
    if (!req.url.startsWith("/v1/messages")) { res.writeHead(200, {"Content-Type": "application/json"}); res.end("{}"); return; }
    let raw = ""; for await (const part of req) raw += part;
    let body; try { body = JSON.parse(raw); } catch { res.writeHead(400); res.end(); return; }
    if (req.url.includes("count_tokens")) { res.end('{"input_tokens":10}'); return; }
    if (hold) return;
    reasoningConfigured ||= ["enabled", "adaptive"].includes(body.thinking?.type) && body.output_config?.effort === "max";
    const step = requests++;
    const text = step >= 3 ? "VA_COMPAT_OK" : "Checking task progress.";
    const tools = [
      {name: "TaskCreate", input: {subject: "Compatibility check", description: "Local fixture only", activeForm: "Checking compatibility"}},
      {name: "TaskUpdate", input: {taskId: "1", status: "in_progress"}},
      {name: "TaskUpdate", input: {taskId: "1", status: "completed"}},
    ];
    const blocks = [{type: "thinking", thinking: "Checking the test fixture.", signature: "fixture-signature"}, {type: "text", text}];
    if (tools[step]) blocks.push({type: "tool_use", id: `tool_${step}`, ...tools[step]});
    const message = {id: `msg_${step}`, type: "message", role: "assistant", model: body.model, content: blocks, stop_reason: tools[step] ? "tool_use" : "end_turn", stop_sequence: null, usage: {input_tokens: 10, output_tokens: 10}};
    if (!body.stream) { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(message)); return; }
    res.writeHead(200, {"Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive"});
    const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({type, ...data})}\n\n`);
    send("message_start", {message: {...message, content: [], stop_reason: null, usage: {input_tokens: 10, output_tokens: 0}}});
    blocks.forEach((block, index) => {
      const start = block.type === "text" ? {type: "text", text: ""} : block.type === "thinking" ? {type: "thinking", thinking: "", signature: ""} : {...block, input: {}};
      send("content_block_start", {index, content_block: start});
      const delta = block.type === "text" ? {type: "text_delta", text: block.text} : block.type === "thinking" ? {type: "thinking_delta", thinking: block.thinking} : {type: "input_json_delta", partial_json: JSON.stringify(block.input)};
      send("content_block_delta", {index, delta});
      if (block.type === "thinking") send("content_block_delta", {index, delta: {type: "signature_delta", signature: block.signature}});
      send("content_block_stop", {index});
    });
    send("message_delta", {delta: {stop_reason: message.stop_reason, stop_sequence: null}, usage: {output_tokens: 10}});
    send("message_stop", {}); res.end();
  });
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const env = {...process.env};
    for (const name of Object.keys(env)) if (/^(ANTHROPIC_|CLAUDE_|DEEPSEEK_|VA_CONTROL)/.test(name)) delete env[name];
    Object.assign(env, {CLAUDE_CONFIG_DIR: path.join(root, "profile"), ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`, ANTHROPIC_AUTH_TOKEN: "local-fixture-only", DISABLE_AUTOUPDATER: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", CLAUDE_CODE_EFFORT_LEVEL: "max"});
    const args = ["-p", "Run the local compatibility fixture.", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--model", "deepseek-flash[1m]", "--settings", '{"alwaysThinkingEnabled":true}', "--setting-sources", "", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--permission-mode", "dontAsk", "--tools", "TaskCreate,TaskUpdate", "--max-turns", "6"];
    const first = await run(binary, args, {cwd: root, env});
    check(!first.timedOut && first.code === 0, "print/stream turn failed");
    if (capture) await fs.writeFile(capture, first.stdout);
    const events = first.stdout.split("\n").filter(Boolean).map(line => JSON.parse(line));
    check(reasoningConfigured, "selected reasoning effort did not reach the API");
    check(events.some(e => e.type === "system" && e.subtype === "init" && e.session_id), "session initialization missing");
    check(events.some(e => e.type === "stream_event" && e.event?.delta?.type === "thinking_delta"), "reasoning stream missing");
    for (const name of ["TaskCreate", "TaskUpdate"]) {
      check(events.some(e => e.type === "assistant" && e.message?.content?.some(b => b.type === "tool_use" && b.name === name)), `${name} event missing`);
    }
    const results = events.flatMap(e => e.type === "user" && Array.isArray(e.message?.content) ? e.message.content.filter(b => b.type === "tool_result") : []);
    check(results.length >= 3 && results.every(r => !r.is_error), "task tools failed");
    const result = events.findLast(e => e.type === "result");
    check(result?.result === "VA_COMPAT_OK" && !result.is_error, "final result missing");
    const resumed = await run(binary, [...args, "--resume", result.session_id], {cwd: root, env});
    check(resumed.code === 0 && resumed.stdout.includes("VA_COMPAT_OK"), "session resume failed");
    hold = true;
    const stopped = await run(binary, args, {cwd: root, env}, 3000);
    check(stopped.timedOut && stopped.code !== 0, "stop did not terminate the process");
    if (capture) await fs.writeFile(capture, first.stdout);
    return {checks: ["stream", "reasoning", "tools", "checklists", "result", "resume", "stop"], event_count: events.length};
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(root, {recursive: true, force: true});
  }
}
module.exports = {verifyClaude, run};
if (require.main === module) verifyClaude(process.argv[2], {capture: process.argv[3]}).then(result => console.log(JSON.stringify(result))).catch(error => {console.error(error.message); process.exitCode = 1;});
