import { useEffect, useRef } from "react";
import type { OutputLine } from "../../hooks/useAgentOutput";

interface TerminalPanelProps {
  lines: OutputLine[];
  onClear?: () => void;
}

export function TerminalPanel({ lines, onClear }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Track line count and last line content to avoid scrolling when
  // other agents' output changes (lines array reference changes but content is same)
  const lineCount = lines.length;
  const lastLineData = lines[lines.length - 1]?.data;

  // Auto-scroll to bottom when new lines arrive for THIS terminal
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lineCount, lastLineData]);

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
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "8px 12px",
          borderBottom: "1px solid var(--border)",
          background: "#1a1a1a",
        }}
      >
        <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
          Terminal Output
        </span>
        {onClear && (
          <button
            onClick={onClear}
            style={{
              padding: "4px 8px",
              fontSize: 11,
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 3,
              color: "var(--text-secondary)",
              cursor: "pointer",
            }}
          >
            Clear
          </button>
        )}
      </div>
      <div
        ref={containerRef}
        style={{
          flex: 1,
          overflow: "auto",
          padding: 12,
          fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
          fontSize: 12,
          lineHeight: 1.5,
        }}
      >
        {lines.length === 0 ? (
          <span style={{ color: "#666" }}>
            Waiting for output...
          </span>
        ) : (
          lines.map((line) => (
            <div
              key={line.id}
              style={{
                color: line.stream === "stderr" ? "#ef4444" : "#e5e5e5",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
              }}
            >
              {line.data}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
