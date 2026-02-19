import { useEffect, useState } from "react";
import { useSettingsStore } from "../../stores/settingsStore";
import {
  getCliStatus,
  getSettingsPath,
  getWorkspacePath,
  isTauri,
  createHostedCheckoutSession,
  getHostedServerState,
  provisionHostedServer,
  startHostedServer,
  stopHostedServer,
  rebuildHostedServer,
  destroyHostedServer,
  rotateHostedPairingCode,
  startHostedCodexAuth,
  getHostedCodexAuthStatus,
  type HostedCodexAuthState,
  type HostedServerStateResponse,
} from "../../lib/api";

interface SettingsPanelProps {
  onClose: () => void;
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const { settings, isLoading, load, updateSettings } = useSettingsStore();
  const [cliPath, setCliPath] = useState<string | null>(null);
  const [settingsPath, setSettingsPath] = useState<string>("");
  const [workspacePath, setWorkspacePath] = useState<string>("");
  const [hostedState, setHostedState] = useState<HostedServerStateResponse | null>(null);
  const [hostedLoading, setHostedLoading] = useState(false);
  const [hostedError, setHostedError] = useState<string | null>(null);
  const [hostedAction, setHostedAction] = useState<string | null>(null);

  const applyHostedCodexAuthState = (codexAuth: HostedCodexAuthState) => {
    setHostedState((prev) => {
      if (!prev?.server) return prev;
      return {
        ...prev,
        server: {
          ...prev.server,
          codexAuth,
        },
      };
    });
  };

  useEffect(() => {
    load();
    getCliStatus().then((status) => setCliPath(status.path));
    getSettingsPath().then(setSettingsPath);
    getWorkspacePath().then(setWorkspacePath);
    if (!isTauri()) {
      setHostedLoading(true);
      getHostedServerState()
        .then((state) => {
          setHostedState(state);
          setHostedError(null);
        })
        .catch((err) => {
          setHostedError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          setHostedLoading(false);
        });
    }
  }, [load]);

  const refreshHostedState = async () => {
    if (isTauri()) return;
    setHostedLoading(true);
    try {
      const state = await getHostedServerState();
      setHostedState(state);
      setHostedError(null);
    } catch (err) {
      setHostedError(err instanceof Error ? err.message : String(err));
    } finally {
      setHostedLoading(false);
    }
  };

  const runHostedAction = async (
    actionName: string,
    action: () => Promise<unknown>,
  ) => {
    setHostedAction(actionName);
    setHostedError(null);
    try {
      await action();
      await refreshHostedState();
    } catch (err) {
      setHostedError(err instanceof Error ? err.message : String(err));
    } finally {
      setHostedAction(null);
    }
  };

  useEffect(() => {
    if (isTauri()) return undefined;
    const status = hostedState?.server?.codexAuth?.status;
    if (!status || !["starting", "awaiting_user", "authorizing"].includes(status)) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      getHostedCodexAuthStatus()
        .then((codexAuth) => {
          applyHostedCodexAuthState(codexAuth);
        })
        .catch((err) => {
          setHostedError(err instanceof Error ? err.message : String(err));
        });
    }, 2000);

    return () => window.clearInterval(timer);
  }, [hostedState?.server?.codexAuth?.status]);

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

  const hostedServerStatus = hostedState?.server?.status?.toLowerCase() || "";
  const hasHostedServer = Boolean(hostedState?.server && hostedServerStatus !== "deleted");
  const hostedIsReady = hostedServerStatus === "ready";
  const hostedIsStopped = hostedServerStatus === "stopped";
  const hostedCanManage = hostedIsReady || hostedIsStopped;
  const codexAuth = hostedState?.server?.codexAuth;
  const codexAuthStatus = codexAuth?.status || "not_started";
  const codexAuthInProgress = ["starting", "awaiting_user", "authorizing"].includes(
    codexAuthStatus,
  );
  const canProvisionHostedServer =
    hostedAction === null &&
    Boolean(hostedState?.hostedSubscriptionActive) &&
    (!hasHostedServer || hostedServerStatus === "deleted");

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

            {!isTauri() && (
              <div style={fieldStyle}>
                <label style={labelStyle}>Default Runtime</label>
                <select
                  value={settings.default_agent_runtime}
                  onChange={(e) =>
                    updateSettings({
                      default_agent_runtime:
                        e.target.value === "hosted" ? "hosted" : "local",
                    })
                  }
                  style={selectStyle}
                >
                  <option value="local">Local</option>
                  <option value="hosted">Cloud Agents</option>
                </select>
                <span style={hintStyle}>
                  Used as the default when creating new agents
                </span>
              </div>
            )}

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

          {!isTauri() && (
            <section style={sectionStyle}>
              <h3 style={sectionTitleStyle}>Cloud Agents</h3>

              <div style={fieldStyle}>
                <label style={labelStyle}>Subscription</label>
                <input
                  type="text"
                  value={
                    hostedState?.hostedSubscriptionActive
                      ? `Active (${hostedState.hostedSubscriptionStatus || "active"})`
                      : "Not active"
                  }
                  disabled
                  style={{ ...inputStyle, opacity: 0.7 }}
                />
              </div>

              <div style={fieldStyle}>
                <label style={labelStyle}>Server Status</label>
                <input
                  type="text"
                  value={hostedState?.server?.status || "Not provisioned"}
                  disabled
                  style={{ ...inputStyle, opacity: 0.7 }}
                />
              </div>

              <div style={fieldStyle}>
                <label style={labelStyle}>Server IP</label>
                <input
                  type="text"
                  value={hostedState?.server?.ipAddress || "—"}
                  disabled
                  style={{ ...inputStyle, opacity: 0.7 }}
                />
              </div>

              <div style={fieldStyle}>
                <label style={labelStyle}>Server SSH Public Key</label>
                <textarea
                  value={hostedState?.server?.sshPublicKey || "Waiting for bootstrap..."}
                  readOnly
                  rows={3}
                  style={{ ...inputStyle, resize: "vertical" }}
                />
                <span style={hintStyle}>
                  Add this key to GitHub deploy keys if your hosted agents need repo access
                </span>
              </div>

              {hostedState?.server?.pairingCode && (
                <div style={fieldStyle}>
                  <label style={labelStyle}>Pairing Code</label>
                  <input
                    type="text"
                    value={`${hostedState.server.pairingCode} (expires ${hostedState.server.pairingExpiresAt || "soon"})`}
                    readOnly
                    style={{ ...inputStyle, opacity: 0.85 }}
                  />
                </div>
              )}

              {hostedState?.server?.ipAddress && (
                <div style={fieldStyle}>
                  <label style={labelStyle}>Codex Auth</label>
                  <input
                    type="text"
                    value={codexAuthStatus}
                    readOnly
                    style={{ ...inputStyle, opacity: 0.85 }}
                  />
                  <span style={hintStyle}>
                    Virtual Agency runs <code>codex login --device-auth</code> on your VPS and waits for browser confirmation.
                  </span>
                  {codexAuth?.userCode && (
                    <input
                      type="text"
                      value={`Code: ${codexAuth.userCode}`}
                      readOnly
                      style={{ ...inputStyle, marginTop: 8, fontFamily: "monospace" }}
                    />
                  )}
                  {codexAuth?.verificationUri && (
                    <input
                      type="text"
                      value={codexAuth.verificationUri}
                      readOnly
                      style={{ ...inputStyle, marginTop: 8, fontFamily: "monospace" }}
                    />
                  )}
                  {codexAuth?.lastMessage && (
                    <div style={{ ...hintStyle, marginTop: 8 }}>{codexAuth.lastMessage}</div>
                  )}
                  {codexAuth?.lastError && (
                    <div style={{ ...hintStyle, marginTop: 6, color: "#ef4444" }}>
                      {codexAuth.lastError}
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <button
                  type="button"
                  style={secondaryActionButtonStyle}
                  onClick={() => {
                    setHostedAction("checkout");
                    createHostedCheckoutSession()
                      .then((resp) => {
                        if (resp?.url) window.location.href = resp.url;
                      })
                      .catch((err) =>
                        setHostedError(err instanceof Error ? err.message : String(err)),
                      )
                      .finally(() => setHostedAction(null));
                  }}
                  disabled={hostedAction !== null}
                >
                  {hostedAction === "checkout" ? "Opening..." : "Purchase Cloud Agents ($25/mo)"}
                </button>

                <button
                  type="button"
                  style={secondaryActionButtonStyle}
                  onClick={() =>
                    runHostedAction("provision", async () => {
                      await provisionHostedServer();
                    })
                  }
                  disabled={!canProvisionHostedServer}
                >
                  {hostedAction === "provision" ? "Provisioning..." : "Provision VPS"}
                </button>

                <button
                  type="button"
                  style={secondaryActionButtonStyle}
                  onClick={() =>
                    runHostedAction("start", async () => {
                      await startHostedServer();
                    })
                  }
                  disabled={hostedAction !== null || !hasHostedServer || !hostedIsStopped}
                >
                  Start
                </button>

                <button
                  type="button"
                  style={secondaryActionButtonStyle}
                  onClick={() =>
                    runHostedAction("stop", async () => {
                      await stopHostedServer();
                    })
                  }
                  disabled={hostedAction !== null || !hasHostedServer || !hostedIsReady}
                >
                  Stop
                </button>

                <button
                  type="button"
                  style={secondaryActionButtonStyle}
                  onClick={() =>
                    runHostedAction("rebuild", async () => {
                      await rebuildHostedServer();
                    })
                  }
                  disabled={hostedAction !== null || !hasHostedServer || !hostedCanManage}
                >
                  Rebuild
                </button>

                <button
                  type="button"
                  style={dangerActionButtonStyle}
                  onClick={() =>
                    runHostedAction("destroy", async () => {
                      await destroyHostedServer();
                    })
                  }
                  disabled={hostedAction !== null || !hasHostedServer || !hostedCanManage}
                >
                  Destroy
                </button>

                <button
                  type="button"
                  style={secondaryActionButtonStyle}
                  onClick={() =>
                    runHostedAction("codex-auth", async () => {
                      const codexAuthState = await startHostedCodexAuth();
                      applyHostedCodexAuthState(codexAuthState);
                    })
                  }
                  disabled={hostedAction !== null || !hasHostedServer || !hostedIsReady || codexAuthInProgress}
                >
                  {hostedAction === "codex-auth"
                    ? "Starting Codex auth..."
                    : codexAuthInProgress
                      ? "Codex auth in progress..."
                      : "Set up Codex Auth"}
                </button>

                <button
                  type="button"
                  style={secondaryActionButtonStyle}
                  onClick={() =>
                    runHostedAction("pairing", async () => {
                      await rotateHostedPairingCode();
                    })
                  }
                  disabled={hostedAction !== null || !hasHostedServer || !hostedIsReady}
                >
                  Rotate Pairing Code
                </button>

                <button
                  type="button"
                  style={secondaryActionButtonStyle}
                  onClick={() => {
                    void refreshHostedState();
                  }}
                  disabled={hostedLoading || hostedAction !== null}
                >
                  Refresh
                </button>
              </div>

              {hasHostedServer && !hostedCanManage && (
                <div style={{ ...hintStyle, marginTop: 8 }}>
                  Server actions unlock when status is <code>ready</code> (or <code>stopped</code> for start/rebuild/destroy).
                </div>
              )}

              {(hostedLoading || hostedError || hostedState?.server?.lastError) && (
                <div style={{ marginTop: 10 }}>
                  {hostedLoading && <span style={hintStyle}>Loading hosted state...</span>}
                  {hostedError && (
                    <div style={{ ...hintStyle, color: "#ef4444" }}>{hostedError}</div>
                  )}
                  {hostedState?.server?.lastError && (
                    <div style={{ ...hintStyle, color: "#ef4444" }}>
                      {hostedState.server.lastError}
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

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

const secondaryActionButtonStyle: React.CSSProperties = {
  padding: "8px 12px",
  backgroundColor: "#1f2937",
  border: "1px solid #374151",
  borderRadius: "6px",
  color: "#e5e7eb",
  cursor: "pointer",
  fontSize: "13px",
};

const dangerActionButtonStyle: React.CSSProperties = {
  ...secondaryActionButtonStyle,
  backgroundColor: "rgba(153, 27, 27, 0.35)",
  border: "1px solid #7f1d1d",
  color: "#fecaca",
};
