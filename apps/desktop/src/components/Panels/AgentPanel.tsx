import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  MessageSquare,
  Terminal as TerminalIcon,
  X,
  Trash2,
  Circle,
  MoreHorizontal,
  FolderOpen,
  Pencil,
  Play,
  Square,
  Pin,
  KeyRound,
  Send,
} from "lucide-react";
import type { Agent } from "@virtual-agency/shared";
import { TerminalTabs } from "./TerminalTabs";
import { ChatPanel } from "./ChatPanel";
import { ChatHistory } from "./ChatHistory";
import { FileTree } from "../FileExplorer/FileTree";
import { EditAvatarDialog } from "./EditAvatarDialog";
import { IntegrationsPanel } from "./IntegrationsPanel";
import { TelegramPanel } from "./TelegramPanel";
import { killAgent } from "../../lib/api";
import { useAgentStore } from "../../stores/agentStore";
import { useChatStore } from "../../stores/chatStore";
import { useChatUIStore } from "../../stores/chatUIStore";
import { useTerminals } from "../../hooks/useTerminals";
import { findAvailablePort } from "../../lib/api";
import { useFileExplorerStore } from "../../stores/fileExplorerStore";
import { useTerminalStore, type TabType } from "../../stores/terminalStore";
import { useIsMobile } from "../../hooks/useIsMobile";

interface AgentPanelProps {
  agent: Agent;
}

const PANEL_WIDTH_KEY = "virtual-agency-panel-width";
const DEFAULT_WIDTH = 550;
const MIN_WIDTH = 350;
const MAX_WIDTH = 900;

const TAB_CONFIG: { id: TabType; label: string; icon: React.ElementType }[] = [
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "terminal", label: "Terminal", icon: TerminalIcon },
  { id: "files", label: "Files", icon: FolderOpen },
  { id: "telegram", label: "Telegram", icon: Send },
  { id: "integrations", label: "Integrations", icon: KeyRound },
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
}: AgentPanelProps) {
  const isMobile = useIsMobile(900);
  // Use global store for active tab (per-agent)
  const activeTab = useTerminalStore((state) => state.activeTabByAgent[agent.id] ?? "chat") as TabType;
  const setActiveTabStore = useTerminalStore((state) => state.setActiveTab);
  const setActiveTab = useCallback((tab: TabType) => setActiveTabStore(agent.id, tab), [agent.id, setActiveTabStore]);
  const [panelWidth, setPanelWidth] = useState(() => {
    const saved = localStorage.getItem(PANEL_WIDTH_KEY);
    return saved ? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, parseInt(saved, 10))) : DEFAULT_WIDTH;
  });
  const [isDragging, setIsDragging] = useState(false);
  const [showEditAvatar, setShowEditAvatar] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showScrollIndicator, setShowScrollIndicator] = useState(false);

  // Resizable chat composer height (per agent)
  const COMPOSER_HEIGHT_KEY = `va-composer-height:${agent.id}`;
  const DEFAULT_COMPOSER_HEIGHT = 170;
  const MIN_COMPOSER_HEIGHT = 110;
  const MAX_COMPOSER_HEIGHT = 520;
  const draftImageCount = useChatUIStore((state) => state.draftImagesByAgent[agent.id]?.length ?? 0);
  const composerExtraHeight = draftImageCount > 0 ? 110 : 0;
  const [baseComposerHeight, setBaseComposerHeight] = useState<number>(() => {
    const raw = localStorage.getItem(COMPOSER_HEIGHT_KEY);
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed)
      ? Math.max(MIN_COMPOSER_HEIGHT, Math.min(MAX_COMPOSER_HEIGHT, parsed))
      : DEFAULT_COMPOSER_HEIGHT;
  });
  const composerHeight = baseComposerHeight + composerExtraHeight;
  const effectiveComposerHeight = isMobile ? Math.max(190, Math.min(320, 190 + composerExtraHeight)) : composerHeight;

  useEffect(() => {
    // Keep total height within bounds when attachments appear/disappear.
    const maxBase = Math.max(MIN_COMPOSER_HEIGHT, MAX_COMPOSER_HEIGHT - composerExtraHeight);
    if (baseComposerHeight > maxBase) setBaseComposerHeight(maxBase);
  }, [baseComposerHeight, composerExtraHeight]);
  const isResizingComposer = useRef(false);
  const resizeStartY = useRef(0);
  const resizeStartHeight = useRef(0);

  const handleComposerResizeStart = useCallback(
    (e: React.MouseEvent) => {
      if (isMobile) return;
      e.preventDefault();
      isResizingComposer.current = true;
      resizeStartY.current = e.clientY;
      resizeStartHeight.current = baseComposerHeight;
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
    },
    [baseComposerHeight, isMobile],
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isResizingComposer.current) return;
      const delta = resizeStartY.current - e.clientY; // drag up increases height
      const maxBase = Math.max(MIN_COMPOSER_HEIGHT, MAX_COMPOSER_HEIGHT - composerExtraHeight);
      const next = Math.max(MIN_COMPOSER_HEIGHT, Math.min(maxBase, resizeStartHeight.current + delta));
      setBaseComposerHeight(next);
    };
    const onUp = () => {
      if (!isResizingComposer.current) return;
      isResizingComposer.current = false;
      localStorage.setItem(COMPOSER_HEIGHT_KEY, String(baseComposerHeight));
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [COMPOSER_HEIGHT_KEY, baseComposerHeight, composerExtraHeight]);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const removeAgent = useAgentStore((state) => state.removeAgent);
  const selectAgent = useAgentStore((state) => state.selectAgent);
  const updateAgent = useAgentStore((state) => state.updateAgent);
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

  const isRobloxBuilder = agent.specialty === "roblox_builder";
  const [rojoTerminalId, setRojoTerminalId] = useState<string | null>(null);
  const [rojoPort, setRojoPort] = useState<number | null>(null);

  // Keep Rojo terminal id in sync with terminal list (e.g. if user closes the tab)
  useEffect(() => {
    if (!isRobloxBuilder) {
      setRojoTerminalId(null);
      setRojoPort(null);
      return;
    }

    const existing = terminals.find((t) => t.name === "Rojo Server");
    setRojoTerminalId(existing?.id ?? null);
    if (!existing) {
      setRojoPort(null);
    }
  }, [isRobloxBuilder, terminals]);

  const handleCreateTerminal = useCallback(() => {
    createTerminal(agent.workingDirectory, `Terminal ${terminals.length + 1}`);
  }, [agent.workingDirectory, createTerminal, terminals.length]);

  const handleToggleRojoServer = useCallback(async () => {
    if (!isRobloxBuilder) return;

    // If running, stop by killing the dedicated terminal session
    if (rojoTerminalId) {
      await killTerminal(rojoTerminalId);
      setRojoPort(null);
      return;
    }

    const session = await createTerminal(agent.workingDirectory, "Rojo Server");
    if (!session) return;

    // Switch to terminal tab and focus the Rojo terminal
    setActiveTabStore(agent.id, "terminal");
    useTerminalStore.getState().setActiveTerminal(agent.id, session.id);

    // Start Rojo server inside the dedicated terminal.
    // Note: Terminal default on Windows is cmd.exe (COMSPEC), so use cmd syntax.
    const isWindows =
      typeof navigator !== "undefined" &&
      (navigator.platform?.toLowerCase().includes("win") ||
        navigator.userAgent?.toLowerCase().includes("windows"));
    const newline = isWindows ? "\r\n" : "\n";

    // Prefer the standard Rojo port, but if it's already in use (another agent or a previous run),
    // pick the next available port so users don't get stuck.
    let port = 34872;
    try {
      const resp = await findAvailablePort(34872, 34972);
      if (typeof resp?.port === "number" && Number.isFinite(resp.port)) {
        port = resp.port;
      }
    } catch (err) {
      console.warn("[Rojo] Failed to find available port; falling back to 34872:", err);
    }
    setRojoPort(port);

    const cmd = isWindows
      ? `echo Starting Rojo on port ${port}...${newline}set \"PATH=%USERPROFILE%\\\\.rokit\\\\bin;%PATH%\" && rojo serve --port ${port}${newline}`
      : `echo \"Starting Rojo on port ${port}...\"${newline}export PATH=\"$HOME/.rokit/bin:$PATH\" && rojo serve --port ${port}${newline}`;

    sendInput(session.id, cmd);
  }, [
    agent.id,
    agent.workingDirectory,
    createTerminal,
    isRobloxBuilder,
    killTerminal,
    rojoTerminalId,
    sendInput,
    setActiveTabStore,
  ]);

  // Load file tree when Files tab is opened
  const setAgentId = useFileExplorerStore((state) => state.setAgentId);
  const loadFileTree = useFileExplorerStore((state) => state.loadFileTree);
  const currentAgentId = useFileExplorerStore((state) => state.agentId);
  const isHostedRootWorkspace =
    agent.runtime === "hosted" && agent.workingDirectory.trim() === "/";

  useEffect(() => {
    if (activeTab === "files" && currentAgentId !== agent.id) {
      setAgentId(agent.id);
      // For hosted "/" agents, avoid eager recursive tree fetch on tab open.
      // Users can still load files manually with Refresh.
      if (!isHostedRootWorkspace) {
        loadFileTree();
      }
    }
  }, [activeTab, agent.id, currentAgentId, isHostedRootWorkspace, setAgentId, loadFileTree]);

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
    if (!isDragging || isMobile) return;
    const delta = dragStartX.current - e.clientX;
    const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, dragStartWidth.current + delta));
    setPanelWidth(newWidth);
  }, [isDragging, isMobile]);

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
    if (isMobile) return;
    e.preventDefault();
    dragStartX.current = e.clientX;
    dragStartWidth.current = panelWidth;
    setIsDragging(true);
  }, [isMobile, panelWidth]);

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
    }
  };

  const handleToggleStayAtDesk = useCallback(() => {
    updateAgent(agent.id, { stayAtDesk: !agent.stayAtDesk });
  }, [agent.id, agent.stayAtDesk, updateAgent]);

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
        width: isMobile ? "100%" : panelWidth,
        position: isMobile ? "absolute" : "relative",
        top: isMobile ? 0 : undefined,
        right: isMobile ? 0 : undefined,
        bottom: isMobile ? 0 : undefined,
        zIndex: isMobile ? 40 : undefined,
        background: "#1e1e1e",
        borderLeft: isMobile ? "none" : "1px solid #3c3c3c",
      }}
    >
      {/* Drag handle */}
      {!isMobile && (
        <div
          onMouseDown={handleDragStart}
          className={`absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-10 transition-colors ${
            isDragging ? "bg-[#007fd4]" : "hover:bg-[#007fd4]/50"
          }`}
        />
      )}

      {/* Panel content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div
          className="bg-[#252526] border-b border-[#3c3c3c] flex-shrink-0"
          style={{
            display: "flex",
            alignItems: isMobile ? "flex-start" : "center",
            justifyContent: "space-between",
            gap: isMobile ? 10 : 12,
            minHeight: isMobile ? 86 : 52,
            padding: isMobile ? "10px 12px" : "0 20px",
            flexWrap: isMobile ? "wrap" : "nowrap",
          }}
        >
          <div
            className="flex items-center gap-3 min-w-0"
            style={{
              flex: isMobile ? "1 1 100%" : "0 1 auto",
            }}
          >
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
          <div
            className="flex items-center gap-2"
            style={{
              width: isMobile ? "100%" : "auto",
              flexWrap: isMobile ? "wrap" : "nowrap",
              justifyContent: isMobile ? "flex-start" : "flex-end",
            }}
          >
            <button
              onClick={handleToggleStayAtDesk}
              className={`px-3 py-2 rounded text-[11px] font-medium transition-all duration-200 border flex items-center gap-1.5 ${
                agent.stayAtDesk
                  ? "text-[#22c55e] bg-[#22c55e]/10 border-[#22c55e]/30 hover:bg-[#22c55e]/20"
                  : "text-[#969696] bg-transparent border-[#3c3c3c] hover:text-white hover:bg-[#37373d] hover:border-[#969696]"
              }`}
              title={agent.stayAtDesk ? "Agent stays at desk when idle" : "Allow agent to move to lounge when idle"}
              aria-label={agent.stayAtDesk ? "Disable stay at desk" : "Enable stay at desk"}
              style={{
                minHeight: isMobile ? 36 : undefined,
                whiteSpace: "nowrap",
              }}
            >
              <Pin className="w-3.5 h-3.5" />
              <span>Stay at Desk</span>
            </button>

            {/* Clear button - only show for chat tab */}
            {activeTab === "chat" && (
              <button
                onClick={handleClear}
                className="px-4 py-2 rounded text-[11px] font-medium text-[#969696] hover:text-white bg-transparent hover:bg-[#37373d] border border-[#3c3c3c] hover:border-[#969696] transition-all duration-200 flex items-center gap-2"
                title="Clear chat history"
                aria-label="Clear chat history"
                style={{
                  minHeight: isMobile ? 36 : undefined,
                  whiteSpace: "nowrap",
                }}
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear Chat</span>
              </button>
            )}

            {/* Kill Agent button */}
            <button
              onClick={handleKill}
              className="px-4 py-2 rounded text-[11px] font-medium text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 transition-all duration-200"
              title="Kill agent"
              aria-label="Kill agent"
              style={{
                minHeight: isMobile ? 36 : undefined,
                whiteSpace: "nowrap",
              }}
            >
              Kill Agent
            </button>

            {/* Menu button */}
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setShowMenu(!showMenu)}
                className="p-2 rounded text-[#969696] hover:text-white hover:bg-[#37373d] transition-all duration-200"
                aria-label="More options"
                style={{ minHeight: isMobile ? 36 : undefined, minWidth: isMobile ? 36 : undefined }}
              >
                <MoreHorizontal className="w-[14px] h-[14px]" />
              </button>

              {/* Dropdown menu */}
              {showMenu && (
                <div
                  className="absolute right-0 top-full mt-1 bg-[#3c3c3c] border border-[#454545] rounded-md shadow-xl z-50 py-1"
                  style={{ width: isMobile ? 220 : 192 }}
                >
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
              style={{ minHeight: isMobile ? 36 : undefined, minWidth: isMobile ? 36 : undefined }}
            >
              <X className="w-[14px] h-[14px]" />
            </button>
          </div>
        </div>

        {/* Working directory */}
        <div
          className="flex items-center px-3 bg-[#1e1e1e] border-b border-[#3c3c3c] flex-shrink-0"
          style={{ minHeight: isMobile ? 32 : 28 }}
        >
          <FolderOpen className="w-3.5 h-3.5 text-[#969696] mr-2 flex-shrink-0" />
          <span
            className="text-[11px] text-[#969696] font-mono truncate"
            title={agent.workingDirectory}
          >
            {shortPath}
          </span>
        </div>

        {/* Tab bar - VS Code style */}
        <div
          className="flex items-center px-3 py-1.5 gap-2 bg-[#1e1e1e] border-b border-[#3c3c3c] flex-shrink-0"
          style={{ minHeight: isMobile ? 46 : undefined }}
        >
          <div
            className="flex items-center gap-1 hide-scrollbar"
            style={{
              flex: 1,
              minWidth: 0,
              overflowX: "auto",
              overflowY: "hidden",
              scrollbarWidth: "none",
              msOverflowStyle: "none",
            }}
          >
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
                  style={{
                    flexShrink: 0,
                    minHeight: isMobile ? 36 : undefined,
                    whiteSpace: "nowrap",
                  }}
                >
                  <Icon className="w-4 h-4" />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>

          {/* Roblox: Rojo server toggle (far right of tabs) */}
          {isRobloxBuilder && (
            <div className="flex items-center" style={{ flexShrink: 0 }}>
              <button
                onClick={handleToggleRojoServer}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-[12px] font-medium transition-all duration-200 border cursor-pointer ${
                  rojoTerminalId
                    ? "bg-[#11301b] text-[#4ade80] border-[#2f6f42] hover:bg-[#154022]"
                    : "bg-transparent text-[#969696] border-[#3c3c3c] hover:text-[#cccccc] hover:bg-[#2a2a2a]"
                }`}
                title={
                  rojoTerminalId
                    ? `Stop Rojo server${rojoPort ? ` (port ${rojoPort})` : ""}`
                    : "Start Rojo server"
                }
                aria-label={
                  rojoTerminalId
                    ? `Stop Rojo server${rojoPort ? ` (port ${rojoPort})` : ""}`
                    : "Start Rojo server"
                }
                style={{ minHeight: isMobile ? 36 : undefined, whiteSpace: "nowrap" }}
              >
                {rojoTerminalId ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                <span>Rojo</span>
                {rojoTerminalId && rojoPort && (
                  <span className="text-[11px] text-[#9ae6b4] font-mono">:{rojoPort}</span>
                )}
              </button>
            </div>
          )}
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

              {/* Chat input - resizable by dragging */}
              <div
                className="flex-shrink-0 border-t border-[#3c3c3c]"
                style={{ height: effectiveComposerHeight, overflow: "hidden" }}
              >
                {!isMobile && (
                  <div
                    onMouseDown={handleComposerResizeStart}
                    className="h-1 w-full cursor-row-resize bg-transparent hover:bg-[#007fd4]/30"
                    title="Drag to resize"
                    aria-label="Resize chat input"
                  />
                )}
                <div style={{ height: isMobile ? effectiveComposerHeight : effectiveComposerHeight - 4, display: "flex", overflow: "hidden" }}>
                  <ChatPanel agentId={agent.id} />
                </div>
              </div>
            </>
          ) : activeTab === "terminal" ? (
            /* Interactive terminal view */
            <div className="flex-1 overflow-hidden">
              <TerminalTabs
                agentId={agent.id}
                terminals={terminals}
                onCreateTerminal={handleCreateTerminal}
                onCloseTerminal={killTerminal}
                onSendInput={sendInput}
                onResize={sendResize}
                registerOutputCallback={registerOutputCallback}
              />
            </div>
          ) : activeTab === "integrations" ? (
            /* Integrations view */
            <div className="flex-1 overflow-hidden">
              <IntegrationsPanel agentId={agent.id} />
            </div>
          ) : activeTab === "telegram" ? (
            /* Telegram view */
            <div className="flex-1 overflow-hidden">
              <TelegramPanel agentId={agent.id} />
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
