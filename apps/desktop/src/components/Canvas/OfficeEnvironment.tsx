import { useRef, useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

// Office layout constants - exported for agent positioning
export const OFFICE_SIZE = 80;
export const DESK_ROWS = 4;
export const DESKS_PER_ROW = 6;

// Height of our office floor above ground level (we're in a high-rise)
const BUILDING_HEIGHT = 30;

// Desk positions for working agents (row, col) -> [x, z]
export function getDeskPosition(index: number): { x: number; z: number } {
  const row = Math.floor(index / DESKS_PER_ROW);
  const col = index % DESKS_PER_ROW;
  const startX = -15;
  const startZ = -25;
  const spacingX = 6;
  const spacingZ = 5;
  return {
    x: startX + col * spacingX,
    z: startZ + row * spacingZ,
  };
}

// Lounge positions for idle agents
export function getLoungePosition(index: number): { x: number; z: number } {
  const loungePositions = [
    { x: -8, z: 15 },
    { x: -4, z: 18 },
    { x: 0, z: 15 },
    { x: 4, z: 18 },
    { x: 8, z: 15 },
    { x: -6, z: 22 },
    { x: 0, z: 22 },
    { x: 6, z: 22 },
    { x: -10, z: 20 },
    { x: 10, z: 20 },
  ];
  return loungePositions[index % loungePositions.length];
}

export function OfficeEnvironment() {
  return (
    <group>
      {/* Sky - independent of office position, always surrounds everything */}
      <Sky />

      {/* Sun - positioned high in the sky */}
      <Sun />

      {/* Building base - the structure our office sits on top of */}
      <BuildingBase />

      {/* Office Interior */}
      <OfficeFloor />
      <GlassWalls />
      <WorkArea />
      <LoungeArea />
      <AreaDivider />
      <OfficeLight />

      {/* Outside View - positioned below office level */}
      <group position={[0, -BUILDING_HEIGHT, 0]}>
        <CityBelow />
        <Roads />
        <CoastalRoad />
        <Shoreline />
        <Ocean />
      </group>
    </group>
  );
}

// Building structure underneath the office
function BuildingBase() {
  const buildingWidth = OFFICE_SIZE; // Same as office floor
  const buildingDepth = OFFICE_SIZE;
  const floorHeight = 3; // Height per floor
  const numFloors = Math.floor(BUILDING_HEIGHT / floorHeight);

  // Position so the top of the building is just below the office floor (y=0)
  // Center of building is at -BUILDING_HEIGHT/2 - 0.5 to avoid overlap
  return (
    <group position={[0, -BUILDING_HEIGHT / 2 - 0.5, 0]}>
      {/* Main building structure */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[buildingWidth, BUILDING_HEIGHT, buildingDepth]} />
        <meshStandardMaterial color="#5a6a7a" metalness={0.3} roughness={0.7} />
      </mesh>

      {/* Windows on all four sides */}
      {Array.from({ length: numFloors }).map((_, floor) => {
        const y = -BUILDING_HEIGHT / 2 + floor * floorHeight + floorHeight / 2 + 0.5;
        const windowsPerSide = 12;
        const windowSpacing = buildingWidth / (windowsPerSide + 1);

        return (
          <group key={floor}>
            {/* Front windows (negative z) */}
            {Array.from({ length: windowsPerSide }).map((_, i) => (
              <mesh
                key={`front-${i}`}
                position={[
                  -buildingWidth / 2 + windowSpacing * (i + 1),
                  y,
                  -buildingDepth / 2 - 0.02,
                ]}
              >
                <planeGeometry args={[2.5, 2]} />
                <meshStandardMaterial
                  color="#88ccff"
                  metalness={0.8}
                  roughness={0.2}
                  transparent
                  opacity={0.7}
                />
              </mesh>
            ))}

            {/* Back windows (positive z) */}
            {Array.from({ length: windowsPerSide }).map((_, i) => (
              <mesh
                key={`back-${i}`}
                position={[
                  -buildingWidth / 2 + windowSpacing * (i + 1),
                  y,
                  buildingDepth / 2 + 0.02,
                ]}
                rotation={[0, Math.PI, 0]}
              >
                <planeGeometry args={[2.5, 2]} />
                <meshStandardMaterial
                  color="#88ccff"
                  metalness={0.8}
                  roughness={0.2}
                  transparent
                  opacity={0.7}
                />
              </mesh>
            ))}

            {/* Left windows (negative x) */}
            {Array.from({ length: windowsPerSide }).map((_, i) => (
              <mesh
                key={`left-${i}`}
                position={[
                  -buildingWidth / 2 - 0.02,
                  y,
                  -buildingDepth / 2 + windowSpacing * (i + 1),
                ]}
                rotation={[0, -Math.PI / 2, 0]}
              >
                <planeGeometry args={[2.5, 2]} />
                <meshStandardMaterial
                  color="#88ccff"
                  metalness={0.8}
                  roughness={0.2}
                  transparent
                  opacity={0.7}
                />
              </mesh>
            ))}

            {/* Right windows (positive x) */}
            {Array.from({ length: windowsPerSide }).map((_, i) => (
              <mesh
                key={`right-${i}`}
                position={[
                  buildingWidth / 2 + 0.02,
                  y,
                  -buildingDepth / 2 + windowSpacing * (i + 1),
                ]}
                rotation={[0, Math.PI / 2, 0]}
              >
                <planeGeometry args={[2.5, 2]} />
                <meshStandardMaterial
                  color="#88ccff"
                  metalness={0.8}
                  roughness={0.2}
                  transparent
                  opacity={0.7}
                />
              </mesh>
            ))}
          </group>
        );
      })}

      {/* Floor dividers / trim lines */}
      {Array.from({ length: numFloors + 1 }).map((_, i) => {
        const y = -BUILDING_HEIGHT / 2 + i * floorHeight;
        return (
          <group key={`trim-${i}`}>
            {/* Front trim */}
            <mesh position={[0, y, -buildingDepth / 2 - 0.03]}>
              <boxGeometry args={[buildingWidth + 0.5, 0.3, 0.1]} />
              <meshStandardMaterial color="#4a5a6a" />
            </mesh>
            {/* Back trim */}
            <mesh position={[0, y, buildingDepth / 2 + 0.03]}>
              <boxGeometry args={[buildingWidth + 0.5, 0.3, 0.1]} />
              <meshStandardMaterial color="#4a5a6a" />
            </mesh>
            {/* Left trim */}
            <mesh position={[-buildingWidth / 2 - 0.03, y, 0]}>
              <boxGeometry args={[0.1, 0.3, buildingDepth + 0.5]} />
              <meshStandardMaterial color="#4a5a6a" />
            </mesh>
            {/* Right trim */}
            <mesh position={[buildingWidth / 2 + 0.03, y, 0]}>
              <boxGeometry args={[0.1, 0.3, buildingDepth + 0.5]} />
              <meshStandardMaterial color="#4a5a6a" />
            </mesh>
          </group>
        );
      })}

      {/* Building entrance at ground level */}
      <mesh position={[0, -BUILDING_HEIGHT / 2 + 2, -buildingDepth / 2 - 0.03]}>
        <boxGeometry args={[8, 4, 0.2]} />
        <meshStandardMaterial color="#334455" />
      </mesh>
      {/* Entrance glass doors */}
      <mesh position={[0, -BUILDING_HEIGHT / 2 + 2, -buildingDepth / 2 - 0.05]}>
        <planeGeometry args={[6, 3.5]} />
        <meshStandardMaterial color="#aaddff" metalness={0.9} roughness={0.1} transparent opacity={0.5} />
      </mesh>
    </group>
  );
}

function OfficeFloor() {
  const tiles = useMemo(() => {
    const tileCount = 40;
    const result: { x: number; z: number; color: string }[] = [];
    for (let i = 0; i < tileCount; i++) {
      for (let j = 0; j < tileCount; j++) {
        result.push({
          x: (i - tileCount / 2 + 0.5) * 2,
          z: (j - tileCount / 2 + 0.5) * 2,
          color: (i + j) % 2 === 0 ? "#2a2a3a" : "#323242",
        });
      }
    }
    return result;
  }, []);

  return (
    <group>
      {/* Floor tiles pattern */}
      {tiles.map((tile, idx) => (
        <mesh
          key={idx}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[tile.x, 0, tile.z]}
          receiveShadow
        >
          <planeGeometry args={[1.98, 1.98]} />
          <meshStandardMaterial
            color={tile.color}
            metalness={0.3}
            roughness={0.7}
          />
        </mesh>
      ))}
    </group>
  );
}

function GlassWalls() {
  const wallHeight = 10;
  const wallLength = OFFICE_SIZE;
  const halfSize = OFFICE_SIZE / 2;

  return (
    <group>
      {/* Glass panels on all sides */}
      {[
        { pos: [0, wallHeight / 2, -halfSize] as [number, number, number], rot: [0, 0, 0] as [number, number, number] },
        { pos: [0, wallHeight / 2, halfSize] as [number, number, number], rot: [0, Math.PI, 0] as [number, number, number] },
        { pos: [halfSize, wallHeight / 2, 0] as [number, number, number], rot: [0, -Math.PI / 2, 0] as [number, number, number] },
        { pos: [-halfSize, wallHeight / 2, 0] as [number, number, number], rot: [0, Math.PI / 2, 0] as [number, number, number] },
      ].map((wall, i) => (
        <mesh key={i} position={wall.pos} rotation={wall.rot}>
          <planeGeometry args={[wallLength, wallHeight]} />
          <meshPhysicalMaterial
            color="#aaddff"
            transparent
            opacity={0.08}
            metalness={0.9}
            roughness={0.1}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}

      {/* Window frames */}
      <WindowFrames />
    </group>
  );
}

function WindowFrames() {
  const frameColor = "#2a2a3a";
  const frames: JSX.Element[] = [];
  const halfSize = OFFICE_SIZE / 2;

  for (let i = -halfSize + 8; i <= halfSize - 8; i += 10) {
    // All four walls
    frames.push(
      <mesh key={`n-${i}`} position={[i, 5, -halfSize + 0.05]}>
        <boxGeometry args={[0.12, 10, 0.12]} />
        <meshStandardMaterial color={frameColor} metalness={0.7} />
      </mesh>,
      <mesh key={`s-${i}`} position={[i, 5, halfSize - 0.05]}>
        <boxGeometry args={[0.12, 10, 0.12]} />
        <meshStandardMaterial color={frameColor} metalness={0.7} />
      </mesh>,
      <mesh key={`e-${i}`} position={[halfSize - 0.05, 5, i]}>
        <boxGeometry args={[0.12, 10, 0.12]} />
        <meshStandardMaterial color={frameColor} metalness={0.7} />
      </mesh>,
      <mesh key={`w-${i}`} position={[-halfSize + 0.05, 5, i]}>
        <boxGeometry args={[0.12, 10, 0.12]} />
        <meshStandardMaterial color={frameColor} metalness={0.7} />
      </mesh>
    );
  }

  return <group>{frames}</group>;
}

function WorkArea() {
  const desks: JSX.Element[] = [];

  for (let row = 0; row < DESK_ROWS; row++) {
    for (let col = 0; col < DESKS_PER_ROW; col++) {
      const pos = getDeskPosition(row * DESKS_PER_ROW + col);
      desks.push(
        <Desk
          key={`desk-${row}-${col}`}
          position={[pos.x, 0, pos.z]}
          deskId={row * DESKS_PER_ROW + col}
        />
      );
    }
  }

  return (
    <group>
      {desks}
      <ServerRack position={[22, 0, -20]} />
      <ServerRack position={[22, 0, -15]} />
      <Whiteboard position={[-22, 0, -18]} />
    </group>
  );
}

function LoungeArea() {
  return (
    <group position={[0, 0, 18]}>
      <Couch position={[-8, 0, 0]} rotation={[0, Math.PI / 4, 0]} />
      <Couch position={[8, 0, 0]} rotation={[0, -Math.PI / 4, 0]} />
      <Couch position={[0, 0, 5]} rotation={[0, Math.PI, 0]} />
      <CoffeeTable position={[0, 0, 2]} />
      <Beanbag position={[-4, 0, 6]} color="#9d4edd" />
      <Beanbag position={[4, 0, 6]} color="#ff6600" />
      <Beanbag position={[-10, 0, 3]} color="#00ffff" />
      <Beanbag position={[10, 0, 3]} color="#ff1493" />
      <ArcadeMachine position={[15, 0, 8]} />
      <VendingMachine position={[-18, 0, 5]} color="#ff1493" />
      <VendingMachine position={[-18, 0, 8]} color="#00ffff" />
      <OfficePlant position={[-12, 0, -2]} scale={1.5} />
      <OfficePlant position={[12, 0, -2]} scale={1.5} />
      <OfficePlant position={[0, 0, 10]} scale={1.2} />
    </group>
  );
}

function AreaDivider() {
  return (
    <group position={[0, 0, 3]}>
      <mesh position={[0, 0.5, 0]}>
        <boxGeometry args={[30, 1, 0.8]} />
        <meshStandardMaterial color="#3a3a4a" />
      </mesh>
      {[-12, -6, 0, 6, 12].map((x, i) => (
        <mesh key={i} position={[x, 1.2, 0]}>
          <sphereGeometry args={[0.4, 12, 12]} />
          <meshStandardMaterial color="#228b22" />
        </mesh>
      ))}
      <mesh position={[0, 0.1, 0.45]}>
        <boxGeometry args={[30, 0.05, 0.05]} />
        <meshBasicMaterial color="#ff1493" />
      </mesh>
    </group>
  );
}

function Desk({ position, deskId }: { position: [number, number, number]; deskId: number }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.75, 0]}>
        <boxGeometry args={[2, 0.05, 1]} />
        <meshStandardMaterial color="#4a4a5a" metalness={0.2} roughness={0.8} />
      </mesh>
      <mesh position={[-0.9, 0.375, 0]}>
        <boxGeometry args={[0.05, 0.75, 0.8]} />
        <meshStandardMaterial color="#3a3a4a" metalness={0.4} />
      </mesh>
      <mesh position={[0.9, 0.375, 0]}>
        <boxGeometry args={[0.05, 0.75, 0.8]} />
        <meshStandardMaterial color="#3a3a4a" metalness={0.4} />
      </mesh>
      <mesh position={[0, 1.15, -0.3]}>
        <boxGeometry args={[0.8, 0.5, 0.03]} />
        <meshStandardMaterial color="#1a1a2a" metalness={0.8} />
      </mesh>
      <mesh position={[0, 1.15, -0.28]}>
        <planeGeometry args={[0.75, 0.45]} />
        <meshBasicMaterial color="#0a1628" />
      </mesh>
      <mesh position={[0, 1.15, -0.27]}>
        <planeGeometry args={[0.7, 0.4]} />
        <meshBasicMaterial
          color={deskId % 3 === 0 ? "#00ffff" : deskId % 3 === 1 ? "#ff1493" : "#4ade80"}
          transparent
          opacity={0.2}
        />
      </mesh>
      <mesh position={[0, 0.85, -0.3]}>
        <boxGeometry args={[0.15, 0.15, 0.1]} />
        <meshStandardMaterial color="#3a3a4a" metalness={0.5} />
      </mesh>
      <mesh position={[0, 0.78, 0.1]}>
        <boxGeometry args={[0.5, 0.02, 0.18]} />
        <meshStandardMaterial color="#2a2a3a" />
      </mesh>
      <mesh position={[0.4, 0.78, 0.1]}>
        <boxGeometry args={[0.08, 0.02, 0.12]} />
        <meshStandardMaterial color="#2a2a3a" />
      </mesh>
      <OfficeChair position={[0, 0, 0.7]} />
    </group>
  );
}

function OfficeChair({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.45, 0]}>
        <boxGeometry args={[0.5, 0.08, 0.5]} />
        <meshStandardMaterial color="#3d3d4d" />
      </mesh>
      <mesh position={[0, 0.8, -0.22]}>
        <boxGeometry args={[0.5, 0.6, 0.05]} />
        <meshStandardMaterial color="#3d3d4d" />
      </mesh>
      <mesh position={[0, 0.2, 0]}>
        <cylinderGeometry args={[0.02, 0.02, 0.4, 8]} />
        <meshStandardMaterial color="#2a2a3a" metalness={0.8} />
      </mesh>
      <mesh position={[0, 0.05, 0]}>
        <cylinderGeometry args={[0.25, 0.25, 0.05, 5]} />
        <meshStandardMaterial color="#2a2a3a" metalness={0.8} />
      </mesh>
    </group>
  );
}

function Couch({ position, rotation }: { position: [number, number, number]; rotation: [number, number, number] }) {
  return (
    <group position={position} rotation={rotation}>
      <mesh position={[0, 0.25, 0]}>
        <boxGeometry args={[3, 0.5, 1]} />
        <meshStandardMaterial color="#5a4a6a" />
      </mesh>
      <mesh position={[0, 0.7, -0.4]}>
        <boxGeometry args={[3, 0.8, 0.2]} />
        <meshStandardMaterial color="#5a4a6a" />
      </mesh>
      <mesh position={[-1.4, 0.5, 0]}>
        <boxGeometry args={[0.2, 0.5, 1]} />
        <meshStandardMaterial color="#5a4a6a" />
      </mesh>
      <mesh position={[1.4, 0.5, 0]}>
        <boxGeometry args={[0.2, 0.5, 1]} />
        <meshStandardMaterial color="#5a4a6a" />
      </mesh>
    </group>
  );
}

function CoffeeTable({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.4, 0]}>
        <boxGeometry args={[2, 0.05, 1]} />
        <meshPhysicalMaterial color="#aaddff" transparent opacity={0.4} metalness={0.9} roughness={0.1} />
      </mesh>
      {[[-0.8, -0.4], [0.8, -0.4], [-0.8, 0.4], [0.8, 0.4]].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.2, z]}>
          <cylinderGeometry args={[0.05, 0.05, 0.4, 8]} />
          <meshStandardMaterial color="#2a2a3a" metalness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

function Beanbag({ position, color }: { position: [number, number, number]; color: string }) {
  return (
    <mesh position={[position[0], 0.35, position[2]]}>
      <sphereGeometry args={[0.5, 16, 12]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
}

function ArcadeMachine({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 1, 0]}>
        <boxGeometry args={[1, 2, 0.8]} />
        <meshStandardMaterial color="#2a2a3a" />
      </mesh>
      <mesh position={[0, 1.3, 0.41]}>
        <planeGeometry args={[0.7, 0.6]} />
        <meshBasicMaterial color="#000000" />
      </mesh>
      <mesh position={[0, 1.3, 0.42]}>
        <planeGeometry args={[0.65, 0.55]} />
        <meshBasicMaterial color="#00ff00" transparent opacity={0.4} />
      </mesh>
      <mesh position={[0, 0.02, 0.41]}>
        <boxGeometry args={[1.02, 0.04, 0.02]} />
        <meshBasicMaterial color="#ff1493" />
      </mesh>
    </group>
  );
}

function VendingMachine({ position, color }: { position: [number, number, number]; color: string }) {
  return (
    <group position={position}>
      <mesh position={[0, 1, 0]}>
        <boxGeometry args={[1, 2, 0.7]} />
        <meshStandardMaterial color="#3a3a4a" />
      </mesh>
      <mesh position={[0, 1.2, 0.36]}>
        <boxGeometry args={[0.9, 1.4, 0.02]} />
        <meshPhysicalMaterial color="#1a1a2a" transparent opacity={0.8} />
      </mesh>
      <mesh position={[0, 1.9, 0.36]}>
        <boxGeometry args={[0.95, 0.1, 0.03]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <pointLight position={[0, 1, 0.5]} color={color} intensity={0.5} distance={4} />
    </group>
  );
}

function ServerRack({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 1.2, 0]}>
        <boxGeometry args={[1.2, 2.4, 0.8]} />
        <meshStandardMaterial color="#1a1a2a" metalness={0.8} />
      </mesh>
      {[0.3, 0.6, 0.9, 1.2, 1.5, 1.8].map((y, i) => (
        <mesh key={i} position={[0.5, y, 0.41]}>
          <sphereGeometry args={[0.03, 8, 8]} />
          <meshBasicMaterial color={i % 2 === 0 ? "#00ff00" : "#ff0000"} />
        </mesh>
      ))}
    </group>
  );
}

function Whiteboard({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 1.5, 0]}>
        <boxGeometry args={[4, 2, 0.1]} />
        <meshStandardMaterial color="#f5f5f5" />
      </mesh>
      <mesh position={[0, 1.5, 0.06]}>
        <boxGeometry args={[4.1, 2.1, 0.02]} />
        <meshStandardMaterial color="#4a4a5a" />
      </mesh>
    </group>
  );
}

function OfficePlant({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.3, 0]}>
        <cylinderGeometry args={[0.3, 0.25, 0.6, 16]} />
        <meshStandardMaterial color="#5a5a6a" />
      </mesh>
      <mesh position={[0, 1, 0]}>
        <sphereGeometry args={[0.5, 16, 16]} />
        <meshStandardMaterial color="#2d8c2d" />
      </mesh>
    </group>
  );
}

// ==================== OUTSIDE WORLD ====================

function Sky() {
  return (
    <mesh renderOrder={-1000}>
      <sphereGeometry args={[400, 32, 32]} />
      <meshBasicMaterial color="#4a90d9" side={THREE.BackSide} />
    </mesh>
  );
}

function Sun() {
  const sunRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (sunRef.current) {
      const scale = 1 + Math.sin(state.clock.elapsedTime * 0.5) * 0.03;
      sunRef.current.scale.setScalar(scale);
    }
  });

  return (
    <group position={[-150, 200, -200]}>
      <mesh ref={sunRef}>
        <circleGeometry args={[30, 32]} />
        <meshBasicMaterial color="#ffffcc" />
      </mesh>
      <mesh position={[0, 0, -1]}>
        <circleGeometry args={[40, 32]} />
        <meshBasicMaterial color="#ffffaa" transparent opacity={0.5} />
      </mesh>
      <mesh position={[0, 0, -2]}>
        <circleGeometry args={[55, 32]} />
        <meshBasicMaterial color="#ffff88" transparent opacity={0.3} />
      </mesh>
      {/* Sun directional light */}
      <directionalLight
        position={[0, 0, 10]}
        intensity={1.5}
        color="#ffffd0"
        castShadow
      />
    </group>
  );
}

function CityBelow() {
  const buildings = useMemo(() => {
    const result: { x: number; z: number; height: number; width: number; depth: number }[] = [];

    // Buildings spread around below the office, but NOT on the ocean side (negative z)
    for (let i = 0; i < 150; i++) {
      const baseAngle = (i / 150) * Math.PI;
      const angle = baseAngle - Math.PI / 2;

      const distance = 60 + ((i * 31) % 200);
      const height = 10 + ((i * 17) % 60);

      result.push({
        x: Math.sin(angle) * distance,
        z: Math.cos(angle) * distance,
        height,
        width: 8 + ((i * 13) % 15),
        depth: 8 + ((i * 11) % 15),
      });
    }
    return result;
  }, []);

  return (
    <group>
      {buildings.map((b, i) => (
        <CityBuilding key={i} {...b} />
      ))}
    </group>
  );
}

function CityBuilding({ x, z, height, width, depth }: { x: number; z: number; height: number; width: number; depth: number }) {
  // Building colors - lighter daytime colors (deterministic based on position)
  const buildingColor = useMemo(() => {
    const colors = ["#8899aa", "#99aabb", "#7788aa", "#aabbcc", "#778899", "#6699aa", "#88aacc"];
    const seed = Math.abs(Math.floor(x * 100 + z * 50));
    return colors[seed % colors.length];
  }, [x, z]);

  // Window pattern (deterministic based on position)
  const hasWindows = useMemo(() => {
    const seed = Math.abs(Math.floor(x * 73 + z * 37));
    return seed % 5 !== 0; // ~80% have windows
  }, [x, z]);

  return (
    <group position={[x, height / 2, z]}>
      {/* Building body */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial color={buildingColor} metalness={0.4} roughness={0.6} />
      </mesh>

      {/* Windows - reflective glass */}
      {hasWindows && (
        <>
          <mesh position={[0, 0, depth / 2 + 0.02]}>
            <planeGeometry args={[width * 0.85, height * 0.85]} />
            <meshStandardMaterial color="#aaddff" metalness={0.9} roughness={0.1} transparent opacity={0.6} />
          </mesh>
          <mesh position={[0, 0, -depth / 2 - 0.02]} rotation={[0, Math.PI, 0]}>
            <planeGeometry args={[width * 0.85, height * 0.85]} />
            <meshStandardMaterial color="#aaddff" metalness={0.9} roughness={0.1} transparent opacity={0.6} />
          </mesh>
          <mesh position={[width / 2 + 0.02, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
            <planeGeometry args={[depth * 0.85, height * 0.85]} />
            <meshStandardMaterial color="#aaddff" metalness={0.9} roughness={0.1} transparent opacity={0.6} />
          </mesh>
          <mesh position={[-width / 2 - 0.02, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
            <planeGeometry args={[depth * 0.85, height * 0.85]} />
            <meshStandardMaterial color="#aaddff" metalness={0.9} roughness={0.1} transparent opacity={0.6} />
          </mesh>
        </>
      )}

      {/* Rooftop details */}
      <mesh position={[0, height / 2 + 0.5, 0]}>
        <boxGeometry args={[width * 0.3, 1, depth * 0.3]} />
        <meshStandardMaterial color="#556677" />
      </mesh>
    </group>
  );
}

function Roads() {
  return (
    <group position={[0, 0.1, 0]}>
      {/* Ground - extends from beach edge to city */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.1, 100]}>
        <planeGeometry args={[1500, 300]} />
        <meshStandardMaterial color="#3a5a3a" roughness={0.95} />
      </mesh>

      {/* Main roads - only in city area */}
      {[50, 125, 200, 275].map((pos, i) => (
        <group key={`road-${i}`}>
          {/* Horizontal road */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, pos]}>
            <planeGeometry args={[1200, 15]} />
            <meshStandardMaterial color="#1a1a1a" roughness={0.9} />
          </mesh>
          {/* Road markings */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, pos]}>
            <planeGeometry args={[1200, 0.5]} />
            <meshBasicMaterial color="#ffff00" transparent opacity={0.5} />
          </mesh>
        </group>
      ))}

      {/* Vertical roads */}
      {[-400, -200, 0, 200, 400].map((pos, i) => (
        <group key={`vroad-${i}`}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[pos, 0, 175]}>
            <planeGeometry args={[15, 350]} />
            <meshStandardMaterial color="#1a1a1a" roughness={0.9} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[pos, 0.01, 175]}>
            <planeGeometry args={[0.5, 350]} />
            <meshBasicMaterial color="#ffff00" transparent opacity={0.5} />
          </mesh>
        </group>
      ))}

      {/* Street lights - only in city area */}
      {Array.from({ length: 20 }).map((_, i) => {
        const x = -400 + ((i * 97) % 800);
        const z = 60 + ((i * 31) % 250);
        return (
          <group key={`light-${i}`} position={[x, 0, z]}>
            <mesh position={[0, 4, 0]}>
              <cylinderGeometry args={[0.2, 0.3, 8, 8]} />
              <meshStandardMaterial color="#3a3a3a" />
            </mesh>
            <pointLight position={[0, 8, 0]} color="#ffaa66" intensity={2} distance={20} />
          </group>
        );
      })}
    </group>
  );
}

function CoastalRoad() {
  // Road runs along the coast on the grass, parallel to the sand/grass boundary
  const roadZ = -35;
  const roadLength = 1500;

  // Car configurations
  const cars = useMemo(() => {
    const carColors = ["#ff3333", "#3366ff", "#ffcc00", "#33cc33", "#ff66cc", "#ffffff", "#333333", "#ff6600"];
    return Array.from({ length: 20 }, (_, i) => ({
      id: i,
      color: carColors[i % carColors.length],
      startX: -750 + (i * 75),
      speed: 15 + (i % 5) * 3,
      direction: i % 2 === 0 ? 1 : -1,
      lane: i % 2,
    }));
  }, []);

  // Single refs array for all car groups
  const carRefs = useRef<(THREE.Group | null)[]>([]);

  // Single useFrame for all cars instead of one per car
  useFrame((state) => {
    const time = state.clock.elapsedTime;
    const halfLength = roadLength / 2;

    cars.forEach((car, index) => {
      const carRef = carRefs.current[index];
      if (carRef) {
        let x = car.startX + time * car.speed * car.direction;
        // Wrap around
        if (x > halfLength) {
          x = -halfLength + ((x - halfLength) % roadLength);
        } else if (x < -halfLength) {
          x = halfLength - ((-halfLength - x) % roadLength);
        }
        carRef.position.x = x;
      }
    });
  });

  // Road dashes
  const roadDashes = useMemo(() =>
    Array.from({ length: 150 }, (_, i) => -750 + i * 10 + 2.5),
  []);

  return (
    <group position={[0, 0, roadZ]}>
      {/* Main road surface */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.2, 0]}>
        <planeGeometry args={[roadLength, 12]} />
        <meshStandardMaterial color="#2a2a2a" roughness={0.9} />
      </mesh>

      {/* Road center line (dashed yellow) */}
      {roadDashes.map((x, i) => (
        <mesh key={`dash-${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.22, 0]}>
          <planeGeometry args={[5, 0.3]} />
          <meshBasicMaterial color="#ffcc00" />
        </mesh>
      ))}

      {/* Road edge lines (white) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.22, -5.5]}>
        <planeGeometry args={[roadLength, 0.3]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.22, 5.5]}>
        <planeGeometry args={[roadLength, 0.3]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>

      {/* Cars - now using shared refs */}
      {cars.map((car, index) => (
        <group
          key={car.id}
          ref={(el) => { carRefs.current[index] = el; }}
          position={[car.startX, 0.5, car.lane === 0 ? -2.5 : 2.5]}
          rotation={[0, car.direction === 1 ? 0 : Math.PI, 0]}
        >
          <CarBody color={car.color} />
        </group>
      ))}
    </group>
  );
}

// Static car body component - no useFrame, animation handled by parent
function CarBody({ color }: { color: string }) {
  return (
    <>
      {/* Car body */}
      <mesh position={[0, 0.3, 0]}>
        <boxGeometry args={[3.5, 0.6, 1.6]} />
        <meshStandardMaterial color={color} metalness={0.6} roughness={0.4} />
      </mesh>

      {/* Car cabin */}
      <mesh position={[0.2, 0.75, 0]}>
        <boxGeometry args={[1.8, 0.5, 1.4]} />
        <meshStandardMaterial color="#1a1a2a" metalness={0.8} roughness={0.2} />
      </mesh>

      {/* Windows - simplified to 2 instead of 4 */}
      <mesh position={[0.2, 0.75, 0.71]}>
        <planeGeometry args={[1.6, 0.4]} />
        <meshStandardMaterial color="#88ccff" metalness={0.9} roughness={0.1} transparent opacity={0.7} />
      </mesh>

      {/* Wheels - simplified geometry */}
      {[[-1, -0.8], [-1, 0.8], [1, -0.8], [1, 0.8]].map(([x, z], i) => (
        <mesh key={i} position={[x, 0, z]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.3, 0.3, 0.2, 8]} />
          <meshStandardMaterial color="#1a1a1a" roughness={0.9} />
        </mesh>
      ))}

      {/* Headlights */}
      <mesh position={[1.76, 0.3, 0]}>
        <boxGeometry args={[0.05, 0.15, 0.8]} />
        <meshBasicMaterial color="#ffffcc" />
      </mesh>

      {/* Taillights */}
      <mesh position={[-1.76, 0.3, 0]}>
        <boxGeometry args={[0.05, 0.15, 0.8]} />
        <meshBasicMaterial color="#ff3333" />
      </mesh>
    </>
  );
}

function Shoreline() {
  return (
    <group position={[0, 0, -50]}>
      {/* Beach - wide strip of sand connecting grass to ocean */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.15, -40]}>
        <planeGeometry args={[1500, 100]} />
        <meshStandardMaterial color="#c2a878" roughness={0.9} />
      </mesh>

      {/* Palm trees along the shore - spread wide, all on sand */}
      {Array.from({ length: 100 }).map((_, i) => (
        <PalmTree
          key={i}
          position={[
            -700 + i * 14 + ((i * 7) % 5),
            0,
            -60 + ((i * 11) % 40),
          ]}
        />
      ))}
    </group>
  );
}

function PalmFrond({ angle, droopFactor }: { angle: number; droopFactor: number }) {
  const leafSegments = 8;
  // Use deterministic value based on angle instead of random
  const frondLength = 5 + ((Math.abs(angle) * 7) % 15) / 10;

  return (
    <group rotation={[0, (angle * Math.PI) / 180, 0]}>
      {/* Main frond stem */}
      <group rotation={[0.3 + droopFactor * 0.4, 0, 0]}>
        {Array.from({ length: leafSegments }).map((_, i) => {
          const t = i / leafSegments;
          const curveAngle = t * t * (0.8 + droopFactor * 0.6);
          const segmentLength = frondLength / leafSegments;
          const yOffset = i * segmentLength * Math.cos(curveAngle * 0.5);
          const zOffset = i * segmentLength * (1 + t * 0.3);

          return (
            <group key={i} position={[0, yOffset, zOffset]} rotation={[curveAngle, 0, 0]}>
              {/* Frond stem segment */}
              <mesh>
                <cylinderGeometry args={[0.03 * (1 - t * 0.7), 0.04 * (1 - t * 0.5), segmentLength, 4]} />
                <meshStandardMaterial color="#3d6b1e" roughness={0.8} />
              </mesh>

              {/* Leaflets on both sides */}
              {i > 0 && (
                <>
                  {/* Left leaflet */}
                  <mesh
                    position={[-0.3 * (1 - t * 0.5), 0, 0]}
                    rotation={[0.1, 0.3, -0.4 - t * 0.3]}
                    scale={[1 - t * 0.6, 1, 1]}
                  >
                    <planeGeometry args={[0.6, 0.15]} />
                    <meshStandardMaterial
                      color={i < 3 ? "#2d7d2d" : "#228b22"}
                      side={THREE.DoubleSide}
                      roughness={0.7}
                    />
                  </mesh>
                  {/* Right leaflet */}
                  <mesh
                    position={[0.3 * (1 - t * 0.5), 0, 0]}
                    rotation={[0.1, -0.3, 0.4 + t * 0.3]}
                    scale={[1 - t * 0.6, 1, 1]}
                  >
                    <planeGeometry args={[0.6, 0.15]} />
                    <meshStandardMaterial
                      color={i < 3 ? "#2d7d2d" : "#228b22"}
                      side={THREE.DoubleSide}
                      roughness={0.7}
                    />
                  </mesh>
                </>
              )}
            </group>
          );
        })}
      </group>
    </group>
  );
}

function PalmTree({ position }: { position: [number, number, number] }) {
  // Use deterministic values based on position to avoid Math.random() on each render
  const trunkHeight = useMemo(() => 10 + ((Math.abs(position[0] * 17 + position[2] * 31)) % 40) / 10, [position]);
  const trunkSegments = 12;
  const frondAngles = useMemo(() =>
    Array.from({ length: 9 }, (_, i) => ({
      angle: i * 40 + ((position[0] * 13 + i * 7) % 15) - 7.5,
      droop: ((position[2] * 11 + i * 5) % 80) / 100
    })),
  [position]);

  // Removed useFrame animation - saves 100 callbacks per frame
  return (
    <group position={position}>
      {/* Trunk with segments and slight curve */}
      {Array.from({ length: trunkSegments }).map((_, i) => {
        const t = i / trunkSegments;
        const segmentHeight = trunkHeight / trunkSegments;
        const topRadius = 0.25 + (1 - t) * 0.15;
        const bottomRadius = 0.3 + (1 - t) * 0.2;
        const curveOffset = Math.sin(t * Math.PI * 0.5) * 0.3;

        return (
          <group key={i} position={[curveOffset, i * segmentHeight + segmentHeight / 2, 0]}>
            <mesh>
              <cylinderGeometry args={[topRadius, bottomRadius, segmentHeight, 8]} />
              <meshStandardMaterial
                color={i % 2 === 0 ? "#6b5344" : "#5a4535"}
                roughness={0.95}
              />
            </mesh>
            {/* Trunk ring detail */}
            <mesh position={[0, segmentHeight * 0.4, 0]}>
              <torusGeometry args={[topRadius + 0.02, 0.03, 4, 8]} />
              <meshStandardMaterial color="#4a3828" roughness={1} />
            </mesh>
          </group>
        );
      })}

      {/* Crown base (where fronds attach) */}
      <mesh position={[Math.sin(Math.PI * 0.5) * 0.3, trunkHeight + 0.3, 0]}>
        <sphereGeometry args={[0.5, 8, 6]} />
        <meshStandardMaterial color="#4a6b2a" roughness={0.8} />
      </mesh>

      {/* Palm fronds */}
      <group position={[Math.sin(Math.PI * 0.5) * 0.3, trunkHeight + 0.5, 0]}>
        {frondAngles.map((frond, i) => (
          <PalmFrond key={i} angle={frond.angle} droopFactor={frond.droop} />
        ))}
      </group>

      {/* Coconuts */}
      {[0, 120, 240].map((angle, i) => (
        <mesh
          key={i}
          position={[
            Math.sin((angle * Math.PI) / 180) * 0.4 + Math.sin(Math.PI * 0.5) * 0.3,
            trunkHeight - 0.3,
            Math.cos((angle * Math.PI) / 180) * 0.4,
          ]}
        >
          <sphereGeometry args={[0.2, 8, 8]} />
          <meshStandardMaterial color="#5c4033" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

function Ocean() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, -400]}>
      <planeGeometry args={[2000, 600]} />
      <meshStandardMaterial color="#1e90ff" metalness={0.3} roughness={0.6} />
    </mesh>
  );
}

// ==================== OFFICE LIGHTING ====================

function OfficeLight() {
  const halfSize = OFFICE_SIZE / 2;

  return (
    <group>
      {/* Strong ambient for well-lit office */}
      <ambientLight intensity={0.6} color="#ffffff" />

      {/* Main overhead lights */}
      <directionalLight position={[0, 20, 0]} intensity={0.8} color="#ffffff" />

      {/* Window light (sunset tones from outside) */}
      <directionalLight position={[0, 10, -50]} intensity={0.3} color="#ffaa77" />
      <directionalLight position={[50, 10, 0]} intensity={0.2} color="#ffaa77" />
      <directionalLight position={[-50, 10, 0]} intensity={0.2} color="#ffaa77" />

      {/* Ceiling panel lights - work area */}
      {[
        [-15, -22], [-5, -22], [5, -22], [15, -22],
        [-15, -12], [-5, -12], [5, -12], [15, -12],
        [-10, -2], [0, -2], [10, -2],
      ].map(([x, z], i) => (
        <group key={`ceil-${i}`} position={[x, 9.5, z]}>
          <pointLight color="#ffffff" intensity={1.2} distance={18} />
          <mesh>
            <boxGeometry args={[3, 0.1, 1.5]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
        </group>
      ))}

      {/* Ceiling lights - lounge area */}
      {[[-10, 15], [0, 15], [10, 15], [-5, 22], [5, 22], [0, 28]].map(([x, z], i) => (
        <group key={`lounge-ceil-${i}`} position={[x, 9.5, z]}>
          <pointLight color="#fff5e6" intensity={0.8} distance={15} />
          <mesh>
            <sphereGeometry args={[0.4, 16, 16]} />
            <meshBasicMaterial color="#fff5e6" />
          </mesh>
        </group>
      ))}

      {/* Neon accent strips on floor edges */}
      <mesh position={[-halfSize + 0.5, 0.05, 0]}>
        <boxGeometry args={[0.1, 0.05, OFFICE_SIZE - 2]} />
        <meshBasicMaterial color="#ff1493" />
      </mesh>
      <mesh position={[halfSize - 0.5, 0.05, 0]}>
        <boxGeometry args={[0.1, 0.05, OFFICE_SIZE - 2]} />
        <meshBasicMaterial color="#00ffff" />
      </mesh>
      <pointLight position={[-halfSize + 1, 0.5, 0]} color="#ff1493" intensity={0.5} distance={10} />
      <pointLight position={[halfSize - 1, 0.5, 0]} color="#00ffff" intensity={0.5} distance={10} />
    </group>
  );
}
