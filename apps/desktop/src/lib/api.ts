/**
 * Unified API layer that works in both Tauri (desktop) and browser modes.
 * Automatically detects the environment and uses the appropriate backend.
 */

import type {
  AgentAutomation,
  AgentSpecialty,
  AgentRuntime,
} from "@virtual-agency/shared";

// Server URL for browser mode (resolved dynamically when env vars are not provided).
const ENV_SERVER_URL = import.meta.env.VITE_SERVER_URL as string | undefined;
const ENV_WS_URL = import.meta.env.VITE_WS_URL as string | undefined;
const ENV_BILLING_API_URL = import.meta.env.VITE_BILLING_API_URL as
  | string
  | undefined;
const ENV_CLERK_PUBLISHABLE_KEY = import.meta.env
  .VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
const ENV_NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = import.meta.env
  .NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY as string | undefined;
const HAS_BUILDTIME_CLERK_KEY = Boolean(
  (ENV_CLERK_PUBLISHABLE_KEY && ENV_CLERK_PUBLISHABLE_KEY.trim().length > 0) ||
    (ENV_NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
      ENV_NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.trim().length > 0),
);

const SERVER_URL_STORAGE_KEY = "virtual-agency-server-url";
const AGENT_RUNTIME_STORAGE_KEY = "virtual-agency-agent-runtime-map";
const DEFAULT_SERVER_URL = "http://127.0.0.1:1337";
const SERVER_RESOLVE_COOLDOWN_MS = 15_000;
let resolvedServerUrl: string | null = null;
let resolvingServerUrl: Promise<string> | null = null;
let lastServerResolveFailureAt = 0;

let hostedAuthTokenProvider: (() => Promise<string | null>) | null = null;
let hostedAuthProviderResolvers: Array<() => void> = [];
let hostedAuthProviderState: "unknown" | "available" | "unavailable" =
  HAS_BUILDTIME_CLERK_KEY ? "unknown" : "unavailable";
const HOSTED_AUTH_REQUIRED_PREFIX = "hosted_auth_required";
const HOSTED_AUTH_REQUIRED_MESSAGE =
  "Hosted auth required. Sign in to use Cloud Agents.";

export function setHostedAuthTokenProvider(
  provider: (() => Promise<string | null>) | null,
) {
  hostedAuthTokenProvider = provider;
  hostedAuthProviderState = provider ? "available" : "unavailable";
  const resolvers = hostedAuthProviderResolvers;
  hostedAuthProviderResolvers = [];
  for (const resolve of resolvers) resolve();
}

async function waitForHostedAuthProvider(timeoutMs = 250): Promise<boolean> {
  if (hostedAuthTokenProvider) return true;
  if (hostedAuthProviderState === "unavailable") return false;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, timeoutMs);
    hostedAuthProviderResolvers.push(() => {
      clearTimeout(timeout);
      resolve();
    });
  });
  return Boolean(hostedAuthTokenProvider);
}

function createHostedAuthRequiredError(
  code: "missing_hosted_auth_provider" | "missing_hosted_auth_token",
): Error {
  return new Error(
    `${HOSTED_AUTH_REQUIRED_PREFIX}:${code}:${HOSTED_AUTH_REQUIRED_MESSAGE}`,
  );
}

async function tryGetClerkTokenFallback(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  try {
    const clerk = (window as any).Clerk;
    const token = await clerk?.session?.getToken?.();
    return typeof token === "string" && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

function getBillingApiBaseUrl(): string {
  if (ENV_BILLING_API_URL && ENV_BILLING_API_URL.trim().length > 0) {
    return ENV_BILLING_API_URL.replace(/\/$/, "");
  }
  return "";
}

async function getHostedAuthToken(): Promise<string> {
  if (!hostedAuthTokenProvider && hostedAuthProviderState === "unknown") {
    await waitForHostedAuthProvider();
  }
  if (hostedAuthTokenProvider) {
    const token = await hostedAuthTokenProvider();
    if (token) {
      return token;
    }
  }

  const fallbackToken = await tryGetClerkTokenFallback();
  if (fallbackToken) {
    return fallbackToken;
  }

  if (!hostedAuthTokenProvider) {
    throw createHostedAuthRequiredError("missing_hosted_auth_provider");
  }
  throw createHostedAuthRequiredError("missing_hosted_auth_token");
}

async function getHostedAuthTokenStrict(): Promise<string> {
  const token = await getHostedAuthToken();
  if (!token) {
    throw createHostedAuthRequiredError("missing_hosted_auth_token");
  }
  return token;
}

type AgentRuntimeMap = Record<string, AgentRuntime>;
interface RuntimeQueryOptions {
  includeHosted?: boolean;
}

function loadAgentRuntimeMap(): AgentRuntimeMap {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(AGENT_RUNTIME_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as AgentRuntimeMap;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

function persistAgentRuntimeMap(map: AgentRuntimeMap) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(AGENT_RUNTIME_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

export function setAgentRuntime(id: string, runtime: AgentRuntime) {
  const map = loadAgentRuntimeMap();
  map[id] = runtime;
  persistAgentRuntimeMap(map);
}

export function removeAgentRuntime(id: string) {
  const map = loadAgentRuntimeMap();
  delete map[id];
  persistAgentRuntimeMap(map);
}

export function getAgentRuntime(id: string): AgentRuntime {
  const map = loadAgentRuntimeMap();
  return map[id] === "hosted" ? "hosted" : "local";
}

export function replaceAgentRuntimeMap(next: AgentRuntimeMap) {
  persistAgentRuntimeMap(next);
}

function hasHostedAgentsMapped(): boolean {
  const map = loadAgentRuntimeMap();
  return Object.values(map).some((value) => value === "hosted");
}

function hasLocalAgentsMapped(): boolean {
  const values = Object.values(loadAgentRuntimeMap());
  if (values.length === 0) return true;
  return values.some((value) => value !== "hosted");
}

function shouldIncludeHosted(options?: RuntimeQueryOptions): boolean {
  if (options?.includeHosted === true) return true;
  if (options?.includeHosted === false) return false;
  return hasHostedAgentsMapped();
}

export function isHostedAuthBootError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes(HOSTED_AUTH_REQUIRED_PREFIX) ||
    message.includes("missing_hosted_auth_provider") ||
    message.includes("missing_hosted_auth_token")
  );
}

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

interface ServerUrlResolveOptions {
  forceRescan?: boolean;
  includePortScan?: boolean;
}

function defaultServerCandidates(includePortScan: boolean): string[] {
  const candidates: string[] = [];
  const saved = loadSavedServerUrl();
  if (saved) candidates.push(saved);

  // Always try the primary default first.
  candidates.push(DEFAULT_SERVER_URL);

  // Optional fallback scan for recovery/manual retries.
  if (includePortScan) {
    const ports = Array.from({ length: 13 }, (_, i) => 1338 + i);
    for (const port of ports) {
      candidates.push(`http://127.0.0.1:${port}`);
    }
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

export async function getServerHttpBaseUrl(options: ServerUrlResolveOptions = {}): Promise<string> {
  if (isTauri()) {
    // In Tauri mode we don't use HTTP; requests go through invoke().
    return "";
  }
  if (ENV_SERVER_URL) return ENV_SERVER_URL;
  if (resolvedServerUrl && !options.forceRescan) return resolvedServerUrl;
  if (resolvingServerUrl) return resolvingServerUrl;

  const now = Date.now();
  const withinCooldown =
    !options.forceRescan &&
    lastServerResolveFailureAt > 0 &&
    now - lastServerResolveFailureAt < SERVER_RESOLVE_COOLDOWN_MS;

  if (withinCooldown) {
    return DEFAULT_SERVER_URL;
  }

  resolvingServerUrl = (async () => {
    for (const candidate of defaultServerCandidates(Boolean(options.includePortScan))) {
      // If the saved URL is dead, quickly move on.
      // When the server is up, /api/health responds immediately.
      // eslint-disable-next-line no-await-in-loop
      const ok = await probeServer(candidate);
      if (ok) {
        resolvedServerUrl = candidate;
        lastServerResolveFailureAt = 0;
        persistServerUrl(candidate);
        return candidate;
      }
    }

    lastServerResolveFailureAt = Date.now();
    // Default fallback (used by UI for "waiting for server" states).
    return DEFAULT_SERVER_URL;
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
let wsGeneration = 0;
let hostedPollTimer: ReturnType<typeof setTimeout> | null = null;
let hostedPollingInFlight = false;
let hostedLastSeq = 0;

const EVENT_SEQ_STORAGE_KEY = "virtual-agency-last-event-seq";
let lastEventSeq = 0;
let isReplaying = false;
let pendingDuringReplay: string[] = [];
let seenSeqDuringReplay: Set<number> | null = null;

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

async function pollHostedEventsOnce() {
  if (isTauri()) return;
  if (!hasHostedAgentsMapped()) return;
  if (hostedPollingInFlight) return;

  hostedPollingInFlight = true;
  try {
    const suffix =
      hostedLastSeq > 0
        ? `?since=${encodeURIComponent(String(hostedLastSeq))}`
        : "";
    const payload = await fetchHostedApi<{ latest_seq: number; events: unknown[] }>(
      `/api/hosting/va/api/events${suffix}`,
      { method: "GET" },
    );
    const events = Array.isArray(payload?.events) ? payload.events : [];
    for (const event of events) {
      const seq = (event as { seq?: unknown })?.seq;
      if (typeof seq === "number" && Number.isFinite(seq) && seq > hostedLastSeq) {
        hostedLastSeq = seq;
      }
      handleIncomingWsData(JSON.stringify(event));
    }
    if (
      typeof payload?.latest_seq === "number" &&
      Number.isFinite(payload.latest_seq) &&
      payload.latest_seq > hostedLastSeq
    ) {
      hostedLastSeq = payload.latest_seq;
    }
  } catch (err) {
    if (!isHostedAuthBootError(err)) {
      console.warn("[API] Hosted event poll failed:", err);
    }
  } finally {
    hostedPollingInFlight = false;
  }
}

function ensureHostedEventPolling() {
  if (hostedPollTimer) return;
  const tick = async () => {
    await pollHostedEventsOnce();
    hostedPollTimer = setTimeout(() => {
      void tick();
    }, 1000);
  };
  void tick();
}

function stopHostedEventPolling() {
  if (hostedPollTimer) {
    clearTimeout(hostedPollTimer);
    hostedPollTimer = null;
  }
}

async function replayMissedEvents() {
  if (isTauri()) return;

  const since = lastEventSeq || loadLastEventSeq();
  lastEventSeq = since;
  const seen = seenSeqDuringReplay;

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
        const seq = (ev as { seq?: unknown })?.seq;
        if (seen && typeof seq === "number" && Number.isFinite(seq) && seen.has(seq)) continue;
        handleIncomingWsData(JSON.stringify(ev));
      }
      if (fullPayload && typeof fullPayload.latest_seq === "number") {
        updateLastEventSeq(fullPayload.latest_seq);
      }
      return;
    }

    const events = Array.isArray(payload?.events) ? payload.events : [];
    for (const ev of events) {
      const seq = (ev as { seq?: unknown })?.seq;
      if (seen && typeof seq === "number" && Number.isFinite(seq) && seen.has(seq)) continue;
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
  const generation = ++wsGeneration;
  ws = new WebSocket(wsUrl);
  const socket = ws;

  socket.onopen = () => {
    if (ws !== socket || generation !== wsGeneration) return;
    console.log('[API] WebSocket connected');
    if (wsReconnectTimeout) {
      clearTimeout(wsReconnectTimeout);
      wsReconnectTimeout = null;
    }

    if (wsOutboundQueue.length > 0) {
      const pending = wsOutboundQueue.splice(0, wsOutboundQueue.length);
      for (const payload of pending) {
        try {
          socket.send(payload);
        } catch {
          wsOutboundQueue.unshift(payload);
          break;
        }
      }
    }

    // Replay any missed events since the last seen seq, buffering live WS
    // messages until replay completes to preserve ordering as much as possible.
    isReplaying = true;
    seenSeqDuringReplay = new Set<number>();
    replayMissedEvents()
      .catch(() => {})
      .finally(() => {
        if (ws !== socket || generation !== wsGeneration) return;
        isReplaying = false;
        seenSeqDuringReplay = null;
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

  socket.onmessage = (event) => {
    if (ws !== socket || generation !== wsGeneration) return;
    const data = typeof event.data === "string" ? event.data : String(event.data);
    if (isReplaying) {
      // During replay we buffer most live events to preserve ordering, but terminal IO must
      // stay responsive (otherwise typing feels laggy as echo waits for replay to finish).
      // Let terminal output through immediately.
      try {
        const msg = JSON.parse(data);
        if (typeof msg?.seq === "number" && Number.isFinite(msg.seq)) {
          seenSeqDuringReplay?.add(msg.seq);
        }
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

  socket.onclose = () => {
    if (ws !== socket || generation !== wsGeneration) return;
    console.log('[API] WebSocket disconnected, reconnecting...');
    ws = null;
    wsReconnectTimeout = setTimeout(() => void connectWebSocket(), 2000);
  };

  socket.onerror = (error) => {
    if (ws !== socket || generation !== wsGeneration) return;
    console.error('[API] WebSocket error:', error);
  };
}

export function addWebSocketListener(listener: (event: MessageEvent) => void) {
  wsListeners.add(listener);
  // Ensure WebSocket is connected in browser mode
  if (!isTauri()) {
    if (hasLocalAgentsMapped()) {
      void connectWebSocket();
    }
    ensureHostedEventPolling();
  }
  return () => {
    wsListeners.delete(listener);
    if (wsListeners.size === 0) {
      stopHostedEventPolling();
    }
  };
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
    const errorText = await response.text();
    let message = errorText;
    try {
      const parsed = JSON.parse(errorText) as { error?: unknown; message?: unknown };
      if (typeof parsed?.message === "string" && parsed.message.trim()) {
        message = parsed.message;
      } else if (typeof parsed?.error === "string" && parsed.error.trim()) {
        message = parsed.error;
      }
      if (
        typeof parsed?.error === "string" &&
        parsed.error.trim() &&
        typeof parsed?.message === "string" &&
        parsed.message.trim()
      ) {
        message = `${parsed.error}: ${parsed.message}`;
      }
    } catch {
      // Keep original text when non-JSON errors are returned.
    }
    throw new Error(message || `HTTP ${response.status}`);
  }

  // Handle empty responses
  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text);
}

export async function fetchHostedApi<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const base = getBillingApiBaseUrl();
  const token = await getHostedAuthTokenStrict();
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    let message = errorText;
    try {
      const parsed = JSON.parse(errorText) as { error?: unknown; message?: unknown };
      if (typeof parsed?.message === "string" && parsed.message.trim()) {
        message = parsed.message;
      } else if (typeof parsed?.error === "string" && parsed.error.trim()) {
        message = parsed.error;
      }
      if (
        typeof parsed?.error === "string" &&
        parsed.error.trim() &&
        typeof parsed?.message === "string" &&
        parsed.message.trim()
      ) {
        message = `${parsed.error}: ${parsed.message}`;
      }
    } catch {
      // Keep original text when non-JSON errors are returned.
    }
    throw new Error(message || `HTTP ${response.status}`);
  }

  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text);
}

async function fetchApiForRuntime<T>(
  runtime: AgentRuntime,
  path: string,
  options?: RequestInit,
): Promise<T> {
  if (runtime === "hosted") {
    return fetchHostedApi<T>(`/api/hosting/va${path}`, options);
  }
  return fetchApi<T>(path, options);
}

export async function fetchAgentApi<T>(
  agentId: string,
  path: string,
  options?: RequestInit,
): Promise<T> {
  const runtime = getAgentRuntime(agentId);
  return fetchApiForRuntime<T>(runtime, path, options);
}

export async function getAgentHttpBaseUrl(agentId: string): Promise<string> {
  const runtime = getAgentRuntime(agentId);
  if (runtime === "hosted") {
    const base = getBillingApiBaseUrl();
    return `${base}/api/hosting/va`;
  }
  const localBase = await getServerHttpBaseUrl();
  return localBase || DEFAULT_SERVER_URL;
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
export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";

export interface AgentOptions {
  model?: ClaudeModel | CodexModel | string;
  thinkingEnabled?: boolean; // For Claude extended thinking
  reasoningEffort?: ReasoningEffort; // For Codex reasoning models
  mcpServers?: string[]; // Array of MCP server IDs
  sessionId?: string; // Session ID to resume conversation
  cliType?: CliType; // CLI backend to use (claude or codex)
  specialty?: AgentSpecialty; // Optional system prompt specialization
  runtime?: AgentRuntime; // Local process or hosted VPS runtime
}

// Agent APIs
export async function createAgent(id: string, workingDir: string, options?: AgentOptions): Promise<void> {
  const cliType = options?.cliType || "claude";
  const model = options?.model || (cliType === "codex" ? "gpt-5.3-codex" : "sonnet");
  const thinkingEnabled = options?.thinkingEnabled || false;
  const reasoningEffort = options?.reasoningEffort || "medium";
  const mcpServers = options?.mcpServers || [];
  const sessionId = options?.sessionId;
  const specialty = options?.specialty || "normal";
  const runtime = options?.runtime || "local";

  if (isTauri()) {
    return tauriInvoke("create_agent", { id, workingDir, model, thinkingEnabled, reasoningEffort, mcpServers, cliType, sessionId, specialty });
  } else {
    setAgentRuntime(id, runtime);
    if (runtime === "local" && wsListeners.size > 0) {
      void connectWebSocket();
    }
    // Pass the client-generated ID so the server uses it
    await fetchApiForRuntime<void>(runtime, "/api/agents", {
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
    const runtime = getAgentRuntime(id);
    await fetchApiForRuntime<void>(runtime, `/api/agents/${id}`, { method: "DELETE" });
    removeAgentRuntime(id);
  }
}

export async function stopAgent(id: string): Promise<void> {
  if (isTauri()) {
    return tauriInvoke("stop_agent", { id });
  } else {
    const runtime = getAgentRuntime(id);
    await fetchApiForRuntime<void>(runtime, `/api/agents/${id}/stop`, { method: "POST" });
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

export async function sendMessage(
  id: string,
  message: string,
  images?: string[],
  clientMessageId?: string,
  runtimeOverride?: AgentRuntime,
): Promise<void> {
  if (isTauri()) {
    return tauriInvoke("send_message", { id, message, images: images || [] });
  } else {
    const runtime = runtimeOverride || getAgentRuntime(id);
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

    await fetchApiForRuntime<void>(runtime, `/api/agents/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        message,
        images: imageData,
        client_message_id: clientMessageId,
      }),
    });
  }
}

const INTEGRATIONS_FILE_PATH = ".virtual-agency/integrations.md";

export async function saveIntegrationsMarkdown(id: string, markdown: string): Promise<void> {
  if (isTauri()) {
    return tauriInvoke("save_integrations_markdown", { id, markdown });
  }

  const runtime = getAgentRuntime(id);
  await fetchApiForRuntime<void>(runtime, `/api/files/write/${id}`, {
    method: "POST",
    body: JSON.stringify({
      path: INTEGRATIONS_FILE_PATH,
      content: markdown,
    }),
  });
}

export async function loadIntegrationsMarkdown(id: string): Promise<string> {
  if (isTauri()) {
    return tauriInvoke("load_integrations_markdown", { id });
  }

  try {
    const runtime = getAgentRuntime(id);
    const response = await fetchApiForRuntime<{ content?: string }>(runtime, `/api/files/read/${id}`, {
      method: "POST",
      body: JSON.stringify({ path: INTEGRATIONS_FILE_PATH }),
    });
    return typeof response?.content === "string" ? response.content : "";
  } catch {
    // Missing file is expected before first save.
    return "";
  }
}

export interface NangoConnectSessionResponse {
  session_token: string;
  integration_id: string;
  nango_base_url: string;
  expires_at?: string | null;
  connect_link?: string | null;
}

export interface NangoConnectionInfo {
  connection_id: string;
  integration_id: string;
  end_user_id?: string | null;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface NangoConnectionsResponse {
  end_user_id: string;
  integration_id?: string | null;
  total: number;
  connections: NangoConnectionInfo[];
}

export interface NangoDeleteConnectionResponse {
  ok: boolean;
  connection_id: string;
}

export async function createNangoConnectSession(
  id: string,
  integrationId: string
): Promise<NangoConnectSessionResponse> {
  if (isTauri()) {
    throw new Error("Nango connect flow is only available in browser/server mode.");
  }

  const runtime = getAgentRuntime(id);
  return fetchApiForRuntime<NangoConnectSessionResponse>(
    runtime,
    "/api/integrations/nango/connect-session",
    {
      method: "POST",
      body: JSON.stringify({
        integration_id: integrationId,
        end_user_id: id,
        end_user_display_name: id,
      }),
    }
  );
}

export async function listNangoConnections(
  id: string,
  integrationId?: string
): Promise<NangoConnectionsResponse> {
  if (isTauri()) {
    throw new Error("Nango connection management is only available in browser/server mode.");
  }

  const runtime = getAgentRuntime(id);
  return fetchApiForRuntime<NangoConnectionsResponse>(
    runtime,
    "/api/integrations/nango/connections",
    {
      method: "POST",
      body: JSON.stringify({
        end_user_id: id,
        integration_id: integrationId,
      }),
    }
  );
}

export async function deleteNangoConnection(
  id: string,
  connectionId: string,
  integrationId?: string
): Promise<NangoDeleteConnectionResponse> {
  if (isTauri()) {
    throw new Error("Nango connection management is only available in browser/server mode.");
  }

  const runtime = getAgentRuntime(id);
  return fetchApiForRuntime<NangoDeleteConnectionResponse>(
    runtime,
    "/api/integrations/nango/connections",
    {
      method: "DELETE",
      body: JSON.stringify({
        end_user_id: id,
        connection_id: connectionId,
        integration_id: integrationId,
      }),
    }
  );
}

export async function listAgents(options: RuntimeQueryOptions = {}): Promise<string[]> {
  if (isTauri()) {
    return tauriInvoke("list_agents");
  } else {
    const all = new Set<string>();
    try {
      const local = await fetchApi<Array<{ id: string }>>("/api/agents");
      local.forEach((agent) => all.add(agent.id));
    } catch {
      // ignore local errors
    }
    if (shouldIncludeHosted(options)) {
      try {
        const hosted = await fetchHostedApi<Array<{ id: string }>>("/api/hosting/va/api/agents");
        hosted.forEach((agent) => all.add(agent.id));
      } catch (err) {
        if (isHostedAuthBootError(err)) {
          throw err;
        }
      }
    }
    return Array.from(all);
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
    const runtime = getAgentRuntime(id);
    await fetchApiForRuntime<void>(runtime, `/api/agents/${id}`, {
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

export interface AgentTelegramSettings {
  enabled: boolean;
  polling: boolean;
  connected: boolean;
  has_token: boolean;
  allowed_handle: string;
  allowed_chat_id: number | null;
  allowed_chat_ids: number[];
  send_typing: boolean;
  send_updates: boolean;
  queue_depth: number;
  has_active_turn: boolean;
  last_error: string | null;
  last_update_id: number | null;
}

export interface SetAgentTelegramRequest {
  enabled: boolean;
  bot_token?: string;
  allowed_handle?: string;
  allowed_chat_id?: number;
  send_typing?: boolean;
  send_updates?: boolean;
}

export async function getAgentTelegramSettings(id: string): Promise<AgentTelegramSettings> {
  if (isTauri()) {
    throw new Error("Telegram settings are only available in browser/server mode.");
  }
  const runtime = getAgentRuntime(id);
  return fetchApiForRuntime<AgentTelegramSettings>(runtime, `/api/agents/${id}/telegram`);
}

export async function setAgentTelegramSettings(
  id: string,
  input: SetAgentTelegramRequest
): Promise<AgentTelegramSettings> {
  if (isTauri()) {
    throw new Error("Telegram settings are only available in browser/server mode.");
  }
  const runtime = getAgentRuntime(id);
  return fetchApiForRuntime<AgentTelegramSettings>(runtime, `/api/agents/${id}/telegram`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function deleteAgentTelegramSettings(id: string): Promise<void> {
  if (isTauri()) {
    throw new Error("Telegram settings are only available in browser/server mode.");
  }
  const runtime = getAgentRuntime(id);
  await fetchApiForRuntime<void>(runtime, `/api/agents/${id}/telegram`, {
    method: "DELETE",
  });
}

export interface CliStatus {
  installed: boolean;
  path: string | null;
  version: string | null;
}

export interface CliStatusOptions {
  forceRescan?: boolean;
  includePortScan?: boolean;
}

export async function getCliStatus(options: CliStatusOptions = {}): Promise<CliStatus> {
  if (isTauri()) {
    return tauriInvoke("get_cli_status");
  } else {
    // In browser mode, check local server first, then hosted control-plane health.
    try {
      const base = await getServerHttpBaseUrl({
        forceRescan: options.forceRescan,
        includePortScan: options.includePortScan,
      });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2500);
      try {
        const response = await fetch(`${base}/api/health`, {
          method: "GET",
          signal: controller.signal,
        });
        if (response.ok) {
          return { installed: true, path: "server", version: null };
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      // ignore local health errors and fall back to hosted check
    }

    try {
      const hosted = await fetchHostedApi<HostedServerStateResponse>("/api/hosting/me", {
        method: "GET",
      });
      if (hosted?.server && hosted.server.status !== "deleted") {
        return { installed: true, path: "hosted-server", version: null };
      }
    } catch {
      // ignore hosted errors
    }

    return { installed: false, path: null, version: null };
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
  runtime?: AgentRuntime;
  stay_at_desk?: boolean;
  automations?: AgentAutomation[];
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
  runtime?: AgentRuntime;
}

export async function listAgentDetails(options: RuntimeQueryOptions = {}): Promise<ServerAgentInfo[]> {
  if (isTauri()) {
    return [];
  }
  const result: ServerAgentInfo[] = [];
  try {
    const local = await fetchApi<ServerAgentInfo[]>("/api/agents");
    result.push(...local.map((agent) => ({ ...agent, runtime: "local" as AgentRuntime })));
  } catch {
    // ignore local errors
  }
  if (shouldIncludeHosted(options)) {
    try {
      const hosted = await fetchHostedApi<ServerAgentInfo[]>("/api/hosting/va/api/agents");
      result.push(
        ...hosted.map((agent) => ({ ...agent, runtime: "hosted" as AgentRuntime })),
      );
    } catch (err) {
      if (isHostedAuthBootError(err)) {
        throw err;
      }
    }
  }
  return result;
}

export interface ServerTerminalInfo {
  id: string;
  working_dir: string;
}

export async function listTerminals(options: RuntimeQueryOptions = {}): Promise<ServerTerminalInfo[]> {
  // Browser-only for now; desktop can add a Tauri command later if needed.
  if (isTauri()) return [];
  const result: ServerTerminalInfo[] = [];
  try {
    const local = await fetchApi<ServerTerminalInfo[]>("/api/terminals");
    result.push(...local);
  } catch (err) {
    console.warn("[api] Failed to list terminals:", err);
  }
  if (shouldIncludeHosted(options)) {
    try {
      const hosted = await fetchHostedApi<ServerTerminalInfo[]>("/api/hosting/va/api/terminals");
      result.push(...hosted);
    } catch (err) {
      if (isHostedAuthBootError(err)) {
        throw err;
      }
      console.warn("[api] Failed to list hosted terminals:", err);
    }
  }
  return result;
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
  default_agent_runtime: AgentRuntime;
}

const SETTINGS_STORAGE_KEY = 'virtual-agency-settings';

const DEFAULT_SETTINGS: AppSettings = {
  claude_cli_path: null,
  theme: 'dark',
  auto_save_enabled: true,
  auto_save_interval_seconds: 60,
  default_working_directory: null,
  default_agent_runtime: "local",
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

export interface HostedServerInfo {
  id: string;
  name: string;
  status: string;
  ipAddress: string | null;
  runtimeBaseUrl: string | null;
  hostedApiBaseUrl: string;
  sshPublicKey: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  lastError: string | null;
  pairingCode: string | null;
  pairingExpiresAt: string | null;
  codexAuth: HostedCodexAuthState | null;
}

export interface HostedCodexAuthState {
  status:
    | "not_started"
    | "starting"
    | "awaiting_user"
    | "authorizing"
    | "completed"
    | "failed";
  startedAt: string | null;
  updatedAt: string | null;
  verificationUri: string | null;
  userCode: string | null;
  lastMessage: string | null;
  lastError: string | null;
}

export interface HostedServerStateResponse {
  server: HostedServerInfo | null;
  hostedSubscriptionActive: boolean;
  hostedSubscriptionStatus: string | null;
  hostedSubscriptionPeriodEnd: number | null;
}

export async function getHostedServerState(): Promise<HostedServerStateResponse> {
  if (isTauri()) {
    throw new Error("Hosted server management is browser-only.");
  }
  return fetchHostedApi<HostedServerStateResponse>("/api/hosting/me", {
    method: "GET",
  });
}

export async function createHostedCheckoutSession(): Promise<{ url: string }> {
  if (isTauri()) {
    throw new Error("Hosted checkout is browser-only.");
  }
  return fetchHostedApi<{ url: string }>("/api/hosting/create-checkout-session", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

async function hostedServerAction(path: string): Promise<HostedServerInfo> {
  const payload = await fetchHostedApi<{ server: HostedServerInfo }>(path, {
    method: "POST",
    body: JSON.stringify({}),
  });
  return payload.server;
}

export async function provisionHostedServer(): Promise<HostedServerInfo> {
  return hostedServerAction("/api/hosting/server/provision");
}

export async function startHostedServer(): Promise<HostedServerInfo> {
  return hostedServerAction("/api/hosting/server/start");
}

export async function stopHostedServer(): Promise<HostedServerInfo> {
  return hostedServerAction("/api/hosting/server/stop");
}

export async function rebuildHostedServer(): Promise<HostedServerInfo> {
  return hostedServerAction("/api/hosting/server/rebuild");
}

export async function destroyHostedServer(): Promise<HostedServerInfo> {
  return hostedServerAction("/api/hosting/server/destroy");
}

export async function rotateHostedPairingCode(): Promise<{
  pairingCode: string;
  pairingExpiresAt: string;
}> {
  return fetchHostedApi<{ pairingCode: string; pairingExpiresAt: string }>(
    "/api/hosting/server/pairing-code",
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );
}

export async function startHostedCodexAuth(options: {
  forceRestart?: boolean;
} = {}): Promise<HostedCodexAuthState> {
  const payload = await fetchHostedApi<{ codexAuth: HostedCodexAuthState }>(
    "/api/hosting/server/codex-auth/start",
    {
      method: "POST",
      body: JSON.stringify({
        force: options.forceRestart === true,
      }),
    },
  );
  return payload.codexAuth;
}

export async function getHostedCodexAuthStatus(): Promise<HostedCodexAuthState> {
  const payload = await fetchHostedApi<{ codexAuth: HostedCodexAuthState }>(
    "/api/hosting/server/codex-auth/status",
    {
      method: "GET",
    },
  );
  return payload.codexAuth;
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

export async function browseDirectory(
  path?: string,
  runtime: AgentRuntime = "local",
): Promise<BrowseResponse> {
  const params = path ? `?path=${encodeURIComponent(path)}` : '';
  return fetchApiForRuntime<BrowseResponse>(runtime, `/api/browse${params}`);
}
