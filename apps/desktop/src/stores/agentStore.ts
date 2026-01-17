import { create } from "zustand";
import type { Agent } from "@virtual-agency/shared";

interface AgentState {
  agents: Agent[];
  selectedAgent: Agent | null;
  addAgent: (agent: Agent) => void;
  removeAgent: (id: string) => void;
  selectAgent: (id: string | null) => void;
  updateAgent: (id: string, updates: Partial<Agent>) => void;
  clearAllAgents: () => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  agents: [],
  selectedAgent: null,

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
      agents: state.agents.map((a) => (a.id === id ? { ...a, ...updates } : a)),
      selectedAgent:
        state.selectedAgent?.id === id
          ? { ...state.selectedAgent, ...updates }
          : state.selectedAgent,
    })),

  clearAllAgents: () =>
    set({
      agents: [],
      selectedAgent: null,
    }),
}));
