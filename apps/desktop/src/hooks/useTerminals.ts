import { useCallback, useEffect, useRef } from "react";
import { fetchAgentApi } from "../lib/api";
import { useTerminalStore } from "../stores/terminalStore";
import { disposeTerminalInstance } from "../stores/terminalInstanceStore";
import {
  clearTerminalOutputCallback,
  registerTerminalOutputCallback,
  useTerminalOutputStore,
} from "../stores/terminalOutputStore";

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
  const inputBuffersRef = useRef(new Map<string, string>());
  const inputTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const flushInputBuffer = useCallback((terminalId: string) => {
    const timer = inputTimersRef.current.get(terminalId);
    if (timer) {
      clearTimeout(timer);
      inputTimersRef.current.delete(terminalId);
    }

    const buffered = inputBuffersRef.current.get(terminalId);
    if (!buffered || buffered.length === 0) return;
    inputBuffersRef.current.delete(terminalId);

    void fetchAgentApi<void>(agentId, `/api/terminals/${terminalId}/input`, {
      method: "POST",
      body: JSON.stringify({ data: buffered }),
    }).catch((err) => {
      console.warn("[useTerminals] Failed to send terminal input:", err);
    });
  }, [agentId]);

  useEffect(() => {
    return () => {
      for (const timer of inputTimersRef.current.values()) {
        clearTimeout(timer);
      }
      inputTimersRef.current.clear();

      for (const terminalId of inputBuffersRef.current.keys()) {
        flushInputBuffer(terminalId);
      }
      inputBuffersRef.current.clear();
    };
  }, [flushInputBuffer]);

  // Create a new terminal
  const createTerminal = useCallback(
    async (workingDir: string, name?: string): Promise<TerminalSession | null> => {
      try {
        const data = await fetchAgentApi<{ id: string; working_dir: string }>(
          agentId,
          "/api/terminals",
          {
          method: "POST",
          body: JSON.stringify({
            working_dir: workingDir,
            cols: 80,
            rows: 24,
          }),
          },
        );
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
      await fetchAgentApi<void>(agentId, `/api/terminals/${terminalId}`, {
        method: "DELETE",
      });

      // Dispose the xterm.js instance from the persistent store
      disposeTerminalInstance(terminalId);

      removeTerminal(agentId, terminalId);
      clearTerminalOutputCallback(terminalId);
      useTerminalOutputStore.getState().clear(terminalId);
      const timer = inputTimersRef.current.get(terminalId);
      if (timer) {
        clearTimeout(timer);
        inputTimersRef.current.delete(terminalId);
      }
      inputBuffersRef.current.delete(terminalId);
    } catch (error) {
      console.error("[useTerminals] Failed to kill terminal:", error);
    }
  }, [agentId, removeTerminal]);

  // Send input to a terminal
  const sendInput = useCallback((terminalId: string, data: string) => {
    const existing = inputBuffersRef.current.get(terminalId) || "";
    const next = existing + data;
    inputBuffersRef.current.set(terminalId, next);

    // Enter-like/control input should flush immediately for snappy UX.
    const shouldFlushNow =
      data.includes("\r") ||
      data.includes("\n") ||
      data.charCodeAt(0) < 32 ||
      next.length >= 128;

    if (shouldFlushNow) {
      flushInputBuffer(terminalId);
      return;
    }

    if (inputTimersRef.current.has(terminalId)) return;
    const timer = setTimeout(() => {
      flushInputBuffer(terminalId);
    }, 8);
    inputTimersRef.current.set(terminalId, timer);
  }, [flushInputBuffer]);

  // Send resize event
  const sendResize = useCallback(
    (terminalId: string, cols: number, rows: number) => {
      void fetchAgentApi<void>(agentId, `/api/terminals/${terminalId}/resize`, {
        method: "POST",
        body: JSON.stringify({
          cols,
          rows,
        }),
      }).catch((err) => {
        console.warn("[useTerminals] Failed to resize terminal:", err);
      });
    },
    [agentId]
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
