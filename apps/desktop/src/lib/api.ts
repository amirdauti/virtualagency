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

// Claude model aliases - these always point to the latest version of each model
// See: claude --help for more info
export type ClaudeModel = "sonnet" | "opus" | "haiku";

export interface AgentOptions {
  model?: ClaudeModel;
  thinkingEnabled?: boolean;
}

// Agent APIs
export async function createAgent(id: string, workingDir: string, options?: AgentOptions): Promise<void> {
  const model = options?.model || "sonnet";
  const thinkingEnabled = options?.thinkingEnabled || false;

  if (isTauri()) {
    return tauriInvoke("create_agent", { id, workingDir, model, thinkingEnabled });
  } else {
    // Pass the client-generated ID so the server uses it
    await fetchApi('/api/agents', {
      method: 'POST',
      body: JSON.stringify({
        id,
        name: id,
        working_dir: workingDir,
        model,
        thinking_enabled: thinkingEnabled,
      }),
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

export async function stopAgent(id: string): Promise<void> {
  if (isTauri()) {
    return tauriInvoke("stop_agent", { id });
  } else {
    await fetchApi(`/api/agents/${id}/stop`, { method: 'POST' });
  }
}

// Maximum image dimensions to send (larger images will be resized)
const MAX_IMAGE_DIMENSION = 2048;

// Helper to resize image if it's too large
async function resizeImageIfNeeded(blob: Blob): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);

    img.onload = () => {
      URL.revokeObjectURL(url);

      const { width, height } = img;

      // If image is within limits, return original
      if (width <= MAX_IMAGE_DIMENSION && height <= MAX_IMAGE_DIMENSION) {
        resolve(blob);
        return;
      }

      // Calculate new dimensions maintaining aspect ratio
      let newWidth = width;
      let newHeight = height;

      if (width > height) {
        if (width > MAX_IMAGE_DIMENSION) {
          newWidth = MAX_IMAGE_DIMENSION;
          newHeight = Math.round((height / width) * MAX_IMAGE_DIMENSION);
        }
      } else {
        if (height > MAX_IMAGE_DIMENSION) {
          newHeight = MAX_IMAGE_DIMENSION;
          newWidth = Math.round((width / height) * MAX_IMAGE_DIMENSION);
        }
      }

      // Create canvas and resize
      const canvas = document.createElement('canvas');
      canvas.width = newWidth;
      canvas.height = newHeight;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(blob); // Fallback to original if canvas fails
        return;
      }

      ctx.drawImage(img, 0, 0, newWidth, newHeight);

      // Convert to blob (use JPEG for better compression on photos)
      canvas.toBlob(
        (resizedBlob) => {
          if (resizedBlob) {
            console.log(`[api] Resized image from ${width}x${height} to ${newWidth}x${newHeight}, size: ${blob.size} -> ${resizedBlob.size}`);
            resolve(resizedBlob);
          } else {
            resolve(blob);
          }
        },
        blob.type === 'image/png' ? 'image/png' : 'image/jpeg',
        0.85 // Quality for JPEG
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image for resizing'));
    };

    img.src = url;
  });
}

// Helper to convert blob URL to base64
async function blobUrlToBase64(blobUrl: string): Promise<{ base64: string; mimeType: string }> {
  const response = await fetch(blobUrl);
  let blob = await response.blob();

  // Resize if needed
  blob = await resizeImageIfNeeded(blob);

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      // Return just the base64 data part (after the comma)
      resolve({
        base64: base64.split(',')[1],
        mimeType: blob.type || 'image/png'
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export async function sendMessage(id: string, message: string, images?: string[]): Promise<void> {
  if (isTauri()) {
    return tauriInvoke("send_message", { id, message, images: images || [] });
  } else {
    // In browser mode, convert blob URLs to base64 (with automatic resizing for large images)
    const imageData: Array<{ data: string; mime_type: string }> = [];
    if (images && images.length > 0) {
      for (const imgPath of images) {
        if (imgPath.startsWith('blob:')) {
          try {
            const { base64, mimeType } = await blobUrlToBase64(imgPath);
            imageData.push({
              data: base64,
              mime_type: mimeType
            });
          } catch (err) {
            console.error('[api] Failed to convert blob to base64:', err);
          }
        }
      }
    }

    await fetchApi(`/api/agents/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ message, images: imageData }),
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

export async function updateAgentSettings(
  id: string,
  model?: ClaudeModel,
  thinkingEnabled?: boolean
): Promise<void> {
  if (isTauri()) {
    return tauriInvoke("update_agent_settings", { id, model, thinkingEnabled });
  } else {
    await fetchApi(`/api/agents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        model,
        thinking_enabled: thinkingEnabled,
      }),
    });
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
    // Let errors propagate so the modal knows the server isn't running
    await fetchApi('/api/health');
    return { installed: true, path: 'server', version: null };
  }
}

// Workspace persistence (browser mode uses localStorage)
export interface SavedAgent {
  id: string;
  name: string;
  working_directory: string;
  position: { x: number; y: number; z: number };
  avatar_id?: string;
  model?: ClaudeModel;
  thinking_enabled?: boolean;
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

// Directory browsing (browser mode only - uses local server)
export interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

export interface BrowseResponse {
  current_path: string;
  parent_path: string | null;
  entries: DirEntry[];
}

export async function browseDirectory(path?: string): Promise<BrowseResponse> {
  const params = path ? `?path=${encodeURIComponent(path)}` : '';
  return fetchApi<BrowseResponse>(`/api/browse${params}`);
}
