import { create } from "zustand";
import { useAgentStore } from "./agentStore";
import {
  saveWorkspace,
  loadWorkspace,
  WorkspaceData,
  SavedAgent,
  createAgent,
} from "../lib/api";
import type { Agent } from "@virtual-agency/shared";

interface WorkspaceState {
  isLoading: boolean;
  lastSaved: number | null;
  error: string | null;
  save: () => Promise<void>;
  load: () => Promise<void>;
}

// Convert Agent to SavedAgent format for persistence
function agentToSaved(agent: Agent): SavedAgent {
  return {
    id: agent.id,
    name: agent.name,
    working_directory: agent.workingDirectory,
    position: agent.position,
    avatar_id: agent.avatarId,
    model: agent.model,
    thinking_enabled: agent.thinkingEnabled,
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
    status: "idle",
    position,
    workingDirectory: saved.working_directory,
    createdAt: new Date().toISOString(),
    avatarId: saved.avatar_id,
    model: saved.model,
    thinkingEnabled: saved.thinking_enabled,
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

      if (data && data.agents.length > 0) {
        const agentStore = useAgentStore.getState();

        // Clear existing agents first to avoid duplicates
        agentStore.clearAllAgents();

        // Load saved agents and spawn their CLI processes
        for (let index = 0; index < data.agents.length; index++) {
          const saved = data.agents[index];
          const agent = savedToAgent(saved, index);

          try {
            // Spawn the CLI process for this agent
            await createAgent(agent.id, agent.workingDirectory);
            agentStore.addAgent(agent);
          } catch (err) {
            console.error(`Failed to spawn agent ${agent.name}:`, err);
            // Add agent anyway but mark as error state
            agentStore.addAgent({ ...agent, status: "error" });
          }
        }
      }

      set({ isLoading: false, lastSaved: Date.now() });
    } catch (err) {
      console.error("Failed to load workspace:", err);
      set({ isLoading: false, error: String(err) });
    }
  },
}));

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
