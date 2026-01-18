import { useState, memo, useCallback } from "react";
import { Modal } from "../common/Modal";
import { createAgent, isTauri, browseDirectory, BrowseResponse, ClaudeModel } from "../../lib/api";
import { useAgentStore } from "../../stores/agentStore";
import { generateId, AVATAR_OPTIONS, AvatarId } from "@virtual-agency/shared";

// Memoized Directory Browser component to prevent re-renders from parent state changes
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

  return (
    <div style={browserOverlayStyle}>
      <div style={browserContainerStyle}>
        <div style={browserHeaderStyle}>
          <span style={{ fontWeight: 600 }}>Select Directory</span>
          <button
            onClick={onClose}
            style={browserCloseButtonStyle}
          >
            ×
          </button>
        </div>

        {browserData && (
          <div style={browserPathStyle}>
            {browserData.parent_path && (
              <button
                onClick={() => onNavigate(browserData.parent_path!)}
                style={browserBackButtonStyle}
              >
                ← Back
              </button>
            )}
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
              {browserData.current_path}
            </span>
            <button
              onClick={() => onSelect(browserData.current_path)}
              style={browserSelectButtonStyle}
            >
              Select This
            </button>
          </div>
        )}

        <div style={browserListStyle}>
          {browserLoading ? (
            <div style={{ padding: 20, textAlign: "center", color: "var(--text-secondary)" }}>
              Loading...
            </div>
          ) : browserData?.entries.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: "var(--text-secondary)" }}>
              No subdirectories
            </div>
          ) : (
            browserData?.entries.map((entry) => (
              <div
                key={entry.path}
                onClick={() => onNavigate(entry.path)}
                style={browserItemStyle}
              >
                <span style={{ marginRight: 8 }}>📁</span>
                {entry.name}
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

// Available Claude models - using aliases that always point to the latest version
const CLAUDE_MODELS: { value: ClaudeModel; label: string }[] = [
  { value: "sonnet", label: "Claude Sonnet (Recommended)" },
  { value: "opus", label: "Claude Opus (Most Capable)" },
  { value: "haiku", label: "Claude Haiku (Fast)" },
];

export function CreateAgentDialog({ isOpen, onClose }: CreateAgentDialogProps) {
  const [name, setName] = useState("");
  const [workingDir, setWorkingDir] = useState("");
  const [model, setModel] = useState<ClaudeModel>("sonnet");
  const [thinkingEnabled, setThinkingEnabled] = useState(false);
  const [avatarId, setAvatarId] = useState<AvatarId>("default");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showBrowser, setShowBrowser] = useState(false);
  const [browserData, setBrowserData] = useState<BrowseResponse | null>(null);
  const [browserLoading, setBrowserLoading] = useState(false);

  const addAgent = useAgentStore((state) => state.addAgent);
  const selectAgent = useAgentStore((state) => state.selectAgent);
  // Only get the count, not the full agents array - prevents re-renders when agent state changes
  const agentCount = useAgentStore((state) => state.agents.length);

  const loadDirectory = useCallback(async (path?: string) => {
    setBrowserLoading(true);
    try {
      const data = await browseDirectory(path);
      setBrowserData(data);
    } catch (err) {
      console.error("Failed to browse directory:", err);
      setError("Failed to browse directory");
    } finally {
      setBrowserLoading(false);
    }
  }, []);

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
      // Browser mode - use server-side directory browser
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

    try {
      await createAgent(id, dir, { model, thinkingEnabled });

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
        thinkingEnabled,
        avatarId,
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
    setModel("sonnet");
    setThinkingEnabled(false);
    setAvatarId("default");
    setError(null);
    setShowBrowser(false);
    setBrowserData(null);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Create New Agent">
      <div style={{ display: "flex", flexDirection: "column", gap: 16, position: "relative" }}>
        <div>
          <label style={labelStyle}>Agent Name (optional)</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`Agent ${agentCount + 1}`}
            style={inputStyle}
          />
        </div>

        <div>
          <label style={labelStyle}>Working Directory *</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              value={workingDir}
              onChange={(e) => setWorkingDir(e.target.value)}
              placeholder="/path/to/project"
              style={{ ...inputStyle, flex: 1 }}
            />
            <button
              onClick={handleBrowse}
              type="button"
              style={{
                padding: "10px 16px",
                background: "var(--bg-tertiary)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                color: "var(--text-primary)",
                cursor: "pointer",
                fontSize: 14,
                whiteSpace: "nowrap",
              }}
            >
              Browse...
            </button>
          </div>
          <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--text-secondary)" }}>
            The directory where this agent will operate
          </p>
        </div>

        <div>
          <label style={labelStyle}>Model</label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value as ClaudeModel)}
            style={selectStyle}
          >
            {CLAUDE_MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <label style={toggleContainerStyle}>
            <input
              type="checkbox"
              checked={thinkingEnabled}
              onChange={(e) => setThinkingEnabled(e.target.checked)}
              style={checkboxStyle}
            />
            <span style={toggleLabelStyle}>Enable Thinking Mode</span>
          </label>
          <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
            Extended thinking for complex tasks
          </span>
        </div>

        <div>
          <label style={labelStyle}>Avatar</label>
          <div style={avatarGridStyle}>
            {AVATAR_OPTIONS.map((avatar) => (
              <button
                key={avatar.id}
                type="button"
                onClick={() => setAvatarId(avatar.id)}
                style={{
                  ...avatarOptionStyle,
                  borderColor: avatarId === avatar.id ? "var(--accent)" : "var(--border)",
                  background: avatarId === avatar.id ? "var(--bg-tertiary)" : "var(--bg-primary)",
                }}
              >
                <div style={avatarIconStyle}>
                  {avatar.id === "default" ? "🤖" : "👤"}
                </div>
                <span style={avatarNameStyle}>{avatar.name}</span>
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div style={errorStyle}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
          <button
            onClick={handleCreate}
            disabled={creating || !workingDir.trim()}
            style={{
              ...buttonStyle,
              background: creating || !workingDir.trim() ? "#666" : "var(--accent)",
              cursor: creating || !workingDir.trim() ? "not-allowed" : "pointer",
              flex: 1,
            }}
          >
            {creating ? "Creating..." : "Create Agent"}
          </button>
          <button
            onClick={handleClose}
            style={{
              ...buttonStyle,
              background: "transparent",
              border: "1px solid var(--border)",
              color: "var(--text-secondary)",
            }}
          >
            Cancel
          </button>
        </div>

        <DirectoryBrowser
          showBrowser={showBrowser}
          browserData={browserData}
          browserLoading={browserLoading}
          onClose={handleCloseBrowser}
          onNavigate={loadDirectory}
          onSelect={handleSelectDirectory}
        />
      </div>
    </Modal>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  marginBottom: 8,
  fontSize: 13,
  color: "var(--text-secondary)",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  background: "var(--bg-primary)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text-primary)",
  fontSize: 14,
  boxSizing: "border-box",
};

const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  background: "var(--bg-primary)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text-primary)",
  fontSize: 14,
  boxSizing: "border-box",
  cursor: "pointer",
};

const toggleContainerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  cursor: "pointer",
};

const checkboxStyle: React.CSSProperties = {
  width: 18,
  height: 18,
  cursor: "pointer",
  accentColor: "var(--accent)",
};

const toggleLabelStyle: React.CSSProperties = {
  fontSize: 14,
  color: "var(--text-primary)",
  fontWeight: 500,
};

const buttonStyle: React.CSSProperties = {
  padding: "10px 20px",
  border: "none",
  borderRadius: 6,
  color: "white",
  fontWeight: 600,
  fontSize: 14,
};

const errorStyle: React.CSSProperties = {
  padding: 12,
  background: "#7f1d1d",
  borderRadius: 6,
  fontSize: 13,
  color: "#fecaca",
};

// Directory browser styles
const browserOverlayStyle: React.CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: "var(--bg-secondary)",
  borderRadius: 8,
  zIndex: 10,
  display: "flex",
  flexDirection: "column",
};

const browserContainerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  minHeight: 300,
};

const browserHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "12px 16px",
  borderBottom: "1px solid var(--border)",
};

const browserCloseButtonStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--text-secondary)",
  fontSize: 20,
  cursor: "pointer",
  padding: "0 4px",
};

const browserPathStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 16px",
  background: "var(--bg-primary)",
  fontSize: 12,
  color: "var(--text-secondary)",
  borderBottom: "1px solid var(--border)",
};

const browserBackButtonStyle: React.CSSProperties = {
  background: "var(--bg-tertiary)",
  border: "1px solid var(--border)",
  borderRadius: 4,
  padding: "4px 8px",
  color: "var(--text-primary)",
  cursor: "pointer",
  fontSize: 12,
};

const browserSelectButtonStyle: React.CSSProperties = {
  background: "var(--accent)",
  border: "none",
  borderRadius: 4,
  padding: "4px 12px",
  color: "white",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
};

const browserListStyle: React.CSSProperties = {
  flex: 1,
  overflow: "auto",
  padding: "8px 0",
};

const browserItemStyle: React.CSSProperties = {
  padding: "8px 16px",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  fontSize: 13,
  transition: "background 0.1s",
};

// Avatar picker styles
const avatarGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  gap: 8,
  maxHeight: 200,
  overflow: "auto",
  padding: 4,
};

const avatarOptionStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 4,
  padding: "8px 4px",
  border: "2px solid var(--border)",
  borderRadius: 8,
  cursor: "pointer",
  transition: "all 0.15s ease",
};

const avatarIconStyle: React.CSSProperties = {
  fontSize: 24,
  lineHeight: 1,
};

const avatarNameStyle: React.CSSProperties = {
  fontSize: 10,
  color: "var(--text-secondary)",
  textAlign: "center",
  lineHeight: 1.2,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  width: "100%",
};
