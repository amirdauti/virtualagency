import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import type { Agent } from "@virtual-agency/shared";
import type { OutputLine } from "../../hooks/useAgentOutput";
import { TerminalPanel } from "./TerminalPanel";
import { TerminalTabs } from "./TerminalTabs";
import { ChatPanel } from "./ChatPanel";
import { ChatHistory } from "./ChatHistory";
import { FileTree } from "../FileExplorer/FileTree";
import { EditAvatarDialog } from "./EditAvatarDialog";
import { killAgent } from "../../lib/api";
import { useAgentStore } from "../../stores/agentStore";
import { useChatStore } from "../../stores/chatStore";
import { useTerminals } from "../../hooks/useTerminals";
import { useFileExplorerStore } from "../../stores/fileExplorerStore";

interface AgentPanelProps {
  agent: Agent;
  outputLines: OutputLine[];
  onClearOutput: () => void;
}

type TabType = "chat" | "output" | "terminal" | "files";

const PANEL_WIDTH_KEY = "virtual-agency-panel-width";
const DEFAULT_WIDTH = 550;
const MIN_WIDTH = 350;
const MAX_WIDTH = 900;

export function AgentPanel({
  agent,
  outputLines,
  onClearOutput,
}: AgentPanelProps) {
  const [activeTab, setActiveTab] = useState<TabType>("chat");
  const [panelWidth, setPanelWidth] = useState(() => {
    const saved = localStorage.getItem(PANEL_WIDTH_KEY);
    return saved ? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, parseInt(saved, 10))) : DEFAULT_WIDTH;
  });
  const [isDragging, setIsDragging] = useState(false);
  const [showEditAvatar, setShowEditAvatar] = useState(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);
  const removeAgent = useAgentStore((state) => state.removeAgent);

  // Terminal management
  const {
    terminals,
    createTerminal,
    killTerminal,
    sendInput,
    sendResize,
    registerOutputCallback,
  } = useTerminals();

  const handleCreateTerminal = useCallback(() => {
    createTerminal(agent.workingDirectory, `Terminal ${terminals.length + 1}`);
  }, [agent.workingDirectory, createTerminal, terminals.length]);

  // Load file tree when Files tab is opened
  const setAgentId = useFileExplorerStore((state) => state.setAgentId);
  const loadFileTree = useFileExplorerStore((state) => state.loadFileTree);
  const currentAgentId = useFileExplorerStore((state) => state.agentId);

  useEffect(() => {
    if (activeTab === "files" && currentAgentId !== agent.id) {
      setAgentId(agent.id);
      loadFileTree();
    }
  }, [activeTab, agent.id, currentAgentId, setAgentId, loadFileTree]);

  // Handle mouse move during drag
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;
    const delta = dragStartX.current - e.clientX;
    const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, dragStartWidth.current + delta));
    setPanelWidth(newWidth);
  }, [isDragging]);

  // Handle mouse up to end drag
  const handleMouseUp = useCallback(() => {
    if (isDragging) {
      setIsDragging(false);
      localStorage.setItem(PANEL_WIDTH_KEY, panelWidth.toString());
    }
  }, [isDragging, panelWidth]);

  // Attach/detach global mouse event listeners
  useEffect(() => {
    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  // Start dragging
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragStartX.current = e.clientX;
    dragStartWidth.current = panelWidth;
    setIsDragging(true);
  }, [panelWidth]);
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
    } else if (activeTab === "output") {
      onClearOutput();
    }
    // No clear action for interactive terminal - user can run 'clear' command
  };

  return (
    <div
      style={{
        width: panelWidth,
        height: "100%",
        background: "var(--bg-secondary)",
        borderLeft: "1px solid var(--border)",
        display: "flex",
        overflow: "hidden",
        boxSizing: "border-box",
        position: "relative",
      }}
    >
      {/* Drag handle */}
      <div
        onMouseDown={handleDragStart}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 6,
          cursor: "col-resize",
          background: isDragging ? "var(--accent)" : "transparent",
          transition: isDragging ? "none" : "background 0.2s",
          zIndex: 10,
        }}
        onMouseEnter={(e) => {
          if (!isDragging) {
            (e.target as HTMLDivElement).style.background = "rgba(255, 255, 255, 0.1)";
          }
        }}
        onMouseLeave={(e) => {
          if (!isDragging) {
            (e.target as HTMLDivElement).style.background = "transparent";
          }
        }}
      />
      {/* Panel content */}
      <div
        style={{
          flex: 1,
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          overflow: "hidden",
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
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{agent.name}</h2>
          <button
            onClick={() => setShowEditAvatar(true)}
            style={{
              padding: "2px 6px",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 4,
              color: "var(--text-secondary)",
              cursor: "pointer",
              fontSize: 11,
            }}
            title="Change avatar"
          >
            ✏️
          </button>
        </div>
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
          active={activeTab === "output"}
          onClick={() => setActiveTab("output")}
        >
          Output
        </TabButton>
        <TabButton
          active={activeTab === "terminal"}
          onClick={() => setActiveTab("terminal")}
        >
          Terminal
        </TabButton>
        <TabButton
          active={activeTab === "files"}
          onClick={() => setActiveTab("files")}
        >
          Files
        </TabButton>
        {activeTab !== "terminal" && activeTab !== "files" && (
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
        )}
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
      ) : activeTab === "output" ? (
        /* Agent output view (stdout/stderr from Claude) */
        <div style={{ flex: 1, overflow: "hidden" }}>
          <TerminalPanel lines={outputLines} onClear={onClearOutput} />
        </div>
      ) : activeTab === "terminal" ? (
        /* Interactive terminal view */
        <div style={{ flex: 1, overflow: "hidden" }}>
          <TerminalTabs
            terminals={terminals}
            onCreateTerminal={handleCreateTerminal}
            onCloseTerminal={killTerminal}
            onSendInput={sendInput}
            onResize={sendResize}
            registerOutputCallback={registerOutputCallback}
          />
        </div>
      ) : (
        /* Files view */
        <div style={{ flex: 1, overflow: "hidden" }}>
          <FileTree />
        </div>
      )}
      </div>

      {/* Edit Avatar Dialog */}
      <EditAvatarDialog
        isOpen={showEditAvatar}
        onClose={() => setShowEditAvatar(false)}
        agentId={agent.id}
        currentAvatarId={agent.avatarId || "default"}
      />
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
