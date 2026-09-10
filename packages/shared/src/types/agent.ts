import { MCPServerId } from "./mcpServers";

export type AgentStatus = "idle" | "thinking" | "working" | "error";
export type ClaudeModel = "sonnet" | "opus" | "haiku";
export type CodexModel =
  | "gpt-6-astra"
  | "gpt-5.6-sol"
  | "gpt-5.6-terra"
  | "gpt-5.6-luna"
  | "gpt-5.5"
  | "gpt-5.3-codex-spark";
export type CliType = "claude" | "codex";
export type AgentRuntime = "local" | "hosted";
export type ReasoningEffort =
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max"
  | "ultra";
export type AgentSpecialty = "normal" | "roblox_builder";

export interface CodexModelDefinition {
  value: CodexModel;
  name: string;
  description: string;
  badge?: string;
  defaultReasoningEffort: ReasoningEffort;
  supportedReasoningEfforts: readonly ReasoningEffort[];
}

export interface ReasoningEffortDefinition {
  value: ReasoningEffort;
  name: string;
  description: string;
}

export const DEFAULT_CODEX_MODEL: CodexModel = "gpt-6-astra";

export const CODEX_MODELS: readonly CodexModelDefinition[] = [
  {
    value: "gpt-6-astra",
    name: "GPT-6 Astra",
    description: "Most capable model for complex, demanding work",
    badge: "Recommended",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
  },
  {
    value: "gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    description: "Reliable agentic workhorse for everyday tasks",
    defaultReasoningEffort: "low",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
  },
  {
    value: "gpt-5.6-terra",
    name: "GPT-5.6 Terra",
    description: "Balanced agentic model for everyday work",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
  },
  {
    value: "gpt-5.6-luna",
    name: "GPT-5.6 Luna",
    description: "Fast and affordable agentic model",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    value: "gpt-5.5",
    name: "GPT-5.5",
    description: "Proven previous-generation model",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
  },
  {
    value: "gpt-5.3-codex-spark",
    name: "GPT-5.3 Codex Spark",
    description: "Ultra-fast coding model",
    badge: "Fast",
    defaultReasoningEffort: "high",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
  },
];

export const CODEX_REASONING_EFFORTS: readonly ReasoningEffortDefinition[] = [
  { value: "low", name: "Low", description: "Fast responses with lighter reasoning" },
  { value: "medium", name: "Medium", description: "Balanced speed and reasoning depth" },
  { value: "high", name: "High", description: "Greater depth for complex problems" },
  { value: "xhigh", name: "Extra High", description: "Very deep reasoning for difficult work" },
  { value: "max", name: "Max", description: "Maximum reasoning depth" },
  { value: "ultra", name: "Ultra", description: "Maximum reasoning with automatic delegation" },
];

export function getCodexModelDefinition(
  model: string
): CodexModelDefinition | undefined {
  return CODEX_MODELS.find((candidate) => candidate.value === model);
}

export function isSupportedCodexModel(model: string): model is CodexModel {
  return Boolean(getCodexModelDefinition(model));
}

export function getCodexReasoningEfforts(
  model: string
): readonly ReasoningEffortDefinition[] {
  const definition = getCodexModelDefinition(model);
  const supported = new Set(
    definition?.supportedReasoningEfforts || ["low", "medium", "high", "xhigh"]
  );
  return CODEX_REASONING_EFFORTS.filter((effort) => supported.has(effort.value));
}

export function normalizeCodexReasoningEffort(
  model: string,
  effort: ReasoningEffort
): ReasoningEffort {
  const definition = getCodexModelDefinition(model);
  if (!definition) return effort;
  return definition.supportedReasoningEfforts.includes(effort)
    ? effort
    : definition.defaultReasoningEffort;
}

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
  scale?: number; // Scale factor (default 1.0)
  yOffset?: number; // Y position offset to place feet on ground
  disableFootprintClamp?: boolean; // Disable width/depth clamp (use with care)
  pose?: "armsDown"; // Optional pose fix for models that load in T-pose
  poseOnlyIfNoAnimations?: boolean; // Apply pose fix only when no animations are present
  idleAnims?: string[]; // Animation name patterns for idle
  walkAnims?: string[]; // Animation name patterns for walking
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

export type AvatarId = (typeof AVATAR_OPTIONS)[number]["id"];

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
