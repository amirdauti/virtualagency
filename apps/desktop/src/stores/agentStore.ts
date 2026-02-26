import { create } from "zustand";
import type { Agent } from "@virtual-agency/shared";

interface AgentState {
  agents: Agent[];
  selectedAgent: Agent | null;
  isWorkspacePanelVisible: boolean;
  addAgent: (agent: Agent) => void;
  removeAgent: (id: string) => void;
  selectAgent: (id: string | null) => void;
  updateAgent: (id: string, updates: Partial<Agent>) => void;
  toggleWorkspacePanel: () => void;
  setWorkspacePanelVisible: (visible: boolean) => void;
  clearAllAgents: () => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  agents: [],
  selectedAgent: null,
  isWorkspacePanelVisible: true,

  addAgent: (agent) =>
    set((state) => {
      // Prevent duplicate agents
      if (state.agents.some((a) => a.id === agent.id)) {
        return state;
      }
      return {
        agents: [...state.agents, agent],
      };
    }),

  removeAgent: (id) =>
    set((state) => ({
      agents: state.agents.filter((a) => a.id !== id),
      selectedAgent: state.selectedAgent?.id === id ? null : state.selectedAgent,
    })),

  selectAgent: (id) =>
    set((state) => ({
      selectedAgent: id ? state.agents.find((a) => a.id === id) || null : null,
    })),

  updateAgent: (id, updates) =>
    set((state) => ({
      agents: (() => {
        const idx = state.agents.findIndex((a) => a.id === id);
        if (idx === -1) return state.agents;

        const current = state.agents[idx];
        const keys = Object.keys(updates) as Array<keyof Agent>;
        const changed = keys.some((k) => current[k] !== updates[k]);
        if (!changed) return state.agents;

        return state.agents.map((a) => (a.id === id ? { ...a, ...updates } : a));
      })(),
      selectedAgent: (() => {
        if (!state.selectedAgent || state.selectedAgent.id !== id) return state.selectedAgent;
        const keys = Object.keys(updates) as Array<keyof Agent>;
        const changed = keys.some((k) => state.selectedAgent && state.selectedAgent[k] !== updates[k]);
        if (!changed) return state.selectedAgent;
        return { ...state.selectedAgent, ...updates };
      })(),
    })),

  toggleWorkspacePanel: () =>
    set((state) => ({
      isWorkspacePanelVisible: !state.isWorkspacePanelVisible,
    })),

  setWorkspacePanelVisible: (visible) =>
    set({
      isWorkspacePanelVisible: visible,
    }),

  clearAllAgents: () =>
    set({
      agents: [],
      selectedAgent: null,
    }),
}));
