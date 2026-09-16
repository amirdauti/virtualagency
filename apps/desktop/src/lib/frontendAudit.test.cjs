const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

// Execute the actual TypeScript modules without a browser, network, or CLI.
// Type checking runs separately; this uses the repository's existing compiler.
function loadTs(filename, mocks = {}) {
  const fullPath = path.resolve(__dirname, filename);
  const source = fs.readFileSync(fullPath, "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  const localRequire = (name) => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.startsWith(".")) {
      const resolved = path.resolve(path.dirname(fullPath), name);
      for (const extension of [".ts", ".tsx", ""]) {
        if (fs.existsSync(resolved + extension)) return loadTs(resolved + extension, mocks);
      }
    }
    return require(name);
  };
  new Function("require", "module", "exports", code)(localRequire, module, module.exports);
  return module.exports;
}

const settings = loadTs("./agentSettings.ts");
const snapshot = { model: "gpt-6-astra", thinking_enabled: false, reasoning_effort: "ultra", mcp_servers: [] };

test("settings commit only the authoritative response after acknowledgement", async () => {
  const controller = settings.createSettingsUpdateCoordinator();
  let resolve;
  const commits = [];
  const saving = controller.update("parent", { reasoningEffort: "ultra" }, () => new Promise((done) => { resolve = done; }), (...args) => commits.push(args));
  assert.equal(controller.isPending("parent"), true);
  assert.deepEqual(commits, []);
  resolve({ ...snapshot, reasoning_effort: "high" });
  await saving;
  assert.equal(controller.isPending("parent"), false);
  assert.equal(commits[0][0], "parent");
  assert.equal(commits[0][1].reasoning_effort, "high");
});

test("failed settings preserve confirmed state, surface the error, and release the pending lock", async () => {
  const controller = settings.createSettingsUpdateCoordinator();
  let current = { ...snapshot, reasoning_effort: "medium" };
  await assert.rejects(controller.update("parent", {}, async () => { throw new Error("Settings rejected"); }, (_id, value) => { current = value; }), /Settings rejected/);
  assert.equal(current.reasoning_effort, "medium");
  assert.equal(controller.isPending("parent"), false);
  await controller.update("parent", {}, async () => snapshot, (_id, value) => { current = value; });
  assert.equal(current.reasoning_effort, "ultra");
});

test("concurrent settings changes cannot reorder requests for one agent or affect another agent", async () => {
  const controller = settings.createSettingsUpdateCoordinator();
  let finish;
  const commits = [];
  const first = controller.update("first", {}, () => new Promise((resolve) => { finish = resolve; }), (id) => commits.push(id));
  await assert.rejects(controller.update("first", {}, async () => { assert.fail("duplicate request sent"); }, () => {}), /still being saved/);
  await controller.update("second", {}, async () => snapshot, (id) => commits.push(id));
  finish(snapshot);
  await first;
  assert.deepEqual(commits, ["second", "first"]);
});

test("authoritative snapshots preserve Ultra and reject unconfirmed legacy responses", () => {
  assert.equal(settings.readAgentSettingsSnapshot(snapshot).reasoning_effort, "ultra");
  assert.equal(settings.confirmedAgentSettings(snapshot).reasoningEffort, "ultra");
  assert.equal(settings.readAgentSettingsSnapshot(undefined), null);
  assert.equal(settings.readAgentSettingsSnapshot({ ...snapshot, reasoning_effort: undefined }), null);
  assert.equal(settings.readAgentSettingsSnapshot({ ...snapshot, reasoning_effort: "unrecognized" }), null);
});

test("server reconciliation corrects stale saved reasoning instead of trusting the browser label", () => {
  const saved = { model: "gpt-6-astra", thinkingEnabled: false, reasoningEffort: "ultra" };
  assert.deepEqual(settings.reconcileAgentSettings(saved, { ...snapshot, reasoning_effort: "medium" }), { reasoningEffort: "medium", supportsSteering: true });
  assert.deepEqual(settings.reconcileAgentSettings(saved, snapshot), { supportsSteering: true });
  assert.deepEqual(settings.reconcileAgentSettings(saved, { ...snapshot, reasoning_effort: undefined }), { reasoningEffort: undefined, supportsSteering: false });
});

test("steering accepts busy Codex messages but blocks busy Claude, empty input, and outstanding requests", () => {
  const agent = { cliType: "codex", status: "working", supportsSteering: true };
  assert.equal(settings.canSendAgentMessage("Steer the current task", 0, false, false, agent), true);
  assert.equal(settings.canSendAgentMessage("", 1, false, false, agent), true);
  assert.equal(settings.canSendAgentMessage(" ", 0, false, false, agent), false);
  assert.equal(settings.canSendAgentMessage("instruction", 0, true, false, agent), false);
  assert.equal(settings.canSendAgentMessage("instruction", 0, false, true, agent), false);
  assert.equal(settings.canSendAgentMessage("instruction", 0, false, false, { cliType: "claude", status: "working" }), false);
  assert.equal(settings.canSendAgentMessage("instruction", 0, false, false, { cliType: "claude", status: "idle" }), true);
});

test("legacy or unconfirmed runtimes cannot steer even when a saved config says Ultra", () => {
  const saved = { cliType: "codex", status: "working", reasoningEffort: "ultra" };
  assert.equal(settings.canSendAgentMessage("instruction", 0, false, false, saved), false);
  assert.equal(settings.canSendAgentMessage("instruction", 0, false, false, { ...saved, supportsSteering: false }), false);
  assert.equal(settings.canSendAgentMessage("instruction", 0, false, false, { ...saved, status: "idle" }), true);
  assert.equal(settings.canSendAgentMessage("instruction", 0, false, false, saved, true), true);
  assert.equal(settings.canSendAgentMessage("instruction", 0, false, false, { ...saved, cliType: "claude", supportsSteering: true }, true), false);
  const confirmed = { ...saved, ...settings.confirmedAgentSettings(snapshot) };
  assert.equal(settings.canSendAgentMessage("instruction", 0, false, false, confirmed), true);
  const legacy = { ...confirmed, ...settings.reconcileAgentSettings(confirmed, { ...snapshot, reasoning_effort: undefined }) };
  assert.equal(settings.canSendAgentMessage("instruction", 0, false, false, legacy), false);
});

test("workspace saves omit steering capability and restored configs require a fresh server snapshot", async () => {
  let agents = [{ id: "parent", name: "Parent", workingDirectory: "/workspace", position: { x: 0, y: 0, z: 0 }, cliType: "codex", status: "working", runtime: "hosted", ...settings.confirmedAgentSettings(snapshot) }];
  let saved;
  const addedCapabilities = [];
  const agentStore = {
    get agents() { return agents; },
    clearAllAgents() { agents = []; },
    addAgent(agent) { addedCapabilities.push(agent.supportsSteering); agents.push(agent); },
    updateAgent(id, changes) { Object.assign(agents.find((agent) => agent.id === id), changes); },
  };
  let server = { id: "parent", name: "Parent", working_dir: "/workspace", cli_type: "codex", status: "working", runtime: "hosted", ...snapshot, reasoning_effort: undefined };
  const { useWorkspaceStore: workspace } = loadTs("../stores/workspaceStore.ts", {
    zustand: { create: (initialize) => initialize(() => {}) },
    "./agentStore": { useAgentStore: { getState: () => agentStore } },
    "./terminalStore": { useTerminalStore: { getState: () => ({ clearAllTerminals() {} }) } },
    "@virtual-agency/shared": { MCP_SERVERS: [] },
    "../lib/api": {
      saveWorkspace: async (value) => { saved = value; },
      loadWorkspace: async () => ({ ...saved, agents: saved.agents.map((agent) => ({ ...agent, supportsSteering: true })) }),
      isTauri: () => false,
      listAgentDetails: async () => [server],
      listTerminals: async () => [],
      setAgentRuntime() {}, replaceAgentRuntimeMap() {}, getAgentRuntime: () => "hosted",
    },
  });
  await workspace.save();
  assert.equal(saved.agents[0].reasoning_effort, "ultra");
  assert.equal(Object.hasOwn(saved.agents[0], "supportsSteering"), false);
  await workspace.load();
  assert.equal(addedCapabilities[0], undefined, "saved capability must never be restored");
  assert.equal(agents[0].supportsSteering, false);
  server = { ...server, reasoning_effort: "ultra" };
  await workspace.load();
  assert.equal(agents[0].supportsSteering, true);
});

const { codexDelegationActivity } = loadTs("./codexDelegation.ts");
test("subagent activity retains tasks, IDs and results with bounded output", () => {
  const activity = codexDelegationActivity({
    type: "collab_agent_tool_call", tool: "spawn_agent", status: "completed", prompt: "Inspect the parser",
    receiver_thread_ids: ["child"], agents_states: { child: { status: "completed", message: "Found a race" } },
  });
  assert.equal(activity.text, "Delegate task");
  assert.deepEqual(activity.delegation.agents, [{ id: "child", status: "completed", message: "Found a race" }]);
  assert.equal(activity.delegation.prompt, "Inspect the parser");
  const large = codexDelegationActivity({ type: "collab_agent_tool_call", prompt: "x".repeat(10000), receiver_thread_ids: Array.from({ length: 100 }, (_, i) => String(i)) });
  assert.equal(large.delegation.prompt.length, 4000);
  assert.equal(large.delegation.agents.length, 20);
});

test("partial subagent updates retain the task and terminal call status", () => {
  const previous = codexDelegationActivity({ type: "collab_agent_tool_call", tool: "wait", status: "completed", prompt: "Review", receiver_thread_ids: ["child"] });
  const next = codexDelegationActivity({ type: "collabAgentToolCall", status: "in_progress", agentsStates: { child: { status: "completed", message: "Done" } } }, previous.delegation);
  assert.equal(next.delegation.status, "completed");
  assert.equal(next.delegation.prompt, "Review");
  assert.equal(next.delegation.agents[0].message, "Done");
  assert.equal(codexDelegationActivity({ type: "command_execution" }), null);
});

function chatHarness() {
  const messages = [];
  const agentUpdates = [];
  let output;
  const state = {
    messages,
    addUserMessage() {},
    addAssistantMessage(agentId, content) { const id = `message-${messages.length}`; messages.push({ id, agentId, content, role: "assistant", isStreaming: true }); return id; },
    addActivityMessage(agentId, content, activityType, activityDetails, diffData, todoData, thinkingContent, thinkingTokens, delegation) {
      const id = `message-${messages.length}`;
      messages.push({ id, agentId, content, activityType, activityDetails, diffData, todoData, thinkingContent, thinkingTokens, delegation, role: "activity" });
      return id;
    },
    updateMessage(id, updates) { Object.assign(messages.find((message) => message.id === id), updates); },
    addActivity() {},
    finishStreaming(agentId) { messages.filter((message) => message.agentId === agentId).forEach((message) => { message.isStreaming = false; }); },
  };
  const useChatStore = Object.assign((selector) => selector(state), { getState: () => state });
  const agentState = { updateAgent: (...args) => agentUpdates.push(args), agents: [] };
  const useAgentStore = Object.assign((selector) => selector(agentState), { getState: () => agentState });
  const { useChatMessages } = loadTs("../hooks/useChatMessages.ts", {
    react: { useCallback: (fn) => fn, useRef: (value) => ({ current: value }) },
    "./useTauriEvents": { useAgentOutputListener: (callback) => { output = callback; }, useAgentUserMessageListener() {} },
    "../stores/chatStore": { useChatStore },
    "../stores/agentStore": { useAgentStore },
    "../lib/api": { fetchAgentApi: () => { throw new Error("Unexpected API request in offline test"); } },
  });
  useChatMessages();
  return { messages, agentUpdates, emit: (event, agentId = "parent") => output({ agent_id: agentId, stream: "stdout", data: JSON.stringify(event) }) };
}

test("real chat parser coalesces subagent start/update/completion in the parent chat", () => {
  const chat = chatHarness();
  const item = { id: "task-1", type: "collab_agent_tool_call", tool: "spawn_agent", prompt: "Inspect parser" };
  chat.emit({ type: "item.started", item: { ...item, status: "in_progress" } });
  chat.emit({ type: "item.updated", item: { ...item, receiver_thread_ids: ["child"], agents_states: { child: { status: "running" } } } });
  const completion = { type: "item.completed", item: { ...item, status: "completed", agents_states: { child: { status: "completed", message: "Done" } } } };
  chat.emit(completion);
  chat.emit(completion);
  assert.equal(chat.messages.length, 1);
  assert.equal(chat.messages[0].agentId, "parent");
  assert.equal(chat.messages[0].delegation.agents[0].message, "Done");
  assert.equal(chat.messages[0].delegation.status, "completed");
  assert.deepEqual(chat.agentUpdates, []);
});

test("subagent lifecycle coalesces changing item IDs by internal thread across turns", () => {
  const chat = chatHarness();
  chat.emit({ type: "item.completed", item: { id: "activity-1", type: "subAgentActivity", agentThreadId: "child-1", agentPath: "/root/reviewer", kind: "started" } });
  assert.equal(chat.messages[0].delegation.status, "running");
  chat.emit({ type: "turn.started" });
  chat.emit({ type: "item.completed", item: { id: "activity-2", type: "sub_agent_activity", agent_thread_id: "child-1", agent_path: "/root/reviewer", kind: "interacted" } });
  chat.emit({ type: "item.completed", item: { id: "activity-3", type: "sub_agent_activity", agent_thread_id: "child-1", kind: "completed" } });
  assert.equal(chat.messages.length, 1);
  assert.equal(chat.messages[0].agentId, "parent");
  assert.deepEqual(chat.messages[0].delegation.agents, [{ id: "child-1", path: "/root/reviewer", status: "completed" }]);
  chat.emit({ type: "item.completed", item: { id: "activity-4", type: "sub_agent_activity", agent_thread_id: "child-2", agent_path: "/root/helper", kind: "interrupted" } });
  assert.equal(chat.messages.length, 2);
  assert.equal(chat.messages[1].delegation.status, "interrupted");
  assert.deepEqual(chat.agentUpdates, []);
});

test("streamed commentary and final response update their own item and finish exactly once", () => {
  const chat = chatHarness();
  chat.emit({ type: "item.updated", item: { id: "commentary", type: "agent_message", phase: "commentary", text: "Checking" } });
  chat.emit({ type: "item.updated", item: { id: "commentary", type: "agent_message", phase: "commentary", text: "Checking files" } });
  chat.emit({ type: "item.completed", item: { id: "commentary", type: "agent_message", phase: "commentary", text: "Checked files" } });
  chat.emit({ type: "item.updated", item: { id: "commentary", type: "agent_message", text: "late stale delta" } });
  const final = { type: "item.completed", item: { id: "answer", type: "agent_message", phase: "final_answer", text: "The fix is ready" } };
  chat.emit(final);
  chat.emit(final);
  assert.equal(chat.messages.length, 2);
  assert.deepEqual(chat.messages.map(({ content, phase, isStreaming }) => ({ content, phase, isStreaming })), [
    { content: "Checked files", phase: "commentary", isStreaming: false },
    { content: "The fix is ready", phase: "final", isStreaming: false },
  ]);
});

test("empty public reasoning summaries never create cards or expose raw content", () => {
  const chat = chatHarness();
  for (const summary of [[], "", ["", "  "], null, {}, [null, {}]]) {
    const item = { id: `empty-${JSON.stringify(summary)}`, type: "reasoning", text: "", summary, content: ["raw content must not be displayed"] };
    for (const type of ["item.started", "item.updated", "item.completed"]) chat.emit({ type, item });
  }
  assert.deepEqual(chat.messages, []);
});

test("reasoning summaries coalesce by item, preserve streamed text, and ignore late snapshots", () => {
  const chat = chatHarness();
  const item = { id: "summary-1", type: "reasoning", summary: [] };
  chat.emit({ type: "item.started", item });
  chat.emit({ type: "item.updated", item: { ...item, text: "Checking" } });
  chat.emit({ type: "item.updated", item: { ...item, text: "Checking the request." } });
  chat.emit({ type: "item.completed", item: { id: "summary-2", type: "reasoning", summary: ["Validating", "the result."] } });
  chat.emit({ type: "item.completed", item });
  chat.emit({ type: "item.updated", item: { ...item, text: "stale text" } });
  chat.emit({ type: "item.completed", item });
  assert.deepEqual(chat.messages.map(({ thinkingContent, isStreaming }) => ({ thinkingContent, isStreaming })), [
    { thinkingContent: "Checking the request.", isStreaming: false },
    { thinkingContent: "Validating\nthe result.", isStreaming: false },
  ]);
});

test("restored chat history hides legacy blank reasoning cards and keeps populated cards", () => {
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const { ChatHistory } = loadTs("../components/Panels/ChatHistory.tsx", {
    "react-markdown": ({ children }) => React.createElement("div", null, children),
    "remark-gfm": () => {},
    "../../stores/chatStore": { useChatStore: (selector) => selector({ activities: {} }) },
    "../../stores/agentStore": { useAgentStore: (selector) => selector({ agents: [{ id: "parent", cliType: "codex" }] }) },
    "../../stores/chatUIStore": { useChatUIStore: (selector) => selector({ isUserAtBottomByAgent: {}, setIsUserAtBottom() {}, setScrollTop() {} }) },
    "@tauri-apps/api/core": { convertFileSrc: (value) => value },
    "../../lib/api": { isTauri: () => false },
  });
  const base = { agentId: "parent", role: "activity", activityType: "thinking", timestamp: Date.now() };
  const messages = [
    { ...base, id: "blank-array", content: "Blank array", thinkingContent: [] },
    { ...base, id: "blank-string", content: "Blank string", thinkingContent: "  " },
    { ...base, id: "valid", content: "Populated summary", thinkingContent: "Checking the request." },
  ];
  const markup = renderToStaticMarkup(React.createElement(ChatHistory, { messages, agentId: "parent" }));
  assert.doesNotMatch(markup, /Blank array|Blank string/);
  assert.match(markup, /Populated summary/);
});

test("working-agent composer renders both Send and Stop", () => {
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const agent = { id: "parent", cliType: "codex", model: "gpt-6-astra", reasoningEffort: "ultra", status: "working", supportsSteering: true };
  const chatState = { getDraft: () => "Please focus on the parser", addUserMessage() {}, setDraft() {}, clearDraft() {} };
  const agentState = { agents: [agent], updateAgent() {} };
  const imageState = { draftImagesByAgent: {}, addDraftImages() {}, removeDraftImage() {}, clearDraftImages() {} };
  const shared = loadTs("../../../../packages/shared/src/types/agent.ts");
  const { ChatPanel } = loadTs("../components/Panels/ChatPanel.tsx", {
    "../../lib/api": { isTauri: () => false },
    "../../stores/chatStore": { useChatStore: (selector) => selector(chatState) },
    "../../stores/agentStore": { useAgentStore: (selector) => selector(agentState) },
    "../../stores/chatUIStore": { useChatUIStore: (selector) => selector(imageState) },
    "@virtual-agency/shared": shared,
    "@tauri-apps/api/core": {}, "@tauri-apps/plugin-fs": {}, "@tauri-apps/api/path": {}, "@tauri-apps/plugin-clipboard-manager": {},
    "../../hooks/useIsMobile": { useIsMobile: () => false },
  });
  const html = renderToStaticMarkup(React.createElement(ChatPanel, { agentId: "parent" }));
  assert.match(html, /aria-label="Stop agent"/);
  const sendButton = html.match(/<button[^>]*aria-label="Send message"[^>]*>/)?.[0];
  assert.ok(sendButton);
  assert.doesNotMatch(sendButton, /disabled/);
  assert.match(html, /steer the current task/);
  assert.match(html, /changes apply to the next turn/);
  agent.supportsSteering = false;
  const legacyHtml = renderToStaticMarkup(React.createElement(ChatPanel, { agentId: "parent" }));
  assert.match(legacyHtml, /aria-label="Stop agent"/);
  assert.doesNotMatch(legacyHtml, /aria-label="Send message"/);
  assert.match(legacyHtml, /requires a compatible server/);
  assert.doesNotMatch(legacyHtml, /Add an instruction to the current task/);
  agent.cliType = "claude";
  agent.model = "sonnet";
  const claudeHtml = renderToStaticMarkup(React.createElement(ChatPanel, { agentId: "parent" }));
  assert.match(claudeHtml, /aria-label="Stop agent"/);
  assert.doesNotMatch(claudeHtml, /aria-label="Send message"/);
  assert.doesNotMatch(claudeHtml, /steer the current task/);
});

// Drive the component's actual event handlers with deterministic hook storage.
// The separate React server-render test above checks the real rendered controls.
function composerHarness(apiOverrides = {}) {
  const slots = [];
  let cursor = 0;
  const React = require("react");
  const agent = { id: "parent", cliType: "codex", model: "gpt-6-astra", reasoningEffort: "ultra", status: "working", supportsSteering: true };
  const changes = [];
  const accepted = [];
  let cleared = 0;
  const chatState = { getDraft: () => "Review the parser", addUserMessage: (...args) => accepted.push(args), setDraft() {}, clearDraft: () => { cleared++; } };
  const agentState = { agents: [agent], updateAgent: (...args) => changes.push(args) };
  const imageState = { draftImagesByAgent: {}, addDraftImages() {}, removeDraftImage() {}, clearDraftImages() {} };
  const { ChatPanel } = loadTs("../components/Panels/ChatPanel.tsx", {
    react: {
      ...React,
      useState(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
        return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
      },
      useRef(initial) { const index = cursor++; return slots[index] ||= { current: initial }; },
      useCallback: (callback) => callback,
      useEffect() {},
    },
    "../../lib/api": { isTauri: () => false, ...apiOverrides },
    "../../stores/chatStore": { useChatStore: (selector) => selector(chatState) },
    "../../stores/agentStore": { useAgentStore: (selector) => selector(agentState) },
    "../../stores/chatUIStore": { useChatUIStore: (selector) => selector(imageState) },
    "@virtual-agency/shared": loadTs("../../../../packages/shared/src/types/agent.ts"),
    "@tauri-apps/api/core": {}, "@tauri-apps/plugin-fs": {}, "@tauri-apps/api/path": {}, "@tauri-apps/plugin-clipboard-manager": {},
    "../../hooks/useIsMobile": { useIsMobile: () => false },
  });
  function elements() {
    cursor = 0;
    const root = ChatPanel({ agentId: "parent" });
    const result = [];
    function walk(node) {
      if (Array.isArray(node)) node.forEach(walk);
      else if (node && typeof node === "object" && node.props) { result.push(node); walk(node.props.children); }
    }
    walk(root);
    return result;
  }
  return {
    agent, changes, accepted,
    cleared: () => cleared,
    find: (predicate) => elements().find(predicate),
    button: (label) => elements().find((element) => element.type === "button" && element.props["aria-label"] === label),
    alerts: () => elements().filter((element) => element.props.role === "alert").map((element) => [element.props.children].flat(Infinity).join("")),
  };
}

test("Enter cannot bypass the legacy-runtime guard or clear the unsent draft", async () => {
  let requests = 0;
  const ui = composerHarness({ sendMessage: async () => { requests++; } });
  ui.agent.supportsSteering = false;
  assert.equal(ui.button("Send message"), undefined);
  ui.find((element) => element.type === "textarea").props.onKeyDown({ key: "Enter", shiftKey: false, preventDefault() {} });
  await Promise.resolve();
  assert.equal(requests, 0);
  assert.equal(ui.cleared(), 0);
  assert.deepEqual(ui.accepted, []);
});

test("failed settings in the actual composer retain Ultra, block send while pending, and show the failure", async () => {
  let reject;
  const ui = composerHarness({ updateAgentSettings: () => new Promise((_resolve, fail) => { reject = fail; }) });
  const pending = ui.find((element) => element.type === "select" && element.props.value === "ultra").props.onChange({ target: { value: "high" } });
  assert.equal(ui.button("Send message").props.disabled, true);
  assert.deepEqual(ui.changes, []);
  reject(new Error("Settings rejected"));
  await pending;
  assert.equal(ui.find((element) => element.type === "select" && element.props.value === "ultra").props.value, "ultra");
  assert.match(ui.alerts().join(" "), /Settings rejected/);
  assert.deepEqual(ui.changes, []);
  assert.equal(ui.button("Send message").props.disabled, false);
});

test("rejected steering preserves the draft and active status without adding an accepted message", async () => {
  const ui = composerHarness({ sendMessage: async () => { throw new Error("The active turn changed"); } });
  await ui.button("Send message").props.onClick();
  assert.equal(ui.find((element) => element.type === "textarea").props.value, "Review the parser");
  assert.equal(ui.cleared(), 0);
  assert.deepEqual(ui.accepted, []);
  assert.deepEqual(ui.changes, []);
  assert.match(ui.alerts().join(" "), /Message was not accepted: The active turn changed/);
});

test("accepted steering clears only after acknowledgement and duplicate clicks submit once", async () => {
  let acknowledge;
  let requests = 0;
  const ui = composerHarness({ sendMessage: () => { requests++; return new Promise((resolve) => { acknowledge = resolve; }); } });
  const pending = ui.button("Send message").props.onClick();
  await ui.button("Send message").props.onClick();
  assert.equal(requests, 1);
  assert.equal(ui.cleared(), 0);
  assert.deepEqual(ui.accepted, []);
  acknowledge();
  await pending;
  assert.equal(ui.cleared(), 1);
  assert.equal(ui.accepted.length, 1);
  assert.equal(ui.accepted[0][0], "parent");
  assert.equal(ui.find((element) => element.type === "textarea").props.value, "");
  assert.deepEqual(ui.changes, []);
});

test("stop is single-flight, blocks another send, and surfaces an interruption failure", async () => {
  let reject;
  let requests = 0;
  const ui = composerHarness({ stopAgent: () => { requests++; return new Promise((_resolve, fail) => { reject = fail; }); } });
  const pending = ui.button("Stop agent").props.onClick();
  await ui.button("Stop agent").props.onClick();
  assert.equal(requests, 1);
  assert.equal(ui.button("Stop agent").props.disabled, true);
  assert.equal(ui.button("Send message").props.disabled, true);
  reject(new Error("Interrupt rejected"));
  await pending;
  assert.equal(ui.button("Stop agent").props.disabled, false);
  assert.match(ui.alerts().join(" "), /Could not stop the agent: Interrupt rejected/);
  assert.deepEqual(ui.changes, []);
});
