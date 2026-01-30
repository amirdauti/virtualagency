import { MCPServerId } from "./mcpServers";

export type AgentStatus = "idle" | "thinking" | "working" | "error";
export type ClaudeModel = "sonnet" | "opus" | "haiku";
export type CodexModel =
  | "gpt-5.2-codex"
  | "gpt-5.2"
  | "gpt-5.1-codex-max"
  | "gpt-5.1-codex"
  | "gpt-5.1"
  | "gpt-5-codex"
  | "gpt-5"
  | "gpt-5-mini"
  | "o3"
  | "o4-mini"
  | "gpt-4.1";
export type CliType = "claude" | "codex";
export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";
export type AgentSpecialty = "normal" | "roblox_builder";

export interface Position {
  x: number;
  y: number;
  z: number;
}

// Model configuration for proper positioning and animation
export interface AvatarConfig {
  id: string;
  name: string;
  path: string | null;
  scale?: number;        // Scale factor (default 1.0)
  yOffset?: number;      // Y position offset to place feet on ground
  idleAnims?: string[];  // Animation name patterns for idle
  walkAnims?: string[];  // Animation name patterns for walking
}

// Available avatar models with configuration
export const AVATAR_OPTIONS: AvatarConfig[] = [
  { id: "default", name: "Default (Chibi)", path: null },
  {
    id: "landmine_girl",
    name: "Landmine Girl",
    path: "/models/avatars/-_landmine_girl.glb",
    scale: 1.0,
    idleAnims: ["idle", "Idle", "stand"],
    walkAnims: ["walk", "Walk", "run", "Run"]
  },
  {
    id: "supermodel",
    name: "Supermodel",
    path: "/models/avatars/animated_supermodel_catwalk_walking_loop.glb",
    scale: 1.0,
    idleAnims: ["idle", "Idle"],
    walkAnims: ["walk", "Walk", "catwalk", "Catwalk"]
  },
  {
    id: "astronaut",
    name: "Astronaut",
    path: "/models/avatars/astronaut_character_stylized_rigged_free_model.glb",
    scale: 1.0,
    idleAnims: ["idle", "Idle"],
    walkAnims: ["walk", "Walk"]
  },
  {
    id: "paladin",
    name: "Darien the Paladin",
    path: "/models/avatars/darien_the_paladin_moba_character.glb",
    scale: 1.0,
    idleAnims: ["idle", "Idle"],
    walkAnims: ["walk", "Walk", "run", "Run"]
  },
  {
    id: "humanoid",
    name: "Humanoid Avatar",
    path: "/models/avatars/humanoid_avatar_with_rig.glb",
    scale: 1.0,
    idleAnims: ["idle", "Idle"],
    walkAnims: ["walk", "Walk"]
  },
  {
    id: "punk_demon",
    name: "Punk Demon",
    path: "/models/avatars/neverblink__punk_demon.glb",
    scale: 1.0,
    idleAnims: ["idle", "Idle"],
    walkAnims: ["walk", "Walk"]
  },
  {
    id: "one_armed_hero",
    name: "One-Armed Hero",
    path: "/models/avatars/one-armed_hero.glb",
    scale: 1.0,
    idleAnims: ["idle", "Idle"],
    walkAnims: ["walk", "Walk"]
  },
  {
    id: "rpm_male",
    name: "Ready Player Me Male",
    path: "/models/avatars/ready_player_me_male_avatar.glb",
    scale: 1.0,
    idleAnims: ["idle", "Idle"],
    walkAnims: ["walk", "Walk"]
  },
  {
    id: "spiderman",
    name: "Spider-Man",
    path: "/models/avatars/spider_man__rigged___superhero___unityunreal.glb",
    scale: 1.0,
    idleAnims: ["idle", "Idle"],
    walkAnims: ["walk", "Walk", "run", "Run"]
  },
  {
    id: "stylized_male",
    name: "Stylized Male",
    path: "/models/avatars/stylized_male.glb",
    scale: 1.0,
    idleAnims: ["idle", "Idle"],
    walkAnims: ["walk", "Walk"]
  },
];

export type AvatarId = typeof AVATAR_OPTIONS[number]["id"];

export interface Agent {
  id: string;
  name: string;
  status: AgentStatus;
  position: Position;
  workingDirectory: string;
  createdAt: string;
  lastActivity?: string;
  model?: ClaudeModel | CodexModel | string; // Model depends on CLI type
  thinkingEnabled?: boolean; // For Claude
  reasoningEffort?: ReasoningEffort; // For Codex
  specialty?: AgentSpecialty;
  avatarId?: AvatarId;
  mcpServers?: MCPServerId[]; // List of enabled MCP server IDs
  sessionId?: string; // CLI session ID for conversation continuity
  cliType?: CliType; // CLI backend to use (claude or codex)
}
