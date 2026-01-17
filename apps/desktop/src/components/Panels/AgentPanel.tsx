import { useState, useMemo } from "react";
import type { Agent } from "@virtual-agency/shared";
import type { OutputLine } from "../../hooks/useAgentOutput";
import { TerminalPanel } from "./TerminalPanel";
import { ChatPanel } from "./ChatPanel";
import { ChatHistory } from "./ChatHistory";
import { killAgent } from "../../lib/api";
import { useAgentStore } from "../../stores/agentStore";
import { useChatStore } from "../../stores/chatStore";

interface AgentPanelProps {
  agent: Agent;
  outputLines: OutputLine[];
  onClearOutput: () => void;
}

type TabType = "chat" | "terminal";

export function AgentPanel({
  agent,
  outputLines,
  onClearOutput,
}: AgentPanelProps) {
  const [activeTab, setActiveTab] = useState<TabType>("chat");
  const removeAgent = useAgentStore((state) => state.removeAgent);
  // Get raw messages array from store (stable reference)
  const allMessages = useChatStore((state) => state.messages);
  const clearMessages = useChatStore((state) => state.clearMessagesForAgent);

  // Filter messages in component with useMemo to avoid infinite re-renders
  const messages = useMemo(
    () => allMessages.filter((msg) => msg.agentId === agent.id),
    [allMessages, agent.id]
  );

  const handleKill = async () => {
    try {
      await killAgent(agent.id);
      removeAgent(agent.id);
    } catch (err) {
      console.error("Failed to kill agent:", err);
    }
  };

  const handleClear = () => {
    if (activeTab === "chat") {
      clearMessages(agent.id);
    } else {
      onClearOutput();
    }
  };

  return (
    <div
      style={{
        width: 550,
        height: "100%",
        background: "var(--bg-secondary)",
        borderLeft: "1px solid var(--border)",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        overflow: "hidden",
        boxSizing: "border-box",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <h2 style={{ margin: 0, fontSize: 18 }}>{agent.name}</h2>
        <button
          onClick={handleKill}
          style={{
            padding: "4px 8px",
            background: "#dc2626",
            border: "none",
            borderRadius: 4,
            color: "white",
            cursor: "pointer",
            fontSize: 11,
          }}
        >
          Kill
        </button>
      </div>

      {/* Status bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background:
              agent.status === "working"
                ? "#4ade80"
                : agent.status === "thinking"
                ? "#fbbf24"
                : agent.status === "error"
                ? "#ef4444"
                : "#6b7280",
          }}
        />
        <span
          style={{
            textTransform: "capitalize",
            fontSize: 13,
            color: "var(--text-secondary)",
          }}
        >
          {agent.status}
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 11,
            color: "var(--text-secondary)",
            fontFamily: "monospace",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: 200,
          }}
          title={agent.workingDirectory}
        >
          {agent.workingDirectory}
        </span>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: 4,
          borderBottom: "1px solid var(--border)",
          paddingBottom: 8,
        }}
      >
        <TabButton
          active={activeTab === "chat"}
          onClick={() => setActiveTab("chat")}
        >
          Chat
        </TabButton>
        <TabButton
          active={activeTab === "terminal"}
          onClick={() => setActiveTab("terminal")}
        >
          Terminal
        </TabButton>
        <button
          onClick={handleClear}
          style={{
            marginLeft: "auto",
            padding: "4px 8px",
            background: "transparent",
            border: "1px solid var(--border)",
            borderRadius: 4,
            color: "var(--text-secondary)",
            cursor: "pointer",
            fontSize: 11,
          }}
        >
          Clear
        </button>
      </div>

      {/* Content area */}
      {activeTab === "chat" ? (
        <>
          {/* Chat history - scrollable */}
          <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <ChatHistory messages={messages} agentId={agent.id} />
          </div>

          {/* Chat input - always visible */}
          <div style={{ flexShrink: 0 }}>
            <ChatPanel agentId={agent.id} />
          </div>
        </>
      ) : (
        /* Terminal view */
        <div style={{ flex: 1, overflow: "hidden" }}>
          <TerminalPanel lines={outputLines} onClear={onClearOutput} />
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "6px 12px",
        background: active ? "var(--accent)" : "transparent",
        border: active ? "none" : "1px solid var(--border)",
        borderRadius: 4,
        color: active ? "white" : "var(--text-secondary)",
        cursor: "pointer",
        fontSize: 12,
        fontWeight: active ? 600 : 400,
      }}
    >
      {children}
    </button>
  );
}
