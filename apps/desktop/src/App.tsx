import { useCallback, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useAgentStore } from "./stores/agentStore";
import { useAgentOutput } from "./hooks/useAgentOutput";
import { useChatMessages } from "./hooks/useChatMessages";
import { useWorkspaceInit } from "./hooks/useWorkspace";
import { AgentPanel } from "./components/Panels/AgentPanel";
import { WorkspacePanel } from "./components/Panels/WorkspacePanel";
import { Toolbar } from "./components/Toolbar/Toolbar";
import { AgentAvatar } from "./components/Canvas/AgentAvatar";
import { OfficeEnvironment, getDeskPosition, getLoungePosition, OFFICE_SIZE } from "./components/Canvas/OfficeEnvironment";
import { CliSetupModal } from "./components/Setup/CliSetupModal";

function Scene() {
  const agents = useAgentStore((state) => state.agents);
  const selectedAgent = useAgentStore((state) => state.selectedAgent);
  const selectAgent = useAgentStore((state) => state.selectAgent);

  const handleBackgroundClick = () => {
    selectAgent(null);
  };

  // Calculate agent positions based on status
  // Working/thinking agents go to desks, idle agents go to lounge
  const getAgentPosition = (agent: typeof agents[0], index: number) => {
    if (agent.status === "working" || agent.status === "thinking") {
      // Assign to a desk based on index
      const deskPos = getDeskPosition(index);
      return { x: deskPos.x, z: deskPos.z + 1.5 }; // Offset to sit at desk
    } else {
      // Idle or error - go to lounge
      const loungePos = getLoungePosition(index);
      return loungePos;
    }
  };

  return (
    <>
      {/* Office Environment with Miami skyline */}
      <OfficeEnvironment />

      {/* Invisible plane to catch background clicks */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.01, 0]}
        onClick={handleBackgroundClick}
      >
        <planeGeometry args={[OFFICE_SIZE, OFFICE_SIZE]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>

      {/* Render all agents */}
      {agents.map((agent, index) => {
        const pos = getAgentPosition(agent, index);
        return (
          <AgentAvatar
            key={agent.id}
            agent={{ ...agent, position: { ...agent.position, x: pos.x, z: pos.z } }}
            isSelected={selectedAgent?.id === agent.id}
            onClick={() => selectAgent(agent.id)}
          />
        );
      })}

      <OrbitControls
        makeDefault
        minPolarAngle={0.3}
        maxPolarAngle={Math.PI / 2.2}
        minDistance={15}
        maxDistance={60}
        target={[0, 0, 0]}
        enablePan={true}
        panSpeed={0.5}
      />
    </>
  );
}

function App() {
  const [cliReady, setCliReady] = useState(false);
  const { initialized: workspaceInitialized, isLoading: workspaceLoading } = useWorkspaceInit();
  const selectedAgent = useAgentStore((state) => state.selectedAgent);
  const { getOutputForAgent, clearOutput } = useAgentOutput();

  // Parse Claude CLI output into chat messages
  useChatMessages();

  const handleClearOutput = useCallback(() => {
    if (selectedAgent) {
      clearOutput(selectedAgent.id);
    }
  }, [selectedAgent, clearOutput]);

  const outputLines = selectedAgent ? getOutputForAgent(selectedAgent.id) : [];

  // Show loading state while workspace is initializing
  if (!workspaceInitialized || workspaceLoading) {
    return (
      <div style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#1a0a2e",
        color: "#fff",
        fontFamily: "system-ui, sans-serif"
      }}>
        <div style={{ textAlign: "center" }}>
          <div style={{
            fontSize: "32px",
            marginBottom: "8px",
            background: "linear-gradient(135deg, #ff6b6b, #ffd93d, #ff1493)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            fontWeight: "bold"
          }}>
            Virtual Agency
          </div>
          <div style={{ fontSize: "16px", marginBottom: "24px", color: "#ff6b6b" }}>
            Loading workspace...
          </div>
          <div style={{
            width: "50px",
            height: "50px",
            border: "3px solid #1a0a2e",
            borderTopColor: "#ff1493",
            borderRightColor: "#00ffff",
            borderRadius: "50%",
            animation: "spin 1s linear infinite",
            margin: "0 auto"
          }} />
        </div>
      </div>
    );
  }

  return (
    <>
      {!cliReady && <CliSetupModal onReady={() => setCliReady(true)} />}

      <div style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: "flex",
        overflow: "hidden",
      }}>
        <div style={{
          flex: 1,
          position: "relative",
          minWidth: 0,
        }}>
          <Canvas
            camera={{
              position: [0, 30, 40],
              fov: 55,
              near: 0.1,
              far: 500,
            }}
            shadows
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
            gl={{ antialias: true, alpha: false }}
          >
            <Scene />
          </Canvas>
          <Toolbar />
          {!selectedAgent && <WorkspacePanel />}
        </div>
        {selectedAgent && (
          <AgentPanel
            agent={selectedAgent}
            outputLines={outputLines}
            onClearOutput={handleClearOutput}
          />
        )}
      </div>
    </>
  );
}

export default App;
