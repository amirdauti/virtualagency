import { useCallback, useEffect, useMemo, useRef } from "react";
import { useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useAgentStore } from "./stores/agentStore";
import { useChatMessages } from "./hooks/useChatMessages";
import { useTerminalOutputEvents } from "./hooks/useTerminalOutputEvents";
import { useAgentAutomations } from "./hooks/useAgentAutomations";
import { useWorkspaceInit } from "./hooks/useWorkspace";
import { AgentPanel } from "./components/Panels/AgentPanel";
import { WorkspacePanel } from "./components/Panels/WorkspacePanel";
import { Toolbar } from "./components/Toolbar/Toolbar";
import { AgentAvatar } from "./components/Canvas/AgentAvatar";
import { OfficeEnvironment, getDeskPosition, LOUNGE_TARGETS, OFFICE_SIZE } from "./components/Canvas/OfficeEnvironment";
import { CliSetupModal } from "./components/Setup/CliSetupModal";
import { EditorView } from "./components/FileExplorer/EditorView";
import { useFileExplorerStore } from "./stores/fileExplorerStore";
import { AuthBillingGate } from "./components/Auth/AuthBillingGate";
import { isTauri } from "./lib/api";
import { useAgentStatusListener } from "./hooks/useTauriEvents";

type LoungePose = "stand" | "sit_low" | "sit_high" | "arcade" | "vending";

const isDeskBound = (agent: { status: string; stayAtDesk?: boolean }) =>
  agent.status === "working" || agent.status === "thinking" || agent.stayAtDesk === true;

function Scene({
  onControlsStart,
  onControlsEnd,
  onControlsChange,
}: {
  onControlsStart: () => void;
  onControlsEnd: () => void;
  onControlsChange: () => void;
}) {
  const agents = useAgentStore((state) => state.agents);
  const selectedAgent = useAgentStore((state) => state.selectedAgent);
  const selectAgent = useAgentStore((state) => state.selectAgent);

  // Fixed lounge slots (24) so agents are easy to find and always face the city-view windows.
  const loungeTargets = LOUNGE_TARGETS;

  // Keep the AgentPanel open when users click around the office (for camera movement, etc).
  // Provide an intentional "deselect" gesture instead (Shift+Click).
  const handleBackgroundClick = (event: { nativeEvent?: MouseEvent }) => {
    if (event.nativeEvent?.shiftKey) {
      selectAgent(null);
    }
  };

  const { workingIndexById, idleIndexById } = useMemo(() => {
    const compareCreated = (a: { createdAt?: string; id: string }, b: { createdAt?: string; id: string }) =>
      (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.id.localeCompare(b.id);

    const working = agents
      .filter((a) => isDeskBound(a))
      .slice()
      .sort(compareCreated);
    const idle = agents
      .filter((a) => !isDeskBound(a))
      .slice()
      .sort(compareCreated);

    return {
      workingIndexById: new Map(working.map((a, i) => [a.id, i] as const)),
      idleIndexById: new Map(idle.map((a, i) => [a.id, i] as const)),
    };
  }, [agents]);

  // Calculate agent positions based on status:
  // - Working/thinking agents (and desk-locked agents) go to desks.
  // - Other idle/error agents occupy fixed lounge slots (24) facing the city-view windows.
  const getAgentPosition = (agent: typeof agents[0]) => {
    if (isDeskBound(agent)) {
      const deskIndex = workingIndexById.get(agent.id) ?? 0;
      const deskPos = getDeskPosition(deskIndex);
      return { x: deskPos.x, z: deskPos.z + 2.2 }; // Offset to sit at desk (avoid clipping into desk/chair)
    }

    const base = loungeTargets[(idleIndexById.get(agent.id) ?? 0) % loungeTargets.length];
    return base;
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
      {agents.map((agent) => {
        const pos = getAgentPosition(agent);
        const idle = isDeskBound(agent) ? undefined : (pos as { facingY: number; pose: LoungePose });
        return (
          <AgentAvatar
            key={agent.id}
            agent={{ ...agent, position: { ...agent.position, x: pos.x, z: pos.z } }}
            loungeFacingY={idle?.facingY}
            loungePose={idle?.pose}
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
        // Stop camera immediately on pointer-up (no inertia/damping) to avoid
        // the DPR toggling while the camera continues to glide.
        enableDamping={false}
        onStart={onControlsStart}
        onEnd={onControlsEnd}
        onChange={onControlsChange}
      />
    </>
  );
}

function AppShell() {
  const [cliReady, setCliReady] = useState(false);
  const [isCameraInteracting, setIsCameraInteracting] = useState(false);
  const cameraIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedAgent = useAgentStore((state) => state.selectedAgent);
  const updateAgent = useAgentStore((state) => state.updateAgent);
  const openFiles = useFileExplorerStore((state) => state.openFiles);
  const showEditor = openFiles.length > 0;

  // Only initialize workspace after server is ready
  const { initialized: workspaceInitialized, isLoading: workspaceLoading } = useWorkspaceInit(cliReady);

  // Parse Claude CLI output into chat messages
  useChatMessages();
  // Buffer terminal output even when Terminal tab/panel is closed
  useTerminalOutputEvents();
  // Run recurring agent automations.
  useAgentAutomations();
  // Keep agent status in sync with backend lifecycle events.
  useAgentStatusListener(
    useCallback(
      ({ agent_id, status }) => {
        const nextStatus = status === "exited" ? "idle" : status;
        updateAgent(agent_id, { status: nextStatus });
      },
      [updateAgent],
    ),
  );

  // OrbitControls can keep moving after pointer-up when damping/inertia is enabled
  // (common with trackpads/touch). Keep DPR reduced while the camera is still changing,
  // and only restore DPR once changes have stopped for a short window.
  const clearCameraIdleTimer = useCallback(() => {
    if (cameraIdleTimerRef.current) {
      clearTimeout(cameraIdleTimerRef.current);
      cameraIdleTimerRef.current = null;
    }
  }, []);

  const markCameraActive = useCallback(() => {
    clearCameraIdleTimer();
    setIsCameraInteracting(true);
  }, [clearCameraIdleTimer]);

  const scheduleCameraIdle = useCallback(() => {
    clearCameraIdleTimer();
    cameraIdleTimerRef.current = setTimeout(() => {
      setIsCameraInteracting(false);
    }, 180);
  }, [clearCameraIdleTimer]);

  const handleControlsChange = useCallback(() => {
    // "change" fires while damping continues after input ends.
    // Keep DPR low until motion settles.
    markCameraActive();
    scheduleCameraIdle();
  }, [markCameraActive, scheduleCameraIdle]);

  useEffect(() => {
    return () => clearCameraIdleTimer();
  }, [clearCameraIdleTimer]);

  const dpr = useMemo(() => {
    // Reduce pixel ratio while the user is actively moving the camera for higher FPS.
    if (isCameraInteracting) return 1;
    const device = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    return Math.min(2, Math.max(1, device));
  }, [isCameraInteracting]);

  const AppContent = (
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
          height: "100%",
          overflow: "hidden",
        }}>
          {showEditor ? (
            <EditorView />
          ) : (
            <>
              <Canvas
                camera={{
                  position: [0, 30, 40],
                  fov: 55,
                  near: 0.1,
                  far: 500,
                }}
                shadows
                style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
                dpr={dpr}
                gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
              >
                <Scene
                  onControlsStart={markCameraActive}
                  onControlsEnd={scheduleCameraIdle}
                  onControlsChange={handleControlsChange}
                />
              </Canvas>
              <Toolbar />
              {!selectedAgent && <WorkspacePanel />}
            </>
          )}
        </div>
        {selectedAgent && (
          <AgentPanel
            key={selectedAgent.id}
            agent={selectedAgent}
          />
        )}
      </div>
    </>
  );

  // Show loading state while workspace is initializing (after CLI is ready)
  if (cliReady && (!workspaceInitialized || workspaceLoading)) {
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

  return AppContent;
}

function App() {
  // Gate only in browser mode for now (Tauri stays unchanged).
  const hasClerk = Boolean(
    import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ||
      import.meta.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  );
  if (!isTauri() && hasClerk) {
    return (
      <AuthBillingGate>
        <AppShell />
      </AuthBillingGate>
    );
  }
  return <AppShell />;
}

export default App;
