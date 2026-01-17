/**
 * Unified API layer that works in both Tauri (desktop) and browser modes.
 * Automatically detects the environment and uses the appropriate backend.
 */

// Server URL for browser mode
const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://127.0.0.1:3001';
const WS_URL = import.meta.env.VITE_WS_URL || 'ws://127.0.0.1:3001/ws';

// Detect if running in Tauri (v2 uses __TAURI_INTERNALS__)
export function isTauri(): boolean {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
}

// WebSocket connection for browser mode
let ws: WebSocket | null = null;
let wsReconnectTimeout: ReturnType<typeof setTimeout> | null = null;
const wsListeners: Set<(event: MessageEvent) => void> = new Set();

function connectWebSocket() {
  if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) {
    return;
  }

  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    console.log('[API] WebSocket connected');
    if (wsReconnectTimeout) {
      clearTimeout(wsReconnectTimeout);
      wsReconnectTimeout = null;
    }
  };

  ws.onmessage = (event) => {
    wsListeners.forEach(listener => listener(event));
  };

  ws.onclose = () => {
    console.log('[API] WebSocket disconnected, reconnecting...');
    ws = null;
    wsReconnectTimeout = setTimeout(connectWebSocket, 2000);
  };

  ws.onerror = (error) => {
    console.error('[API] WebSocket error:', error);
  };
}

export function addWebSocketListener(listener: (event: MessageEvent) => void) {
  wsListeners.add(listener);
  // Ensure WebSocket is connected in browser mode
  if (!isTauri()) {
    connectWebSocket();
  }
  return () => wsListeners.delete(listener);
}

// Tauri invoke helper
async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke(cmd, args);
}

// HTTP fetch helper for browser mode
async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${SERVER_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || `HTTP ${response.status}`);
  }

  // Handle empty responses
  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text);
}

// Agent APIs
export async function createAgent(id: string, workingDir: string): Promise<void> {
  if (isTauri()) {
    return tauriInvoke("create_agent", { id, workingDir });
  } else {
    // In browser mode, we pass name=id for simplicity
    await fetchApi('/api/agents', {
      method: 'POST',
      body: JSON.stringify({ name: id, working_dir: workingDir }),
    });
  }
}

export async function killAgent(id: string): Promise<void> {
  if (isTauri()) {
    return tauriInvoke("kill_agent", { id });
  } else {
    await fetchApi(`/api/agents/${id}`, { method: 'DELETE' });
  }
}

export async function sendMessage(id: string, message: string, images?: string[]): Promise<void> {
  if (isTauri()) {
    return tauriInvoke("send_message", { id, message, images: images || [] });
  } else {
    await fetchApi(`/api/agents/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ message, images: images || [] }),
    });
  }
}

export async function listAgents(): Promise<string[]> {
  if (isTauri()) {
    return tauriInvoke("list_agents");
  } else {
    const agents = await fetchApi<Array<{ id: string }>>('/api/agents');
    return agents.map(a => a.id);
  }
}

export interface CliStatus {
  installed: boolean;
  path: string | null;
  version: string | null;
}

export async function getCliStatus(): Promise<CliStatus> {
  if (isTauri()) {
    return tauriInvoke("get_cli_status");
  } else {
    // In browser mode, check server health as a proxy for CLI status
    try {
      await fetchApi('/api/health');
      return { installed: true, path: 'server', version: null };
    } catch {
      return { installed: false, path: null, version: null };
    }
  }
}

// Workspace persistence (browser mode uses localStorage)
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

const WORKSPACE_STORAGE_KEY = 'virtual-agency-workspace';

export async function saveWorkspace(data: WorkspaceData): Promise<void> {
  if (isTauri()) {
    return tauriInvoke("save_workspace", { data });
  } else {
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(data));
  }
}

export async function loadWorkspace(): Promise<WorkspaceData | null> {
  if (isTauri()) {
    return tauriInvoke("load_workspace");
  } else {
    const stored = localStorage.getItem(WORKSPACE_STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  }
}

export async function getWorkspacePath(): Promise<string> {
  if (isTauri()) {
    return tauriInvoke("get_workspace_path_str");
  } else {
    return 'localStorage';
  }
}

// Settings (browser mode uses localStorage)
export interface AppSettings {
  claude_cli_path: string | null;
  theme: string;
  auto_save_enabled: boolean;
  auto_save_interval_seconds: number;
  default_working_directory: string | null;
}

const SETTINGS_STORAGE_KEY = 'virtual-agency-settings';

const DEFAULT_SETTINGS: AppSettings = {
  claude_cli_path: null,
  theme: 'dark',
  auto_save_enabled: true,
  auto_save_interval_seconds: 60,
  default_working_directory: null,
};

export async function saveSettings(settings: AppSettings): Promise<void> {
  if (isTauri()) {
    return tauriInvoke("save_settings", { settings });
  } else {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  }
}

export async function loadSettings(): Promise<AppSettings> {
  if (isTauri()) {
    return tauriInvoke("load_settings");
  } else {
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
    return stored ? { ...DEFAULT_SETTINGS, ...JSON.parse(stored) } : DEFAULT_SETTINGS;
  }
}

export async function getSettingsPath(): Promise<string> {
  if (isTauri()) {
    return tauriInvoke("get_settings_path_str");
  } else {
    return 'localStorage';
  }
}
