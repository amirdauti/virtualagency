import { useEffect } from "react";
import { addWebSocketListener, isTauri } from "../lib/api";
import { emitTerminalOutput } from "../stores/terminalOutputStore";

export function useTerminalOutputEvents() {
  useEffect(() => {
    if (isTauri()) return;

    const unsubscribe = addWebSocketListener((event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === "terminal-output") {
          const terminalId = message.terminal_id as string | undefined;
          const data = message.data as string | undefined;
          if (terminalId && typeof data === "string") {
            emitTerminalOutput(terminalId, data);
          }
        }
      } catch {
        // ignore non-JSON messages
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);
}
