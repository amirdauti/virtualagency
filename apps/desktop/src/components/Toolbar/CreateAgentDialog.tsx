import { useState } from "react";
import { Modal } from "../common/Modal";
import { createAgent } from "../../lib/api";
import { useAgentStore } from "../../stores/agentStore";
import { generateId } from "@virtual-agency/shared";

interface CreateAgentDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CreateAgentDialog({ isOpen, onClose }: CreateAgentDialogProps) {
  const [name, setName] = useState("");
  const [workingDir, setWorkingDir] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addAgent = useAgentStore((state) => state.addAgent);
  const selectAgent = useAgentStore((state) => state.selectAgent);
  const agents = useAgentStore((state) => state.agents);

  const handleBrowse = async () => {
    try {
      // Dynamic import to avoid crashes if plugin not available
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Working Directory",
      });
      console.log("Directory picker result:", selected, typeof selected);
      if (selected && typeof selected === "string") {
        setWorkingDir(selected);
      } else if (selected && Array.isArray(selected) && selected.length > 0) {
        // Handle case where it might return an array
        setWorkingDir(selected[0]);
      }
    } catch (err) {
      console.error("Failed to open directory picker:", err);
      setError("Browse not available. Please type the path manually.");
    }
  };

  const handleCreate = async () => {
    if (!workingDir.trim()) {
      setError("Working directory is required");
      return;
    }

    setCreating(true);
    setError(null);

    const id = generateId();
    const agentName = name.trim() || `Agent ${agents.length + 1}`;
    const dir = workingDir.trim();

    try {
      await createAgent(id, dir);

      const agent = {
        id,
        name: agentName,
        status: "idle" as const,
        position: {
          x: (agents.length % 5) * 2 - 4,
          y: 0,
          z: Math.floor(agents.length / 5) * 2 - 2,
        },
        workingDirectory: dir,
        createdAt: new Date().toISOString(),
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
    setError(null);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Create New Agent">
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <label style={labelStyle}>Agent Name (optional)</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`Agent ${agents.length + 1}`}
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
