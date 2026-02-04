/**
 * Unified API layer that works in both Tauri (desktop) and browser modes.
 * Automatically detects the environment and uses the appropriate backend.
 */

import type { AgentSpecialty } from "@virtual-agency/shared";

// Server URL for browser mode (resolved dynamically when env vars are not provided).
const ENV_SERVER_URL = import.meta.env.VITE_SERVER_URL as string | undefined;
const ENV_WS_URL = import.meta.env.VITE_WS_URL as string | undefined;

const SERVER_URL_STORAGE_KEY = "virtual-agency-server-url";
let resolvedServerUrl: string | null = null;
let resolvingServerUrl: Promise<string> | null = null;

// Detect if running in Tauri (v2 uses __TAURI_INTERNALS__)
export function isTauri(): boolean {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
}

function loadSavedServerUrl(): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const value = localStorage.getItem(SERVER_URL_STORAGE_KEY);
    if (!value) return null;
    return value.startsWith("http://") || value.startsWith("https://") ? value : null;
  } catch {
    return null;
  }
}

function persistServerUrl(url: string) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(SERVER_URL_STORAGE_KEY, url);
  } catch {
    // ignore
  }
}

function defaultServerCandidates(): string[] {
  const candidates: string[] = [];
  const saved = loadSavedServerUrl();
  if (saved) candidates.push(saved);

  // Prefer 1337, but allow fallbacks. The local server will attempt these as well.
  const ports = [1337, 3001, ...Array.from({ length: 13 }, (_, i) => 1338 + i)];
  for (const port of ports) {
    candidates.push(`http://127.0.0.1:${port}`);
  }

  // Unique, preserve order.
  return Array.from(new Set(candidates));
}

async function probeServer(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 700);
    const res = await fetch(`${url}/api/health`, { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

export async function getServerHttpBaseUrl(): Promise<string> {
  if (isTauri()) {
    // In Tauri mode we don't use HTTP; requests go through invoke().
    return "";
  }
  if (ENV_SERVER_URL) return ENV_SERVER_URL;
  if (resolvedServerUrl) return resolvedServerUrl;
  if (resolvingServerUrl) return resolvingServerUrl;

  resolvingServerUrl = (async () => {
    for (const candidate of defaultServerCandidates()) {
      // If the saved URL is dead, quickly move on.
      // When the server is up, /api/health responds immediately.
      // eslint-disable-next-line no-await-in-loop
      const ok = await probeServer(candidate);
      if (ok) {
        resolvedServerUrl = candidate;
        persistServerUrl(candidate);
        return candidate;
      }
    }

    // Default fallback (used by UI for "waiting for server" states).
    return "http://127.0.0.1:1337";
  })();

  try {
    return await resolvingServerUrl;
  } finally {
    resolvingServerUrl = null;
  }
}

export async function getServerWsUrl(): Promise<string> {
  if (isTauri()) return "";
  if (ENV_WS_URL) return ENV_WS_URL;
  const httpBase = await getServerHttpBaseUrl();
  return `${httpBase.replace(/^http/, "ws")}/ws`;
}

// WebSocket connection for browser mode
let ws: WebSocket | null = null;
let wsReconnectTimeout: ReturnType<typeof setTimeout> | null = null;
const wsListeners: Set<(event: MessageEvent) => void> = new Set();
const wsOutboundQueue: string[] = [];

const EVENT_SEQ_STORAGE_KEY = "virtual-agency-last-event-seq";
let lastEventSeq = 0;
let isReplaying = false;
let pendingDuringReplay: string[] = [];

function loadLastEventSeq(): number {
  try {
    if (typeof localStorage === "undefined") return 0;
    const value = localStorage.getItem(EVENT_SEQ_STORAGE_KEY);
    const parsed = value ? Number(value) : 0;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

function persistLastEventSeq(seq: number) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(EVENT_SEQ_STORAGE_KEY, String(seq));
  } catch {
    // ignore
  }
}

function updateLastEventSeq(seq: unknown) {
  if (typeof seq !== "number" || !Number.isFinite(seq) || seq <= 0) return;
  if (seq > lastEventSeq) {
    lastEventSeq = seq;
    persistLastEventSeq(seq);
  }
}

function handleIncomingWsData(data: unknown) {
  const text = typeof data === "string" ? data : String(data);
  try {
    const msg = JSON.parse(text);
    updateLastEventSeq(msg?.seq);
  } catch {
    // ignore
  }

  const fakeEvent = { data: text } as MessageEvent;
  wsListeners.forEach((listener) => listener(fakeEvent));
}

async function replayMissedEvents() {
  if (isTauri()) return;

  const since = lastEventSeq || loadLastEventSeq();
  lastEventSeq = since;

  try {
    const path = since > 0 ? `/api/events?since=${encodeURIComponent(String(since))}` : "/api/events";
    const payload = await fetchApi<{ latest_seq: number; events: unknown[] }>(path);

    // If the server restarted (seq reset), our stored `since` may be ahead of server state.
    // In that case, re-fetch the current buffer from the server and reset our cursor.
    if (since > 0 && typeof payload?.latest_seq === "number" && payload.latest_seq < since) {
      lastEventSeq = 0;
      persistLastEventSeq(0);
      const fullPayload = await fetchApi<{ latest_seq: number; events: unknown[] }>("/api/events");
      const fullEvents = Array.isArray(fullPayload?.events) ? fullPayload.events : [];
      for (const ev of fullEvents) {
        handleIncomingWsData(JSON.stringify(ev));
      }
      if (fullPayload && typeof fullPayload.latest_seq === "number") {
        updateLastEventSeq(fullPayload.latest_seq);
      }
      return;
    }

    const events = Array.isArray(payload?.events) ? payload.events : [];
    for (const ev of events) {
      handleIncomingWsData(JSON.stringify(ev));
    }
    if (payload && typeof payload.latest_seq === "number") {
      updateLastEventSeq(payload.latest_seq);
    }
  } catch (err) {
    console.warn("[API] Failed to replay events:", err);
  }
}

async function connectWebSocket() {
  if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) {
    return;
  }

  const wsUrl = await getServerWsUrl();
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('[API] WebSocket connected');
    if (wsReconnectTimeout) {
      clearTimeout(wsReconnectTimeout);
      wsReconnectTimeout = null;
    }

    if (wsOutboundQueue.length > 0) {
      const pending = wsOutboundQueue.splice(0, wsOutboundQueue.length);
      for (const payload of pending) {
        try {
          ws?.send(payload);
        } catch {
          wsOutboundQueue.unshift(payload);
          break;
        }
      }
    }

    // Replay any missed events since the last seen seq, buffering live WS
    // messages until replay completes to preserve ordering as much as possible.
    isReplaying = true;
    replayMissedEvents()
      .catch(() => {})
      .finally(() => {
        isReplaying = false;
        if (pendingDuringReplay.length > 0) {
          const pending = pendingDuringReplay;
          pendingDuringReplay = [];

          // Best-effort ordering by seq (if present)
          const sorted = pending
            .map((raw) => {
              try {
                const msg = JSON.parse(raw);
                const seq = typeof msg?.seq === "number" ? msg.seq : Number.POSITIVE_INFINITY;
                return { raw, seq };
              } catch {
                return { raw, seq: Number.POSITIVE_INFINITY };
              }
            })
            .sort((a, b) => a.seq - b.seq);

          for (const item of sorted) {
            handleIncomingWsData(item.raw);
          }
        }
      });
  };

  ws.onmessage = (event) => {
    const data = typeof event.data === "string" ? event.data : String(event.data);
    if (isReplaying) {
      // During replay we buffer most live events to preserve ordering, but terminal IO must
      // stay responsive (otherwise typing feels laggy as echo waits for replay to finish).
      // Let terminal output through immediately.
      try {
        const msg = JSON.parse(data);
        if (msg?.type === "terminal-output") {
          handleIncomingWsData(data);
          return;
        }
      } catch {
        // ignore
      }

      pendingDuringReplay.push(data);
      return;
    }
    handleIncomingWsData(data);
  };

  ws.onclose = () => {
    console.log('[API] WebSocket disconnected, reconnecting...');
    ws = null;
    wsReconnectTimeout = setTimeout(() => void connectWebSocket(), 2000);
  };

  ws.onerror = (error) => {
    console.error('[API] WebSocket error:', error);
  };
}

export function addWebSocketListener(listener: (event: MessageEvent) => void) {
  wsListeners.add(listener);
  // Ensure WebSocket is connected in browser mode
  if (!isTauri()) {
    void connectWebSocket();
  }
  return () => wsListeners.delete(listener);
}

export function sendWebSocketMessage(message: unknown): boolean {
  if (isTauri()) return false;
  const payload = JSON.stringify(message);
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    wsOutboundQueue.push(payload);
    void connectWebSocket();
    return true;
  }

  try {
    ws.send(payload);
    return true;
  } catch (err) {
    console.warn("[API] Failed to send WebSocket message:", err);
    return false;
  }
}

// Tauri invoke helper
async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke(cmd, args);
}

// HTTP fetch helper for browser mode
async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const base = await getServerHttpBaseUrl();
  const response = await fetch(`${base}${path}`, {
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

export interface FindAvailablePortResponse {
  port: number;
  start: number;
  end: number;
}

export async function findAvailablePort(
  start: number = 34872,
  end: number = 34972
): Promise<FindAvailablePortResponse> {
  const params = new URLSearchParams({
    start: String(start),
    end: String(end),
  });
  return fetchApi<FindAvailablePortResponse>(`/api/ports/find?${params.toString()}`);
}

// Claude model aliases - these always point to the latest version of each model
// See: claude --help for more info
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

export interface AgentOptions {
  model?: ClaudeModel | CodexModel | string;
  thinkingEnabled?: boolean; // For Claude extended thinking
  reasoningEffort?: ReasoningEffort; // For Codex reasoning models
  mcpServers?: string[]; // Array of MCP server IDs
  sessionId?: string; // Session ID to resume conversation
  cliType?: CliType; // CLI backend to use (claude or codex)
  specialty?: AgentSpecialty; // Optional system prompt specialization
}

// Agent APIs
export async function createAgent(id: string, workingDir: string, options?: AgentOptions): Promise<void> {
  const cliType = options?.cliType || "claude";
  const model = options?.model || (cliType === "codex" ? "gpt-5.2-codex" : "sonnet");
  const thinkingEnabled = options?.thinkingEnabled || false;
  const reasoningEffort = options?.reasoningEffort || "medium";
  const mcpServers = options?.mcpServers || [];
  const sessionId = options?.sessionId;
  const specialty = options?.specialty || "normal";

  if (isTauri()) {
    return tauriInvoke("create_agent", { id, workingDir, model, thinkingEnabled, reasoningEffort, mcpServers, cliType, sessionId, specialty });
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
        reasoning_effort: reasoningEffort,
        mcp_servers: mcpServers,
        cli_type: cliType,
        session_id: sessionId,
        specialty,
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
  options: {
    model?: string;
    thinkingEnabled?: boolean;
    reasoningEffort?: ReasoningEffort;
    mcpServers?: string[];
  }
): Promise<void> {
  if (isTauri()) {
    return tauriInvoke("update_agent_settings", {
      id,
      model: options.model,
      thinkingEnabled: options.thinkingEnabled,
      reasoningEffort: options.reasoningEffort,
      mcpServers: options.mcpServers,
    });
  } else {
    await fetchApi(`/api/agents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        model: options.model,
        thinking_enabled: options.thinkingEnabled,
        reasoning_effort: options.reasoningEffort,
        mcp_servers: options.mcpServers,
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
  status?: "idle" | "thinking" | "working" | "error";
  avatar_id?: string;
  model?: string; // ClaudeModel or CodexModel
  thinking_enabled?: boolean; // For Claude
  reasoning_effort?: ReasoningEffort; // For Codex
  session_id?: string; // CLI session ID for conversation continuity
  mcp_servers?: string[]; // List of MCP server IDs
  cli_type?: CliType; // CLI backend (claude or codex)
  specialty?: AgentSpecialty;
}

export interface WorkspaceData {
  agents: SavedAgent[];
  version: number;
}

export interface ServerAgentInfo {
  id: string;
  name: string;
  working_dir: string;
  model: string;
  thinking_enabled: boolean;
  mcp_servers: string[];
  cli_type: string;
  specialty: string;
  status?: string;
  session_id?: string | null;
}

export async function listAgentDetails(): Promise<ServerAgentInfo[]> {
  if (isTauri()) {
    return [];
  }
  return fetchApi<ServerAgentInfo[]>("/api/agents");
}

export interface ServerTerminalInfo {
  id: string;
  working_dir: string;
}

export async function listTerminals(): Promise<ServerTerminalInfo[]> {
  // Browser-only for now; desktop can add a Tauri command later if needed.
  if (isTauri()) return [];
  try {
    return fetchApi<ServerTerminalInfo[]>("/api/terminals");
  } catch (err) {
    console.warn("[api] Failed to list terminals:", err);
    return [];
  }
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
