import { useEffect, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChatMessage, useChatStore } from "../../stores/chatStore";
import { convertFileSrc } from "@tauri-apps/api/core";
import { isTauri } from "../../lib/api";

interface ChatHistoryProps {
  messages: ChatMessage[];
  agentId: string;
}

// Threshold in pixels - if user is within this distance from bottom, consider them "at bottom"
const SCROLL_THRESHOLD = 50;

export function ChatHistory({ messages, agentId }: ChatHistoryProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isUserAtBottomRef = useRef(true); // Track if user is at/near bottom
  const activity = useChatStore((state) => state.activities[agentId]);

  // Track message count and last message content for this specific agent
  const messageCount = messages.length;
  const lastMessageContent = messages[messages.length - 1]?.content;
  const lastMessageStreaming = messages[messages.length - 1]?.isStreaming;

  // Check if user is at/near the bottom of the scroll container
  const checkIfAtBottom = useCallback(() => {
    if (!containerRef.current) return true;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    return scrollHeight - scrollTop - clientHeight <= SCROLL_THRESHOLD;
  }, []);

  // Handle scroll events to track user's scroll position
  const handleScroll = useCallback(() => {
    isUserAtBottomRef.current = checkIfAtBottom();
  }, [checkIfAtBottom]);

  // Auto-scroll to bottom only if user is already at/near bottom
  useEffect(() => {
    if (containerRef.current && isUserAtBottomRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messageCount, lastMessageContent, lastMessageStreaming, activity]);

  // When new conversation starts (messages go from 0 to 1+), always scroll to bottom
  useEffect(() => {
    if (messageCount === 1 && containerRef.current) {
      isUserAtBottomRef.current = true;
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messageCount]);

  if (messages.length === 0 && !activity) {
    return (
      <div style={emptyStyle}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>💬</div>
        <div style={{ color: "#888", fontSize: 14 }}>No messages yet</div>
        <div style={{ color: "#666", fontSize: 12, marginTop: 4 }}>
          Send a message to start the conversation
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} style={containerStyle} onScroll={handleScroll}>
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
      {activity && <ActivityIndicator activity={activity} />}
    </div>
  );
}

function ActivityIndicator({ activity }: { activity: string }) {
  return (
    <div style={activityStyle}>
      <span style={activityDotStyle}>●</span>
      <span>{activity}</span>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const isActivity = message.role === "activity";

  // Activity messages get a compact, distinct style
  if (isActivity) {
    return (
      <div style={activityMessageStyle}>
        <span style={activityIconStyle}>{getActivityIcon(message.activityType)}</span>
        <span style={activityTextStyle}>{message.content}</span>
        <span style={activityTimeStyle}>{formatTime(message.timestamp)}</span>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: isUser ? "flex-end" : "flex-start",
        marginBottom: 16,
      }}
    >
      <div style={labelStyle}>
        {isUser ? "You" : "Claude"}
        <span style={{ marginLeft: 8, opacity: 0.5 }}>
          {formatTime(message.timestamp)}
        </span>
      </div>
      <div
        style={{
          ...bubbleStyle,
          backgroundColor: isUser ? "#2563eb" : "#1e293b",
          borderBottomRightRadius: isUser ? 4 : 16,
          borderBottomLeftRadius: isUser ? 16 : 4,
        }}
      >
        {isUser ? (
          <div>
            {message.images && message.images.length > 0 && (
              <div style={messageImagesContainerStyle}>
                {message.images.map((imagePath, idx) => {
                  // For browser mode (blob: URLs), use directly; for Tauri, use convertFileSrc
                  const imgSrc = imagePath.startsWith('blob:') ? imagePath : (isTauri() ? convertFileSrc(imagePath) : imagePath);
                  return (
                    <img
                      key={`${imagePath}-${idx}`}
                      src={imgSrc}
                      alt={`Attached image ${idx + 1}`}
                      style={messageImageStyle}
                      onClick={() => window.open(imgSrc, "_blank")}
                    />
                  );
                })}
              </div>
            )}
            <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {message.content}
            </div>
          </div>
        ) : (
          <div style={markdownContainerStyle}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                // Style code blocks
                code: ({ className, children, ...props }) => {
                  const isInline = !className;
                  if (isInline) {
                    return (
                      <code style={inlineCodeStyle} {...props}>
                        {children}
                      </code>
                    );
                  }
                  return (
                    <code style={codeBlockStyle} {...props}>
                      {children}
                    </code>
                  );
                },
                pre: ({ children }) => (
                  <pre style={preStyle}>{children}</pre>
                ),
                // Style other elements
                p: ({ children }) => (
                  <p style={{ margin: "0 0 8px 0" }}>{children}</p>
                ),
                ul: ({ children }) => (
                  <ul style={{ margin: "8px 0", paddingLeft: 20 }}>{children}</ul>
                ),
                ol: ({ children }) => (
                  <ol style={{ margin: "8px 0", paddingLeft: 20 }}>{children}</ol>
                ),
                li: ({ children }) => (
                  <li style={{ marginBottom: 4 }}>{children}</li>
                ),
                a: ({ href, children }) => (
                  <a
                    href={href}
                    style={{ color: "#60a5fa", textDecoration: "underline" }}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {children}
                  </a>
                ),
                strong: ({ children }) => (
                  <strong style={{ fontWeight: 600 }}>{children}</strong>
                ),
                h1: ({ children }) => (
                  <h1 style={{ fontSize: 18, fontWeight: 600, margin: "12px 0 8px" }}>{children}</h1>
                ),
                h2: ({ children }) => (
                  <h2 style={{ fontSize: 16, fontWeight: 600, margin: "10px 0 6px" }}>{children}</h2>
                ),
                h3: ({ children }) => (
                  <h3 style={{ fontSize: 14, fontWeight: 600, margin: "8px 0 4px" }}>{children}</h3>
                ),
                blockquote: ({ children }) => (
                  <blockquote style={blockquoteStyle}>{children}</blockquote>
                ),
                table: ({ children }) => (
                  <div style={tableWrapperStyle}>
                    <table style={tableStyle}>{children}</table>
                  </div>
                ),
                thead: ({ children }) => (
                  <thead style={theadStyle}>{children}</thead>
                ),
                tbody: ({ children }) => (
                  <tbody>{children}</tbody>
                ),
                tr: ({ children }) => (
                  <tr style={trStyle}>{children}</tr>
                ),
                th: ({ children }) => (
                  <th style={thStyle}>{children}</th>
                ),
                td: ({ children }) => (
                  <td style={tdStyle}>{children}</td>
                ),
              }}
            >
              {message.content || (message.isStreaming ? "..." : "")}
            </ReactMarkdown>
          </div>
        )}
        {message.isStreaming && (
          <span style={streamingIndicatorStyle}>●</span>
        )}
      </div>
    </div>
  );
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const containerStyle: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "12px 8px",
  display: "flex",
  flexDirection: "column",
};

const emptyStyle: React.CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  padding: 20,
  textAlign: "center",
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#888",
  marginBottom: 4,
  paddingLeft: 4,
  paddingRight: 4,
};

const bubbleStyle: React.CSSProperties = {
  maxWidth: "90%",
  padding: "12px 16px",
  borderRadius: 16,
  fontSize: 14,
  lineHeight: 1.6,
  color: "#fff",
};

const markdownContainerStyle: React.CSSProperties = {
  wordBreak: "break-word",
};

const inlineCodeStyle: React.CSSProperties = {
  background: "rgba(255, 255, 255, 0.1)",
  padding: "2px 6px",
  borderRadius: 4,
  fontFamily: "monospace",
  fontSize: 13,
};

const codeBlockStyle: React.CSSProperties = {
  display: "block",
  fontFamily: "monospace",
  fontSize: 12,
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
};

const preStyle: React.CSSProperties = {
  background: "rgba(0, 0, 0, 0.3)",
  padding: 12,
  borderRadius: 8,
  margin: "8px 0",
  overflow: "auto",
};

const blockquoteStyle: React.CSSProperties = {
  borderLeft: "3px solid #60a5fa",
  margin: "8px 0",
  paddingLeft: 12,
  color: "#94a3b8",
};

const streamingIndicatorStyle: React.CSSProperties = {
  display: "inline-block",
  marginLeft: 6,
  color: "#4ade80",
  animation: "pulse 1s infinite",
};

const activityStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 12px",
  color: "#94a3b8",
  fontSize: 13,
  fontStyle: "italic",
};

const activityDotStyle: React.CSSProperties = {
  color: "#fbbf24",
  animation: "pulse 1s infinite",
};

// Activity message styles (persistent activity log)
const activityMessageStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 12px",
  marginBottom: 4,
  background: "rgba(59, 130, 246, 0.1)",
  borderRadius: 8,
  borderLeft: "3px solid #3b82f6",
};

const activityIconStyle: React.CSSProperties = {
  fontSize: 14,
  width: 20,
  textAlign: "center",
};

const activityTextStyle: React.CSSProperties = {
  flex: 1,
  fontSize: 12,
  color: "#94a3b8",
  fontFamily: "monospace",
};

const activityTimeStyle: React.CSSProperties = {
  fontSize: 10,
  color: "#64748b",
};

function getActivityIcon(type?: string): string {
  switch (type) {
    case "read":
      return "📖";
    case "write":
      return "📝";
    case "edit":
      return "✏️";
    case "bash":
      return "⚡";
    case "search":
      return "🔍";
    default:
      return "🔧";
  }
}

const messageImagesContainerStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  marginBottom: 8,
};

const messageImageStyle: React.CSSProperties = {
  maxWidth: 200,
  maxHeight: 150,
  borderRadius: 8,
  cursor: "pointer",
  objectFit: "cover",
  border: "1px solid rgba(255, 255, 255, 0.2)",
};

// Table styles for markdown tables
const tableWrapperStyle: React.CSSProperties = {
  overflowX: "auto",
  margin: "12px 0",
  borderRadius: 8,
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 13,
  background: "rgba(0, 0, 0, 0.2)",
  borderRadius: 8,
};

const theadStyle: React.CSSProperties = {
  background: "rgba(0, 0, 0, 0.3)",
};

const trStyle: React.CSSProperties = {
  borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
};

const thStyle: React.CSSProperties = {
  padding: "10px 12px",
  textAlign: "left",
  fontWeight: 600,
  color: "#e2e8f0",
  borderBottom: "2px solid rgba(255, 255, 255, 0.2)",
};

const tdStyle: React.CSSProperties = {
  padding: "8px 12px",
  color: "#cbd5e1",
};
