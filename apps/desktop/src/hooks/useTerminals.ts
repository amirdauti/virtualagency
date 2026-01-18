import { useCallback, useState, useEffect, useRef } from "react";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://127.0.0.1:3001";
const WS_URL = import.meta.env.VITE_WS_URL || "ws://127.0.0.1:3001/ws";

export interface TerminalSession {
  id: string;
  workingDir: string;
  name: string;
}

export function useTerminals() {
  const [terminals, setTerminals] = useState<TerminalSession[]>([]);
  const outputCallbacksRef = useRef<Map<string, (data: string) => void>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);

  // Connect to WebSocket for terminal I/O
  useEffect(() => {
    const connectWs = () => {
      const ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        console.log("[useTerminals] WebSocket connected");
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "terminal-output") {
            const output = msg as { type: string; terminal_id: string; data: string };
            const callback = outputCallbacksRef.current.get(output.terminal_id);
            if (callback) {
              callback(output.data);
            }
          }
        } catch (e) {
          console.error("[useTerminals] Failed to parse message:", e);
        }
      };

      ws.onclose = () => {
        console.log("[useTerminals] WebSocket closed, reconnecting...");
        setTimeout(connectWs, 2000);
      };

      ws.onerror = (error) => {
        console.error("[useTerminals] WebSocket error:", error);
      };

      wsRef.current = ws;
    };

    connectWs();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
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
        const session: TerminalSession = {
          id: data.id,
          workingDir: data.working_dir,
          name: name || `Terminal`,
        };

        setTerminals((prev) => {
          const newName = `Terminal ${prev.length + 1}`;
          return [...prev, { ...session, name: name || newName }];
        });
        return session;
      } catch (error) {
        console.error("[useTerminals] Failed to create terminal:", error);
        return null;
      }
    },
    []
  );

  // Kill a terminal
  const killTerminal = useCallback(async (terminalId: string) => {
    try {
      await fetch(`${SERVER_URL}/api/terminals/${terminalId}`, {
        method: "DELETE",
      });

      setTerminals((prev) => prev.filter((t) => t.id !== terminalId));
      outputCallbacksRef.current.delete(terminalId);
    } catch (error) {
      console.error("[useTerminals] Failed to kill terminal:", error);
    }
  }, []);

  // Send input to a terminal
  const sendInput = useCallback((terminalId: string, data: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
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
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
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

      // Return unregister function
      return () => {
        outputCallbacksRef.current.delete(terminalId);
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
