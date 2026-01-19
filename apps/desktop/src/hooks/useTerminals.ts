import { useCallback, useEffect, useRef } from "react";
import { useTerminalStore } from "../stores/terminalStore";
import { disposeTerminalInstance } from "../stores/terminalInstanceStore";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://127.0.0.1:3001";
const WS_URL = import.meta.env.VITE_WS_URL || "ws://127.0.0.1:3001/ws";

export interface TerminalSession {
  id: string;
  workingDir: string;
  name: string;
}

// Global WebSocket connection (shared across all agents)
let globalWs: WebSocket | null = null;
let wsListeners = 0;
let wsGeneration = 0; // Tracks which WebSocket instance is "current"
const outputCallbacksMap = new Map<string, (data: string) => void>();

// Stable empty array for when agent has no terminals
const EMPTY_TERMINALS: TerminalSession[] = [];

export function useTerminals(agentId: string) {
  // Use a proper selector that returns stable references
  const terminals = useTerminalStore((state) =>
    state.terminalsByAgent.get(agentId) || EMPTY_TERMINALS
  );
  const addTerminal = useTerminalStore((state) => state.addTerminal);
  const removeTerminal = useTerminalStore((state) => state.removeTerminal);
  const outputCallbacksRef = useRef<Map<string, (data: string) => void>>(new Map());

  // Connect to WebSocket for terminal I/O (shared global connection)
  useEffect(() => {
    wsListeners++;

    const connectWs = () => {
      if (globalWs && (globalWs.readyState === WebSocket.OPEN || globalWs.readyState === WebSocket.CONNECTING)) {
        return; // Already connected or connecting
      }

      // Increment generation to invalidate any pending messages from old connections
      const currentGeneration = ++wsGeneration;
      const ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        console.log("[useTerminals] WebSocket connected (gen:", currentGeneration, ")");
      };

      ws.onmessage = (event) => {
        // Ignore messages from stale WebSocket connections
        if (currentGeneration !== wsGeneration) {
          return;
        }
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "terminal-output") {
            const output = msg as { type: string; terminal_id: string; data: string };
            // Only check global map since callbacks persist there
            const callback = outputCallbacksMap.get(output.terminal_id);
            if (callback) {
              callback(output.data);
            }
          }
        } catch (e) {
          console.error("[useTerminals] Failed to parse message:", e);
        }
      };

      ws.onclose = () => {
        // Only reconnect if this is still the current connection
        if (currentGeneration === wsGeneration) {
          console.log("[useTerminals] WebSocket closed, reconnecting...");
          globalWs = null;
          setTimeout(connectWs, 2000);
        }
      };

      ws.onerror = (error) => {
        console.error("[useTerminals] WebSocket error:", error);
      };

      globalWs = ws;
    };

    if (!globalWs) {
      connectWs();
    }

    return () => {
      wsListeners--;
      // Only close WebSocket when no components are using it
      if (wsListeners === 0 && globalWs) {
        wsGeneration++; // Invalidate any pending messages before close completes
        globalWs.close();
        globalWs = null;
      }
    };
  }, []);

  // Create a new terminal
  const createTerminal = useCallback(
    async (workingDir: string, name?: string): Promise<TerminalSession | null> => {
      try {
        const response = await fetch(`${SERVER_URL}/api/terminals`, {
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
      await fetch(`${SERVER_URL}/api/terminals/${terminalId}`, {
        method: "DELETE",
      });

      // Dispose the xterm.js instance from the persistent store
      disposeTerminalInstance(terminalId);

      removeTerminal(agentId, terminalId);
      outputCallbacksRef.current.delete(terminalId);
      outputCallbacksMap.delete(terminalId);
    } catch (error) {
      console.error("[useTerminals] Failed to kill terminal:", error);
    }
  }, [agentId, removeTerminal]);

  // Send input to a terminal
  const sendInput = useCallback((terminalId: string, data: string) => {
    if (globalWs && globalWs.readyState === WebSocket.OPEN) {
      globalWs.send(
        JSON.stringify({
          type: "terminal-input",
          terminal_id: terminalId,
          data,
        })
      );
    }
  }, []);

  // Send resize event
  const sendResize = useCallback(
    (terminalId: string, cols: number, rows: number) => {
      if (globalWs && globalWs.readyState === WebSocket.OPEN) {
        globalWs.send(
          JSON.stringify({
            type: "terminal-resize",
            terminal_id: terminalId,
            cols,
            rows,
          })
        );
      }
    },
    []
  );

  // Register output callback for a terminal
  const registerOutputCallback = useCallback(
    (terminalId: string, callback: (data: string) => void) => {
      outputCallbacksRef.current.set(terminalId, callback);
      outputCallbacksMap.set(terminalId, callback);

      // Return unregister function
      return () => {
        outputCallbacksRef.current.delete(terminalId);
        outputCallbacksMap.delete(terminalId);
      };
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
