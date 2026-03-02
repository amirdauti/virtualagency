import { useEffect, useMemo, useState } from "react";
import { MCP_SERVERS, MCPServerId } from "@virtual-agency/shared";
import { Modal } from "../common/Modal";
import { updateAgentSettings } from "../../lib/api";
import { useAgentStore } from "../../stores/agentStore";

interface EditAgentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  agentId: string;
  currentName: string;
  currentMcpServers?: MCPServerId[];
}

export function EditAgentDialog({
  isOpen,
  onClose,
  agentId,
  currentName,
  currentMcpServers,
}: EditAgentDialogProps) {
  const [name, setName] = useState(currentName);
  const [mcpServers, setMcpServers] = useState<MCPServerId[]>(currentMcpServers || []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const updateAgent = useAgentStore((state) => state.updateAgent);

  useEffect(() => {
    if (!isOpen) return;
    setName(currentName);
    setMcpServers(currentMcpServers || []);
    setError(null);
    setSaving(false);
  }, [isOpen, currentName, currentMcpServers]);

  const selectedSet = useMemo(() => new Set(mcpServers), [mcpServers]);

  const toggleServer = (id: MCPServerId) => {
    setMcpServers((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Agent name is required.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await updateAgentSettings(agentId, {
        name: trimmed,
        mcpServers,
      });
      updateAgent(agentId, {
        name: trimmed,
        mcpServers: mcpServers.length > 0 ? mcpServers : undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Edit Agent">
      <div style={containerStyle}>
        <div style={fieldStyle}>
          <label style={labelStyle}>Agent Name</label>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Agent name"
            style={inputStyle}
          />
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle}>MCP Servers</label>
          <div style={serverListStyle}>
            {MCP_SERVERS.map((server) => {
              const checked = selectedSet.has(server.id);
              return (
                <label key={server.id} style={serverRowStyle}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleServer(server.id)}
                    style={{ marginTop: 2 }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div style={serverNameStyle}>{server.name}</div>
                    <div style={serverDescriptionStyle}>{server.description}</div>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        {error && <div style={errorStyle}>{error}</div>}

        <div style={actionsStyle}>
          <button type="button" onClick={onClose} style={secondaryButtonStyle} disabled={saving}>
            Cancel
          </button>
          <button type="button" onClick={handleSave} style={primaryButtonStyle} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

const containerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 14,
};

const fieldStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--text-secondary)",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  border: "1px solid var(--border)",
  borderRadius: 6,
  background: "var(--bg-primary)",
  color: "var(--text-primary)",
  padding: "8px 10px",
  fontSize: 14,
};

const serverListStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  maxHeight: 260,
  overflowY: "auto",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: 10,
  background: "var(--bg-primary)",
};

const serverRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 8,
  cursor: "pointer",
};

const serverNameStyle: React.CSSProperties = {
  color: "var(--text-primary)",
  fontSize: 13,
  fontWeight: 600,
  lineHeight: 1.2,
};

const serverDescriptionStyle: React.CSSProperties = {
  color: "var(--text-secondary)",
  fontSize: 12,
  lineHeight: 1.3,
  marginTop: 2,
};

const errorStyle: React.CSSProperties = {
  color: "#ef4444",
  fontSize: 12,
};

const actionsStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 10,
  marginTop: 6,
};

const primaryButtonStyle: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 6,
  border: "1px solid #007fd4",
  background: "#007fd4",
  color: "white",
  fontWeight: 600,
  cursor: "pointer",
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text-secondary)",
  fontWeight: 600,
  cursor: "pointer",
};
