import { useEffect, useMemo, useRef, useState } from "react";
import { ChatMessage } from "../../stores/chatStore";

/**
 * File Edit Diff View Component
 * Shows side-by-side comparison of code changes with lines added/removed
 */
export function DiffView({ message }: { message: ChatMessage }) {
  if (!message.diffData) return null;

  const { filePath, oldContent, newContent, linesAdded, linesRemoved } = message.diffData;

  // For Write operations, only show the new content
  if (!oldContent && newContent) {
    const lines = newContent.split('\n');
    return (
      <div style={diffContainerStyle}>
        <div style={diffHeaderStyle}>
          <span style={diffFileNameStyle}>{getShortPath(filePath)}</span>
          <span style={diffStatsStyle}>
            {linesAdded} lines
          </span>
        </div>
        <div style={diffCodeContainerStyle}>
          <div style={codeBlockFullStyle}>
            {lines.map((line, i) => (
              <div key={i} style={codeLineStyle}>
                <span style={lineNumberStyle}>{i + 1}</span>
                <span style={codeContentStyle}>{line || ' '}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // For Edit operations, show side-by-side diff
  if (oldContent && newContent) {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');

    type RowKind = 'equal' | 'add' | 'remove';
    type DiffRow = {
      kind: RowKind;
      oldLineNumber?: number;
      oldText?: string;
      newLineNumber?: number;
      newText?: string;
    };

    const rows: DiffRow[] = useMemo(() => {
      const n = oldLines.length;
      const m = newLines.length;

      // If this is huge, avoid quadratic work and fall back to a simple view.
      // (Most tool diffs are small snippets; this keeps the UI responsive for large blocks.)
      const maxCells = 250_000; // ~500x500
      if (n * m > maxCells) {
        const out: DiffRow[] = [];
        for (let i = 0; i < n; i++) out.push({ kind: 'remove', oldLineNumber: i + 1, oldText: oldLines[i] });
        for (let j = 0; j < m; j++) out.push({ kind: 'add', newLineNumber: j + 1, newText: newLines[j] });
        return out;
      }

      // LCS DP to align lines
      const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
      for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
          if (oldLines[i] === newLines[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
          else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
      }

      const out: DiffRow[] = [];
      let i = 0;
      let j = 0;
      let oldNo = 1;
      let newNo = 1;

      while (i < n && j < m) {
        if (oldLines[i] === newLines[j]) {
          out.push({
            kind: 'equal',
            oldLineNumber: oldNo++,
            oldText: oldLines[i],
            newLineNumber: newNo++,
            newText: newLines[j],
          });
          i++;
          j++;
        } else if (dp[i + 1][j] >= dp[i][j + 1]) {
          out.push({ kind: 'remove', oldLineNumber: oldNo++, oldText: oldLines[i] });
          i++;
        } else {
          out.push({ kind: 'add', newLineNumber: newNo++, newText: newLines[j] });
          j++;
        }
      }
      while (i < n) {
        out.push({ kind: 'remove', oldLineNumber: oldNo++, oldText: oldLines[i++] });
      }
      while (j < m) {
        out.push({ kind: 'add', newLineNumber: newNo++, newText: newLines[j++] });
      }

      return out;
    }, [oldContent, newContent]);

    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const firstChangeRef = useRef<HTMLDivElement>(null);
    const firstChangeIndex = useMemo(
      () => rows.findIndex((r) => r.kind !== 'equal'),
      [rows],
    );

    useEffect(() => {
      // Scroll to the first changed line when the diff mounts/updates.
      // Use rAF so layout is ready.
      requestAnimationFrame(() => {
        firstChangeRef.current?.scrollIntoView({ block: 'center' });
      });
    }, [message.id]);

    return (
      <div style={diffContainerStyle}>
        <div style={diffHeaderStyle}>
          <span style={diffFileNameStyle}>{getShortPath(filePath)}</span>
          <span style={diffStatsStyle}>
            {linesRemoved && linesRemoved > 0 && (
              <span style={removedCountStyle}>-{linesRemoved}</span>
            )}
            {linesAdded && linesAdded > 0 && (
              <span style={addedCountStyle}>+{linesAdded}</span>
            )}
          </span>
        </div>
        <div ref={scrollContainerRef} style={diffCodeContainerStyle}>
          <div style={diffGridStyle}>
            {rows.map((row, idx) => {
              const setRef = firstChangeIndex >= 0 && idx === firstChangeIndex;
              return (
                <div
                  key={idx}
                  ref={setRef ? firstChangeRef : undefined}
                  style={diffRowStyle}
                >
                  <span style={lineNumberStyle}>{row.oldLineNumber ?? ''}</span>
                  <span style={row.kind === 'remove' ? removedCellStyle : codeContentStyle}>
                    {row.oldText ?? ' '}
                  </span>
                  <span style={lineNumberStyle}>{row.newLineNumber ?? ''}</span>
                  <span style={row.kind === 'add' ? addedCellStyle : codeContentStyle}>
                    {row.newText ?? ' '}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return null;
}

/**
 * Expandable Thinking Block Component
 * Shows thinking content with collapse/expand functionality
 */
export function ThinkingBlock({ message }: { message: ChatMessage }) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!message.thinkingContent) return null;

  const label = message.content || "Thinking";

  return (
    <div style={thinkingContainerStyle}>
      <div
        style={thinkingHeaderStyle}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span style={expandIconStyle}>{isExpanded ? '▼' : '▶'}</span>
        <span style={thinkingLabelStyle}>{label}</span>
        {message.thinkingTokens && (
          <span style={thinkingTokensStyle}>{message.thinkingTokens} tokens</span>
        )}
      </div>
      {isExpanded && (
        <div style={thinkingContentStyle}>
          <pre style={thinkingTextStyle}>{message.thinkingContent}</pre>
        </div>
      )}
    </div>
  );
}

/**
 * Visual Todo Update Card Component
 * Shows todos with checkboxes and strikethrough for completed items
 */
export function TodoCard({ message }: { message: ChatMessage }) {
  if (!message.todoData || !message.todoData.todos) return null;

  const { todos } = message.todoData;

  return (
    <div style={todoContainerStyle}>
      <div style={todoHeaderStyle}>
        <span style={todoIconStyle}>✓</span>
        <span style={todoTitleStyle}>Update Todos</span>
      </div>
      <div style={todoListStyle}>
        {todos.map((todo, index) => {
          const isCompleted = todo.status === 'completed';
          const isInProgress = todo.status === 'in_progress';

          return (
            <div key={index} style={todoItemStyle}>
              <span style={checkboxStyle(isCompleted, isInProgress)}>
                {isCompleted ? '✓' : isInProgress ? '○' : ''}
              </span>
              <span style={todoTextStyle(isCompleted)}>
                {todo.content}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Get shortened path for display with better relative path handling
 */
function getShortPath(path?: string): string {
  if (!path) return "file";

  // Remove common prefixes
  let withoutHome = path.replace(/^\/Users\/[^\/]+\//, "~/");
  const withoutWorkspace = withoutHome.replace(/^~\/Development\//, "");

  const parts = withoutWorkspace.split("/");
  if (parts.length <= 3) return withoutWorkspace;

  return `.../${parts.slice(-2).join("/")}`;
}

// ========== STYLES ==========

// Diff View Styles
const diffContainerStyle: React.CSSProperties = {
  marginTop: 8,
  borderRadius: 8,
  overflow: 'hidden',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  background: 'rgba(0, 0, 0, 0.2)',
};

const diffHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '8px 12px',
  background: 'rgba(0, 0, 0, 0.3)',
  borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
};

const diffFileNameStyle: React.CSSProperties = {
  fontFamily: 'monospace',
  fontSize: 12,
  color: '#94a3b8',
};

const diffStatsStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  fontSize: 11,
  fontWeight: 600,
};

const removedCountStyle: React.CSSProperties = {
  color: '#ef4444',
};

const addedCountStyle: React.CSSProperties = {
  color: '#22c55e',
};

const diffCodeContainerStyle: React.CSSProperties = {
  maxHeight: 420,
  overflowY: 'auto',
  overflowX: 'auto',
};

const codeBlockFullStyle: React.CSSProperties = {
  flex: 1,
  fontFamily: 'monospace',
  fontSize: 12,
  lineHeight: 1.5,
};

const diffGridStyle: React.CSSProperties = {
  fontFamily: 'monospace',
  fontSize: 12,
  lineHeight: 1.5,
  minWidth: 720, // ensures both columns stay readable; container scrolls horizontally if needed
};

const diffRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '48px 1fr 48px 1fr',
  alignItems: 'stretch',
  minHeight: 20,
  padding: '2px 0',
};

const codeLineStyle: React.CSSProperties = {
  display: 'flex',
  minHeight: 20,
  padding: '2px 0',
};

const codeContentStyle: React.CSSProperties = {
  color: '#e2e8f0',
  whiteSpace: 'pre',
  flex: 1,
  paddingRight: 12,
};

const removedCellStyle: React.CSSProperties = {
  ...codeContentStyle,
  background: 'rgba(239, 68, 68, 0.15)',
  borderLeft: '3px solid #ef4444',
};

const addedCellStyle: React.CSSProperties = {
  ...codeContentStyle,
  background: 'rgba(34, 197, 94, 0.15)',
  borderLeft: '3px solid #22c55e',
};

const lineNumberStyle: React.CSSProperties = {
  display: 'inline-block',
  width: 40,
  textAlign: 'right',
  paddingRight: 12,
  color: '#64748b',
  userSelect: 'none',
  flexShrink: 0,
};

// Thinking Block Styles
const thinkingContainerStyle: React.CSSProperties = {
  marginTop: 8,
  borderRadius: 8,
  overflow: 'hidden',
  border: '1px solid rgba(139, 92, 246, 0.3)',
  background: 'rgba(139, 92, 246, 0.05)',
};

const thinkingHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 12px',
  cursor: 'pointer',
  userSelect: 'none',
  background: 'rgba(139, 92, 246, 0.1)',
};

const expandIconStyle: React.CSSProperties = {
  fontSize: 10,
  color: '#a78bfa',
};

const thinkingLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: '#a78bfa',
  fontStyle: 'italic',
};

const thinkingTokensStyle: React.CSSProperties = {
  marginLeft: 'auto',
  fontSize: 10,
  color: '#8b5cf6',
  opacity: 0.7,
};

const thinkingContentStyle: React.CSSProperties = {
  padding: 12,
  borderTop: '1px solid rgba(139, 92, 246, 0.2)',
  maxHeight: 300,
  overflow: 'auto',
  animation: 'slideIn 0.2s ease-out',
};

const thinkingTextStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: 'monospace',
  fontSize: 12,
  lineHeight: 1.5,
  color: '#cbd5e1',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

// Todo Card Styles
const todoContainerStyle: React.CSSProperties = {
  marginTop: 8,
  borderRadius: 8,
  overflow: 'hidden',
  border: '1px solid rgba(34, 197, 94, 0.3)',
  background: 'rgba(34, 197, 94, 0.05)',
};

const todoHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 12px',
  background: 'rgba(34, 197, 94, 0.1)',
  borderBottom: '1px solid rgba(34, 197, 94, 0.2)',
};

const todoIconStyle: React.CSSProperties = {
  fontSize: 16,
  color: '#22c55e',
};

const todoTitleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: '#22c55e',
};

const todoListStyle: React.CSSProperties = {
  padding: '8px 0',
};

const todoItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '6px 16px',
};

const checkboxStyle = (isCompleted: boolean, isInProgress: boolean): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 18,
  height: 18,
  borderRadius: 3,
  border: '2px solid',
  borderColor: isCompleted ? '#22c55e' : isInProgress ? '#3b82f6' : '#64748b',
  background: isCompleted ? '#22c55e' : isInProgress ? '#3b82f6' : 'transparent',
  color: '#fff',
  fontSize: 12,
  fontWeight: 'bold',
  flexShrink: 0,
});

const todoTextStyle = (isCompleted: boolean): React.CSSProperties => ({
  fontSize: 13,
  color: isCompleted ? '#64748b' : '#cbd5e1',
  textDecoration: isCompleted ? 'line-through' : 'none',
  flex: 1,
});
