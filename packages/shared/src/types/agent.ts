import { MCPServerId } from "./mcpServers";

export type AgentStatus = "idle" | "thinking" | "working" | "error";
export type ClaudeModel = "sonnet" | "opus" | "haiku";
export type CodexModel =
  | "gpt-5.4"
  | "gpt-5.4-pro"
  | "gpt-5.3-codex"
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
export type AgentRuntime = "local" | "hosted";
export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";
export type AgentSpecialty = "normal" | "roblox_builder";

export interface AgentAutomation {
  id: string;
  taskDescription: string;
  prompt: string;
  intervalMinutes: number;
  enabled: boolean;
  createdAt: string;
  lastRunAt?: string;
  nextRunAt: string;
}

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
  disableFootprintClamp?: boolean; // Disable width/depth clamp (use with care)
  pose?: "armsDown";     // Optional pose fix for models that load in T-pose
  poseOnlyIfNoAnimations?: boolean; // Apply pose fix only when no animations are present
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
  },
  {
    id: "paladin",
    name: "Darien the Paladin",
    path: "/models/avatars/darien_the_paladin_moba_character.glb",
    scale: 1.0,
  },
  {
    id: "humanoid",
    name: "Humanoid Avatar",
    path: "/models/avatars/humanoid_avatar_with_rig.glb",
    scale: 1.0,
    // Only play an idle animation if the file explicitly provides one. Otherwise,
    // some rigs' only animation is a walk cycle (often named ambiguously), which
    // would look like "walking in place" while idle.
    idleAnims: ["idle", "stand", "Idle", "Stand"],
    walkAnims: ["walk", "run", "locomotion", "Walk", "Run", "Locomotion"],
  },
  {
    id: "rpm_male",
    name: "Ready Player Me Male",
    path: "/models/avatars/ready_player_me_male_avatar.glb",
    scale: 1.1,
  },
  {
    id: "spiderman",
    name: "Spider-Man",
    path: "/models/avatars/spider_man__rigged___superhero___unityunreal.glb",
    scale: 1.15,
    // Some Spider-Man rigs ship without a proper idle; avoid playing an action loop while standing.
    idleAnims: ["idle", "stand", "Idle", "Stand"],
  },
  {
    id: "stylized_male",
    name: "Stylized Male",
    path: "/models/avatars/stylized_male.glb",
    scale: 1.1,
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
  runtime?: AgentRuntime; // Execution runtime (local process or hosted VPS)
  stayAtDesk?: boolean; // Keep the agent at a desk even while idle/error
  automations?: AgentAutomation[]; // Recurring scheduled tasks for the agent
}
