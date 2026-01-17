import { useEffect, useRef } from "react";
import { isTauri, addWebSocketListener } from "../lib/api";

export interface AgentOutput {
  agent_id: string;
  stream: "stdout" | "stderr";
  data: string;
}

export interface AgentStatusChange {
  agent_id: string;
  status: "idle" | "thinking" | "working" | "error" | "exited";
}

type OutputCallback = (output: AgentOutput) => void;
type StatusCallback = (status: AgentStatusChange) => void;

/**
 * Singleton event manager that works in both Tauri and browser modes.
 * - In Tauri: Uses Tauri's event system
 * - In browser: Uses WebSocket connection to the server
 */
class EventManager {
  private outputSubscribers = new Set<OutputCallback>();
  private statusSubscribers = new Set<StatusCallback>();
  private listenerInitialized = false;

  subscribeToOutput(callback: OutputCallback): () => void {
    this.outputSubscribers.add(callback);
    this.ensureListener();

    return () => {
      this.outputSubscribers.delete(callback);
    };
  }

  subscribeToStatus(callback: StatusCallback): () => void {
    this.statusSubscribers.add(callback);
    this.ensureListener();

    return () => {
      this.statusSubscribers.delete(callback);
    };
  }

  private ensureListener() {
    if (this.listenerInitialized) return;
    this.listenerInitialized = true;

    if (isTauri()) {
      this.initTauriListeners();
    } else {
      this.initWebSocketListener();
    }
  }

  private initTauriListeners() {
    import("@tauri-apps/api/event")
      .then(({ listen }) => {
        listen<AgentOutput>("agent-output", (event) => {
          this.outputSubscribers.forEach((callback) => {
            try {
              callback(event.payload);
            } catch (err) {
              console.error("Error in output subscriber:", err);
            }
          });
        });

        listen<AgentStatusChange>("agent-status", (event) => {
          this.statusSubscribers.forEach((callback) => {
            try {
              callback(event.payload);
            } catch (err) {
              console.error("Error in status subscriber:", err);
            }
          });
        });
      })
      .catch((err) => {
        console.warn("Tauri event API not available:", err);
        this.listenerInitialized = false;
      });
  }

  private initWebSocketListener() {
    addWebSocketListener((event) => {
      try {
        const message = JSON.parse(event.data);

        if (message.type === "agent-output") {
          const output: AgentOutput = {
            agent_id: message.agent_id,
            stream: message.stream,
            data: message.data,
          };
          this.outputSubscribers.forEach((callback) => {
            try {
              callback(output);
            } catch (err) {
              console.error("Error in output subscriber:", err);
            }
          });
        } else if (message.type === "agent-status") {
          const status: AgentStatusChange = {
            agent_id: message.agent_id,
            status: message.status,
          };
          this.statusSubscribers.forEach((callback) => {
            try {
              callback(status);
            } catch (err) {
              console.error("Error in status subscriber:", err);
            }
          });
        }
      } catch (err) {
        console.error("Error parsing WebSocket message:", err);
      }
    });
  }
}

// Global singleton instance
const eventManager = new EventManager();

/**
 * Hook to subscribe to agent output events.
 * Uses a singleton event manager to prevent duplicate Tauri listeners.
 */
export function useAgentOutputListener(
  callback: (output: AgentOutput) => void
) {
  // Use ref to hold the latest callback without triggering re-subscriptions
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    // Subscribe with a stable wrapper that uses the ref
    const stableCallback = (output: AgentOutput) => {
      callbackRef.current(output);
    };

    const unsubscribe = eventManager.subscribeToOutput(stableCallback);
    return unsubscribe;
  }, []); // Empty deps - subscribe once, use ref for latest callback
}

/**
 * Hook to subscribe to agent status change events.
 * Uses a singleton event manager to prevent duplicate Tauri listeners.
 */
export function useAgentStatusListener(
  callback: (status: AgentStatusChange) => void
) {
  // Use ref to hold the latest callback without triggering re-subscriptions
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    // Subscribe with a stable wrapper that uses the ref
    const stableCallback = (status: AgentStatusChange) => {
      callbackRef.current(status);
    };

    const unsubscribe = eventManager.subscribeToStatus(stableCallback);
    return unsubscribe;
  }, []); // Empty deps - subscribe once, use ref for latest callback
}
