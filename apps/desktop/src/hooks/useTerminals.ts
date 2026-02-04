import { useCallback } from "react";
import { getServerHttpBaseUrl, sendWebSocketMessage } from "../lib/api";
import { useTerminalStore } from "../stores/terminalStore";
import { disposeTerminalInstance } from "../stores/terminalInstanceStore";
import {
  clearTerminalOutputCallback,
  registerTerminalOutputCallback,
  useTerminalOutputStore,
} from "../stores/terminalOutputStore";

async function getApiBase(): Promise<string> {
  const resolved = await getServerHttpBaseUrl();
  return resolved || "http://127.0.0.1:1337";
}

export interface TerminalSession {
  id: string;
  workingDir: string;
  name: string;
}

// Stable empty array for when agent has no terminals
const EMPTY_TERMINALS: TerminalSession[] = [];

export function useTerminals(agentId: string) {
  // Use a proper selector that returns stable references
  const terminals = useTerminalStore((state) =>
    state.terminalsByAgent.get(agentId) || EMPTY_TERMINALS
  );
  const addTerminal = useTerminalStore((state) => state.addTerminal);
  const removeTerminal = useTerminalStore((state) => state.removeTerminal);

  // Create a new terminal
  const createTerminal = useCallback(
    async (workingDir: string, name?: string): Promise<TerminalSession | null> => {
      try {
        const base = await getApiBase();
        const response = await fetch(`${base}/api/terminals`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            working_dir: workingDir,
            cols: 80,
            rows: 24,
          }),
        });

        if (!response.ok) {
          throw new Error(`Failed to create terminal: ${response.statusText}`);
        }

        const data = await response.json();
        const currentTerminals = useTerminalStore.getState().getTerminalsForAgent(agentId);
        const newName = name || `Terminal ${currentTerminals.length + 1}`;

        const session: TerminalSession = {
          id: data.id,
          workingDir: data.working_dir,
          name: newName,
        };

        addTerminal(agentId, session);
        return session;
      } catch (error) {
        console.error("[useTerminals] Failed to create terminal:", error);
        return null;
      }
    },
    [agentId, addTerminal]
  );

  // Kill a terminal
  const killTerminal = useCallback(async (terminalId: string) => {
    try {
      const base = await getApiBase();
      await fetch(`${base}/api/terminals/${terminalId}`, {
        method: "DELETE",
      });

      // Dispose the xterm.js instance from the persistent store
      disposeTerminalInstance(terminalId);

      removeTerminal(agentId, terminalId);
      clearTerminalOutputCallback(terminalId);
      useTerminalOutputStore.getState().clear(terminalId);
    } catch (error) {
      console.error("[useTerminals] Failed to kill terminal:", error);
    }
  }, [agentId, removeTerminal]);

  // Send input to a terminal
  const sendInput = useCallback((terminalId: string, data: string) => {
    sendWebSocketMessage({
      type: "terminal-input",
      terminal_id: terminalId,
      data,
    });
  }, []);

  // Send resize event
  const sendResize = useCallback(
    (terminalId: string, cols: number, rows: number) => {
      sendWebSocketMessage({
        type: "terminal-resize",
        terminal_id: terminalId,
        cols,
        rows,
      });
    },
    []
  );

  // Register output callback for a terminal
  const registerOutputCallback = useCallback(
    (terminalId: string, callback: (data: string) => void) => {
      return registerTerminalOutputCallback(terminalId, callback);
    },
    []
  );

  return {
    terminals,
    createTerminal,
    killTerminal,
    sendInput,
    sendResize,
    registerOutputCallback,
  };
}
