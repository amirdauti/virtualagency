import { useAgentStore } from "../../stores/agentStore";
import { killAgent } from "../../lib/api";
import type { Agent } from "@virtual-agency/shared";

export function WorkspacePanel() {
  const agents = useAgentStore((state) => state.agents);
  const selectedAgent = useAgentStore((state) => state.selectedAgent);
  const selectAgent = useAgentStore((state) => state.selectAgent);
  const removeAgent = useAgentStore((state) => state.removeAgent);
  const clearAllAgents = useAgentStore((state) => state.clearAllAgents);

  const handleSelect = (id: string) => {
    selectAgent(id);
  };

  const handleDelete = async (agent: Agent, e: React.MouseEvent) => {
    e.stopPropagation();
    // Remove from frontend state first to update UI immediately
    removeAgent(agent.id);
    // Then try to kill the backend process (may not exist for workspace-loaded agents)
    try {
      await killAgent(agent.id);
    } catch {
      // Agent process might not exist in backend, that's OK
    }
  };

  const handleClearAll = async () => {
    // Clear all from frontend state first
    const agentsCopy = [...agents];
    clearAllAgents();
    // Then try to kill backend processes
    for (const agent of agentsCopy) {
      try {
        await killAgent(agent.id);
      } catch {
        // Ignore errors for agents without backend processes
      }
    }
  };

  if (agents.length === 0) {
    return (
      <div style={containerStyle}>
        <div style={headerStyle}>
          <h3 style={{ margin: 0, fontSize: 14 }}>Agents</h3>
        </div>
        <div style={emptyStyle}>
          <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 13 }}>
            No agents yet
          </p>
          <p style={{ margin: "8px 0 0", color: "var(--text-secondary)", fontSize: 12 }}>
            Click "+ Add Agent" to create one
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <h3 style={{ margin: 0, fontSize: 14 }}>Agents</h3>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
            {agents.length}
          </span>
          <button
            onClick={handleClearAll}
            style={clearAllButtonStyle}
            title="Clear all agents"
          >
            Clear
          </button>
        </div>
      </div>
      <div style={listStyle}>
        {agents.map((agent) => (
          <div
            key={agent.id}
            onClick={() => handleSelect(agent.id)}
            style={{
              ...itemStyle,
              background:
                selectedAgent?.id === agent.id
                  ? "var(--bg-tertiary)"
                  : "transparent",
              borderColor:
                selectedAgent?.id === agent.id
                  ? "var(--accent)"
                  : "var(--border)",
            }}
          >
            <div style={itemContentStyle}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
                <span style={{ fontWeight: 500 }}>{agent.name}</span>
              </div>
              <span
                style={{
                  fontSize: 11,
                  color: "var(--text-secondary)",
                  fontFamily: "monospace",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {agent.workingDirectory}
              </span>
            </div>
            <button
              onClick={(e) => handleDelete(agent, e)}
              style={deleteButtonStyle}
              title="Delete agent"
            >
              &times;
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  position: "absolute",
  top: 16,
  right: 16,
  width: 260,
  background: "var(--bg-secondary)",
  borderRadius: 8,
  border: "1px solid var(--border)",
  overflow: "hidden",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "12px 16px",
  borderBottom: "1px solid var(--border)",
};

const listStyle: React.CSSProperties = {
  maxHeight: 300,
  overflow: "auto",
};

const itemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "10px 12px",
  cursor: "pointer",
  borderLeft: "3px solid transparent",
  transition: "background 0.15s",
};

const itemContentStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  overflow: "hidden",
  flex: 1,
};

const deleteButtonStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "var(--text-secondary)",
  fontSize: 18,
  cursor: "pointer",
  padding: "0 4px",
  opacity: 0.6,
};

const clearAllButtonStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: 4,
  color: "var(--text-secondary)",
  fontSize: 10,
  cursor: "pointer",
  padding: "2px 6px",
};

const emptyStyle: React.CSSProperties = {
  padding: 20,
  textAlign: "center",
};
