import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

/**
 * Global store for xterm.js Terminal instances.
 * These are stored outside of React's lifecycle to persist across component unmounts.
 * Terminals are only destroyed when explicitly killed by the user.
 */

interface TerminalInstance {
  terminal: Terminal;
  fitAddon: FitAddon;
  element: HTMLDivElement;
  dataListener: { dispose: () => void } | null;
}

// Global map of terminalId -> Terminal instance
const terminalInstances = new Map<string, TerminalInstance>();

export function getTerminalInstance(terminalId: string): TerminalInstance | undefined {
  return terminalInstances.get(terminalId);
}

export function setTerminalInstance(terminalId: string, instance: TerminalInstance): void {
  terminalInstances.set(terminalId, instance);
}

export function disposeTerminalInstance(terminalId: string): void {
  const instance = terminalInstances.get(terminalId);
  if (instance) {
    if (instance.dataListener) {
      instance.dataListener.dispose();
    }
    instance.terminal.dispose();
    terminalInstances.delete(terminalId);
  }
}

