import type { Agent, ReasoningEffort } from "@virtual-agency/shared";

export interface AgentSettingsSnapshot {
  model: string;
  thinking_enabled: boolean;
  reasoning_effort: ReasoningEffort;
  mcp_servers: string[];
}

export interface AgentSettingsChange {
  name?: string;
  model?: string;
  thinkingEnabled?: boolean;
  reasoningEffort?: ReasoningEffort;
  mcpServers?: string[];
}

const REASONING_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max", "ultra"]);

export function readAgentSettingsSnapshot(value: unknown): AgentSettingsSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const settings = value as Record<string, unknown>;
  if (
    typeof settings.model !== "string" ||
    typeof settings.thinking_enabled !== "boolean" ||
    typeof settings.reasoning_effort !== "string" ||
    !REASONING_EFFORTS.has(settings.reasoning_effort) ||
    !Array.isArray(settings.mcp_servers) ||
    !settings.mcp_servers.every((server) => typeof server === "string")
  ) return null;
  return settings as unknown as AgentSettingsSnapshot;
}

export function confirmedAgentSettings(settings: AgentSettingsSnapshot): Pick<Agent, "model" | "thinkingEnabled" | "reasoningEffort" | "supportsSteering"> {
  return {
    model: settings.model,
    thinkingEnabled: settings.thinking_enabled,
    reasoningEffort: settings.reasoning_effort,
    supportsSteering: readAgentSettingsSnapshot(settings) !== null,
  };
}

export function reconcileAgentSettings(
  agent: Pick<Agent, "model" | "thinkingEnabled" | "reasoningEffort" | "supportsSteering">,
  server: { model: string; thinking_enabled: boolean; reasoning_effort?: ReasoningEffort; mcp_servers?: string[] },
): Partial<Agent> {
  const updates: Partial<Agent> = {};
  if (server.model !== agent.model) updates.model = server.model;
  if (server.thinking_enabled !== agent.thinkingEnabled) updates.thinkingEnabled = server.thinking_enabled;
  if (server.reasoning_effort !== agent.reasoningEffort) updates.reasoningEffort = server.reasoning_effort;
  const supportsSteering = readAgentSettingsSnapshot(server) !== null;
  if (supportsSteering !== agent.supportsSteering) updates.supportsSteering = supportsSteering;
  return updates;
}

/** Serialize settings changes per agent; never publish an unconfirmed selection. */
export function createSettingsUpdateCoordinator() {
  const pending = new Set<string>();
  return {
    isPending: (id: string) => pending.has(id),
    async update(
      id: string,
      changes: AgentSettingsChange,
      save: (id: string, changes: AgentSettingsChange) => Promise<AgentSettingsSnapshot>,
      commit: (id: string, settings: AgentSettingsSnapshot) => void,
    ): Promise<void> {
      if (pending.has(id)) throw new Error("A settings change is still being saved.");
      pending.add(id);
      try {
        const settings = await save(id, changes);
        commit(id, settings);
      } finally {
        pending.delete(id);
      }
    },
  };
}

/** Older servers start competing CLI processes on busy sends. Fail closed until confirmed. */
export function canSteerAgent(agent?: Pick<Agent, "cliType" | "supportsSteering">, native = false): boolean {
  return agent?.cliType === "codex" && (native || agent.supportsSteering === true);
}

/** Only a compatible Codex runtime supports steering; other agents must finish first. */
export function canSendAgentMessage(input: string, imageCount: number, sending: boolean, savingSettings: boolean, agent?: Pick<Agent, "cliType" | "status" | "supportsSteering">, native = false): boolean {
  const working = agent?.status === "working" || agent?.status === "thinking";
  return Boolean(agent && (input.trim() || imageCount > 0)) && !sending && !savingSettings && (!working || canSteerAgent(agent, native));
}
