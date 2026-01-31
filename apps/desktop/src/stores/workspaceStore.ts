import { create } from "zustand";
import { useAgentStore } from "./agentStore";
import {
  saveWorkspace,
  loadWorkspace,
  WorkspaceData,
  SavedAgent,
  createAgent,
  isTauri,
  listAgentDetails,
} from "../lib/api";
import { MCP_SERVERS } from "@virtual-agency/shared";
import type { Agent, MCPServerId } from "@virtual-agency/shared";

interface WorkspaceState {
  isLoading: boolean;
  lastSaved: number | null;
  error: string | null;
  save: () => Promise<void>;
  load: () => Promise<void>;
}

function inferCliTypeFromModel(model?: string): "claude" | "codex" | undefined {
  if (!model) return undefined;
  if (model === "sonnet" || model === "opus" || model === "haiku") return "claude";
  return "codex";
}

function coerceMcpServers(value?: string[]): MCPServerId[] | undefined {
  if (!value || value.length === 0) return undefined;
  const allowed = new Set(MCP_SERVERS.map((s) => s.id));
  const filtered = value.filter((id): id is MCPServerId => allowed.has(id as MCPServerId));
  return filtered.length > 0 ? filtered : undefined;
}

// Convert Agent to SavedAgent format for persistence
function agentToSaved(agent: Agent): SavedAgent {
  return {
    id: agent.id,
    name: agent.name,
    working_directory: agent.workingDirectory,
    position: agent.position,
    status: agent.status,
    avatar_id: agent.avatarId,
    model: agent.model,
    thinking_enabled: agent.thinkingEnabled,
    reasoning_effort: agent.reasoningEffort,
    session_id: agent.sessionId,
    mcp_servers: agent.mcpServers,
    cli_type: agent.cliType,
    specialty: agent.specialty,
  };
}

// Convert SavedAgent to Agent format with defensive position handling
function savedToAgent(saved: SavedAgent, index: number): Agent {
  // Ensure position is valid, fallback to grid position if not
  const position = saved.position &&
    typeof saved.position.x === 'number' &&
    typeof saved.position.z === 'number'
    ? saved.position
    : {
        x: (index % 5) * 2 - 4,
        y: 0,
        z: Math.floor(index / 5) * 2 - 2,
      };

  return {
    id: saved.id,
    name: saved.name,
    status: saved.status || "idle",
    position,
    workingDirectory: saved.working_directory,
    createdAt: new Date().toISOString(),
    avatarId: saved.avatar_id,
    model: saved.model,
    thinkingEnabled: saved.thinking_enabled,
    reasoningEffort: saved.reasoning_effort,
    specialty: saved.specialty || "normal",
    sessionId: saved.session_id,
    mcpServers: coerceMcpServers(saved.mcp_servers),
    cliType: saved.cli_type || inferCliTypeFromModel(saved.model),
  };
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  isLoading: false,
  lastSaved: null,
  error: null,

  save: async () => {
    const agents = useAgentStore.getState().agents;

    const data: WorkspaceData = {
      agents: agents.map(agentToSaved),
      version: 1,
    };

    try {
      await saveWorkspace(data);
      set({ lastSaved: Date.now(), error: null });
    } catch (err) {
      console.error("Failed to save workspace:", err);
      set({ error: String(err) });
    }
  },

  load: async () => {
    set({ isLoading: true, error: null });

    try {
      const data = await loadWorkspace();

      const agentStore = useAgentStore.getState();

      // Clear existing agents first to avoid duplicates
      agentStore.clearAllAgents();

      if (data && data.agents.length > 0) {
        // Load saved agents and spawn their CLI processes
        for (let index = 0; index < data.agents.length; index++) {
          const saved = data.agents[index];
          const agent = savedToAgent(saved, index);

          try {
            // Spawn the CLI process for this agent with saved model settings and session ID
            await createAgent(agent.id, agent.workingDirectory, {
              model: agent.model,
              thinkingEnabled: agent.thinkingEnabled,
              reasoningEffort: agent.reasoningEffort,
              mcpServers: agent.mcpServers,
              cliType: agent.cliType,
              specialty: agent.specialty,
              sessionId: agent.sessionId, // Pass session ID to resume conversation
            });
            agentStore.addAgent(agent);
          } catch (err) {
            console.error(`Failed to spawn agent ${agent.name}:`, err);
            // Add agent anyway but mark as error state
            agentStore.addAgent({ ...agent, status: "error" });
          }
        }
      } else if (!isTauri()) {
        // Browser mode fallback: if we have agents running on the server but no saved workspace,
        // still render them so a refresh doesn't "lose" running sessions.
        try {
          const serverAgents = await listAgentDetails();
          for (let index = 0; index < serverAgents.length; index++) {
            const a = serverAgents[index];
            agentStore.addAgent({
              id: a.id,
              name: a.name,
              status: toClientStatus(a.status),
              position: {
                x: (index % 5) * 2 - 4,
                y: 0,
                z: Math.floor(index / 5) * 2 - 2,
              },
              workingDirectory: a.working_dir,
              createdAt: new Date().toISOString(),
              model: a.model,
              thinkingEnabled: a.thinking_enabled,
              mcpServers: coerceMcpServers(a.mcp_servers),
              cliType: a.cli_type === "codex" ? "codex" : "claude",
              specialty: a.specialty === "roblox_builder" ? "roblox_builder" : "normal",
              sessionId: a.session_id || undefined,
            });
          }
        } catch (err) {
          console.warn("[workspace] Failed to load agents from server snapshot:", err);
        }
      }

      // Browser mode: after (re)hydration, sync runtime status/session from server snapshot.
      if (!isTauri()) {
        try {
          const serverAgents = await listAgentDetails();
          const byId = new Map(serverAgents.map((a) => [a.id, a]));
          const currentAgents = useAgentStore.getState().agents;
          for (const agent of currentAgents) {
            const server = byId.get(agent.id);
            if (!server) continue;
            const nextStatus = toClientStatus(server.status);
            const nextSessionId = server.session_id || undefined;
            const updates: Partial<Agent> = {};
            if (nextStatus && nextStatus !== agent.status) updates.status = nextStatus;
            if (nextSessionId && nextSessionId !== agent.sessionId) updates.sessionId = nextSessionId;
            if (Object.keys(updates).length > 0) {
              agentStore.updateAgent(agent.id, updates);
            }
          }
        } catch (err) {
          console.warn("[workspace] Failed to sync agent runtime snapshot:", err);
        }
      }

      set({ isLoading: false, lastSaved: Date.now() });
    } catch (err) {
      console.error("Failed to load workspace:", err);
      set({ isLoading: false, error: String(err) });
    }
  },
}));

function toClientStatus(status?: string): "idle" | "thinking" | "working" | "error" {
  switch (status) {
    case "thinking":
      return "thinking";
    case "working":
      return "working";
    case "error":
      return "error";
    case "exited":
      return "error";
    case "idle":
    default:
      return "idle";
  }
}

// Auto-save debounced
let saveTimeout: ReturnType<typeof setTimeout> | null = null;

export function setupAutoSave() {
  // Subscribe to agent store changes
  useAgentStore.subscribe((state, prevState) => {
    // Only save if agents changed
    if (state.agents !== prevState.agents) {
      // Debounce saves
      if (saveTimeout) {
        clearTimeout(saveTimeout);
      }
      saveTimeout = setTimeout(() => {
        useWorkspaceStore.getState().save();
      }, 1000); // Save 1 second after last change
    }
  });
}
