import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  AgentTelegramSettings,
  deleteAgentTelegramSettings,
  getAgentTelegramSettings,
  isTauri,
  setAgentTelegramSettings,
} from "../../lib/api";

interface TelegramPanelProps {
  agentId: string;
}

const DEFAULT_SETTINGS: AgentTelegramSettings = {
  enabled: false,
  polling: false,
  connected: false,
  has_token: false,
  allowed_handle: "",
  allowed_chat_ids: [],
  send_typing: true,
  send_updates: false,
  queue_depth: 0,
  has_active_turn: false,
  last_error: null,
  last_update_id: null,
};

export function TelegramPanel({ agentId }: TelegramPanelProps) {
  const tauri = isTauri();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<AgentTelegramSettings>(DEFAULT_SETTINGS);

  const [enabled, setEnabled] = useState(false);
  const [sendTyping, setSendTyping] = useState(true);
  const [sendUpdates, setSendUpdates] = useState(false);
  const [allowedHandle, setAllowedHandle] = useState("");
  const [botToken, setBotToken] = useState("");

  const refresh = useCallback(async () => {
    if (tauri) return;
    try {
      const data = await getAgentTelegramSettings(agentId);
      setStatus(data);
      setEnabled(data.enabled);
      setSendTyping(data.send_typing);
      setSendUpdates(data.send_updates);
      setAllowedHandle(data.allowed_handle || "");
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [agentId, tauri]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!status.enabled) return;
    const interval = setInterval(() => {
      void refresh();
    }, 4000);
    return () => clearInterval(interval);
  }, [refresh, status.enabled]);

  const normalizedHandle = useMemo(
    () => allowedHandle.trim().replace(/^@/, ""),
    [allowedHandle]
  );

  const save = useCallback(async () => {
    if (tauri) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await setAgentTelegramSettings(agentId, {
        enabled,
        allowed_handle: normalizedHandle,
        send_typing: sendTyping,
        send_updates: sendUpdates,
        bot_token: botToken.trim().length > 0 ? botToken.trim() : undefined,
      });
      setStatus(updated);
      setBotToken("");
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }, [agentId, botToken, enabled, normalizedHandle, sendTyping, sendUpdates, tauri]);

  const disconnect = useCallback(async () => {
    if (tauri) return;
    setSaving(true);
    setError(null);
    try {
      await deleteAgentTelegramSettings(agentId);
      setStatus(DEFAULT_SETTINGS);
      setEnabled(false);
      setAllowedHandle("");
      setBotToken("");
      setSendTyping(true);
      setSendUpdates(false);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }, [agentId, tauri]);

  if (tauri) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <div style={titleStyle}>Telegram Integration</div>
          <div style={mutedStyle}>
            Telegram bot routing is currently available in browser/server mode.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <div style={headerRowStyle}>
          <div>
            <div style={titleStyle}>Telegram Bot Routing</div>
            <div style={mutedStyle}>
              This agent will only process Telegram messages from the configured handle.
            </div>
          </div>
          <button onClick={() => void refresh()} disabled={loading || saving} style={secondaryButtonStyle}>
            Refresh
          </button>
        </div>

        <div style={statusRowStyle}>
          <StatusPill label={status.enabled ? "Enabled" : "Disabled"} ok={status.enabled} />
          <StatusPill label={status.polling ? "Polling" : "Stopped"} ok={status.polling} />
          <StatusPill label={status.connected ? "Connected" : "Not Connected"} ok={status.connected} />
          <StatusPill label={status.has_token ? "Token Set" : "No Token"} ok={status.has_token} />
        </div>

        <label style={labelStyle}>Allowed Telegram Handle</label>
        <input
          value={allowedHandle}
          onChange={(e) => setAllowedHandle(e.target.value)}
          placeholder="@your_username"
          style={inputStyle}
          disabled={saving}
        />

        <label style={labelStyle}>Bot Token</label>
        <input
          type="password"
          value={botToken}
          onChange={(e) => setBotToken(e.target.value)}
          placeholder={status.has_token ? "Leave empty to keep existing token" : "123456:ABC..."}
          style={inputStyle}
          disabled={saving}
        />

        <div style={toggleRowStyle}>
          <label style={checkboxLabelStyle}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              disabled={saving}
            />
            Enable Telegram for this agent
          </label>
          <label style={checkboxLabelStyle}>
            <input
              type="checkbox"
              checked={sendTyping}
              onChange={(e) => setSendTyping(e.target.checked)}
              disabled={saving}
            />
            Send typing indicator while agent is working
          </label>
          <label style={checkboxLabelStyle}>
            <input
              type="checkbox"
              checked={sendUpdates}
              onChange={(e) => setSendUpdates(e.target.checked)}
              disabled={saving}
            />
            Send incremental progress updates
          </label>
        </div>

        <div style={buttonRowStyle}>
          <button
            onClick={() => void save()}
            disabled={saving || normalizedHandle.length === 0 || (!status.has_token && botToken.trim().length === 0)}
            style={primaryButtonStyle}
          >
            {saving ? "Saving..." : "Save"}
          </button>
          <button onClick={() => void disconnect()} disabled={saving} style={dangerButtonStyle}>
            Disconnect
          </button>
        </div>

        <div style={metaBoxStyle}>
          <div style={metaLineStyle}>
            <span style={mutedLabelStyle}>Allowed chat IDs:</span>{" "}
            {status.allowed_chat_ids.length > 0 ? status.allowed_chat_ids.join(", ") : "none yet"}
          </div>
          <div style={metaLineStyle}>
            <span style={mutedLabelStyle}>Queue depth:</span> {status.queue_depth}
          </div>
          <div style={metaLineStyle}>
            <span style={mutedLabelStyle}>Active turn:</span> {status.has_active_turn ? "yes" : "no"}
          </div>
          <div style={metaLineStyle}>
            <span style={mutedLabelStyle}>Last update id:</span>{" "}
            {status.last_update_id !== null ? status.last_update_id : "n/a"}
          </div>
        </div>

        {status.last_error && <div style={errorStyle}>Last server error: {status.last_error}</div>}
        {error && <div style={errorStyle}>Error: {error}</div>}
      </div>
    </div>
  );
}

function StatusPill({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        padding: "4px 8px",
        borderRadius: 999,
        border: `1px solid ${ok ? "rgba(74, 222, 128, 0.4)" : "rgba(148, 163, 184, 0.35)"}`,
        color: ok ? "#4ade80" : "#94a3b8",
        background: ok ? "rgba(74, 222, 128, 0.1)" : "rgba(148, 163, 184, 0.08)",
      }}
    >
      {label}
    </span>
  );
}

const containerStyle: CSSProperties = {
  height: "100%",
  overflow: "auto",
  padding: 16,
};

const cardStyle: CSSProperties = {
  maxWidth: 760,
  margin: "0 auto",
  background: "#161821",
  border: "1px solid #2b3143",
  borderRadius: 12,
  padding: 16,
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const headerRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 12,
};

const titleStyle: CSSProperties = {
  color: "#e5e7eb",
  fontSize: 16,
  fontWeight: 700,
};

const mutedStyle: CSSProperties = {
  color: "#9ca3af",
  fontSize: 12,
  marginTop: 4,
};

const statusRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
};

const labelStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "#cbd5e1",
};

const inputStyle: CSSProperties = {
  width: "100%",
  background: "#0f1118",
  border: "1px solid #2b3143",
  borderRadius: 8,
  color: "#e5e7eb",
  padding: "10px 12px",
  fontSize: 13,
};

const toggleRowStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const checkboxLabelStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  color: "#cbd5e1",
  fontSize: 12,
};

const buttonRowStyle: CSSProperties = {
  display: "flex",
  gap: 10,
  marginTop: 4,
};

const baseButtonStyle: CSSProperties = {
  borderRadius: 8,
  border: "1px solid transparent",
  padding: "9px 12px",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};

const primaryButtonStyle: CSSProperties = {
  ...baseButtonStyle,
  background: "#1d4ed8",
  borderColor: "#2563eb",
  color: "white",
};

const secondaryButtonStyle: CSSProperties = {
  ...baseButtonStyle,
  background: "#111827",
  borderColor: "#334155",
  color: "#cbd5e1",
};

const dangerButtonStyle: CSSProperties = {
  ...baseButtonStyle,
  background: "#3f1d2a",
  borderColor: "#7f1d1d",
  color: "#fecaca",
};

const metaBoxStyle: CSSProperties = {
  border: "1px solid #2b3143",
  borderRadius: 8,
  padding: 10,
  background: "#0f1118",
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const metaLineStyle: CSSProperties = {
  fontSize: 12,
  color: "#d1d5db",
};

const mutedLabelStyle: CSSProperties = {
  color: "#94a3b8",
};

const errorStyle: CSSProperties = {
  border: "1px solid #7f1d1d",
  background: "rgba(127, 29, 29, 0.2)",
  color: "#fca5a5",
  fontSize: 12,
  borderRadius: 8,
  padding: 10,
};
