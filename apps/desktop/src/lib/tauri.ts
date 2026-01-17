// Helper to get invoke function dynamically
async function getInvoke() {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke;
  } catch {
    throw new Error("Tauri API not available. Make sure to run with 'pnpm tauri dev'");
  }
}

export async function createAgent(
  id: string,
  workingDir: string
): Promise<void> {
  const invoke = await getInvoke();
  return invoke("create_agent", { id, workingDir });
}

export async function killAgent(id: string): Promise<void> {
  const invoke = await getInvoke();
  return invoke("kill_agent", { id });
}

export async function sendMessage(id: string, message: string, images?: string[]): Promise<void> {
  const invoke = await getInvoke();
  return invoke("send_message", { id, message, images: images || [] });
}

export async function listAgents(): Promise<string[]> {
  const invoke = await getInvoke();
  return invoke("list_agents");
}

export interface CliStatus {
  installed: boolean;
  path: string | null;
  version: string | null;
}

export async function getCliStatus(): Promise<CliStatus> {
  const invoke = await getInvoke();
  return invoke("get_cli_status");
}

// Workspace persistence
export interface SavedAgent {
  id: string;
  name: string;
  working_directory: string;
  position: { x: number; y: number; z: number };
}

export interface WorkspaceData {
  agents: SavedAgent[];
  version: number;
}

export async function saveWorkspace(data: WorkspaceData): Promise<void> {
  const invoke = await getInvoke();
  return invoke("save_workspace", { data });
}

export async function loadWorkspace(): Promise<WorkspaceData | null> {
  const invoke = await getInvoke();
  return invoke("load_workspace");
}

export async function getWorkspacePath(): Promise<string> {
  const invoke = await getInvoke();
  return invoke("get_workspace_path_str");
}

// Settings
export interface AppSettings {
  claude_cli_path: string | null;
  theme: string;
  auto_save_enabled: boolean;
  auto_save_interval_seconds: number;
  default_working_directory: string | null;
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const invoke = await getInvoke();
  return invoke("save_settings", { settings });
}

export async function loadSettings(): Promise<AppSettings> {
  const invoke = await getInvoke();
  return invoke("load_settings");
}

export async function getSettingsPath(): Promise<string> {
  const invoke = await getInvoke();
  return invoke("get_settings_path_str");
}
