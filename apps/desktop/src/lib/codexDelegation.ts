export interface CodexSubagent {
  id: string;
  path?: string;
  status: string;
  message?: string;
}

export interface CodexDelegation {
  tool: string;
  status: string;
  prompt?: string;
  agents: CodexSubagent[];
}

export interface CodexDelegationActivity {
  text: string;
  delegation: CodexDelegation;
}

function text(value: unknown, max = 4000): string | undefined {
  return typeof value === "string" && value.trim() ? value.slice(0, max) : undefined;
}

const TOOL_LABELS: Record<string, string> = {
  spawn_agent: "Delegate task",
  send_input: "Message subagent",
  wait: "Wait for subagents",
  wait_agent: "Wait for subagents",
  resume_agent: "Resume subagent",
  close_agent: "Close subagent",
};

const TOOL_ALIASES: Record<string, string> = {
  spawnAgent: "spawn_agent", sendInput: "send_input", waitAgent: "wait_agent",
  resumeAgent: "resume_agent", closeAgent: "close_agent",
};

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

export function codexDelegationKey(item: unknown): string | undefined {
  if (!item || typeof item !== "object") return undefined;
  const value = item as Record<string, unknown>;
  if (value.type !== "sub_agent_activity" && value.type !== "subAgentActivity") return undefined;
  const threadId = text(value.agent_thread_id || value.agentThreadId, 200);
  return threadId ? `subagent:${threadId}` : undefined;
}

/** Keep Codex's internal workers within the parent conversation. */
export function codexDelegationActivity(item: unknown, previous?: CodexDelegation): CodexDelegationActivity | null {
  if (!item || typeof item !== "object") return null;
  const value = item as Record<string, unknown>;
  if (value.type === "sub_agent_activity" || value.type === "subAgentActivity") {
    const id = text(value.agent_thread_id || value.agentThreadId, 200);
    if (!id) return null;
    const agentPath = text(value.agent_path || value.agentPath, 300);
    const kind = text(value.kind, 100);
    const status = kind === "started" || kind === "interacted" ? "running"
      : kind === "completed" || kind === "interrupted" ? kind : previous?.status || "pending";
    return {
      text: "Subagent activity",
      delegation: {
        tool: "subagent_activity", status,
        agents: [{ id, path: agentPath || previous?.agents[0]?.path, status }],
      },
    };
  }
  if (value.type !== "collab_agent_tool_call" && value.type !== "collabAgentToolCall") return null;
  const rawTool = text(value.tool, 100) || previous?.tool || "collaboration";
  const tool = TOOL_ALIASES[rawTool] || rawTool;
  const incomingStatus = text(value.status, 100) || "in_progress";
  const status = previous && TERMINAL_STATUSES.has(previous.status) && !TERMINAL_STATUSES.has(incomingStatus)
    ? previous.status : incomingStatus;
  const states = value.agents_states || value.agentsStates;
  const stateMap = states && typeof states === "object" && !Array.isArray(states)
    ? states as Record<string, unknown> : {};
  const receiverIds = value.receiver_thread_ids || value.receiverThreadIds;
  const ids = new Set<string>(previous?.agents.map((agent) => agent.id) || []);
  if (Array.isArray(receiverIds)) receiverIds.forEach((id) => { if (typeof id === "string") ids.add(id); });
  Object.keys(stateMap).forEach((id) => ids.add(id));
  const agents = [...ids].slice(0, 20).map((id): CodexSubagent => {
    const old = previous?.agents.find((agent) => agent.id === id);
    const raw = stateMap[id];
    const state = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    return {
      id,
      status: text(state.status, 100) || text(raw, 100) || old?.status || "pending",
      message: text(state.message) || old?.message,
    };
  });
  return {
    text: TOOL_LABELS[tool] || "Subagent activity",
    delegation: { tool, status, prompt: text(value.prompt) || previous?.prompt, agents },
  };
}
