import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  MessageSquare,
  Terminal as TerminalIcon,
  ScrollText,
  X,
  Trash2,
  Circle,
  MoreHorizontal,
  FolderOpen,
  Pencil,
} from "lucide-react";
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
import { useTerminalStore } from "../../stores/terminalStore";

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

const TAB_CONFIG: { id: TabType; label: string; icon: React.ElementType }[] = [
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "output", label: "Output", icon: ScrollText },
  { id: "terminal", label: "Terminal", icon: TerminalIcon },
  { id: "files", label: "Files", icon: FolderOpen },
];

const STATUS_CONFIG = {
  working: {
    color: "#22c55e",
    bgColor: "rgba(34, 197, 94, 0.15)",
    label: "Active",
    pulse: true
  },
  thinking: {
    color: "#8b5cf6",
    bgColor: "rgba(139, 92, 246, 0.15)",
    label: "Thinking",
    pulse: true
  },
  error: {
    color: "#ef4444",
    bgColor: "rgba(239, 68, 68, 0.15)",
    label: "Error",
    pulse: false
  },
  idle: {
    color: "#64748b",
    bgColor: "rgba(100, 116, 139, 0.15)",
    label: "Idle",
    pulse: false
  },
};

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
  const [showMenu, setShowMenu] = useState(false);
  const [showScrollIndicator, setShowScrollIndicator] = useState(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const removeAgent = useAgentStore((state) => state.removeAgent);
  const selectAgent = useAgentStore((state) => state.selectAgent);
  const clearTerminalsForAgent = useTerminalStore((state) => state.clearTerminalsForAgent);

  // Terminal management
  const {
    terminals,
    createTerminal,
    killTerminal,
    sendInput,
    sendResize,
    registerOutputCallback,
  } = useTerminals(agent.id);

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

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    if (showMenu) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showMenu]);

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

  // Scroll indicator logic for chat tab
  useEffect(() => {
    if (activeTab !== "chat") return;

    const container = chatScrollRef.current;
    if (!container) return;

    const checkScroll = () => {
      const isScrollable = container.scrollHeight > container.clientHeight;
      const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 10;
      setShowScrollIndicator(isScrollable && !isAtBottom);
    };

    checkScroll();
    container.addEventListener("scroll", checkScroll);
    window.addEventListener("resize", checkScroll);

    return () => {
      container.removeEventListener("scroll", checkScroll);
      window.removeEventListener("resize", checkScroll);
    };
  }, [messages, activeTab]);

  const handleKill = async () => {
    try {
      // Kill all terminals for this agent first
      for (const terminal of terminals) {
        await killTerminal(terminal.id);
      }
      clearTerminalsForAgent(agent.id);

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
  };

  const statusConfig = STATUS_CONFIG[agent.status] || STATUS_CONFIG.idle;

  // Get shortened path for display
  const shortPath = useMemo(() => {
    const parts = agent.workingDirectory.split("/");
    if (parts.length <= 3) return agent.workingDirectory;
    return `.../${parts.slice(-2).join("/")}`;
  }, [agent.workingDirectory]);

  return (
    <div
      className="h-full flex overflow-hidden relative"
      style={{
        width: panelWidth,
        background: "#1e1e1e",
        borderLeft: "1px solid #3c3c3c",
      }}
    >
      {/* Drag handle */}
      <div
        onMouseDown={handleDragStart}
        className={`absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-10 transition-colors ${
          isDragging ? "bg-[#007fd4]" : "hover:bg-[#007fd4]/50"
        }`}
      />

      {/* Panel content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 h-[52px] bg-[#252526] border-b border-[#3c3c3c] flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {/* Status indicator */}
            <div
              className="flex items-center gap-2 px-2.5 py-1.5 rounded text-[11px] font-medium"
              style={{
                background: statusConfig.bgColor,
                color: statusConfig.color,
                border: `1px solid ${statusConfig.color}40`,
              }}
            >
              <Circle
                className={`w-2 h-2 fill-current ${statusConfig.pulse ? 'animate-pulse' : ''}`}
              />
              {statusConfig.label}
            </div>

            {/* Agent name */}
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[14px] font-semibold text-white truncate">
                {agent.name}
              </span>
              <button
                onClick={() => setShowEditAvatar(true)}
                className="p-1.5 rounded text-[#969696] hover:text-[#007fd4] hover:bg-[#094771] transition-all duration-200 group"
                title="Edit avatar"
                aria-label="Edit agent avatar"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {/* Clear button - only show for chat and output tabs */}
            {(activeTab === "chat" || activeTab === "output") && (
              <button
                onClick={handleClear}
                className="px-4 py-2 rounded text-[11px] font-medium text-[#969696] hover:text-white bg-transparent hover:bg-[#37373d] border border-[#3c3c3c] hover:border-[#969696] transition-all duration-200 flex items-center gap-2"
                title={`Clear ${activeTab === "chat" ? "chat history" : "output"}`}
                aria-label={`Clear ${activeTab === "chat" ? "chat history" : "output"}`}
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear {activeTab === "chat" ? "Chat" : "Output"}</span>
              </button>
            )}

            {/* Kill Agent button */}
            <button
              onClick={handleKill}
              className="px-4 py-2 rounded text-[11px] font-medium text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 transition-all duration-200"
              title="Kill agent"
              aria-label="Kill agent"
            >
              Kill Agent
            </button>

            {/* Menu button */}
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setShowMenu(!showMenu)}
                className="p-2 rounded text-[#969696] hover:text-white hover:bg-[#37373d] transition-all duration-200"
                aria-label="More options"
              >
                <MoreHorizontal className="w-[14px] h-[14px]" />
              </button>

              {/* Dropdown menu */}
              {showMenu && (
                <div className="absolute right-0 top-full mt-1 w-48 bg-[#3c3c3c] border border-[#454545] rounded-md shadow-xl z-50 py-1">
                  <button
                    onClick={() => {
                      setShowMenu(false);
                      setShowEditAvatar(true);
                    }}
                    className="w-full px-3 py-1.5 text-left text-[13px] text-[#cccccc] hover:bg-[#094771] hover:text-white flex items-center gap-2"
                  >
                    <Pencil className="w-4 h-4" />
                    Change Avatar
                  </button>
                  <div className="my-1 border-t border-[#454545]" />
                  <button
                    onClick={() => {
                      setShowMenu(false);
                      handleKill();
                    }}
                    className="w-full px-3 py-1.5 text-left text-[13px] text-red-400 hover:bg-red-500/20 flex items-center gap-2"
                  >
                    <X className="w-4 h-4" />
                    Kill Agent
                  </button>
                </div>
              )}
            </div>

            {/* Close panel button */}
            <button
              onClick={() => selectAgent(null)}
              className="p-2 rounded text-[#969696] hover:text-white hover:bg-[#37373d] transition-all duration-200"
              title="Close panel"
              aria-label="Close panel"
            >
              <X className="w-[14px] h-[14px]" />
            </button>
          </div>
        </div>

        {/* Working directory */}
        <div className="flex items-center px-3 h-[28px] bg-[#1e1e1e] border-b border-[#3c3c3c] flex-shrink-0">
          <FolderOpen className="w-3.5 h-3.5 text-[#969696] mr-2 flex-shrink-0" />
          <span
            className="text-[11px] text-[#969696] font-mono truncate"
            title={agent.workingDirectory}
          >
            {shortPath}
          </span>
        </div>

        {/* Tab bar - VS Code style */}
        <div className="flex items-center px-3 py-1.5 gap-1 bg-[#1e1e1e] border-b border-[#3c3c3c] flex-shrink-0">
          {TAB_CONFIG.map(({ id, label, icon: Icon }) => {
            const isActive = activeTab === id;
            return (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`
                  flex items-center gap-2 px-3 py-1.5 rounded-md text-[12px] font-medium transition-all duration-200 border-none cursor-pointer
                  ${isActive
                    ? "bg-[#37373d] text-white"
                    : "bg-transparent text-[#969696] hover:text-[#cccccc] hover:bg-[#2a2a2a]"
                  }
                `}
              >
                <Icon className="w-4 h-4" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-hidden flex flex-col bg-[#1e1e1e] min-h-0">
          {activeTab === "chat" ? (
            <>
              {/* Chat history - scrollable with indicator */}
              <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
                <div ref={chatScrollRef} className="flex-1 overflow-auto min-h-0" style={{ height: "100%" }}>
                  <ChatHistory messages={messages} agentId={agent.id} scrollContainerRef={chatScrollRef} />
                </div>

                {/* Scroll to bottom indicator */}
                {showScrollIndicator && (
                  <div
                    style={{
                      position: "absolute",
                      bottom: 16,
                      left: "50%",
                      transform: "translateX(-50%)",
                      background: "rgba(0, 127, 212, 0.9)",
                      color: "white",
                      padding: "6px 12px",
                      borderRadius: 16,
                      fontSize: 11,
                      fontWeight: 500,
                      boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      zIndex: 10,
                      transition: "all 0.2s ease",
                    }}
                    onClick={() => {
                      chatScrollRef.current?.scrollTo({
                        top: chatScrollRef.current.scrollHeight,
                        behavior: "smooth",
                      });
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "rgba(0, 152, 255, 0.9)";
                      e.currentTarget.style.transform = "translateX(-50%) translateY(-2px)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "rgba(0, 127, 212, 0.9)";
                      e.currentTarget.style.transform = "translateX(-50%) translateY(0)";
                    }}
                  >
                    <span>↓</span>
                    New messages
                  </div>
                )}
              </div>

              {/* Chat input - always visible */}
              <div className="flex-shrink-0 border-t border-[#3c3c3c]">
                <ChatPanel agentId={agent.id} />
              </div>
            </>
          ) : activeTab === "output" ? (
            /* Agent output view (stdout/stderr from Claude) */
            <div className="flex-1 overflow-hidden">
              <TerminalPanel lines={outputLines} onClear={onClearOutput} />
            </div>
          ) : activeTab === "terminal" ? (
            /* Interactive terminal view */
            <div className="flex-1 overflow-hidden">
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
            <div className="flex-1 overflow-hidden">
              <FileTree />
            </div>
          )}
        </div>
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
