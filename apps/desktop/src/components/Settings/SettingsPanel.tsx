import { useEffect, useState } from "react";
import { useSettingsStore } from "../../stores/settingsStore";
import { getCliStatus, getSettingsPath, getWorkspacePath } from "../../lib/api";

interface SettingsPanelProps {
  onClose: () => void;
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const { settings, isLoading, load, updateSettings } = useSettingsStore();
  const [cliPath, setCliPath] = useState<string | null>(null);
  const [settingsPath, setSettingsPath] = useState<string>("");
  const [workspacePath, setWorkspacePath] = useState<string>("");

  useEffect(() => {
    load();
    getCliStatus().then((status) => setCliPath(status.path));
    getSettingsPath().then(setSettingsPath);
    getWorkspacePath().then(setWorkspacePath);
  }, [load]);

  const handleBrowseCli = async () => {
    try {
      // Dynamic import to avoid crashes if plugin not available
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: false,
        multiple: false,
        title: "Select Claude CLI Executable",
      });
      if (selected) {
        updateSettings({ claude_cli_path: selected as string });
      }
    } catch (err) {
      console.error("Failed to open file picker:", err);
    }
  };

  const handleBrowseWorkingDir = async () => {
    try {
      // Dynamic import to avoid crashes if plugin not available
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Default Working Directory",
      });
      if (selected) {
        updateSettings({ default_working_directory: selected as string });
      }
    } catch (err) {
      console.error("Failed to open directory picker:", err);
    }
  };

  if (isLoading) {
    return (
      <div style={overlayStyle}>
        <div style={panelStyle}>
          <div style={{ textAlign: "center", padding: "40px" }}>
            Loading settings...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyle}>
          <h2 style={{ margin: 0, fontSize: "18px" }}>Settings</h2>
          <button onClick={onClose} style={closeButtonStyle}>
            ✕
          </button>
        </div>

        <div style={contentStyle}>
          {/* CLI Configuration */}
          <section style={sectionStyle}>
            <h3 style={sectionTitleStyle}>Claude CLI</h3>

            <div style={fieldStyle}>
              <label style={labelStyle}>Detected Path</label>
              <input
                type="text"
                value={cliPath || "Not detected"}
                disabled
                style={{ ...inputStyle, opacity: 0.7 }}
              />
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>Custom CLI Path (optional)</label>
              <div style={{ display: "flex", gap: "8px" }}>
                <input
                  type="text"
                  value={settings.claude_cli_path || ""}
                  onChange={(e) =>
                    updateSettings({
                      claude_cli_path: e.target.value || null,
                    })
                  }
                  placeholder="/path/to/claude"
                  style={{ ...inputStyle, flex: 1 }}
                />
                <button
                  onClick={handleBrowseCli}
                  type="button"
                  style={browseButtonStyle}
                >
                  Browse...
                </button>
              </div>
              <span style={hintStyle}>
                Leave empty to use auto-detected path
              </span>
            </div>
          </section>

          {/* Workspace Settings */}
          <section style={sectionStyle}>
            <h3 style={sectionTitleStyle}>Workspace</h3>

            <div style={fieldStyle}>
              <label style={labelStyle}>Default Working Directory</label>
              <div style={{ display: "flex", gap: "8px" }}>
                <input
                  type="text"
                  value={settings.default_working_directory || ""}
                  onChange={(e) =>
                    updateSettings({
                      default_working_directory: e.target.value || null,
                    })
                  }
                  placeholder="~/projects"
                  style={{ ...inputStyle, flex: 1 }}
                />
                <button
                  onClick={handleBrowseWorkingDir}
                  type="button"
                  style={browseButtonStyle}
                >
                  Browse...
                </button>
              </div>
              <span style={hintStyle}>
                Default directory for new agents
              </span>
            </div>

            <div style={fieldStyle}>
              <label style={checkboxLabelStyle}>
                <input
                  type="checkbox"
                  checked={settings.auto_save_enabled}
                  onChange={(e) =>
                    updateSettings({ auto_save_enabled: e.target.checked })
                  }
                  style={checkboxStyle}
                />
                Enable auto-save
              </label>
            </div>

            {settings.auto_save_enabled && (
              <div style={fieldStyle}>
                <label style={labelStyle}>Auto-save interval (seconds)</label>
                <input
                  type="number"
                  min={5}
                  max={300}
                  value={settings.auto_save_interval_seconds}
                  onChange={(e) =>
                    updateSettings({
                      auto_save_interval_seconds: parseInt(e.target.value) || 30,
                    })
                  }
                  style={{ ...inputStyle, width: "100px" }}
                />
              </div>
            )}
          </section>

          {/* Theme Settings */}
          <section style={sectionStyle}>
            <h3 style={sectionTitleStyle}>Appearance</h3>

            <div style={fieldStyle}>
              <label style={labelStyle}>Theme</label>
              <select
                value={settings.theme}
                onChange={(e) => updateSettings({ theme: e.target.value })}
                style={selectStyle}
              >
                <option value="dark">Dark</option>
                <option value="light">Light (coming soon)</option>
              </select>
            </div>
          </section>

          {/* Data Locations */}
          <section style={sectionStyle}>
            <h3 style={sectionTitleStyle}>Data Locations</h3>

            <div style={fieldStyle}>
              <label style={labelStyle}>Settings File</label>
              <input
                type="text"
                value={settingsPath}
                disabled
                style={{ ...inputStyle, opacity: 0.7, fontSize: "12px" }}
              />
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>Workspace File</label>
              <input
                type="text"
                value={workspacePath}
                disabled
                style={{ ...inputStyle, opacity: 0.7, fontSize: "12px" }}
              />
            </div>
          </section>
        </div>

        <div style={footerStyle}>
          <span style={{ color: "#666", fontSize: "12px" }}>
            Settings are saved automatically
          </span>
          <button onClick={onClose} style={doneButtonStyle}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: "rgba(0, 0, 0, 0.7)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
};

const panelStyle: React.CSSProperties = {
  backgroundColor: "#1e1e1e",
  borderRadius: "12px",
  width: "500px",
  maxHeight: "80vh",
  display: "flex",
  flexDirection: "column",
  boxShadow: "0 20px 60px rgba(0, 0, 0, 0.5)",
  border: "1px solid #333",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "16px 20px",
  borderBottom: "1px solid #333",
};

const closeButtonStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#888",
  fontSize: "18px",
  cursor: "pointer",
  padding: "4px 8px",
  borderRadius: "4px",
};

const contentStyle: React.CSSProperties = {
  padding: "20px",
  overflowY: "auto",
  flex: 1,
};

const sectionStyle: React.CSSProperties = {
  marginBottom: "24px",
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: "14px",
  fontWeight: 600,
  color: "#888",
  marginBottom: "12px",
  textTransform: "uppercase",
  letterSpacing: "0.5px",
};

const fieldStyle: React.CSSProperties = {
  marginBottom: "16px",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  marginBottom: "6px",
  fontSize: "13px",
  color: "#ccc",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  backgroundColor: "#2a2a2a",
  border: "1px solid #444",
  borderRadius: "6px",
  color: "#fff",
  fontSize: "14px",
  outline: "none",
  boxSizing: "border-box",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: "pointer",
};

const checkboxLabelStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  fontSize: "14px",
  color: "#ccc",
  cursor: "pointer",
};

const checkboxStyle: React.CSSProperties = {
  width: "16px",
  height: "16px",
  cursor: "pointer",
};

const hintStyle: React.CSSProperties = {
  display: "block",
  marginTop: "4px",
  fontSize: "11px",
  color: "#666",
};

const footerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "16px 20px",
  borderTop: "1px solid #333",
};

const doneButtonStyle: React.CSSProperties = {
  padding: "8px 24px",
  backgroundColor: "#007bff",
  color: "#fff",
  border: "none",
  borderRadius: "6px",
  fontSize: "14px",
  cursor: "pointer",
  fontWeight: 500,
};

const browseButtonStyle: React.CSSProperties = {
  padding: "10px 16px",
  backgroundColor: "#333",
  border: "1px solid #444",
  borderRadius: "6px",
  color: "#fff",
  cursor: "pointer",
  fontSize: "14px",
  whiteSpace: "nowrap",
};
