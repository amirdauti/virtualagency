import { useState, memo, useCallback, useLayoutEffect, useRef } from "react";
import { Modal } from "../common/Modal";
import {
  createAgent,
  isTauri,
  browseDirectory,
  BrowseResponse,
  ClaudeModel,
  CodexModel,
  CliType,
  ReasoningEffort,
} from "../../lib/api";
import { useAgentStore } from "../../stores/agentStore";
import { useSettingsStore } from "../../stores/settingsStore";
import {
  generateId,
  AVATAR_OPTIONS,
  AvatarId,
  MCP_SERVERS,
  MCPServerId,
  AgentSpecialty,
  AgentRuntime,
} from "@virtual-agency/shared";

// CLI type configurations
const CLI_TYPES: {
  value: CliType;
  name: string;
  description: string;
  badge?: string;
}[] = [
  {
    value: "claude",
    name: "Claude Code",
    description: "Anthropic's Claude AI assistant",
    badge: "Default",
  },
  { value: "codex", name: "Codex", description: "OpenAI's Codex assistant" },
];

// Agent specialty configurations
const AGENT_SPECIALTIES: {
  value: AgentSpecialty;
  name: string;
  description: string;
  badge?: string;
}[] = [
  {
    value: "normal",
    name: "Normal",
    description: "General purpose agent",
    badge: "Default",
  },
  {
    value: "roblox_builder",
    name: "Roblox Builder",
    description: "Roblox development agent (Rojo + Luau)",
  },
];

const AGENT_RUNTIMES: {
  value: AgentRuntime;
  name: string;
  description: string;
  badge?: string;
}[] = [
  {
    value: "local",
    name: "Local",
    description: "Run on this machine",
    badge: "Default",
  },
  {
    value: "hosted",
    name: "Cloud Agents",
    description: "Run on your managed cloud server",
  },
];

// Claude model configurations
const CLAUDE_MODELS: {
  value: ClaudeModel;
  name: string;
  description: string;
  badge?: string;
}[] = [
  // `claude --help` recommends using aliases (e.g. "sonnet") to always target the latest Sonnet.
  {
    value: "sonnet",
    name: "Sonnet 4.5 (Latest)",
    description: "Best balance of speed & capability",
    badge: "Recommended",
  },
  {
    value: "opus",
    name: "Opus 4.6 (Latest)",
    description: "Maximum capability for complex tasks",
    badge: "New",
  },
  {
    value: "haiku",
    name: "Haiku",
    description: "Fastest responses, simple tasks",
  },
];

// Codex model configurations
const CODEX_MODELS: {
  value: CodexModel;
  name: string;
  description: string;
  badge?: string;
}[] = [
  {
    value: "gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    description: "Flagship GPT-5.6 model for highest capability",
    badge: "Recommended",
  },
  {
    value: "gpt-5.6-terra",
    name: "GPT-5.6 Terra",
    description: "Strong GPT-5.6 capability at lower cost",
    badge: "New",
  },
  {
    value: "gpt-5.6-luna",
    name: "GPT-5.6 Luna",
    description: "Efficient GPT-5.6 model for high-volume work",
    badge: "New",
  },
  {
    value: "gpt-5.6",
    name: "GPT-5.6 Alias",
    description: "Alias that routes to GPT-5.6 Sol",
  },
  {
    value: "gpt-5.5",
    name: "GPT-5.5",
    description: "Previous GPT-5.5 frontier tier",
  },
  {
    value: "gpt-5.5-pro",
    name: "GPT-5.5 Pro",
    description: "Previous highest capability GPT-5.5 tier",
  },
  {
    value: "gpt-5.4",
    name: "GPT-5.4",
    description: "Previous GPT-5 frontier tier",
  },
  {
    value: "gpt-5.4-pro",
    name: "GPT-5.4 Pro",
    description: "Previous GPT-5.4 Pro tier",
  },
  {
    value: "gpt-5.3-codex",
    name: "GPT-5.3 Codex",
    description: "Codex-tuned model for legacy compatibility",
  },
  {
    value: "gpt-5.2-codex",
    name: "GPT-5.2 Codex",
    description: "Legacy Codex model",
  },
  {
    value: "gpt-5.2",
    name: "GPT-5.2",
    description: "Legacy GPT-5.2 general model",
  },
  {
    value: "gpt-5.1-codex-max",
    name: "GPT-5.1 Codex Max",
    description: "Frontier agentic coding model",
  },
  {
    value: "gpt-5.1-codex",
    name: "GPT-5.1 Codex",
    description: "Intelligent coding model",
  },
  { value: "gpt-5.1", name: "GPT-5.1", description: "GPT-5.1 general model" },
  {
    value: "gpt-5-codex",
    name: "GPT-5 Codex",
    description: "GPT-5 coding model",
  },
  { value: "gpt-5", name: "GPT-5", description: "GPT-5 general model" },
  {
    value: "gpt-5-mini",
    name: "GPT-5 Mini",
    description: "Compact GPT-5 model",
  },
  { value: "o3", name: "o3", description: "Reasoning model (legacy)" },
  {
    value: "o4-mini",
    name: "o4-mini",
    description: "Compact reasoning model (legacy)",
  },
  {
    value: "gpt-4.1",
    name: "GPT-4.1",
    description: "High performance (legacy)",
  },
];

// Reasoning effort configurations for Codex
const REASONING_EFFORTS: {
  value: ReasoningEffort;
  name: string;
  description: string;
}[] = [
  { value: "low", name: "Low", description: "Faster, less thorough reasoning" },
  { value: "medium", name: "Medium", description: "Balanced speed and depth" },
  { value: "high", name: "High", description: "More thorough reasoning" },
  {
    value: "xhigh",
    name: "Extra High",
    description: "Very deep reasoning for difficult work",
  },
  { value: "max", name: "Max", description: "Maximum GPT-5.6 reasoning depth" },
];

// Memoized Directory Browser component
interface DirectoryBrowserProps {
  showBrowser: boolean;
  browserData: BrowseResponse | null;
  browserLoading: boolean;
  onClose: () => void;
  onNavigate: (path?: string) => void;
  onSelect: (path: string) => void;
}

const DirectoryBrowser = memo(function DirectoryBrowser({
  showBrowser,
  browserData,
  browserLoading,
  onClose,
  onNavigate,
  onSelect,
}: DirectoryBrowserProps) {
  if (!showBrowser) return null;

  const listRef = useRef<HTMLDivElement>(null);

  const scrollToTop = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = 0;
    // In some browsers, the scroll container can render at an old scroll offset
    // for a frame when the list content changes (especially after a long scroll).
    requestAnimationFrame(() => {
      if (listRef.current) listRef.current.scrollTop = 0;
    });
  }, []);

  // Reset scroll position when opening, while loading a new directory, and after contents change.
  useLayoutEffect(() => {
    scrollToTop();
  }, [
    scrollToTop,
    showBrowser,
    browserLoading,
    browserData?.current_path,
    browserData?.entries.length,
  ]);

  const handleNavigate = useCallback(
    (path?: string) => {
      scrollToTop();
      onNavigate(path);
    },
    [onNavigate, scrollToTop]
  );

  return (
    <div style={browserOverlayStyle}>
      <div style={browserContainerStyle}>
        <div style={browserHeaderStyle}>
          <span style={{ fontWeight: 600, color: "#f3f4f6" }}>
            Select Directory
          </span>
          <button onClick={onClose} style={browserCloseButtonStyle}>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {browserData && (
          <div style={browserPathStyle}>
            {browserData.parent_path && (
              <button
                onClick={() => handleNavigate(browserData.parent_path!)}
                style={browserBackButtonStyle}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <polyline points="15 18 9 12 15 6" />
                </svg>
                Back
              </button>
            )}
            <span
              style={{
                flex: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                color: "#9ca3af",
              }}
            >
              {browserData.current_path}
            </span>
            <button
              onClick={() => {
                scrollToTop();
                onSelect(browserData.current_path);
              }}
              style={browserSelectButtonStyle}
            >
              Select
            </button>
          </div>
        )}

        <div
          key={browserData?.current_path ?? "__root__"}
          ref={listRef}
          style={browserListStyle}
        >
          {browserLoading ? (
            <div style={{ padding: 32, textAlign: "center", color: "#6b7280" }}>
              <div
                style={{
                  width: 24,
                  height: 24,
                  border: "2px solid #374151",
                  borderTopColor: "#3b82f6",
                  borderRadius: "50%",
                  animation: "spin 0.8s linear infinite",
                  margin: "0 auto 12px",
                }}
              />
              Loading...
            </div>
          ) : browserData?.entries.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center", color: "#6b7280" }}>
              No subdirectories
            </div>
          ) : (
            browserData?.entries.map((entry) => (
              <div
                key={entry.path}
                onClick={() => handleNavigate(entry.path)}
                style={browserItemStyle}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(59, 130, 246, 0.1)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="#3b82f6"
                  stroke="none"
                  style={{ flexShrink: 0 }}
                >
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {entry.name}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
});

interface CreateAgentDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CreateAgentDialog({ isOpen, onClose }: CreateAgentDialogProps) {
  const defaultAgentRuntime = useSettingsStore(
    (state) => state.settings.default_agent_runtime
  );
  const [name, setName] = useState("");
  const [workingDir, setWorkingDir] = useState("");
  const [runtime, setRuntime] = useState<AgentRuntime>(
    defaultAgentRuntime || "local"
  );
  const [specialty, setSpecialty] = useState<AgentSpecialty>("normal");
  const [cliType, setCliType] = useState<CliType>("claude");
  const [claudeModel, setClaudeModel] = useState<ClaudeModel>("sonnet");
  const [codexModel, setCodexModel] = useState<CodexModel>("gpt-5.6-sol");
  const [thinkingEnabled, setThinkingEnabled] = useState(false);
  const [reasoningEffort, setReasoningEffort] =
    useState<ReasoningEffort>("medium");
  const [avatarId, setAvatarId] = useState<AvatarId>("default");
  const [mcpServers, setMcpServers] = useState<MCPServerId[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showBrowser, setShowBrowser] = useState(false);
  const [browserData, setBrowserData] = useState<BrowseResponse | null>(null);
  const [browserLoading, setBrowserLoading] = useState(false);

  const addAgent = useAgentStore((state) => state.addAgent);
  const selectAgent = useAgentStore((state) => state.selectAgent);
  const agentCount = useAgentStore((state) => state.agents.length);

  useLayoutEffect(() => {
    if (!isOpen) return;
    setRuntime(defaultAgentRuntime || "local");
  }, [isOpen, defaultAgentRuntime]);

  const loadDirectory = useCallback(
    async (path?: string) => {
      setBrowserLoading(true);
      try {
        const data = await browseDirectory(path, runtime);
        setBrowserData(data);
      } catch (err) {
        console.error("Failed to browse directory:", err);
        setError("Failed to browse directory");
      } finally {
        setBrowserLoading(false);
      }
    },
    [runtime]
  );

  const handleBrowse = async () => {
    if (isTauri()) {
      try {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const selected = await open({
          directory: true,
          multiple: false,
          title: "Select Working Directory",
        });
        if (selected && typeof selected === "string") {
          setWorkingDir(selected);
        } else if (selected && Array.isArray(selected) && selected.length > 0) {
          setWorkingDir(selected[0]);
        }
      } catch (err) {
        console.error("Failed to open directory picker:", err);
        setError("Browse not available. Please type the path manually.");
      }
    } else {
      setShowBrowser(true);
      loadDirectory();
    }
  };

  const handleSelectDirectory = useCallback((path: string) => {
    setWorkingDir(path);
    setShowBrowser(false);
    setBrowserData(null);
  }, []);

  const handleCloseBrowser = useCallback(() => {
    setShowBrowser(false);
  }, []);

  const toggleMcpServer = useCallback((serverId: MCPServerId) => {
    setMcpServers((prev) =>
      prev.includes(serverId)
        ? prev.filter((id) => id !== serverId)
        : [...prev, serverId]
    );
  }, []);

  const handleCliTypeChange = useCallback((newCliType: CliType) => {
    setCliType(newCliType);
    // Clear MCP servers when switching away from Claude
    if (newCliType !== "claude") {
      setMcpServers([]);
      setThinkingEnabled(false);
    }
  }, []);

  const handleCreate = async () => {
    if (!workingDir.trim()) {
      setError("Working directory is required");
      return;
    }
    setCreating(true);
    setError(null);

    const id = generateId();
    const agentName = name.trim() || `Agent ${agentCount + 1}`;
    const dir = workingDir.trim();

    // Select the appropriate model based on CLI type
    const model = cliType === "codex" ? codexModel : claudeModel;

    try {
      await createAgent(id, dir, {
        model,
        thinkingEnabled: cliType === "claude" ? thinkingEnabled : false,
        reasoningEffort: cliType === "codex" ? reasoningEffort : undefined,
        mcpServers,
        cliType,
        specialty,
        runtime,
      });

      const agent = {
        id,
        name: agentName,
        status: "idle" as const,
        position: {
          x: (agentCount % 5) * 2 - 4,
          y: 0,
          z: Math.floor(agentCount / 5) * 2 - 2,
        },
        workingDirectory: dir,
        createdAt: new Date().toISOString(),
        model,
        thinkingEnabled: cliType === "claude" ? thinkingEnabled : undefined,
        reasoningEffort: cliType === "codex" ? reasoningEffort : undefined,
        specialty,
        avatarId,
        mcpServers: mcpServers.length > 0 ? mcpServers : undefined,
        cliType,
        runtime,
      };

      addAgent(agent);
      selectAgent(id);
      handleClose();
    } catch (err) {
      console.error("Failed to create agent:", err);
      setError(String(err));
    } finally {
      setCreating(false);
    }
  };

  const handleClose = () => {
    setName("");
    setWorkingDir("");
    setRuntime(defaultAgentRuntime || "local");
    setSpecialty("normal");
    setCliType("claude");
    setClaudeModel("sonnet");
    setCodexModel("gpt-5.6-sol");
    setThinkingEnabled(false);
    setReasoningEffort("medium");
    setAvatarId("default");
    setMcpServers([]);
    setError(null);
    setShowBrowser(false);
    setBrowserData(null);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Create New Agent"
      subtitle="Configure your AI assistant"
      width={560}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 24,
          position: "relative",
        }}
      >
        {/* Basic Info Section */}
        <section>
          <SectionHeader icon={<UserIcon />} title="Basic Information" />
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 16,
              marginTop: 12,
            }}
          >
            {/* Agent Name */}
            <FormField label="Agent Name" optional>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={`Agent ${agentCount + 1}`}
              />
            </FormField>

            {/* Working Directory */}
            <FormField
              label="Working Directory"
              required
              hint="The folder this agent will work in"
            >
              <div style={{ display: "flex", gap: 8 }}>
                <Input
                  value={workingDir}
                  onChange={(e) => setWorkingDir(e.target.value)}
                  placeholder="/path/to/your/project"
                  style={{ flex: 1 }}
                />
                <button onClick={handleBrowse} style={browseButtonStyle}>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                  Browse
                </button>
              </div>
            </FormField>
          </div>
        </section>

        {/* Runtime Selection */}
        {!isTauri() && (
          <section>
            <SectionHeader icon={<CloudIcon />} title="Runtime" />
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, 1fr)",
                gap: 10,
                marginTop: 12,
              }}
            >
              {AGENT_RUNTIMES.map((option) => (
                <RuntimeCard
                  key={option.value}
                  option={option}
                  selected={runtime === option.value}
                  onClick={() => setRuntime(option.value)}
                />
              ))}
            </div>
          </section>
        )}

        {/* Specialty Selection */}
        <section>
          <SectionHeader icon={<BadgeIcon />} title="Specialty" />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: 10,
              marginTop: 12,
            }}
          >
            {AGENT_SPECIALTIES.map((s) => (
              <SpecialtyCard
                key={s.value}
                specialty={s}
                selected={specialty === s.value}
                onClick={() => setSpecialty(s.value)}
              />
            ))}
          </div>
        </section>

        {/* CLI Type Selection */}
        <section>
          <SectionHeader icon={<TerminalIcon />} title="CLI Backend" />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: 10,
              marginTop: 12,
            }}
          >
            {CLI_TYPES.map((cli) => (
              <CliTypeCard
                key={cli.value}
                cliType={cli}
                selected={cliType === cli.value}
                onClick={() => handleCliTypeChange(cli.value)}
              />
            ))}
          </div>
        </section>

        {/* Model Selection */}
        <section>
          <SectionHeader icon={<BrainIcon />} title="Model" />
          {cliType === "claude" ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 10,
                marginTop: 12,
              }}
            >
              {CLAUDE_MODELS.map((m) => (
                <ModelCard
                  key={m.value}
                  model={m}
                  selected={claudeModel === m.value}
                  onClick={() => setClaudeModel(m.value)}
                />
              ))}
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, 1fr)",
                gap: 10,
                marginTop: 12,
              }}
            >
              {CODEX_MODELS.map((m) => (
                <ModelCard
                  key={m.value}
                  model={m}
                  selected={codexModel === m.value}
                  onClick={() => setCodexModel(m.value as CodexModel)}
                />
              ))}
            </div>
          )}

          {/* Thinking Mode Toggle - only show for Claude */}
          {cliType === "claude" && (
            <div style={{ marginTop: 16 }}>
              <ToggleSwitch
                checked={thinkingEnabled}
                onChange={setThinkingEnabled}
                label="Extended Thinking"
                description="Better reasoning for complex problems"
              />
            </div>
          )}

          {/* Reasoning Effort Selection - only show for Codex */}
          {cliType === "codex" && (
            <div style={{ marginTop: 16 }}>
              <label
                style={{
                  display: "block",
                  marginBottom: 8,
                  fontSize: 13,
                  color: "#9ca3af",
                }}
              >
                Reasoning Effort
              </label>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: 8,
                }}
              >
                {REASONING_EFFORTS.map((effort) => (
                  <button
                    key={effort.value}
                    onClick={() => setReasoningEffort(effort.value)}
                    style={{
                      padding: "10px 12px",
                      background:
                        reasoningEffort === effort.value
                          ? "rgba(59, 130, 246, 0.15)"
                          : "#0d0d14",
                      border: `2px solid ${reasoningEffort === effort.value ? "#3b82f6" : "#374151"}`,
                      borderRadius: 10,
                      cursor: "pointer",
                      transition: "all 0.2s ease",
                      textAlign: "center",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color:
                          reasoningEffort === effort.value
                            ? "#60a5fa"
                            : "#e5e7eb",
                      }}
                    >
                      {effort.name}
                    </div>
                    <div
                      style={{ fontSize: 10, color: "#6b7280", marginTop: 2 }}
                    >
                      {effort.description}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Avatar Selection */}
        <section>
          <SectionHeader icon={<SparkleIcon />} title="Avatar" />
          <div style={avatarGridStyle}>
            {AVATAR_OPTIONS.map((avatar) => (
              <AvatarOption
                key={avatar.id}
                avatar={avatar}
                selected={avatarId === avatar.id}
                onClick={() => setAvatarId(avatar.id)}
              />
            ))}
          </div>
        </section>

        {/* MCP Servers */}
        {(cliType === "claude" || cliType === "codex") &&
          MCP_SERVERS.length > 0 && (
            <section>
              <SectionHeader
                icon={<PlugIcon />}
                title="Capabilities"
                optional
              />
              <p
                style={{ margin: "8px 0 12px", fontSize: 13, color: "#6b7280" }}
              >
                Extend your agent with additional tools and integrations
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {MCP_SERVERS.map((server) => (
                  <MCPServerOption
                    key={server.id}
                    server={server}
                    selected={mcpServers.includes(server.id)}
                    onClick={() => toggleMcpServer(server.id)}
                  />
                ))}
              </div>
            </section>
          )}

        {/* Error Message */}
        {error && (
          <div style={errorStyle}>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            {error}
          </div>
        )}

        {/* Action Buttons */}
        <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
          <button onClick={handleClose} style={cancelButtonStyle}>
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={creating || !workingDir.trim()}
            style={{
              ...createButtonStyle,
              opacity: creating || !workingDir.trim() ? 0.5 : 1,
              cursor:
                creating || !workingDir.trim() ? "not-allowed" : "pointer",
            }}
          >
            {creating ? (
              <>
                <div style={spinnerStyle} />
                Creating...
              </>
            ) : (
              <>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Create Agent
              </>
            )}
          </button>
        </div>
      </div>
      {/* Directory Browser Overlay */}
      <DirectoryBrowser
        showBrowser={showBrowser}
        browserData={browserData}
        browserLoading={browserLoading}
        onClose={handleCloseBrowser}
        onNavigate={loadDirectory}
        onSelect={handleSelectDirectory}
      />
    </Modal>
  );
}

// ============ Sub-components ============

function SectionHeader({
  icon,
  title,
  optional,
}: {
  icon: React.ReactNode;
  title: string;
  optional?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ color: "#3b82f6" }}>{icon}</span>
      <span style={{ fontSize: 14, fontWeight: 600, color: "#e5e7eb" }}>
        {title}
      </span>
      {optional && (
        <span style={{ fontSize: 11, color: "#6b7280", fontWeight: 400 }}>
          (optional)
        </span>
      )}
    </div>
  );
}

function FormField({
  label,
  optional,
  required,
  hint,
  children,
}: {
  label: string;
  optional?: boolean;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        style={{
          display: "block",
          marginBottom: 6,
          fontSize: 13,
          color: "#9ca3af",
        }}
      >
        {label}
        {optional && (
          <span style={{ color: "#6b7280", marginLeft: 4 }}>(optional)</span>
        )}
        {required && <span style={{ color: "#ef4444", marginLeft: 4 }}>*</span>}
      </label>
      {children}
      {hint && (
        <p style={{ margin: "6px 0 0", fontSize: 12, color: "#6b7280" }}>
          {hint}
        </p>
      )}
    </div>
  );
}

function Input({
  style,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      style={{
        width: "100%",
        padding: "10px 14px",
        background: "#0d0d14",
        border: "1px solid #374151",
        borderRadius: 10,
        color: "#f3f4f6",
        fontSize: 14,
        outline: "none",
        transition: "all 0.2s ease",
        boxSizing: "border-box",
        ...style,
      }}
      onFocus={(e) => {
        e.currentTarget.style.borderColor = "#3b82f6";
        e.currentTarget.style.boxShadow = "0 0 0 3px rgba(59, 130, 246, 0.15)";
      }}
      onBlur={(e) => {
        e.currentTarget.style.borderColor = "#374151";
        e.currentTarget.style.boxShadow = "none";
      }}
    />
  );
}

function CliTypeCard({
  cliType,
  selected,
  onClick,
}: {
  cliType: {
    value: CliType;
    name: string;
    description: string;
    badge?: string;
  };
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        position: "relative",
        padding: "14px 12px",
        background: selected ? "rgba(59, 130, 246, 0.15)" : "#0d0d14",
        border: `2px solid ${selected ? "#3b82f6" : "#374151"}`,
        borderRadius: 12,
        cursor: "pointer",
        transition: "all 0.2s ease",
        textAlign: "left",
      }}
      onMouseEnter={(e) => {
        if (!selected) e.currentTarget.style.borderColor = "#4b5563";
      }}
      onMouseLeave={(e) => {
        if (!selected) e.currentTarget.style.borderColor = "#374151";
      }}
    >
      {cliType.badge && (
        <span
          style={{
            position: "absolute",
            top: -8,
            right: 8,
            padding: "2px 8px",
            background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
            borderRadius: 20,
            fontSize: 10,
            fontWeight: 600,
            color: "white",
          }}
        >
          {cliType.badge}
        </span>
      )}
      <div
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: selected ? "#60a5fa" : "#e5e7eb",
          marginBottom: 4,
        }}
      >
        {cliType.name}
      </div>
      <div style={{ fontSize: 11, color: "#9ca3af", lineHeight: 1.4 }}>
        {cliType.description}
      </div>
    </button>
  );
}

function RuntimeCard({
  option,
  selected,
  onClick,
}: {
  option: {
    value: AgentRuntime;
    name: string;
    description: string;
    badge?: string;
  };
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        position: "relative",
        padding: "14px 12px",
        background: selected ? "rgba(59, 130, 246, 0.15)" : "#0d0d14",
        border: `2px solid ${selected ? "#3b82f6" : "#374151"}`,
        borderRadius: 12,
        cursor: "pointer",
        transition: "all 0.2s ease",
        textAlign: "left",
      }}
      onMouseEnter={(e) => {
        if (!selected) e.currentTarget.style.borderColor = "#4b5563";
      }}
      onMouseLeave={(e) => {
        if (!selected) e.currentTarget.style.borderColor = "#374151";
      }}
    >
      {option.badge && (
        <span
          style={{
            position: "absolute",
            top: -8,
            right: 8,
            padding: "2px 8px",
            background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
            borderRadius: 20,
            fontSize: 10,
            fontWeight: 600,
            color: "white",
          }}
        >
          {option.badge}
        </span>
      )}
      <div
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: selected ? "#60a5fa" : "#e5e7eb",
          marginBottom: 4,
        }}
      >
        {option.name}
      </div>
      <div style={{ fontSize: 11, color: "#9ca3af", lineHeight: 1.4 }}>
        {option.description}
      </div>
    </button>
  );
}

function SpecialtyCard({
  specialty,
  selected,
  onClick,
}: {
  specialty: {
    value: AgentSpecialty;
    name: string;
    description: string;
    badge?: string;
  };
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        position: "relative",
        padding: "14px 12px",
        background: selected ? "rgba(59, 130, 246, 0.15)" : "#0d0d14",
        border: `2px solid ${selected ? "#3b82f6" : "#374151"}`,
        borderRadius: 12,
        cursor: "pointer",
        transition: "all 0.2s ease",
        textAlign: "left",
      }}
      onMouseEnter={(e) => {
        if (!selected) e.currentTarget.style.borderColor = "#4b5563";
      }}
      onMouseLeave={(e) => {
        if (!selected) e.currentTarget.style.borderColor = "#374151";
      }}
    >
      {specialty.badge && (
        <span
          style={{
            position: "absolute",
            top: -8,
            right: 8,
            padding: "2px 8px",
            background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
            borderRadius: 20,
            fontSize: 10,
            fontWeight: 600,
            color: "white",
          }}
        >
          {specialty.badge}
        </span>
      )}
      <div
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: selected ? "#60a5fa" : "#e5e7eb",
          marginBottom: 4,
        }}
      >
        {specialty.name}
      </div>
      <div style={{ fontSize: 11, color: "#9ca3af", lineHeight: 1.4 }}>
        {specialty.description}
      </div>
    </button>
  );
}

function ModelCard({
  model,
  selected,
  onClick,
}: {
  model: { value: string; name: string; description: string; badge?: string };
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        position: "relative",
        padding: "14px 12px",
        background: selected ? "rgba(59, 130, 246, 0.15)" : "#0d0d14",
        border: `2px solid ${selected ? "#3b82f6" : "#374151"}`,
        borderRadius: 12,
        cursor: "pointer",
        transition: "all 0.2s ease",
        textAlign: "left",
      }}
      onMouseEnter={(e) => {
        if (!selected) e.currentTarget.style.borderColor = "#4b5563";
      }}
      onMouseLeave={(e) => {
        if (!selected) e.currentTarget.style.borderColor = "#374151";
      }}
    >
      {model.badge && (
        <span
          style={{
            position: "absolute",
            top: -8,
            right: 8,
            padding: "2px 8px",
            background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
            borderRadius: 20,
            fontSize: 10,
            fontWeight: 600,
            color: "white",
          }}
        >
          {model.badge}
        </span>
      )}
      <div
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: selected ? "#60a5fa" : "#e5e7eb",
          marginBottom: 4,
        }}
      >
        {model.name}
      </div>
      <div style={{ fontSize: 11, color: "#9ca3af", lineHeight: 1.4 }}>
        {model.description}
      </div>
    </button>
  );
}

function ToggleSwitch({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description: string;
}) {
  return (
    <div
      onClick={() => onChange(!checked)}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 14px",
        background: checked ? "rgba(59, 130, 246, 0.1)" : "#0d0d14",
        border: `1px solid ${checked ? "#3b82f6" : "#374151"}`,
        borderRadius: 10,
        cursor: "pointer",
        transition: "all 0.2s ease",
      }}
    >
      <div>
        <div style={{ fontSize: 14, fontWeight: 500, color: "#e5e7eb" }}>
          {label}
        </div>
        <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
          {description}
        </div>
      </div>
      <div
        style={{
          width: 44,
          height: 24,
          background: checked ? "#3b82f6" : "#374151",
          borderRadius: 12,
          padding: 2,
          transition: "all 0.2s ease",
          flexShrink: 0,
          marginLeft: 16,
        }}
      >
        <div
          style={{
            width: 20,
            height: 20,
            background: "white",
            borderRadius: 10,
            transition: "all 0.2s ease",
            transform: checked ? "translateX(20px)" : "translateX(0)",
            boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
          }}
        />
      </div>
    </div>
  );
}

function AvatarOption({
  avatar,
  selected,
  onClick,
}: {
  avatar: { id: AvatarId; name: string };
  selected: boolean;
  onClick: () => void;
}) {
  const getAvatarEmoji = (id: AvatarId) => {
    switch (id) {
      case "default":
        return "🤖";
      case "casual-male":
        return "👨‍💻";
      case "casual-female":
        return "👩‍💻";
      case "business-male":
        return "👨‍💼";
      case "business-female":
        return "👩‍💼";
      case "creative-male":
        return "🧑‍🎨";
      case "creative-female":
        return "👩‍🎨";
      default:
        return "🤖";
    }
  };

  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        padding: "10px 8px",
        background: selected ? "rgba(59, 130, 246, 0.15)" : "transparent",
        border: `2px solid ${selected ? "#3b82f6" : "transparent"}`,
        borderRadius: 12,
        cursor: "pointer",
        transition: "all 0.2s ease",
        minWidth: 70,
      }}
      onMouseEnter={(e) => {
        if (!selected)
          e.currentTarget.style.background = "rgba(255,255,255,0.05)";
      }}
      onMouseLeave={(e) => {
        if (!selected) e.currentTarget.style.background = "transparent";
      }}
    >
      <span style={{ fontSize: 28 }}>{getAvatarEmoji(avatar.id)}</span>
      <span
        style={{
          fontSize: 11,
          color: selected ? "#60a5fa" : "#9ca3af",
          fontWeight: selected ? 500 : 400,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          maxWidth: "100%",
        }}
      >
        {avatar.name}
      </span>
    </button>
  );
}

function MCPServerOption({
  server,
  selected,
  onClick,
}: {
  server: {
    id: MCPServerId;
    name: string;
    description: string;
    requiresConfig?: boolean;
    configHint?: string;
  };
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "12px 14px",
        background: selected ? "rgba(59, 130, 246, 0.1)" : "#0d0d14",
        border: `1px solid ${selected ? "#3b82f6" : "#374151"}`,
        borderRadius: 10,
        cursor: "pointer",
        transition: "all 0.2s ease",
      }}
    >
      <div
        style={{
          width: 20,
          height: 20,
          borderRadius: 6,
          border: `2px solid ${selected ? "#3b82f6" : "#4b5563"}`,
          background: selected ? "#3b82f6" : "transparent",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          marginTop: 1,
          transition: "all 0.2s ease",
        }}
      >
        {selected && (
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="3"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: "#e5e7eb" }}>
          {server.name}
        </div>
        <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
          {server.description}
        </div>
        {server.requiresConfig && (
          <div
            style={{
              fontSize: 11,
              color: "#f59e0b",
              marginTop: 4,
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            {server.configHint}
          </div>
        )}
      </div>
    </div>
  );
}

// ============ Icons ============

function UserIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function CloudIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 17.58A5 5 0 0 0 18 8h-1.26A8 8 0 1 0 4 16.25" />
      <path d="m8 16 4-4 4 4" />
      <path d="M12 12v9" />
    </svg>
  );
}

function BrainIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z" />
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
    </svg>
  );
}

function BadgeIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2l3 6 6 .9-4.5 4.3 1.1 6.7L12 17.8 6.4 19.9l1.1-6.7L3 8.9 9 8l3-6z" />
    </svg>
  );
}

function PlugIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 22v-5" />
      <path d="M9 8V2" />
      <path d="M15 8V2" />
      <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
    </svg>
  );
}

function TerminalIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}

// ============ Styles ============

const avatarGridStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 4,
  marginTop: 12,
  padding: 4,
};

const browseButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "10px 16px",
  background: "#1f2937",
  border: "1px solid #374151",
  borderRadius: 10,
  color: "#e5e7eb",
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 500,
  whiteSpace: "nowrap",
  transition: "all 0.2s ease",
};

const cancelButtonStyle: React.CSSProperties = {
  flex: 1,
  padding: "12px 20px",
  background: "transparent",
  border: "1px solid #374151",
  borderRadius: 10,
  color: "#9ca3af",
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 500,
  transition: "all 0.2s ease",
};

const createButtonStyle: React.CSSProperties = {
  flex: 2,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  padding: "12px 20px",
  background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
  border: "none",
  borderRadius: 10,
  color: "white",
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 600,
  transition: "all 0.2s ease",
  boxShadow: "0 4px 14px rgba(59, 130, 246, 0.3)",
};

const spinnerStyle: React.CSSProperties = {
  width: 16,
  height: 16,
  border: "2px solid rgba(255,255,255,0.3)",
  borderTopColor: "white",
  borderRadius: "50%",
  animation: "spin 0.8s linear infinite",
};

const errorStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "12px 14px",
  background: "rgba(239, 68, 68, 0.1)",
  border: "1px solid rgba(239, 68, 68, 0.3)",
  borderRadius: 10,
  fontSize: 13,
  color: "#fca5a5",
};

// Directory browser styles
const browserOverlayStyle: React.CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: "#181825",
  borderRadius: 12,
  zIndex: 10,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  overscrollBehavior: "contain",
  animation: "slideIn 0.2s ease-out",
};

const browserContainerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  minHeight: 0,
};

const browserHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "14px 16px",
  borderBottom: "1px solid #374151",
};

const browserCloseButtonStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#6b7280",
  cursor: "pointer",
  padding: 6,
  borderRadius: 6,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  transition: "all 0.15s ease",
};

const browserPathStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "10px 16px",
  background: "#0d0d14",
  fontSize: 12,
  borderBottom: "1px solid #374151",
};

const browserBackButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  background: "#1f2937",
  border: "1px solid #374151",
  borderRadius: 6,
  padding: "5px 10px",
  color: "#e5e7eb",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 500,
};

const browserSelectButtonStyle: React.CSSProperties = {
  background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
  border: "none",
  borderRadius: 6,
  padding: "6px 14px",
  color: "white",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
};

const browserListStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: "auto",
  overscrollBehavior: "contain",
  padding: "8px 0",
};

const browserItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "10px 16px",
  cursor: "pointer",
  fontSize: 13,
  color: "#e5e7eb",
  transition: "background 0.15s ease",
};
