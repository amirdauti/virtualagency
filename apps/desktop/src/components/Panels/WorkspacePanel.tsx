import { useAgentStore } from "../../stores/agentStore";
import { killAgent } from "../../lib/api";
import type { Agent } from "@virtual-agency/shared";

const STATUS_CONFIG = {
  working: { color: "#22c55e", label: "Active" },
  thinking: { color: "#8b5cf6", label: "Thinking" },
  error: { color: "#ef4444", label: "Error" },
  idle: { color: "#64748b", label: "Idle" },
};

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
    removeAgent(agent.id);
    try {
      await killAgent(agent.id);
    } catch {
      // Agent process might not exist in backend
    }
  };

  const handleClearAll = async () => {
    const agentsCopy = [...agents];
    clearAllAgents();
    for (const agent of agentsCopy) {
      try {
        await killAgent(agent.id);
      } catch {
        // Ignore errors
      }
    }
  };

  // Get shortened path
  const getShortPath = (path: string) => {
    const parts = path.split("/");
    if (parts.length <= 2) return path;
    return `.../${parts.slice(-2).join("/")}`;
  };

  if (agents.length === 0) {
    return (
      <div style={containerStyle}>
        <div style={headerStyle}>
          <div style={headerTitleStyle}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#3b82f6" }}>
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <span>Agents</span>
          </div>
        </div>
        <div style={emptyStyle}>
          <div style={emptyIconStyle}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="5" />
              <path d="M20 21a8 8 0 1 0-16 0" />
            </svg>
          </div>
          <p style={{ margin: 0, color: "#e5e7eb", fontSize: 14, fontWeight: 500 }}>
            No agents yet
          </p>
          <p style={{ margin: "8px 0 0", color: "#6b7280", fontSize: 13 }}>
            Click "Add Agent" to create one
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <div style={headerTitleStyle}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#3b82f6" }}>
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          <span>Agents</span>
          <span style={countBadgeStyle}>{agents.length}</span>
        </div>
        <button
          onClick={handleClearAll}
          style={clearAllButtonStyle}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(239, 68, 68, 0.15)";
            e.currentTarget.style.borderColor = "rgba(239, 68, 68, 0.3)";
            e.currentTarget.style.color = "#fca5a5";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.borderColor = "#3c3c3c";
            e.currentTarget.style.color = "#6b7280";
          }}
          title="Clear all agents"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
          Clear
        </button>
      </div>

      <div style={listStyle}>
        {agents.map((agent) => {
          const isSelected = selectedAgent?.id === agent.id;
          const statusConfig = STATUS_CONFIG[agent.status] || STATUS_CONFIG.idle;

          return (
            <div
              key={agent.id}
              onClick={() => handleSelect(agent.id)}
              style={{
                ...itemStyle,
                background: isSelected ? "rgba(59, 130, 246, 0.1)" : "transparent",
                borderLeftColor: isSelected ? "#3b82f6" : "transparent",
              }}
              onMouseEnter={(e) => {
                if (!isSelected) {
                  e.currentTarget.style.background = "#2a2a2a";
                }
              }}
              onMouseLeave={(e) => {
                if (!isSelected) {
                  e.currentTarget.style.background = "transparent";
                }
              }}
            >
              <div style={itemContentStyle}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  {/* Status dot */}
                  <div style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: statusConfig.color,
                    boxShadow: agent.status === "working" || agent.status === "thinking"
                      ? `0 0 8px ${statusConfig.color}60`
                      : "none",
                  }} />

                  {/* Agent name */}
                  <span style={{
                    fontSize: 14,
                    fontWeight: 500,
                    color: isSelected ? "#60a5fa" : "#e5e7eb",
                  }}>
                    {agent.name}
                  </span>

                  {/* Status label */}
                  {(agent.status === "working" || agent.status === "thinking") && (
                    <span style={{
                      fontSize: 10,
                      fontWeight: 500,
                      color: statusConfig.color,
                      background: `${statusConfig.color}15`,
                      padding: "2px 6px",
                      borderRadius: 4,
                    }}>
                      {statusConfig.label}
                    </span>
                  )}
                </div>

                {/* Working directory */}
                <span style={pathStyle} title={agent.workingDirectory}>
                  {getShortPath(agent.workingDirectory)}
                </span>
              </div>

              {/* Delete button */}
              <button
                onClick={(e) => handleDelete(agent, e)}
                style={deleteButtonStyle}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(239, 68, 68, 0.15)";
                  e.currentTarget.style.color = "#ef4444";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = "#6b7280";
                }}
                title="Delete agent"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  position: "absolute",
  top: 16,
  right: 16,
  width: 280,
  background: "linear-gradient(180deg, #1e1e2e 0%, #181825 100%)",
  borderRadius: 12,
  border: "1px solid #3c3c3c",
  overflow: "hidden",
  boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "14px 16px",
  borderBottom: "1px solid #3c3c3c",
  background: "#252526",
};

const headerTitleStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 14,
  fontWeight: 600,
  color: "#e5e7eb",
};

const countBadgeStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "#3b82f6",
  background: "rgba(59, 130, 246, 0.15)",
  padding: "2px 8px",
  borderRadius: 10,
  marginLeft: 4,
};

const clearAllButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 5,
  background: "transparent",
  border: "1px solid #3c3c3c",
  borderRadius: 6,
  color: "#6b7280",
  fontSize: 11,
  fontWeight: 500,
  cursor: "pointer",
  padding: "5px 10px",
  transition: "all 0.2s ease",
};

const listStyle: React.CSSProperties = {
  maxHeight: 350,
  overflowY: "auto",
  padding: "8px 0",
};

const itemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "12px 16px",
  cursor: "pointer",
  borderLeft: "3px solid transparent",
  transition: "all 0.15s ease",
};

const itemContentStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  overflow: "hidden",
  flex: 1,
};

const pathStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#6b7280",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  paddingLeft: 18,
};

const deleteButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "transparent",
  border: "none",
  color: "#6b7280",
  cursor: "pointer",
  padding: 6,
  borderRadius: 6,
  transition: "all 0.15s ease",
  flexShrink: 0,
};

const emptyStyle: React.CSSProperties = {
  padding: "40px 20px",
  textAlign: "center",
};

const emptyIconStyle: React.CSSProperties = {
  width: 64,
  height: 64,
  borderRadius: "50%",
  background: "rgba(59, 130, 246, 0.1)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  margin: "0 auto 16px",
  color: "#3b82f6",
};
