import { useState } from "react";
import { useAgentStore } from "../../stores/agentStore";
import { generateId } from "@virtual-agency/shared";
import { CreateAgentDialog } from "./CreateAgentDialog";
import { SettingsPanel } from "../Settings/SettingsPanel";

export function Toolbar() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const agents = useAgentStore((state) => state.agents);
  const addAgent = useAgentStore((state) => state.addAgent);
  const selectAgent = useAgentStore((state) => state.selectAgent);

  // For testing UI without CLI
  const handleAddMockAgent = () => {
    const id = generateId();
    const agent = {
      id,
      name: `Mock Agent ${agents.length + 1}`,
      status: "idle" as const,
      position: {
        x: (agents.length % 5) * 2 - 4,
        y: 0,
        z: Math.floor(agents.length / 5) * 2 - 2,
      },
      workingDirectory: "/tmp",
      createdAt: new Date().toISOString(),
    };
    addAgent(agent);
    selectAgent(id);
  };

  return (
    <>
      <div
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        <button
          onClick={() => setDialogOpen(true)}
          style={{
            padding: "8px 16px",
            background: "var(--accent)",
            border: "none",
            borderRadius: 4,
            color: "white",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          + Add Agent
        </button>
        <button
          onClick={handleAddMockAgent}
          style={{
            padding: "8px 16px",
            background: "var(--bg-tertiary)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            color: "var(--text-secondary)",
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          + Mock
        </button>
        <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>
          {agents.length} agent{agents.length !== 1 ? "s" : ""}
        </span>

        <div style={{ marginLeft: "auto" }}>
          <button
            onClick={() => setSettingsOpen(true)}
            style={{
              padding: "8px 12px",
              background: "var(--bg-tertiary)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              color: "var(--text-secondary)",
              cursor: "pointer",
              fontSize: 14,
            }}
            title="Settings"
          >
            ⚙️
          </button>
        </div>
      </div>

      <CreateAgentDialog
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
      />

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </>
  );
}
