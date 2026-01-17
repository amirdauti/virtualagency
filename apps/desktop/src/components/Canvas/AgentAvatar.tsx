import { useRef, useMemo, useState, useEffect } from "react";
import * as THREE from "three";
import { Mesh, Group } from "three";
import { useFrame } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import type { Agent } from "@virtual-agency/shared";
import { generatePath, Point2D } from "../../lib/pathfinding";

// Walking animation configuration
const WALK_SPEED = 8; // Units per second (fast walk)
const LEG_SWING_SPEED = 12; // Oscillation frequency
const LEG_SWING_AMPLITUDE = 0.6; // Radians
const ARM_SWING_AMPLITUDE = 0.4;
const BODY_BOB_AMPLITUDE = 0.05;
const ROTATION_SPEED = 8; // How fast agent turns to face direction

interface AgentAvatarProps {
  agent: Agent;
  isSelected: boolean;
  onClick: () => void;
}

// Helper to handle click with proper event stopping
const handleMeshClick = (onClick: () => void) => (event: { stopPropagation: () => void }) => {
  event.stopPropagation();
  onClick();
};

export function AgentAvatar({ agent, isSelected, onClick }: AgentAvatarProps) {
  const groupRef = useRef<Group>(null);
  const bodyRef = useRef<Mesh>(null);
  const headRef = useRef<Group>(null);
  const statusRef = useRef<Mesh>(null);
  const leftArmRef = useRef<Group>(null);
  const rightArmRef = useRef<Group>(null);
  const leftLegRef = useRef<Group>(null);
  const rightLegRef = useRef<Group>(null);

  // Position state for walking animation
  const [currentPosition, setCurrentPosition] = useState({
    x: agent.position.x,
    z: agent.position.z,
  });
  const pathRef = useRef<Point2D[]>([]);
  const currentWaypointIndex = useRef(0);
  const isWalking = useRef(false);
  const currentRotationY = useRef(0);
  const finalDestination = useRef({ x: agent.position.x, z: agent.position.z });

  // Detect position changes and trigger walking with pathfinding
  useEffect(() => {
    const incomingX = agent.position.x;
    const incomingZ = agent.position.z;

    const dx = Math.abs(incomingX - finalDestination.current.x);
    const dz = Math.abs(incomingZ - finalDestination.current.z);

    if (dx > 0.1 || dz > 0.1) {
      // Generate path with waypoints to avoid obstacles
      const path = generatePath(
        { x: currentPosition.x, z: currentPosition.z },
        { x: incomingX, z: incomingZ }
      );

      pathRef.current = path;
      currentWaypointIndex.current = 0;
      finalDestination.current = { x: incomingX, z: incomingZ };
      isWalking.current = true;
    }
  }, [agent.position.x, agent.position.z]);

  // Create a unique offset for each agent so they don't all animate in sync
  const animOffset = useMemo(
    () => agent.position.x * 1.5 + agent.position.z * 0.7,
    [agent.position.x, agent.position.z]
  );

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;

    // Handle walking animation with waypoints
    if (isWalking.current && groupRef.current && pathRef.current.length > 0) {
      const currentWaypoint = pathRef.current[currentWaypointIndex.current];
      const dx = currentWaypoint.x - currentPosition.x;
      const dz = currentWaypoint.z - currentPosition.z;
      const distance = Math.sqrt(dx * dx + dz * dz);

      if (distance < 0.1) {
        // Reached current waypoint
        setCurrentPosition({ ...currentWaypoint });

        // Move to next waypoint or finish
        currentWaypointIndex.current++;
        if (currentWaypointIndex.current >= pathRef.current.length) {
          // Arrived at final destination
          isWalking.current = false;
          pathRef.current = [];
          // Reset leg positions for smooth transition
          if (leftLegRef.current) leftLegRef.current.rotation.x = 0;
          if (rightLegRef.current) rightLegRef.current.rotation.x = 0;
        }
      } else {
        // Continue walking
        const moveAmount = Math.min(WALK_SPEED * delta, distance);
        const moveRatio = moveAmount / distance;

        const newX = currentPosition.x + dx * moveRatio;
        const newZ = currentPosition.z + dz * moveRatio;
        setCurrentPosition({ x: newX, z: newZ });

        // Smoothly rotate toward movement direction
        const targetAngle = Math.atan2(dx, dz);
        const angleDiff = targetAngle - currentRotationY.current;
        // Normalize angle difference to [-PI, PI]
        const normalizedDiff = Math.atan2(
          Math.sin(angleDiff),
          Math.cos(angleDiff)
        );
        currentRotationY.current +=
          normalizedDiff * Math.min(ROTATION_SPEED * delta, 1);
        groupRef.current.rotation.y = currentRotationY.current;

        // Leg animation (opposite phase)
        const legSwing = Math.sin(t * LEG_SWING_SPEED) * LEG_SWING_AMPLITUDE;
        if (leftLegRef.current) {
          leftLegRef.current.rotation.x = legSwing;
        }
        if (rightLegRef.current) {
          rightLegRef.current.rotation.x = -legSwing;
        }

        // Arm swinging (opposite to legs)
        if (leftArmRef.current) {
          leftArmRef.current.rotation.x =
            -legSwing * (ARM_SWING_AMPLITUDE / LEG_SWING_AMPLITUDE);
          leftArmRef.current.rotation.z = 0.1;
        }
        if (rightArmRef.current) {
          rightArmRef.current.rotation.x =
            legSwing * (ARM_SWING_AMPLITUDE / LEG_SWING_AMPLITUDE);
          rightArmRef.current.rotation.z = -0.1;
        }

        // Body bob
        const bodyBob =
          Math.abs(Math.sin(t * LEG_SWING_SPEED * 2)) * BODY_BOB_AMPLITUDE;
        if (bodyRef.current) {
          bodyRef.current.position.y = 0.5 + bodyBob;
        }
        if (headRef.current) {
          headRef.current.position.y = 1.05 + bodyBob;
        }
        if (statusRef.current) {
          statusRef.current.position.y = 1.55 + bodyBob;
        }

        // Reset body lean while walking
        groupRef.current.rotation.x = 0;
      }
      return; // Skip status animations while walking
    }

    if (bodyRef.current && headRef.current && statusRef.current) {
      const status = agent.status;

      if (status === "idle") {
        // Idle: Gentle floating and subtle breathing
        bodyRef.current.position.y = 0.5 + Math.sin(t * 1.5 + animOffset) * 0.03;
        headRef.current.position.y = 1.05 + Math.sin(t * 1.5 + animOffset) * 0.03;
        statusRef.current.position.y = 1.55 + Math.sin(t * 1.5 + animOffset) * 0.03;

        // Subtle side-to-side sway
        if (groupRef.current) {
          groupRef.current.rotation.y = Math.sin(t * 0.5 + animOffset) * 0.05;
        }

        // Arms relaxed
        if (leftArmRef.current && rightArmRef.current) {
          leftArmRef.current.rotation.z = 0.2 + Math.sin(t * 1.5 + animOffset) * 0.02;
          rightArmRef.current.rotation.z = -0.2 - Math.sin(t * 1.5 + animOffset) * 0.02;
        }

      } else if (status === "thinking") {
        // Thinking: Head tilt, pulsing glow, contemplative pose
        bodyRef.current.position.y = 0.5 + Math.sin(t * 2 + animOffset) * 0.02;
        headRef.current.position.y = 1.05 + Math.sin(t * 2 + animOffset) * 0.02;

        // Head tilts side to side
        headRef.current.rotation.z = Math.sin(t * 0.8 + animOffset) * 0.15;
        headRef.current.rotation.x = Math.sin(t * 0.6 + animOffset) * 0.1;

        // Pulsing status indicator
        const pulse = 0.5 + Math.sin(t * 4) * 0.3;
        statusRef.current.scale.setScalar(1 + Math.sin(t * 4) * 0.3);
        statusRef.current.position.y = 1.55 + Math.sin(t * 2 + animOffset) * 0.02;

        // Update emissive intensity for pulsing effect
        const statusMaterial = statusRef.current.material as THREE.MeshStandardMaterial;
        if (statusMaterial.emissiveIntensity !== undefined) {
          statusMaterial.emissiveIntensity = pulse;
        }

        // One arm up in thinking pose
        if (leftArmRef.current && rightArmRef.current) {
          leftArmRef.current.rotation.z = 0.2;
          leftArmRef.current.rotation.x = 0;
          rightArmRef.current.rotation.z = -1.2 + Math.sin(t * 2) * 0.1;
          rightArmRef.current.rotation.x = -0.5;
        }

      } else if (status === "working") {
        // Working: Active typing animation, body engaged
        const bounce = Math.sin(t * 6 + animOffset) * 0.05;
        bodyRef.current.position.y = 0.5 + Math.abs(bounce);
        headRef.current.position.y = 1.05 + Math.abs(bounce);
        statusRef.current.position.y = 1.55 + Math.abs(bounce);

        // Reset head rotation
        headRef.current.rotation.z = 0;
        headRef.current.rotation.x = -0.1; // Looking slightly down

        // Rapid arm movement like typing
        if (leftArmRef.current && rightArmRef.current) {
          leftArmRef.current.rotation.z = 0.8;
          leftArmRef.current.rotation.x = -0.8 + Math.sin(t * 12 + 0.5) * 0.2;
          rightArmRef.current.rotation.z = -0.8;
          rightArmRef.current.rotation.x = -0.8 + Math.sin(t * 12) * 0.2;
        }

        // Subtle body lean forward
        if (groupRef.current) {
          groupRef.current.rotation.x = 0.05;
          groupRef.current.rotation.y = 0;
        }

        // Status indicator active glow
        statusRef.current.scale.setScalar(1);
        const statusMaterial = statusRef.current.material as THREE.MeshStandardMaterial;
        if (statusMaterial.emissiveIntensity !== undefined) {
          statusMaterial.emissiveIntensity = 0.8;
        }

      } else if (status === "error") {
        // Error: Distressed animation
        const shake = Math.sin(t * 20) * 0.015;
        bodyRef.current.position.x = shake;
        headRef.current.position.x = shake;
        bodyRef.current.position.y = 0.5;
        headRef.current.position.y = 1.05;

        // Head down
        headRef.current.rotation.x = 0.2;
        headRef.current.rotation.z = 0;

        // Arms drooped
        if (leftArmRef.current && rightArmRef.current) {
          leftArmRef.current.rotation.z = 0.3;
          leftArmRef.current.rotation.x = 0.1;
          rightArmRef.current.rotation.z = -0.3;
          rightArmRef.current.rotation.x = 0.1;
        }

        // Flashing status indicator
        const flash = Math.sin(t * 8) > 0 ? 1 : 0.3;
        const statusMaterial = statusRef.current.material as THREE.MeshStandardMaterial;
        if (statusMaterial.emissiveIntensity !== undefined) {
          statusMaterial.emissiveIntensity = flash;
        }
      }
    }
  });

  const statusColor =
    agent.status === "working"
      ? "#4ade80"
      : agent.status === "thinking"
      ? "#fbbf24"
      : agent.status === "error"
      ? "#ef4444"
      : "#6b7280";

  // Gacha chibi color palette - matching the reference image style
  const agentColors = useMemo(() => {
    const hash = agent.name.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);

    // Hair colors from reference - natural + anime colors
    const hairColorSets = [
      { main: "#1a1a2e", highlight: "#2d2d4a" }, // dark blue-black
      { main: "#4a2c2c", highlight: "#6b4040" }, // dark brown-red
      { main: "#2d4a2d", highlight: "#4a6b4a" }, // dark green
      { main: "#c9a227", highlight: "#e8c547" }, // golden blonde
      { main: "#8b4513", highlight: "#a0522d" }, // brown
      { main: "#1a1a1a", highlight: "#333333" }, // black
      { main: "#00bcd4", highlight: "#4dd0e1" }, // cyan/teal
      { main: "#e91e63", highlight: "#f48fb1" }, // pink
      { main: "#9c27b0", highlight: "#ce93d8" }, // purple
      { main: "#4caf50", highlight: "#81c784" }, // green
      { main: "#ff9800", highlight: "#ffb74d" }, // orange
      { main: "#f44336", highlight: "#ef9a9a" }, // red
      { main: "#3f51b5", highlight: "#7986cb" }, // indigo
      { main: "#009688", highlight: "#4db6ac" }, // teal
      { main: "#ffc107", highlight: "#ffecb3" }, // yellow
      { main: "#607d8b", highlight: "#90a4ae" }, // blue-grey
    ];
    const hairSet = hairColorSets[hash % hairColorSets.length];

    // Outfit colors - varied like in the reference (jackets, vests, etc)
    const outfitSets = [
      { jacket: "#1565c0", shirt: "#ffffff", pants: "#37474f", accent: "#ffc107" },
      { jacket: "#c62828", shirt: "#ffebee", pants: "#212121", accent: "#ffd54f" },
      { jacket: "#2e7d32", shirt: "#e8f5e9", pants: "#3e2723", accent: "#ff8a65" },
      { jacket: "#6a1b9a", shirt: "#f3e5f5", pants: "#1a1a1a", accent: "#4fc3f7" },
      { jacket: "#00838f", shirt: "#e0f7fa", pants: "#263238", accent: "#ffab91" },
      { jacket: "#ef6c00", shirt: "#fff3e0", pants: "#3e2723", accent: "#80deea" },
      { jacket: "#ad1457", shirt: "#fce4ec", pants: "#1a1a1a", accent: "#aed581" },
      { jacket: "#283593", shirt: "#e8eaf6", pants: "#37474f", accent: "#ffcc80" },
    ];
    const outfitSet = outfitSets[(hash * 7) % outfitSets.length];

    // Skin tone - anime style pale
    const skinColor = "#ffecd2";

    // Eye color - vibrant, matches or complements hair
    const eyeColors = ["#5d4e37", "#1565c0", "#2e7d32", "#6a1b9a", "#c62828", "#00838f", "#f57c00", "#ec407a"];
    const eyeColor = eyeColors[(hash * 3) % eyeColors.length];

    return {
      hairColor: hairSet.main,
      hairHighlight: hairSet.highlight,
      ...outfitSet,
      skinColor,
      eyeColor
    };
  }, [agent.name]);

  const selectionGlow = isSelected ? 0.5 : 0;

  // Gacha chibi proportions: ~55% head, ~45% body
  // Head radius 0.32, body height 0.5, total ~1.5 units
  return (
    <group ref={groupRef} position={[currentPosition.x, 0, currentPosition.z]}>
      {/* Invisible hitbox */}
      <mesh position={[0, 0.75, 0]} onClick={handleMeshClick(onClick)}>
        <boxGeometry args={[0.9, 1.5, 0.7]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* === CHIBI HEAD === */}
      <group ref={headRef} position={[0, 1.05, 0]}>
        {/* Main head - slightly smaller, more balanced */}
        <mesh>
          <sphereGeometry args={[0.32, 32, 32]} />
          <meshStandardMaterial
            color={agentColors.skinColor}
            emissive={isSelected ? "#ff6b9d" : "#000000"}
            emissiveIntensity={selectionGlow * 0.2}
          />
        </mesh>

        {/* === HAIR - more styled, less helmet-like === */}
        {/* Main hair volume - sits on top */}
        <mesh position={[0, 0.12, -0.03]}>
          <sphereGeometry args={[0.34, 24, 24, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
          <meshStandardMaterial color={agentColors.hairColor} />
        </mesh>

        {/* Side hair - flowing down */}
        <mesh position={[-0.28, -0.08, 0.08]} rotation={[0.15, 0.1, 0.2]}>
          <capsuleGeometry args={[0.08, 0.28, 8, 12]} />
          <meshStandardMaterial color={agentColors.hairColor} />
        </mesh>
        <mesh position={[0.28, -0.08, 0.08]} rotation={[0.15, -0.1, -0.2]}>
          <capsuleGeometry args={[0.08, 0.28, 8, 12]} />
          <meshStandardMaterial color={agentColors.hairColor} />
        </mesh>

        {/* Front bangs - natural looking */}
        <mesh position={[-0.14, 0.18, 0.24]} rotation={[0.6, 0.15, 0.1]} scale={[1, 1.1, 0.5]}>
          <capsuleGeometry args={[0.055, 0.1, 6, 8]} />
          <meshStandardMaterial color={agentColors.hairColor} />
        </mesh>
        <mesh position={[0, 0.2, 0.26]} rotation={[0.5, 0, 0]} scale={[1.1, 1.2, 0.5]}>
          <capsuleGeometry args={[0.06, 0.1, 6, 8]} />
          <meshStandardMaterial color={agentColors.hairColor} />
        </mesh>
        <mesh position={[0.14, 0.18, 0.24]} rotation={[0.6, -0.15, -0.1]} scale={[1, 1.1, 0.5]}>
          <capsuleGeometry args={[0.055, 0.1, 6, 8]} />
          <meshStandardMaterial color={agentColors.hairColor} />
        </mesh>

        {/* Spiky top pieces */}
        <mesh position={[-0.08, 0.32, 0]} rotation={[0.1, 0, 0.2]}>
          <coneGeometry args={[0.04, 0.12, 6]} />
          <meshStandardMaterial color={agentColors.hairHighlight} />
        </mesh>
        <mesh position={[0.05, 0.35, 0.02]} rotation={[0.15, 0, -0.1]}>
          <coneGeometry args={[0.035, 0.14, 6]} />
          <meshStandardMaterial color={agentColors.hairHighlight} />
        </mesh>
        <mesh position={[0.12, 0.3, -0.02]} rotation={[0, 0, -0.25]}>
          <coneGeometry args={[0.03, 0.1, 6]} />
          <meshStandardMaterial color={agentColors.hairHighlight} />
        </mesh>

        {/* Back hair */}
        <mesh position={[-0.15, -0.12, -0.22]} rotation={[-0.2, 0.1, 0.05]}>
          <capsuleGeometry args={[0.07, 0.22, 6, 8]} />
          <meshStandardMaterial color={agentColors.hairColor} />
        </mesh>
        <mesh position={[0, -0.14, -0.26]} rotation={[-0.25, 0, 0]}>
          <capsuleGeometry args={[0.08, 0.26, 6, 8]} />
          <meshStandardMaterial color={agentColors.hairColor} />
        </mesh>
        <mesh position={[0.15, -0.12, -0.22]} rotation={[-0.2, -0.1, -0.05]}>
          <capsuleGeometry args={[0.07, 0.22, 6, 8]} />
          <meshStandardMaterial color={agentColors.hairColor} />
        </mesh>

        {/* === HUGE EYES - characteristic gacha style === */}
        {/* Left eye white */}
        <mesh position={[-0.1, -0.02, 0.27]} scale={[1, 1.4, 0.4]}>
          <sphereGeometry args={[0.11, 20, 20]} />
          <meshStandardMaterial color="#ffffff" />
        </mesh>
        {/* Left iris - large and colorful */}
        <mesh position={[-0.1, -0.04, 0.32]} scale={[1, 1.3, 0.4]}>
          <sphereGeometry args={[0.085, 16, 16]} />
          <meshStandardMaterial color={agentColors.eyeColor} />
        </mesh>
        {/* Left pupil */}
        <mesh position={[-0.1, -0.04, 0.35]}>
          <sphereGeometry args={[0.04, 10, 10]} />
          <meshStandardMaterial color="#000000" />
        </mesh>
        {/* Left highlight big */}
        <mesh position={[-0.06, 0.02, 0.36]}>
          <sphereGeometry args={[0.03, 8, 8]} />
          <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={1} />
        </mesh>
        {/* Left highlight small */}
        <mesh position={[-0.13, -0.07, 0.35]}>
          <sphereGeometry args={[0.015, 6, 6]} />
          <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.8} />
        </mesh>

        {/* Right eye white */}
        <mesh position={[0.1, -0.02, 0.27]} scale={[1, 1.4, 0.4]}>
          <sphereGeometry args={[0.11, 20, 20]} />
          <meshStandardMaterial color="#ffffff" />
        </mesh>
        {/* Right iris */}
        <mesh position={[0.1, -0.04, 0.32]} scale={[1, 1.3, 0.4]}>
          <sphereGeometry args={[0.085, 16, 16]} />
          <meshStandardMaterial color={agentColors.eyeColor} />
        </mesh>
        {/* Right pupil */}
        <mesh position={[0.1, -0.04, 0.35]}>
          <sphereGeometry args={[0.04, 10, 10]} />
          <meshStandardMaterial color="#000000" />
        </mesh>
        {/* Right highlight big */}
        <mesh position={[0.14, 0.02, 0.36]}>
          <sphereGeometry args={[0.03, 8, 8]} />
          <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={1} />
        </mesh>
        {/* Right highlight small */}
        <mesh position={[0.07, -0.07, 0.35]}>
          <sphereGeometry args={[0.015, 6, 6]} />
          <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.8} />
        </mesh>

        {/* Tiny nose - just a hint */}
        <mesh position={[0, -0.12, 0.3]}>
          <sphereGeometry args={[0.01, 6, 6]} />
          <meshStandardMaterial color="#e8c4a0" />
        </mesh>

        {/* Small smile */}
        <mesh position={[0, -0.18, 0.28]} rotation={[0.1, 0, 0]}>
          <torusGeometry args={[0.03, 0.008, 8, 12, Math.PI]} />
          <meshStandardMaterial color="#d4847c" />
        </mesh>

        {/* Blush marks */}
        <mesh position={[-0.2, -0.08, 0.22]}>
          <sphereGeometry args={[0.03, 8, 8]} />
          <meshStandardMaterial color="#ffb5b5" transparent opacity={0.5} />
        </mesh>
        <mesh position={[0.2, -0.08, 0.22]}>
          <sphereGeometry args={[0.03, 8, 8]} />
          <meshStandardMaterial color="#ffb5b5" transparent opacity={0.5} />
        </mesh>
      </group>

      {/* === BODY - more substantial torso === */}
      <mesh ref={bodyRef} position={[0, 0.5, 0]}>
        <capsuleGeometry args={[0.2, 0.35, 8, 16]} />
        <meshStandardMaterial
          color={agentColors.jacket}
          emissive={isSelected ? "#ff6b9d" : agentColors.jacket}
          emissiveIntensity={selectionGlow * 0.2}
        />
      </mesh>

      {/* Shirt collar/neck area */}
      <mesh position={[0, 0.72, 0.08]}>
        <sphereGeometry args={[0.07, 8, 8]} />
        <meshStandardMaterial color={agentColors.shirt} />
      </mesh>

      {/* Jacket lapel details */}
      <mesh position={[-0.12, 0.55, 0.14]} rotation={[0, 0.2, 0.1]}>
        <boxGeometry args={[0.06, 0.18, 0.02]} />
        <meshStandardMaterial color={agentColors.accent} />
      </mesh>
      <mesh position={[0.12, 0.55, 0.14]} rotation={[0, -0.2, -0.1]}>
        <boxGeometry args={[0.06, 0.18, 0.02]} />
        <meshStandardMaterial color={agentColors.accent} />
      </mesh>

      {/* Belt/waist detail */}
      <mesh position={[0, 0.35, 0.12]}>
        <boxGeometry args={[0.25, 0.04, 0.04]} />
        <meshStandardMaterial color={agentColors.accent} />
      </mesh>

      {/* === ARMS - slightly longer === */}
      <group ref={leftArmRef} position={[-0.28, 0.58, 0]}>
        <mesh position={[0, -0.1, 0]} rotation={[0, 0, 0.3]}>
          <capsuleGeometry args={[0.06, 0.16, 4, 8]} />
          <meshStandardMaterial color={agentColors.jacket} />
        </mesh>
        <mesh position={[-0.08, -0.24, 0]}>
          <sphereGeometry args={[0.055, 8, 8]} />
          <meshStandardMaterial color={agentColors.skinColor} />
        </mesh>
      </group>

      <group ref={rightArmRef} position={[0.28, 0.58, 0]}>
        <mesh position={[0, -0.1, 0]} rotation={[0, 0, -0.3]}>
          <capsuleGeometry args={[0.06, 0.16, 4, 8]} />
          <meshStandardMaterial color={agentColors.jacket} />
        </mesh>
        <mesh position={[0.08, -0.24, 0]}>
          <sphereGeometry args={[0.055, 8, 8]} />
          <meshStandardMaterial color={agentColors.skinColor} />
        </mesh>
      </group>

      {/* === LEGS - slightly longer for better proportion === */}
      <group ref={leftLegRef} position={[-0.1, 0.18, 0]}>
        <mesh>
          <capsuleGeometry args={[0.07, 0.16, 4, 8]} />
          <meshStandardMaterial color={agentColors.pants} />
        </mesh>
        <mesh position={[0, -0.14, 0.02]}>
          <boxGeometry args={[0.11, 0.07, 0.14]} />
          <meshStandardMaterial color="#1a1a1a" />
        </mesh>
      </group>

      <group ref={rightLegRef} position={[0.1, 0.18, 0]}>
        <mesh>
          <capsuleGeometry args={[0.07, 0.16, 4, 8]} />
          <meshStandardMaterial color={agentColors.pants} />
        </mesh>
        <mesh position={[0, -0.14, 0.02]}>
          <boxGeometry args={[0.11, 0.07, 0.14]} />
          <meshStandardMaterial color="#1a1a1a" />
        </mesh>
      </group>

      {/* Status indicator */}
      <mesh ref={statusRef} position={[0, 1.55, 0]}>
        <sphereGeometry args={[0.06, 12, 12]} />
        <meshStandardMaterial
          color={statusColor}
          emissive={statusColor}
          emissiveIntensity={1.0}
          transparent
          opacity={0.9}
        />
      </mesh>

      {/* Selection ring */}
      {isSelected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          <ringGeometry args={[0.45, 0.53, 32]} />
          <meshBasicMaterial color="#ff6b9d" transparent opacity={0.8} />
        </mesh>
      )}

      {/* Name label */}
      <Text
        position={[0, 1.72, 0]}
        fontSize={0.12}
        color="white"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.02}
        outlineColor="#000000"
      >
        {agent.name}
      </Text>

      {/* Status text */}
      <Text
        position={[0, 0.0, 0]}
        fontSize={0.07}
        color={statusColor}
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.012}
        outlineColor="#000000"
      >
        {agent.status}
      </Text>
    </group>
  );
}
