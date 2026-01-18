import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

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
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

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

  // Initialize terminal - only runs once per mount
  useEffect(() => {
    if (!terminalRef.current || xtermRef.current) return;

    const terminal = new Terminal({
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

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);

    terminal.open(terminalRef.current);
    fitAddon.fit();

    // Handle user input - send to backend (use ref for latest callback)
    terminal.onData((data) => {
      onDataRef.current(data);
    });

    // Handle resize (use ref for latest callback)
    terminal.onResize(({ cols, rows }) => {
      onResizeRef.current?.(cols, rows);
    });

    xtermRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Report initial size
    onResizeRef.current?.(terminal.cols, terminal.rows);

    // Provide write function to parent via callback
    const writeFunc = (data: string) => {
      terminal.write(data);
    };
    onReadyRef.current?.(writeFunc);

    return () => {
      terminal.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [terminalId]); // Only re-init if terminalId changes

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      if (fitAddonRef.current && xtermRef.current) {
        fitAddonRef.current.fit();
      }
    };

    window.addEventListener("resize", handleResize);

    // Also observe the container for size changes
    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });

    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current);
    }

    return () => {
      window.removeEventListener("resize", handleResize);
      resizeObserver.disconnect();
    };
  }, []);

  // Write data to terminal (called from parent when receiving output)
  const writeData = useCallback((data: string) => {
    if (xtermRef.current) {
      xtermRef.current.write(data);
    }
  }, []);

  // Expose write method via ref pattern
  useEffect(() => {
    // Store write function on the DOM element for parent access
    if (terminalRef.current) {
      (terminalRef.current as any).__writeData = writeData;
    }
  }, [writeData]);

  return (
    <div
      ref={terminalRef}
      data-terminal-id={terminalId}
      style={{
        width: "100%",
        height: "100%",
        background: "#0d0d0d",
      }}
    />
  );
}

