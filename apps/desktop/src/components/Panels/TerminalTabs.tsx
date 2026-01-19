import { useState, useCallback, useEffect, useRef } from "react";
import { InteractiveTerminal } from "./InteractiveTerminal";
import type { TerminalSession } from "../../hooks/useTerminals";

interface TerminalTabsProps {
  terminals: TerminalSession[];
  onCreateTerminal: () => void;
  onCloseTerminal: (terminalId: string) => void;
  onSendInput: (terminalId: string, data: string) => void;
  onResize: (terminalId: string, cols: number, rows: number) => void;
  registerOutputCallback: (
    terminalId: string,
    callback: (data: string) => void
  ) => () => void;
}

export function TerminalTabs({
  terminals,
  onCreateTerminal,
  onCloseTerminal,
  onSendInput,
  onResize,
  registerOutputCallback,
}: TerminalTabsProps) {
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(
    terminals[0]?.id || null
  );

  // Update active terminal when terminals change
  useEffect(() => {
    if (terminals.length > 0 && !terminals.find((t) => t.id === activeTerminalId)) {
      setActiveTerminalId(terminals[0].id);
    } else if (terminals.length === 0) {
      setActiveTerminalId(null);
    }
  }, [terminals, activeTerminalId]);

  // Auto-activate new terminal
  useEffect(() => {
    if (terminals.length > 0) {
      const lastTerminal = terminals[terminals.length - 1];
      setActiveTerminalId(lastTerminal.id);
    }
  }, [terminals.length]);

  const handleCloseTab = useCallback(
    (e: React.MouseEvent, terminalId: string) => {
      e.stopPropagation();
      onCloseTerminal(terminalId);
    },
    [onCloseTerminal]
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "#0d0d0d",
        borderRadius: 4,
        overflow: "hidden",
      }}
    >
      {/* Tab bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "4px 8px",
          borderBottom: "1px solid var(--border)",
          background: "#1a1a1a",
          gap: 4,
          overflowX: "auto",
        }}
      >
        {terminals.map((terminal) => (
          <div
            key={terminal.id}
            onClick={() => setActiveTerminalId(terminal.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 10px",
              borderRadius: 4,
              cursor: "pointer",
              background:
                activeTerminalId === terminal.id
                  ? "var(--accent)"
                  : "transparent",
              color:
                activeTerminalId === terminal.id
                  ? "white"
                  : "var(--text-secondary)",
              fontSize: 12,
              whiteSpace: "nowrap",
              transition: "background 0.15s",
            }}
          >
            <span style={{ fontFamily: "monospace" }}>$</span>
            <span>{terminal.name}</span>
            <button
              onClick={(e) => handleCloseTab(e, terminal.id)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 16,
                height: 16,
                padding: 0,
                background: "transparent",
                border: "none",
                borderRadius: 2,
                color: "inherit",
                cursor: "pointer",
                opacity: 0.7,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.7")}
            >
              ×
            </button>
          </div>
        ))}

        {/* Add terminal button */}
        <button
          onClick={onCreateTerminal}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 24,
            height: 24,
            padding: 0,
            background: "transparent",
            border: "1px solid var(--border)",
            borderRadius: 4,
            color: "var(--text-secondary)",
            cursor: "pointer",
            fontSize: 16,
            flexShrink: 0,
          }}
          title="New Terminal"
        >
          +
        </button>
      </div>

      {/* Terminal content area */}
      <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        {terminals.length === 0 ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: "var(--text-secondary)",
              gap: 12,
            }}
          >
            <span style={{ fontSize: 14 }}>No terminals open</span>
            <button
              onClick={onCreateTerminal}
              style={{
                padding: "8px 16px",
                background: "var(--accent)",
                border: "none",
                borderRadius: 4,
                color: "white",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              Open Terminal
            </button>
          </div>
        ) : (
          <div style={{ width: "100%", height: "100%", position: "relative" }}>
            {terminals.map((terminal) => (
              <div
                key={terminal.id}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  display: activeTerminalId === terminal.id ? "block" : "none",
                }}
              >
                <TerminalWrapper
                  terminal={terminal}
                  isActive={activeTerminalId === terminal.id}
                  onSendInput={onSendInput}
                  onResize={onResize}
                  registerOutputCallback={registerOutputCallback}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Wrapper component to handle individual terminal state
function TerminalWrapper({
  terminal,
  isActive,
  onSendInput,
  onResize,
  registerOutputCallback,
}: {
  terminal: TerminalSession;
  isActive: boolean;
  onSendInput: (terminalId: string, data: string) => void;
  onResize: (terminalId: string, cols: number, rows: number) => void;
  registerOutputCallback: (
    terminalId: string,
    callback: (data: string) => void
  ) => () => void;
}) {
  const writeFuncRef = useRef<((data: string) => void) | null>(null);

  // Register for output when mounted
  useEffect(() => {
    const writeToTerminal = (data: string) => {
      if (writeFuncRef.current) {
        writeFuncRef.current(data);
      }
    };

    const unregister = registerOutputCallback(terminal.id, writeToTerminal);
    return unregister;
  }, [terminal.id, registerOutputCallback]);

  const handleData = useCallback(
    (data: string) => {
      onSendInput(terminal.id, data);
    },
    [terminal.id, onSendInput]
  );

  const handleResize = useCallback(
    (cols: number, rows: number) => {
      onResize(terminal.id, cols, rows);
    },
    [terminal.id, onResize]
  );

  const handleReady = useCallback((writeFunc: (data: string) => void) => {
    writeFuncRef.current = writeFunc;
  }, []);

  return (
    <div style={{ width: "100%", height: "100%", display: isActive ? "block" : "none" }}>
      <InteractiveTerminal
        terminalId={terminal.id}
        onData={handleData}
        onResize={handleResize}
        onReady={handleReady}
      />
    </div>
  );
}
