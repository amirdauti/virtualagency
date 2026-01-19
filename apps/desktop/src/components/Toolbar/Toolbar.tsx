import { useState } from "react";
import { useAgentStore } from "../../stores/agentStore";
import { CreateAgentDialog } from "./CreateAgentDialog";
import { SettingsPanel } from "../Settings/SettingsPanel";

export function Toolbar() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const agents = useAgentStore((state) => state.agents);

  return (
    <>
      <div style={containerStyle}>
        {/* Left side: Settings + Agent count */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            onClick={() => setSettingsOpen(true)}
            style={settingsButtonStyle}
            title="Settings"
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(55, 55, 70, 0.95)";
              e.currentTarget.style.borderColor = "rgba(75, 85, 99, 0.8)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(30, 30, 46, 0.95)";
              e.currentTarget.style.borderColor = "rgba(60, 60, 60, 0.8)";
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>

          {/* Agent count badge */}
          <div style={agentCountStyle}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <span>{agents.length}</span>
          </div>
        </div>

        {/* Right side: Add Agent button */}
        <button
          onClick={() => setDialogOpen(true)}
          style={addButtonStyle}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)";
            e.currentTarget.style.transform = "translateY(-1px)";
            e.currentTarget.style.boxShadow = "0 6px 20px rgba(59, 130, 246, 0.4)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)";
            e.currentTarget.style.transform = "translateY(0)";
            e.currentTarget.style.boxShadow = "0 4px 14px rgba(59, 130, 246, 0.3)";
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span>Add Agent</span>
        </button>
      </div>

      <CreateAgentDialog
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
      />

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </>
  );
}

const containerStyle: React.CSSProperties = {
  position: "absolute",
  top: 16,
  left: 16,
  display: "flex",
  gap: 12,
  alignItems: "center",
};

const settingsButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 38,
  height: 38,
  background: "rgba(30, 30, 46, 0.95)",
  backdropFilter: "blur(8px)",
  border: "1px solid rgba(60, 60, 60, 0.8)",
  borderRadius: 10,
  color: "#e5e7eb",
  cursor: "pointer",
  transition: "all 0.2s ease",
  boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
};

const agentCountStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "8px 14px",
  background: "rgba(30, 30, 46, 0.95)",
  backdropFilter: "blur(8px)",
  border: "1px solid rgba(60, 60, 60, 0.8)",
  borderRadius: 10,
  color: "#e5e7eb",
  fontSize: 13,
  fontWeight: 500,
  boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
};

const addButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "8px 14px",
  background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
  border: "none",
  borderRadius: 10,
  color: "white",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
  transition: "all 0.2s ease",
  boxShadow: "0 4px 14px rgba(59, 130, 246, 0.3)",
};
