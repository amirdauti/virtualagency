import { create } from "zustand";
import type { TerminalSession } from "../hooks/useTerminals";
import { disposeTerminalInstance } from "./terminalInstanceStore";

// Stable empty array to prevent infinite re-renders
const EMPTY_TERMINALS: TerminalSession[] = [];

export type TabType = "chat" | "output" | "terminal" | "files";

interface TerminalState {
  // Map of agentId -> terminals for that agent
  terminalsByAgent: Map<string, TerminalSession[]>;

  // Per-agent UI state
  activeTerminalByAgent: Record<string, string | null>;  // agentId -> terminalId
  activeTabByAgent: Record<string, TabType>;             // agentId -> tab

  // Get terminals for a specific agent (returns stable empty array if none)
  getTerminalsForAgent: (agentId: string) => TerminalSession[];

  // Add a terminal for an agent
  addTerminal: (agentId: string, terminal: TerminalSession) => void;

  // Remove a terminal
  removeTerminal: (agentId: string, terminalId: string) => void;

  // Clear all terminals for an agent (when agent is killed)
  clearTerminalsForAgent: (agentId: string) => void;

  // Clear all terminals
  clearAllTerminals: () => void;

  // Active terminal management
  setActiveTerminal: (agentId: string, terminalId: string | null) => void;
  getActiveTerminal: (agentId: string) => string | null;

  // Active tab management
  setActiveTab: (agentId: string, tab: TabType) => void;
  getActiveTab: (agentId: string) => TabType;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  terminalsByAgent: new Map(),
  activeTerminalByAgent: {},
  activeTabByAgent: {},

  getTerminalsForAgent: (agentId) => {
    return get().terminalsByAgent.get(agentId) || EMPTY_TERMINALS;
  },

  addTerminal: (agentId, terminal) =>
    set((state) => {
      const newMap = new Map(state.terminalsByAgent);
      const existing = newMap.get(agentId) || [];
      newMap.set(agentId, [...existing, terminal]);
      return { terminalsByAgent: newMap };
    }),

  removeTerminal: (agentId, terminalId) =>
    set((state) => {
      const newMap = new Map(state.terminalsByAgent);
      const existing = newMap.get(agentId) || [];
      newMap.set(
        agentId,
        existing.filter((t) => t.id !== terminalId)
      );
      return { terminalsByAgent: newMap };
    }),

  clearTerminalsForAgent: (agentId) =>
    set((state) => {
      const newMap = new Map(state.terminalsByAgent);
      // Dispose all terminal instances for this agent
      const terminals = newMap.get(agentId) || [];
      for (const terminal of terminals) {
        disposeTerminalInstance(terminal.id);
      }
      newMap.delete(agentId);
      // Also clear UI state for this agent
      const { [agentId]: _removedTerminal, ...restTerminals } = state.activeTerminalByAgent;
      const { [agentId]: _removedTab, ...restTabs } = state.activeTabByAgent;
      return {
        terminalsByAgent: newMap,
        activeTerminalByAgent: restTerminals,
        activeTabByAgent: restTabs,
      };
    }),

  clearAllTerminals: () =>
    set((state) => {
      // Dispose all terminal instances
      for (const terminals of state.terminalsByAgent.values()) {
        for (const terminal of terminals) {
          disposeTerminalInstance(terminal.id);
        }
      }
      return { terminalsByAgent: new Map(), activeTerminalByAgent: {}, activeTabByAgent: {} };
    }),

  // Active terminal management
  setActiveTerminal: (agentId, terminalId) =>
    set((state) => ({
      activeTerminalByAgent: { ...state.activeTerminalByAgent, [agentId]: terminalId },
    })),

  getActiveTerminal: (agentId) => {
    return get().activeTerminalByAgent[agentId] ?? null;
  },

  // Active tab management
  setActiveTab: (agentId, tab) =>
    set((state) => ({
      activeTabByAgent: { ...state.activeTabByAgent, [agentId]: tab },
    })),

  getActiveTab: (agentId) => {
    return get().activeTabByAgent[agentId] ?? "chat";
  },
}));
