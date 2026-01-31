import { create } from "zustand";

const MAX_CHUNKS_PER_TERMINAL = 2000;

interface TerminalOutputState {
  buffers: Record<string, string[]>;
  append: (terminalId: string, data: string) => void;
  drain: (terminalId: string) => string;
  clear: (terminalId: string) => void;
  clearAll: () => void;
}

export const useTerminalOutputStore = create<TerminalOutputState>((set, get) => ({
  buffers: {},

  append: (terminalId, data) =>
    set((state) => {
      const existing = state.buffers[terminalId] || [];
      const next = [...existing, data];
      const trimmed = next.length > MAX_CHUNKS_PER_TERMINAL ? next.slice(-MAX_CHUNKS_PER_TERMINAL) : next;
      return { buffers: { ...state.buffers, [terminalId]: trimmed } };
    }),

  drain: (terminalId) => {
    const chunks = get().buffers[terminalId] || [];
    if (chunks.length === 0) return "";
    set((state) => {
      const { [terminalId]: _removed, ...rest } = state.buffers;
      return { buffers: rest };
    });
    return chunks.join("");
  },

  clear: (terminalId) =>
    set((state) => {
      const { [terminalId]: _removed, ...rest } = state.buffers;
      return { buffers: rest };
    }),

  clearAll: () => set({ buffers: {} }),
}));

// Global callback registry: terminalId -> output consumer (xterm writer)
const outputCallbacks = new Map<string, (data: string) => void>();

export function registerTerminalOutputCallback(
  terminalId: string,
  callback: (data: string) => void
): () => void {
  outputCallbacks.set(terminalId, callback);
  return () => {
    outputCallbacks.delete(terminalId);
  };
}

export function emitTerminalOutput(terminalId: string, data: string) {
  const callback = outputCallbacks.get(terminalId);
  if (callback) {
    callback(data);
    return;
  }
  useTerminalOutputStore.getState().append(terminalId, data);
}

export function clearTerminalOutputCallback(terminalId: string) {
  outputCallbacks.delete(terminalId);
}

