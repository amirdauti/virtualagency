import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import {
  getTerminalInstance,
  setTerminalInstance,
} from "../../stores/terminalInstanceStore";

interface InteractiveTerminalProps {
  terminalId: string;
  onData: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
  onReady?: (writeFunc: (data: string) => void) => void;
}

export function InteractiveTerminal({
  terminalId,
  onData,
  onResize,
  onReady,
}: InteractiveTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Use refs to hold latest callbacks without triggering re-initialization
  const onDataRef = useRef(onData);
  const onResizeRef = useRef(onResize);
  const onReadyRef = useRef(onReady);

  // Keep refs updated
  useEffect(() => {
    onDataRef.current = onData;
  }, [onData]);

  useEffect(() => {
    onResizeRef.current = onResize;
  }, [onResize]);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  // Initialize or reattach terminal
  useEffect(() => {
    if (!containerRef.current) return;

    let terminal: Terminal;
    let fitAddon: FitAddon;
    let terminalElement: HTMLDivElement;

    const existingInstance = getTerminalInstance(terminalId);

    if (existingInstance) {
      // Reuse existing terminal instance
      terminal = existingInstance.terminal;
      fitAddon = existingInstance.fitAddon;
      terminalElement = existingInstance.element;

      // Move the terminal element into our container
      containerRef.current.appendChild(terminalElement);

      // Don't recreate the listener - it already uses onDataRef.current
      // which will always call the latest callback

      // Refit after moving to new container
      requestAnimationFrame(() => {
        fitAddon.fit();
        onResizeRef.current?.(terminal.cols, terminal.rows);
      });

      // Provide write function to parent
      const writeFunc = (data: string) => {
        terminal.write(data);
      };
      onReadyRef.current?.(writeFunc);
    } else {
      // Create new terminal instance
      terminalElement = document.createElement("div");
      terminalElement.style.width = "100%";
      terminalElement.style.height = "100%";
      containerRef.current.appendChild(terminalElement);

      terminal = new Terminal({
        cursorBlink: true,
        cursorStyle: "block",
        fontSize: 13,
        fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
        theme: {
          background: "#0d0d0d",
          foreground: "#e5e5e5",
          cursor: "#ffffff",
          cursorAccent: "#0d0d0d",
          selectionBackground: "rgba(255, 255, 255, 0.3)",
          black: "#000000",
          red: "#ef4444",
          green: "#4ade80",
          yellow: "#fbbf24",
          blue: "#3b82f6",
          magenta: "#a855f7",
          cyan: "#22d3ee",
          white: "#e5e5e5",
          brightBlack: "#666666",
          brightRed: "#f87171",
          brightGreen: "#86efac",
          brightYellow: "#fde047",
          brightBlue: "#60a5fa",
          brightMagenta: "#c084fc",
          brightCyan: "#67e8f9",
          brightWhite: "#ffffff",
        },
        allowProposedApi: true,
      });

      fitAddon = new FitAddon();
      const webLinksAddon = new WebLinksAddon();

      terminal.loadAddon(fitAddon);
      terminal.loadAddon(webLinksAddon);

      terminal.open(terminalElement);
      fitAddon.fit();

      // Handle user input
      const dataListener = terminal.onData((data) => {
        onDataRef.current(data);
      });

      // Handle resize
      terminal.onResize(({ cols, rows }) => {
        onResizeRef.current?.(cols, rows);
      });

      // Store the instance for future reuse
      setTerminalInstance(terminalId, {
        terminal,
        fitAddon,
        element: terminalElement,
        dataListener,
      });

      // Report initial size
      onResizeRef.current?.(terminal.cols, terminal.rows);

      // Provide write function to parent
      const writeFunc = (data: string) => {
        terminal.write(data);
      };
      onReadyRef.current?.(writeFunc);
    }

    // Cleanup: detach from DOM but don't dispose terminal
    return () => {
      // Just remove from DOM, don't dispose - terminal stays in store
      // Data listener stays attached for when we reattach
      if (terminalElement.parentNode) {
        terminalElement.parentNode.removeChild(terminalElement);
      }
    };
  }, [terminalId]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      const instance = getTerminalInstance(terminalId);
      if (instance) {
        instance.fitAddon.fit();
      }
    };

    window.addEventListener("resize", handleResize);

    // Also observe the container for size changes
    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      window.removeEventListener("resize", handleResize);
      resizeObserver.disconnect();
    };
  }, [terminalId]);

  return (
    <div
      ref={containerRef}
      data-terminal-id={terminalId}
      style={{
        width: "100%",
        height: "100%",
        background: "#0d0d0d",
      }}
    />
  );
}
