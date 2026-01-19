import { useEffect, useRef, useCallback, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChatMessage, useChatStore } from "../../stores/chatStore";
import { convertFileSrc } from "@tauri-apps/api/core";
import { isTauri } from "../../lib/api";
import { DiffView, ThinkingBlock, TodoCard } from "../Activities/ActivityComponents";

interface ChatHistoryProps {
  messages: ChatMessage[];
  agentId: string;
  scrollContainerRef?: React.RefObject<HTMLDivElement>;
}

// Threshold in pixels - if user is within this distance from bottom, consider them "at bottom"
const SCROLL_THRESHOLD = 50;

// Activity color system for consistent visual hierarchy
const ACTIVITY_COLORS = {
  read: { border: "#60a5fa", bg: "rgba(96, 165, 250, 0.08)", icon: "📖" },
  write: { border: "#22c55e", bg: "rgba(34, 197, 94, 0.08)", icon: "✨" },
  edit: { border: "#f59e0b", bg: "rgba(245, 158, 11, 0.08)", icon: "✏️" },
  bash: { border: "#8b5cf6", bg: "rgba(139, 92, 246, 0.08)", icon: "⚡" },
  search: { border: "#ec4899", bg: "rgba(236, 72, 153, 0.08)", icon: "🔍" },
  thinking: { border: "#8b5cf6", bg: "rgba(139, 92, 246, 0.08)", icon: "💭" },
  todo: { border: "#22c55e", bg: "rgba(34, 197, 94, 0.08)", icon: "✅" },
  tool: { border: "#64748b", bg: "rgba(100, 116, 139, 0.08)", icon: "🔧" },
} as const;

export function ChatHistory({ messages, agentId, scrollContainerRef }: ChatHistoryProps) {
  const fallbackRef = useRef<HTMLDivElement>(null);
  const containerRef = scrollContainerRef || fallbackRef;
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

  // Attach scroll handler to the parent container if provided
  useEffect(() => {
    if (!scrollContainerRef?.current) return;

    const container = scrollContainerRef.current;
    container.addEventListener("scroll", handleScroll);

    return () => {
      container.removeEventListener("scroll", handleScroll);
    };
  }, [scrollContainerRef, handleScroll]);

  // Early return MUST come after all hooks to satisfy Rules of Hooks
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
    <div style={containerStyle}>
      <div style={{ width: "100%", maxWidth: 800, margin: "0 auto" }}>
        {messages.map((message, index) => {
          const prevMessage = messages[index - 1];
          return (
            <div key={message.id}>
              {shouldShowDivider(message, prevMessage) && (
                <MessageDivider timestamp={message.timestamp} />
              )}
              <MessageBubble message={message} previousMessage={prevMessage} />
            </div>
          );
        })}
        {activity && <ActivityIndicator activity={activity} />}
      </div>
    </div>
  );
}

function ActivitySpinner() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      style={{ animation: "spin 1s linear infinite" }}
    >
      <circle cx="12" cy="12" r="10" opacity="0.25" />
      <path d="M12 2 A10 10 0 0 1 22 12" opacity="0.75" />
    </svg>
  );
}

function ActivityIndicator({ activity }: { activity: string }) {
  return (
    <div
      style={{
        ...activityStyle,
        background: "rgba(139, 92, 246, 0.08)",
        borderRadius: 6,
        border: "1px solid rgba(139, 92, 246, 0.3)",
        padding: "8px 12px",
      }}
    >
      <ActivitySpinner />
      <span>{activity}</span>
    </div>
  );
}

function TruncatedText({ text, maxLength = 100 }: { text: string; maxLength?: number }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const needsTruncation = text.length > maxLength;

  if (!needsTruncation) {
    return <span>{text}</span>;
  }

  return (
    <span>
      {isExpanded ? text : text.slice(0, maxLength) + "..."}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          marginLeft: 6,
          color: "#60a5fa",
          background: "none",
          border: "none",
          cursor: "pointer",
          fontSize: 11,
          textDecoration: "underline",
          padding: 0,
        }}
      >
        {isExpanded ? "Show less" : "Show more"}
      </button>
    </span>
  );
}

function shouldShowDivider(currentMsg: ChatMessage, prevMsg?: ChatMessage): boolean {
  if (!prevMsg) return false;

  const timeDiff = currentMsg.timestamp - prevMsg.timestamp;
  const THIRTY_MINUTES = 30 * 60 * 1000;

  // Show divider if more than 30 minutes apart
  if (timeDiff > THIRTY_MINUTES) return true;

  // Show divider if switching between user and assistant
  if (
    currentMsg.role !== prevMsg.role &&
    currentMsg.role !== "activity" &&
    prevMsg.role !== "activity"
  ) {
    return timeDiff > 5 * 60 * 1000; // 5 minutes
  }

  return false;
}

function MessageDivider({ timestamp }: { timestamp: number }) {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  let label = "";
  if (isToday) {
    label = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } else {
    label = date.toLocaleDateString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        margin: "20px 0",
        gap: 12,
      }}
    >
      <div
        style={{
          flex: 1,
          height: 1,
          background: "rgba(255, 255, 255, 0.1)",
        }}
      />
      <span
        style={{
          fontSize: 11,
          color: "#64748b",
          fontWeight: 500,
          textTransform: "uppercase",
          letterSpacing: 0.5,
        }}
      >
        {label}
      </span>
      <div
        style={{
          flex: 1,
          height: 1,
          background: "rgba(255, 255, 255, 0.1)",
        }}
      />
    </div>
  );
}

function MessageBubble({
  message,
  previousMessage,
}: {
  message: ChatMessage;
  previousMessage?: ChatMessage;
}) {
  const isUser = message.role === "user";
  const isActivity = message.role === "activity";

  // Activity messages get a compact, distinct style with enhanced rendering
  if (isActivity) {
    const colors = ACTIVITY_COLORS[message.activityType as keyof typeof ACTIVITY_COLORS] || ACTIVITY_COLORS.tool;
    return (
      <div style={activityMessageContainerStyle}>
        <div
          style={getActivityMessageStyle(message.activityType)}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = colors.bg.replace('0.08', '0.12');
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = colors.bg;
          }}
        >
          <span style={activityIconStyle}>{getActivityIcon(message.activityType)}</span>
          <span style={activityTextStyle}>
            <TruncatedText text={message.content} maxLength={100} />
          </span>
          {formatTime(message.timestamp, previousMessage?.timestamp) && (
            <span style={activityTimeStyle}>
              {formatTime(message.timestamp, previousMessage?.timestamp)}
            </span>
          )}
        </div>

        {/* Render specialized activity components */}
        {(message.activityType === 'edit' || message.activityType === 'write') && message.diffData && (
          <DiffView message={message} />
        )}

        {message.activityType === 'thinking' && message.thinkingContent && (
          <ThinkingBlock message={message} />
        )}

        {message.activityType === 'todo' && message.todoData && (
          <TodoCard message={message} />
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: isUser ? "flex-end" : "flex-start",
        marginBottom: 20,
        paddingLeft: 8,
        paddingRight: 8,
        animation: "slideIn 0.3s ease-out",
      }}
    >
      <div style={labelStyle}>
        {isUser ? "You" : "Claude"}
        {formatTime(message.timestamp, previousMessage?.timestamp) && (
          <span style={{ marginLeft: 8, opacity: 0.5 }}>
            {formatTime(message.timestamp, previousMessage?.timestamp)}
          </span>
        )}
      </div>
      <div
        style={{
          ...bubbleStyle,
          backgroundColor: isUser ? "#0078d4" : "#2d2d2d",
          borderBottomRightRadius: isUser ? 4 : 12,
          borderBottomLeftRadius: isUser ? 12 : 4,
          border: isUser ? "1px solid #0098ff" : "1px solid #3c3c3c",
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

function formatTime(timestamp: number, previousTimestamp?: number): string {
  // If previous message exists and is within 2 minutes, don't show timestamp
  if (previousTimestamp && (timestamp - previousTimestamp) < 120000) {
    return "";
  }

  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - timestamp;

  // If today, show time only
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  // If yesterday
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return "Yesterday " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  // If within last week
  if (diff < 7 * 24 * 60 * 60 * 1000) {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return days[date.getDay()] + " " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  // Otherwise show full date
  return date.toLocaleDateString() + " " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const containerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  padding: "16px 12px",
  alignItems: "center",
  width: "100%",
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
  maxWidth: "85%",
  padding: "12px 16px",
  borderRadius: 12,
  fontSize: 14,
  lineHeight: 1.6,
  color: "#fff",
  boxShadow: "0 1px 3px rgba(0, 0, 0, 0.2)",
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

// Activity message styles (persistent activity log)
const activityMessageContainerStyle: React.CSSProperties = {
  marginBottom: 16,
  marginTop: 4,
};

const getActivityMessageStyle = (activityType?: string): React.CSSProperties => {
  const colors = ACTIVITY_COLORS[activityType as keyof typeof ACTIVITY_COLORS] || ACTIVITY_COLORS.tool;
  return {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 14px",
    background: colors.bg,
    borderRadius: 6,
    borderLeft: `3px solid ${colors.border}`,
    transition: "all 0.2s ease",
    cursor: "default",
  };
};

const activityIconStyle: React.CSSProperties = {
  fontSize: 16,
  width: 24,
  textAlign: "center",
  flexShrink: 0,
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
  if (type && type in ACTIVITY_COLORS) {
    return ACTIVITY_COLORS[type as keyof typeof ACTIVITY_COLORS].icon;
  }
  return "•";
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
