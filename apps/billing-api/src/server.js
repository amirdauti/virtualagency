import express from "express";
import Stripe from "stripe";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  clerkClient,
  ClerkExpressRequireAuth,
  ClerkExpressWithAuth,
} from "@clerk/clerk-sdk-node";

const PORT = Number.parseInt(process.env.PORT || "8787", 10);
const APP_URL = process.env.APP_URL || "https://virtualagency.ai";
const BILLING_PUBLIC_URL = process.env.BILLING_PUBLIC_URL || APP_URL;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const STRIPE_PRICE_ID =
  process.env.STRIPE_PRICE_ID || "price_1StBe1GR9CoMLe1tlnlDu4Ik";
const STRIPE_HOSTED_PRICE_ID =
  process.env.STRIPE_HOSTED_PRICE_ID || "price_1T2ea3GR9CoMLe1thilBUjZ2";

const HETZNER_API_TOKEN = process.env.HETZNER_API_TOKEN || "";
const HETZNER_SERVER_TYPE = process.env.HETZNER_SERVER_TYPE || "cpx31";
const HETZNER_LOCATION = process.env.HETZNER_LOCATION || "ash";
const HETZNER_IMAGE = process.env.HETZNER_IMAGE || "ubuntu-24.04";
const HETZNER_SSH_KEY_IDS = (process.env.HETZNER_SSH_KEY_IDS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => Number.parseInt(value, 10))
  .filter((value) => Number.isFinite(value) && value > 0);

const HOSTED_SERVER_PORT = Number.parseInt(
  process.env.HOSTED_SERVER_PORT || "1337",
  10,
);
const HOSTED_CONTROL_PLANE_TOKEN = process.env.HOSTED_CONTROL_PLANE_TOKEN || "";
const HOSTED_STATE_FILE =
  process.env.HOSTED_STATE_FILE || "/var/lib/virtualagency/hosted-state.json";
const VA_SERVER_NPM_PACKAGE =
  process.env.VA_SERVER_NPM_PACKAGE || "@virtualagency/server";
const VA_SERVER_NPM_VERSION = process.env.VA_SERVER_NPM_VERSION || "latest";
const HOSTED_AUTO_UPDATE_ENABLED = !["0", "false", "off", "no"].includes(
  String(process.env.HOSTED_AUTO_UPDATE_ENABLED || "1").trim().toLowerCase(),
);
const HOSTED_AUTO_UPDATE_INTERVAL_MS = Math.max(
  30_000,
  Number.parseInt(process.env.HOSTED_AUTO_UPDATE_INTERVAL_MS || "120000", 10) || 120_000,
);
const HOSTED_AUTO_UPDATE_CONCURRENCY = Math.max(
  1,
  Math.min(
    6,
    Number.parseInt(process.env.HOSTED_AUTO_UPDATE_CONCURRENCY || "2", 10) || 2,
  ),
);
const HOSTED_AUTO_UPDATE_RETRY_DELAY_MS = Math.max(
  60_000,
  Number.parseInt(process.env.HOSTED_AUTO_UPDATE_RETRY_DELAY_MS || "1800000", 10) || 1_800_000,
);
const HOSTED_AUTO_UPDATE_SSH_FALLBACK_ENABLED = !["0", "false", "off", "no"].includes(
  String(process.env.HOSTED_AUTO_UPDATE_SSH_FALLBACK_ENABLED || "1")
    .trim()
    .toLowerCase(),
);
const HOSTED_AUTO_UPDATE_SSH_USER =
  String(process.env.HOSTED_AUTO_UPDATE_SSH_USER || "root").trim() || "root";
const HOSTED_AUTO_UPDATE_SSH_KEY_PATH = String(
  process.env.HOSTED_AUTO_UPDATE_SSH_KEY_PATH || "",
).trim();
const HOSTED_AUTO_UPDATE_SSH_PORT = Math.max(
  1,
  Math.min(65535, Number.parseInt(process.env.HOSTED_AUTO_UPDATE_SSH_PORT || "22", 10) || 22),
);
const HOSTED_AUTO_UPDATE_SSH_CONNECT_TIMEOUT_SEC = Math.max(
  3,
  Number.parseInt(process.env.HOSTED_AUTO_UPDATE_SSH_CONNECT_TIMEOUT_SEC || "8", 10) || 8,
);
const HOSTED_AUTO_UPDATE_SSH_TIMEOUT_MS = Math.max(
  10_000,
  Number.parseInt(process.env.HOSTED_AUTO_UPDATE_SSH_TIMEOUT_MS || "120000", 10) || 120_000,
);
const NPM_VIEW_TIMEOUT_MS = Math.max(
  5_000,
  Number.parseInt(process.env.NPM_VIEW_TIMEOUT_MS || "15000", 10) || 15_000,
);
const execFileAsync = promisify(execFile);

const stripe = STRIPE_SECRET_KEY
  ? new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" })
  : null;

const app = express();
app.disable("x-powered-by");

const missingClerkEnv = [];
if (!process.env.CLERK_SECRET_KEY) missingClerkEnv.push("CLERK_SECRET_KEY");
if (!process.env.CLERK_PUBLISHABLE_KEY)
  missingClerkEnv.push("CLERK_PUBLISHABLE_KEY");
const hasClerk = missingClerkEnv.length === 0;

if (hasClerk) {
  app.use(ClerkExpressWithAuth());
} else {
  console.warn("[billing] Clerk disabled. Missing env:", missingClerkEnv.join(", "));
}

const requireAuth = hasClerk
  ? ClerkExpressRequireAuth()
  : (_req, res) =>
      res.status(503).json({ error: "missing_clerk_env", missing: missingClerkEnv });

const HETZNER_API_BASE = "https://api.hetzner.cloud/v1";

let hostedStateLoaded = false;
let hostedState = {
  users: {},
  rollout: {
    lastObservedPackageVersion: null,
    lastRolloutTargetVersion: null,
    lastRolledOutPackageVersion: null,
    lastRolloutStartedAt: null,
    lastRolloutCompletedAt: null,
    lastRolloutReason: null,
    lastRolloutSummary: null,
    lastRolloutError: null,
  },
};
let hostedStateWriteQueue = Promise.resolve();
let hostedAutoUpdateTimer = null;
let hostedAutoUpdateInFlight = null;
const codexAuthSessions = new Map();
const CODEX_AUTH_ACTIVE_STATUSES = new Set(["starting", "awaiting_user", "authorizing"]);
const CODEX_AUTH_POLL_INTERVAL_MS = Math.max(
  500,
  Number.parseInt(process.env.CODEX_AUTH_POLL_INTERVAL_MS || "1000", 10) || 1000,
);
const CODEX_AUTH_TIMEOUT_MS = Math.max(
  60_000,
  Number.parseInt(process.env.CODEX_AUTH_TIMEOUT_MS || "900000", 10) || 900_000,
);
const HOSTED_RUNTIME_TIMEOUT_MS = Math.max(
  2_000,
  Number.parseInt(process.env.HOSTED_RUNTIME_TIMEOUT_MS || "25000", 10) || 25_000,
);
const HOSTED_EVENTS_TIMEOUT_MS = Math.max(
  5_000,
  Number.parseInt(process.env.HOSTED_EVENTS_TIMEOUT_MS || "30000", 10) || 30_000,
);
const HOSTED_FILE_TREE_TIMEOUT_MS = Math.max(
  10_000,
  Number.parseInt(process.env.HOSTED_FILE_TREE_TIMEOUT_MS || "120000", 10) || 120_000,
);
const HOSTING_PROXY_JSON_LIMIT =
  (process.env.HOSTING_PROXY_JSON_LIMIT || "50mb").trim() || "50mb";
const HOSTED_REBUILD_COMMAND_POLL_INTERVAL_MS = Math.max(
  500,
  Number.parseInt(process.env.HOSTED_REBUILD_COMMAND_POLL_INTERVAL_MS || "1500", 10) || 1_500,
);
const HOSTED_REBUILD_COMMAND_TIMEOUT_MS = Math.max(
  30_000,
  Number.parseInt(process.env.HOSTED_REBUILD_COMMAND_TIMEOUT_MS || "600000", 10) || 600_000,
);
const HOSTED_SSH_KEY_APPLY_TIMEOUT_MS = Math.max(
  10_000,
  Number.parseInt(process.env.HOSTED_SSH_KEY_APPLY_TIMEOUT_MS || "60000", 10) || 60_000,
);

function nowIso() {
  return new Date().toISOString();
}

function randomToken(size = 24) {
  return crypto.randomBytes(size).toString("hex");
}

function randomCode(size = 8) {
  return crypto
    .randomBytes(size)
    .toString("base64")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, size)
    .toUpperCase();
}

function defaultCodexAuthState() {
  return {
    status: "not_started",
    startedAt: null,
    updatedAt: nowIso(),
    verificationUri: null,
    userCode: null,
    lastMessage: null,
    lastError: null,
  };
}

function sanitizeCodexAuthForClient(auth) {
  if (!auth || typeof auth !== "object") return defaultCodexAuthState();
  return {
    status: auth.status || "not_started",
    startedAt: auth.startedAt || null,
    updatedAt: auth.updatedAt || null,
    verificationUri: auth.verificationUri || null,
    userCode: auth.userCode || null,
    lastMessage: auth.lastMessage || null,
    lastError: auth.lastError || null,
  };
}

function getServerCodexAuth(server) {
  if (!server || typeof server !== "object") return defaultCodexAuthState();
  if (!server.codexAuth || typeof server.codexAuth !== "object") {
    server.codexAuth = defaultCodexAuthState();
  }
  return server.codexAuth;
}

function truncateText(value, max = 320) {
  if (typeof value !== "string") return "";
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
}

function stripAnsi(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

async function fetchWithTimeout(url, options = {}, timeoutMs = HOSTED_RUNTIME_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } catch (err) {
    if (err?.name === "AbortError") {
      const timeoutErr = new Error(`hosted_runtime_timeout:${timeoutMs}`);
      timeoutErr.statusCode = 504;
      throw timeoutErr;
    }
    const networkErr = new Error(
      `hosted_runtime_network_error:${truncateText(err?.message || String(err), 280)}`,
    );
    networkErr.statusCode = 502;
    throw networkErr;
  } finally {
    clearTimeout(timer);
  }
}

function extractCodexVerificationUri(text) {
  const match = text.match(/https?:\/\/[^\s)]+/i);
  return match ? match[0] : null;
}

function extractCodexUserCode(text) {
  if (typeof text !== "string" || !text.trim()) return null;

  const normalizeCandidate = (raw) => {
    if (!raw) return null;
    const candidate = String(raw)
      .toUpperCase()
      .replace(/[_\s]+/g, "-")
      .replace(/^[`"'([{<\s]+/, "")
      .replace(/[`"')\]}>.,:;!?\\\s]+$/, "");

    if (candidate.length < 6 || candidate.length > 24) return null;
    if (!/^[A-Z0-9-]+$/.test(candidate)) return null;
    if (
      /^(AUTHORIZATION|AUTHORIZE|AUTHENTICATE|AUTHENTICATION|VERIFICATION|CONFIRMATION|CONTINUE)$/i.test(
        candidate,
      )
    ) {
      return null;
    }
    const compact = candidate.replace(/-/g, "");
    if (!/\d/.test(compact)) return null;
    if (/^\d{9}$/.test(compact)) return compact;
    return candidate.replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  };

  const contextualPatterns = [
    /(?:user\s*code|device\s*code|enter(?:\s+the)?\s+code|code\s*[:=])\s*([`"'([{<\s]*[A-Z0-9][A-Z0-9\s-]{5,30}[`"')\]}>.,:;!?\s]*)/i,
    /(?:paste|enter|input|use)\s+(?:the\s+)?(?:following\s+)?code\s*[:=]?\s*([`"'([{<\s]*[A-Z0-9][A-Z0-9\s-]{5,30}[`"')\]}>.,:;!?\s]*)/i,
  ];
  for (const pattern of contextualPatterns) {
    for (const match of text.matchAll(new RegExp(pattern.source, "gi"))) {
      const normalized = normalizeCandidate(match?.[1]);
      if (normalized) return normalized;
    }
  }

  for (const match of text.matchAll(/\b([A-Z0-9]{3,8}(?:-[A-Z0-9]{3,8}){1,3})\b/gi)) {
    const dashedCandidate = normalizeCandidate(match?.[1]);
    if (dashedCandidate) return dashedCandidate;
  }

  for (const match of text.matchAll(/\b(\d{3}[-\s]?\d{3}[-\s]?\d{3})\b/g)) {
    const groupedCandidate = normalizeCandidate(match?.[1]);
    if (groupedCandidate) return groupedCandidate;
  }

  for (const match of text.matchAll(/\b(\d{9})\b/g)) {
    const standaloneCandidate = normalizeCandidate(match?.[1]);
    if (standaloneCandidate) return standaloneCandidate;
  }

  return null;
}

async function persistCodexAuthSnapshot(userId, snapshot) {
  const userState = await getHostedUserState(userId);
  if (!userState?.server) return null;

  const current = getServerCodexAuth(userState.server);
  const next = {
    ...current,
    ...snapshot,
    updatedAt: nowIso(),
  };

  userState.server.codexAuth = next;
  userState.server.updatedAt = next.updatedAt;
  userState.updatedAt = next.updatedAt;
  await queueHostedStatePersist();
  return sanitizeCodexAuthForClient(next);
}

function pushCodexAuthLogLine(session, line) {
  if (!line) return;
  if (!Array.isArray(session.outputTail)) session.outputTail = [];
  session.outputTail.push(line);
  if (session.outputTail.length > 20) {
    session.outputTail.shift();
  }
}

async function hostedRuntimeRequest(server, method, suffix, body) {
  const normalizedSuffix = suffix.startsWith("/") ? suffix : `/${suffix}`;
  const targetUrl = `${server.runtimeBaseUrl}${normalizedSuffix}`;

  const headers = {
    Accept: "application/json",
  };
  if (server.proxyToken) {
    headers["x-va-hosted-token"] = server.proxyToken;
  }
  const hasBody = !["GET", "HEAD"].includes(String(method || "").toUpperCase());
  if (hasBody) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetchWithTimeout(targetUrl, {
    method,
    headers,
    body: hasBody ? JSON.stringify(body || {}) : undefined,
  });

  const contentType = response.headers.get("content-type") || "";
  const raw = await response.text();
  let parsed = null;
  if (raw && contentType.includes("application/json")) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    const errorMessage =
      (parsed && (parsed.message || parsed.error)) || truncateText(raw || "", 280);
    const err = new Error(
      `hosted_runtime_request_failed:${response.status}:${errorMessage || "unknown_error"}`,
    );
    err.statusCode = response.status;
    throw err;
  }

  if (parsed !== null) return parsed;
  return raw;
}

function buildCodexTerminalId(userId) {
  const digest = crypto.createHash("sha256").update(userId).digest("hex").slice(0, 16);
  return `codex-auth-${digest}`;
}

async function cleanupCodexAuthTerminal(userId, terminalId) {
  if (!terminalId) return;
  try {
    const server = await ensureHostedServerAccess(userId);
    await hostedRuntimeRequest(server, "DELETE", `/api/terminals/${encodeURIComponent(terminalId)}`);
  } catch (err) {
    if (err?.statusCode === 404) return;
    console.warn(
      `[hosting] failed cleaning codex auth terminal for ${userId}:`,
      err?.message || err,
    );
  }
}

function clearCodexAuthSessionTimers(session) {
  if (!session) return;
  if (session.pollTimer) {
    clearInterval(session.pollTimer);
    session.pollTimer = null;
  }
  if (session.timeoutTimer) {
    clearTimeout(session.timeoutTimer);
    session.timeoutTimer = null;
  }
}

async function finishCodexAuthSession(userId, status, overrides = {}) {
  const session = codexAuthSessions.get(userId);
  if (!session) return;

  clearCodexAuthSessionTimers(session);
  codexAuthSessions.delete(userId);

  const terminalId = session.terminalId;
  await cleanupCodexAuthTerminal(userId, terminalId);

  const snapshot = {
    status,
    verificationUri: session.verificationUri || null,
    userCode: session.userCode || null,
    lastMessage:
      overrides.lastMessage ??
      session.lastMessage ??
      (status === "completed" ? "Codex authentication completed." : "Codex authentication failed."),
    lastError:
      overrides.lastError !== undefined
        ? overrides.lastError
        : status === "completed"
          ? null
          : session.lastError || "codex_auth_failed",
  };

  await persistCodexAuthSnapshot(userId, snapshot);
}

function stopCodexAuthSession(userId, reason = "cancelled") {
  void finishCodexAuthSession(userId, "failed", {
    lastError: reason,
    lastMessage: `Codex auth stopped: ${reason}`,
  });
}

function handleCodexAuthOutput(userId, chunk, isStderr = false) {
  const session = codexAuthSessions.get(userId);
  if (!session) return;

  const text = stripAnsi(String(chunk || ""));
  const lines = text
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return;

  let changed = false;
  for (const line of lines) {
    pushCodexAuthLogLine(session, line);
    const verificationUri = extractCodexVerificationUri(line);
    const userCode = extractCodexUserCode(line);

    if (verificationUri && verificationUri !== session.verificationUri) {
      session.verificationUri = verificationUri;
      changed = true;
    }
    if (userCode && userCode !== session.userCode) {
      session.userCode = userCode;
      changed = true;
    }

    if (isStderr && /error|failed|denied/i.test(line)) {
      session.lastError = truncateText(line, 400);
      changed = true;
    }
    session.lastMessage = truncateText(line, 400);
  }

  if (session.verificationUri || session.userCode) {
    if (session.status !== "awaiting_user") {
      session.status = "awaiting_user";
      changed = true;
    }
  } else if (session.status === "starting") {
    session.status = "authorizing";
    changed = true;
  }

  if (!changed) return;
  session.updatedAt = nowIso();
  void persistCodexAuthSnapshot(userId, {
    status: session.status,
    verificationUri: session.verificationUri || null,
    userCode: session.userCode || null,
    lastMessage: session.lastMessage || null,
    lastError: session.lastError || null,
  });
}

async function pollHostedCodexAuthSession(userId) {
  const session = codexAuthSessions.get(userId);
  if (!session) return;

  const userState = await getHostedUserState(userId);
  const server = userState?.server;
  if (!server?.runtimeBaseUrl || server.status === "deleted") {
    await finishCodexAuthSession(userId, "failed", {
      lastError: "server_not_ready",
      lastMessage: "Hosted VPS is not reachable for Codex auth.",
    });
    return;
  }

  try {
    const since = Number.isFinite(session.lastSeq) ? session.lastSeq : 0;
    const payload = await hostedRuntimeRequest(
      server,
      "GET",
      `/api/events?since=${encodeURIComponent(String(since))}`,
    );

    const latestSeq = Number.isFinite(payload?.latest_seq)
      ? payload.latest_seq
      : Number.isFinite(session.lastSeq)
        ? session.lastSeq
        : 0;
    const events = Array.isArray(payload?.events) ? payload.events : [];

    session.lastSeq = latestSeq;
    session.pollErrors = 0;

    for (const event of events) {
      if (event?.type !== "terminal-output") continue;
      if (event?.terminal_id !== session.terminalId) continue;

      const chunk = String(event?.data || "");
      if (!chunk) continue;

      handleCodexAuthOutput(userId, chunk, false);
      const normalizedChunk = stripAnsi(chunk);
      session.exitBuffer = `${session.exitBuffer || ""}${normalizedChunk}`.slice(-256);
      const exitMatch = session.exitBuffer.match(/__VA_CODEX_AUTH_EXIT__:(\d+)/);
      if (!exitMatch) continue;

      const exitCode = Number.parseInt(exitMatch[1], 10);
      if (Number.isFinite(exitCode) && exitCode === 0) {
        await finishCodexAuthSession(userId, "completed", {
          lastError: null,
          lastMessage: "Codex authentication completed.",
        });
      } else {
        await finishCodexAuthSession(userId, "failed", {
          lastError: session.lastError || `codex_login_exit_${exitMatch[1]}`,
          lastMessage: "Codex authentication failed.",
        });
      }
      return;
    }
  } catch (err) {
    session.pollErrors = (session.pollErrors || 0) + 1;
    const message = truncateText(err?.message || String(err), 400);
    session.lastError = message;
    session.lastMessage = "Unable to read Codex auth status from hosted server.";
    session.updatedAt = nowIso();
    if (session.pollErrors >= 5) {
      await finishCodexAuthSession(userId, "failed", {
        lastError: message,
        lastMessage: session.lastMessage,
      });
      return;
    }
    await persistCodexAuthSnapshot(userId, {
      status: session.status,
      verificationUri: session.verificationUri || null,
      userCode: session.userCode || null,
      lastMessage: session.lastMessage,
      lastError: session.lastError,
    });
  }
}

async function startHostedCodexDeviceAuth(userId, options = {}) {
  const forceRestart = options?.forceRestart === true;
  const userState = await getHostedUserState(userId);
  const server = userState?.server;
  if (!server?.id) {
    throw new Error("server_not_provisioned");
  }
  if (!server.ipAddress) {
    throw new Error("server_not_ready");
  }
  if (server.status === "deleted") {
    throw new Error("server_deleted");
  }
  if (server.status !== "ready" && server.status !== "running") {
    throw new Error("server_not_ready");
  }

  const existing = codexAuthSessions.get(userId);
  const existingIsActive = Boolean(
    existing && CODEX_AUTH_ACTIVE_STATUSES.has(existing.status),
  );
  if (existingIsActive && !forceRestart) {
    return sanitizeCodexAuthForClient(getServerCodexAuth(server));
  }

  if (existing) {
    await finishCodexAuthSession(userId, "failed", {
      lastError: "superseded",
      lastMessage: existingIsActive
        ? "Active Codex auth session restarted by user request."
        : "Previous Codex auth session replaced by a new request.",
    });
  }

  const startedAt = nowIso();
  const terminalId = buildCodexTerminalId(userId);
  const session = {
    terminalId,
    lastSeq: 0,
    pollErrors: 0,
    pollTimer: null,
    timeoutTimer: null,
    status: "starting",
    startedAt,
    updatedAt: startedAt,
    verificationUri: null,
    userCode: null,
    lastMessage: "Starting Codex device authentication on hosted VPS...",
    lastError: null,
    outputTail: [],
    exitBuffer: "",
  };
  codexAuthSessions.set(userId, session);

  await persistCodexAuthSnapshot(userId, {
    status: "starting",
    startedAt,
    verificationUri: null,
    userCode: null,
    lastMessage: session.lastMessage,
    lastError: null,
  });

  try {
    const seed = await hostedRuntimeRequest(server, "GET", "/api/events");
    session.lastSeq = Number.isFinite(seed?.latest_seq) ? seed.latest_seq : 0;

    await cleanupCodexAuthTerminal(userId, terminalId);
    await hostedRuntimeRequest(server, "POST", "/api/terminals", {
      id: terminalId,
      working_dir: "/home/va",
      cols: 120,
      rows: 36,
    });

    const command =
      "export HOME=/home/va; export PATH=/usr/local/bin:/usr/bin:/bin:$PATH; codex login --device-auth; __VA_CODEX_AUTH_EXIT__=$?; printf '\\n__VA_CODEX_AUTH_EXIT__:%s\\n' \"$__VA_CODEX_AUTH_EXIT__\"";
    await hostedRuntimeRequest(
      server,
      "POST",
      `/api/terminals/${encodeURIComponent(terminalId)}/input`,
      { data: `${command}\n` },
    );

    session.status = "authorizing";
    session.lastMessage = "Waiting for Codex device code from hosted VPS...";
    session.updatedAt = nowIso();
    await persistCodexAuthSnapshot(userId, {
      status: session.status,
      verificationUri: null,
      userCode: null,
      lastMessage: session.lastMessage,
      lastError: null,
    });

    session.pollTimer = setInterval(() => {
      void pollHostedCodexAuthSession(userId);
    }, CODEX_AUTH_POLL_INTERVAL_MS);

    session.timeoutTimer = setTimeout(() => {
      void finishCodexAuthSession(userId, "failed", {
        lastError: "timeout",
        lastMessage: "Codex authentication timed out. Try again.",
      });
    }, CODEX_AUTH_TIMEOUT_MS);

    void pollHostedCodexAuthSession(userId);
  } catch (err) {
    const message = truncateText(err?.message || String(err), 400);
    await finishCodexAuthSession(userId, "failed", {
      lastError: message,
      lastMessage: "Codex auth process failed to start.",
    });
    throw err;
  }

  return sanitizeCodexAuthForClient(getServerCodexAuth(server));
}

function sanitizeServerForClient(server) {
  if (!server) return null;
  return {
    id: server.id,
    name: server.name,
    status: server.status,
    ipAddress: server.ipAddress || null,
    runtimeBaseUrl: server.runtimeBaseUrl || null,
    hostedApiBaseUrl: "/api/hosting/va",
    sshPublicKey: server.sshPublicKey || null,
    createdAt: server.createdAt || null,
    updatedAt: server.updatedAt || null,
    lastError: server.lastError || null,
    packageVersion: server.packageVersion || null,
    packageVersionUpdatedAt: server.packageVersionUpdatedAt || null,
    lastAutoUpdateAttemptAt: server.lastAutoUpdateAttemptAt || null,
    lastAutoUpdateError: server.lastAutoUpdateError || null,
    pairingCode: server.pairingCode || null,
    pairingExpiresAt: server.pairingExpiresAt || null,
    codexAuth: sanitizeCodexAuthForClient(server.codexAuth),
  };
}

function normalizeHostedRolloutState(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    lastObservedPackageVersion:
      typeof source.lastObservedPackageVersion === "string"
        ? source.lastObservedPackageVersion
        : null,
    lastRolloutTargetVersion:
      typeof source.lastRolloutTargetVersion === "string"
        ? source.lastRolloutTargetVersion
        : null,
    lastRolledOutPackageVersion:
      typeof source.lastRolledOutPackageVersion === "string"
        ? source.lastRolledOutPackageVersion
        : null,
    lastRolloutStartedAt:
      typeof source.lastRolloutStartedAt === "string" ? source.lastRolloutStartedAt : null,
    lastRolloutCompletedAt:
      typeof source.lastRolloutCompletedAt === "string"
        ? source.lastRolloutCompletedAt
        : null,
    lastRolloutReason:
      typeof source.lastRolloutReason === "string" ? source.lastRolloutReason : null,
    lastRolloutSummary: source.lastRolloutSummary || null,
    lastRolloutError: typeof source.lastRolloutError === "string" ? source.lastRolloutError : null,
  };
}

function normalizeHostedServerState(server) {
  if (!server || typeof server !== "object") return server;
  return {
    ...server,
    packageVersion:
      typeof server.packageVersion === "string" && server.packageVersion.trim()
        ? server.packageVersion.trim()
        : null,
    packageVersionUpdatedAt:
      typeof server.packageVersionUpdatedAt === "string"
        ? server.packageVersionUpdatedAt
        : null,
    lastAutoUpdateAttemptAt:
      typeof server.lastAutoUpdateAttemptAt === "string"
        ? server.lastAutoUpdateAttemptAt
        : null,
    lastAutoUpdateError:
      typeof server.lastAutoUpdateError === "string" ? server.lastAutoUpdateError : null,
    codexAuth: sanitizeCodexAuthForClient(server.codexAuth),
  };
}

function normalizeHostedUsersState(users) {
  if (!users || typeof users !== "object") return {};
  const normalized = {};
  for (const [userId, userState] of Object.entries(users)) {
    if (!userState || typeof userState !== "object") continue;
    normalized[userId] = {
      ...userState,
      updatedAt: typeof userState.updatedAt === "string" ? userState.updatedAt : nowIso(),
      server: normalizeHostedServerState(userState.server || null),
    };
  }
  return normalized;
}

async function ensureHostedStateLoaded() {
  if (hostedStateLoaded) return;
  try {
    const raw = await fs.readFile(HOSTED_STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      hostedState = {
        users: normalizeHostedUsersState(parsed.users),
        rollout: normalizeHostedRolloutState(parsed.rollout),
      };
    }
  } catch (err) {
    if (err && err.code !== "ENOENT") {
      console.warn("[hosting] Failed to read hosted state file:", err);
    }
  }
  hostedStateLoaded = true;
}

async function persistHostedState() {
  await fs.mkdir(path.dirname(HOSTED_STATE_FILE), { recursive: true });
  const tmpPath = `${HOSTED_STATE_FILE}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(hostedState, null, 2), "utf8");
  await fs.rename(tmpPath, HOSTED_STATE_FILE);
}

function queueHostedStatePersist() {
  hostedStateWriteQueue = hostedStateWriteQueue
    .then(() => persistHostedState())
    .catch((err) => {
      console.error("[hosting] Failed to persist hosted state:", err);
    });
  return hostedStateWriteQueue;
}

async function getHostedUserState(userId) {
  await ensureHostedStateLoaded();
  if (!hostedState.users[userId]) {
    hostedState.users[userId] = {
      updatedAt: nowIso(),
      server: null,
    };
  }
  return hostedState.users[userId];
}

function getHostedRolloutState() {
  if (!hostedState.rollout || typeof hostedState.rollout !== "object") {
    hostedState.rollout = normalizeHostedRolloutState(null);
  } else {
    hostedState.rollout = normalizeHostedRolloutState(hostedState.rollout);
  }
  return hostedState.rollout;
}

function slugifyUserId(userId) {
  return String(userId)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 26);
}

function mergePrivateMetadata(currentMeta, updates) {
  return {
    ...(currentMeta || {}),
    ...updates,
  };
}

async function updateUserPrivateMetadata(userId, updates) {
  const user = await clerkClient.users.getUser(userId);
  const nextMeta = mergePrivateMetadata(user.privateMetadata || {}, updates);
  await clerkClient.users.updateUser(userId, {
    privateMetadata: nextMeta,
  });
}

function isSubscriptionActive(meta) {
  const status = meta?.subscriptionStatus;
  if (status !== "active" && status !== "trialing") return false;
  const periodEnd = meta?.currentPeriodEnd;
  if (typeof periodEnd !== "number") return true;
  return periodEnd * 1000 > Date.now();
}

function isHostedSubscriptionActive(meta) {
  const status = meta?.hostedServerSubscriptionStatus;
  if (status !== "active" && status !== "trialing") return false;
  const periodEnd = meta?.hostedServerCurrentPeriodEnd;
  if (typeof periodEnd !== "number") return true;
  return periodEnd * 1000 > Date.now();
}

function isSubscriptionStatusActive(status) {
  return status === "active" || status === "trialing";
}

function isHostedSubscriptionPlan(sub) {
  if (sub?.metadata?.plan === "hosted_server") return true;
  const items = Array.isArray(sub?.items?.data) ? sub.items.data : [];
  return items.some((item) => item?.price?.id === STRIPE_HOSTED_PRICE_ID);
}

async function hetznerRequest(method, pathname, body) {
  if (!HETZNER_API_TOKEN) {
    throw new Error("missing_hetzner_api_token");
  }

  const response = await fetch(`${HETZNER_API_BASE}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${HETZNER_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  const payload = text ? safeJsonParse(text) : null;

  if (!response.ok) {
    const message = payload?.error?.message || text || `Hetzner API ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shellSingleQuote(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

async function runHostedRootSshUpgrade(server, packageSpecifier) {
  if (!HOSTED_AUTO_UPDATE_SSH_FALLBACK_ENABLED) {
    throw new Error("hosted_root_ssh_upgrade_disabled");
  }

  const host = String(server?.ipAddress || "").trim();
  if (!host) {
    throw new Error("hosted_root_ssh_upgrade_missing_ip");
  }

  if (!HOSTED_AUTO_UPDATE_SSH_KEY_PATH) {
    throw new Error("hosted_root_ssh_upgrade_missing_key_path");
  }

  const remotePackage = `${VA_SERVER_NPM_PACKAGE}@${packageSpecifier}`;
  const quotedPackage = shellSingleQuote(remotePackage);
  const remoteCommand = [
    "set -euo pipefail",
    `PKG=${quotedPackage}`,
    "if [ -x /usr/local/bin/virtualagency-upgrade.sh ]; then",
    "  /usr/local/bin/virtualagency-upgrade.sh \"$PKG\"",
    "else",
    "  npm install -g \"$PKG\"",
    "fi",
    "systemctl restart virtualagency-server",
  ].join("; ");

  const sshArgs = [
    "-i",
    HOSTED_AUTO_UPDATE_SSH_KEY_PATH,
    "-p",
    String(HOSTED_AUTO_UPDATE_SSH_PORT),
    "-o",
    "BatchMode=yes",
    "-o",
    "IdentitiesOnly=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    `ConnectTimeout=${HOSTED_AUTO_UPDATE_SSH_CONNECT_TIMEOUT_SEC}`,
    `${HOSTED_AUTO_UPDATE_SSH_USER}@${host}`,
    remoteCommand,
  ];

  try {
    await execFileAsync("ssh", sshArgs, {
      timeout: HOSTED_AUTO_UPDATE_SSH_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });
  } catch (err) {
    const stdout = truncateText(stripAnsi(String(err?.stdout || "")).replace(/\s+/g, " ").trim(), 220);
    const stderr = truncateText(stripAnsi(String(err?.stderr || "")).replace(/\s+/g, " ").trim(), 220);
    const reason = truncateText(err?.message || String(err), 220);
    const details = [reason, stderr, stdout].filter(Boolean).join(" | ");
    throw new Error(`hosted_root_ssh_upgrade_failed:${details || "ssh_command_failed"}`);
  }
}

async function runHostedVaSshUpgrade(server, packageSpecifier) {
  const host = String(server?.ipAddress || "").trim();
  if (!host) {
    throw new Error("hosted_va_ssh_upgrade_missing_ip");
  }

  const tempDir = await fs.mkdtemp("/tmp/va-rollout-");
  const keyPath = path.join(tempDir, "id_ed25519");
  try {
    await execFileAsync(
      "ssh-keygen",
      ["-q", "-t", "ed25519", "-f", keyPath, "-N", "", "-C", `va-rollout-${randomToken(6)}`],
      { timeout: 15_000, maxBuffer: 1024 * 1024 },
    );

    const publicKey = String(await fs.readFile(`${keyPath}.pub`, "utf8")).trim();
    if (!isLikelySshPublicKey(publicKey)) {
      throw new Error("generated_invalid_public_key");
    }

    await addHostedAuthorizedKey(server, publicKey);

    const remotePackage = `${VA_SERVER_NPM_PACKAGE}@${packageSpecifier}`;
    const quotedPackage = shellSingleQuote(remotePackage);
    const remoteCommand = [
      "set -euo pipefail",
      `PKG=${quotedPackage}`,
      "if [ -x /usr/local/bin/virtualagency-upgrade.sh ]; then",
      "  sudo -n /usr/local/bin/virtualagency-upgrade.sh \"$PKG\"",
      "else",
      "  sudo -n npm install -g \"$PKG\"",
      "fi",
      "( sudo -n systemctl restart virtualagency-server || pkill -f '^virtual-agency-server( |$)' || true )",
    ].join("; ");

    const sshArgs = [
      "-i",
      keyPath,
      "-p",
      String(HOSTED_AUTO_UPDATE_SSH_PORT),
      "-o",
      "BatchMode=yes",
      "-o",
      "IdentitiesOnly=yes",
      "-o",
      "StrictHostKeyChecking=accept-new",
      "-o",
      `ConnectTimeout=${HOSTED_AUTO_UPDATE_SSH_CONNECT_TIMEOUT_SEC}`,
      `va@${host}`,
      remoteCommand,
    ];

    await execFileAsync("ssh", sshArgs, {
      timeout: HOSTED_AUTO_UPDATE_SSH_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });
  } catch (err) {
    const stdout = truncateText(stripAnsi(String(err?.stdout || "")).replace(/\s+/g, " ").trim(), 220);
    const stderr = truncateText(stripAnsi(String(err?.stderr || "")).replace(/\s+/g, " ").trim(), 220);
    const reason = truncateText(err?.message || String(err), 220);
    const details = [reason, stderr, stdout].filter(Boolean).join(" | ");
    throw new Error(`hosted_va_ssh_upgrade_failed:${details || "ssh_command_failed"}`);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

function isLikelySshPublicKey(value) {
  const text = String(value || "").trim();
  if (text.length < 40 || text.length > 8192) return false;
  return /^(ssh-(rsa|ed25519)|ecdsa-sha2-nistp(?:256|384|521)) [A-Za-z0-9+/]+={0,3}(?: .*)?$/.test(
    text,
  );
}

async function addHostedAuthorizedKey(server, publicKey) {
  const key = String(publicKey || "").trim();
  if (!isLikelySshPublicKey(key)) {
    throw new Error("invalid_ssh_public_key");
  }

  const terminalId = `hosted-sshkey-${randomToken(6)}`;
  const marker = `__VA_SSH_KEY_DONE_${randomToken(4)}__`;
  const markerRegex = new RegExp(`${marker}:(\\d+)`);
  const quotedKey = shellSingleQuote(key);
  const command = [
    `KEY=${quotedKey}`,
    "mkdir -p \"$HOME/.ssh\"",
    "chmod 700 \"$HOME/.ssh\"",
    "touch \"$HOME/.ssh/authorized_keys\"",
    "chmod 600 \"$HOME/.ssh/authorized_keys\"",
    "grep -qxF \"$KEY\" \"$HOME/.ssh/authorized_keys\" || echo \"$KEY\" >> \"$HOME/.ssh/authorized_keys\"",
    "STATUS=$?",
    `echo '${marker}:'\"$STATUS\"`,
  ].join("; ");

  let since = 0;
  let outputTail = "";
  let sawCompletion = false;
  let exitCode = null;
  let lastPollError = null;

  try {
    const snapshot = await hostedRuntimeRequest(server, "GET", "/api/events?since=0");
    since = Number.isFinite(snapshot?.latest_seq) ? Number(snapshot.latest_seq) : 0;

    await hostedRuntimeRequest(server, "POST", "/api/terminals", {
      id: terminalId,
      working_dir: "/home/va",
      cols: 120,
      rows: 30,
    });
    await hostedRuntimeRequest(
      server,
      "POST",
      `/api/terminals/${encodeURIComponent(terminalId)}/input`,
      { data: `${command}\n` },
    );

    const startedAt = Date.now();
    while (Date.now() - startedAt < HOSTED_SSH_KEY_APPLY_TIMEOUT_MS) {
      await sleep(HOSTED_REBUILD_COMMAND_POLL_INTERVAL_MS);

      let payload;
      try {
        payload = await hostedRuntimeRequest(
          server,
          "GET",
          `/api/events?since=${encodeURIComponent(String(since))}`,
        );
        lastPollError = null;
      } catch (err) {
        lastPollError = err;
        continue;
      }

      const latestSeq = Number(payload?.latest_seq);
      if (Number.isFinite(latestSeq) && latestSeq > since) {
        since = latestSeq;
      }

      const events = Array.isArray(payload?.events) ? payload.events : [];
      for (const event of events) {
        if (event?.type !== "terminal-output") continue;
        if (event?.terminal_id !== terminalId) continue;
        const chunk = String(event?.data || "");
        if (!chunk) continue;

        outputTail = `${outputTail}${chunk}`;
        if (outputTail.length > 8_000) {
          outputTail = outputTail.slice(-8_000);
        }

        const match = outputTail.match(markerRegex);
        if (match) {
          sawCompletion = true;
          exitCode = Number.parseInt(match[1], 10);
          break;
        }
      }

      if (sawCompletion) break;
    }
  } finally {
    try {
      await hostedRuntimeRequest(
        server,
        "DELETE",
        `/api/terminals/${encodeURIComponent(terminalId)}`,
      );
    } catch {
      // ignore cleanup failures
    }
  }

  if (!sawCompletion || !Number.isFinite(exitCode)) {
    const detail = lastPollError?.message || "timed_out_waiting_for_ssh_key_apply_marker";
    throw new Error(`hosted_ssh_key_apply_timeout:${detail}`);
  }

  if (exitCode !== 0) {
    const compact = stripAnsi(outputTail).replace(/\s+/g, " ").trim();
    const tail = compact.length > 320 ? `...${compact.slice(-320)}` : compact;
    throw new Error(`hosted_ssh_key_apply_failed:exit_${exitCode}:${tail || "no_output"}`);
  }
}

async function runHostedInPlaceRebuild(server, packageVersion = VA_SERVER_NPM_VERSION) {
  const terminalId = `hosted-rebuild-${randomToken(6)}`;
  const marker = `__VA_REBUILD_DONE_${randomToken(4)}__`;
  const permissionMarker = "__VA_REBUILD_PERM__:missing_sudo_upgrade_privilege";
  const packageSpec = `${VA_SERVER_NPM_PACKAGE}@${packageVersion}`;
  const quotedPackageSpec = shellSingleQuote(packageSpec);
  const markerRegex = new RegExp(`${marker}:(\\d+)`);

  // Emit a deterministic marker before restarting the service, so callers can observe completion
  // even though the service restart momentarily interrupts hosted API requests.
  const command = [
    `PKG=${quotedPackageSpec}`,
    "STATUS=0",
    "CAN_SUDO=0",
    "INSTALL_DONE=0",
    "if command -v sudo >/dev/null 2>&1; then",
    "  if [ -x /usr/local/bin/virtualagency-upgrade.sh ]; then",
    "    sudo -n /usr/local/bin/virtualagency-upgrade.sh \"$PKG\" && CAN_SUDO=1 && INSTALL_DONE=1 || STATUS=$?",
    "  else",
    "    sudo -n npm install -g \"$PKG\" && CAN_SUDO=1 && INSTALL_DONE=1 || STATUS=$?",
    "  fi",
    "fi",
    "if [ \"$INSTALL_DONE\" -eq 0 ]; then",
    "  PREFIX=$(npm config get prefix 2>/dev/null || true)",
    "  if [ -n \"$PREFIX\" ] && [ -w \"$PREFIX\" ]; then",
    "    npm install -g \"$PKG\" && STATUS=0 && INSTALL_DONE=1 || STATUS=$?",
    "  else",
    "    STATUS=243",
    "    echo '" + permissionMarker + " prefix='\"${PREFIX:-unknown}\"",
    "  fi",
    "fi",
    `echo '${marker}:'\"$STATUS\"`,
    "sleep 1",
    "if [ \"$STATUS\" -eq 0 ]; then ( ( [ \"$CAN_SUDO\" -eq 1 ] && sudo -n systemctl restart virtualagency-server ) || pkill -f '^virtual-agency-server( |$)' || true ); fi",
  ].join("; ");

  let since = 0;
  let outputTail = "";
  let sawCompletion = false;
  let exitCode = null;
  let lastPollError = null;

  try {
    const snapshot = await hostedRuntimeRequest(server, "GET", "/api/events?since=0");
    since = Number.isFinite(snapshot?.latest_seq) ? Number(snapshot.latest_seq) : 0;

    await hostedRuntimeRequest(server, "POST", "/api/terminals", {
      id: terminalId,
      working_dir: "/opt/virtualagency",
      cols: 120,
      rows: 40,
    });
    await hostedRuntimeRequest(
      server,
      "POST",
      `/api/terminals/${encodeURIComponent(terminalId)}/input`,
      { data: `${command}\n` },
    );

    const startedAt = Date.now();
    while (Date.now() - startedAt < HOSTED_REBUILD_COMMAND_TIMEOUT_MS) {
      await sleep(HOSTED_REBUILD_COMMAND_POLL_INTERVAL_MS);

      let payload;
      try {
        payload = await hostedRuntimeRequest(
          server,
          "GET",
          `/api/events?since=${encodeURIComponent(String(since))}`,
        );
        lastPollError = null;
      } catch (err) {
        // During service restart, brief polling failures are expected.
        lastPollError = err;
        continue;
      }

      const latestSeq = Number(payload?.latest_seq);
      if (Number.isFinite(latestSeq) && latestSeq > since) {
        since = latestSeq;
      }

      const events = Array.isArray(payload?.events) ? payload.events : [];
      for (const event of events) {
        if (event?.type !== "terminal-output") continue;
        if (event?.terminal_id !== terminalId) continue;
        const chunk = String(event?.data || "");
        if (!chunk) continue;

        outputTail = `${outputTail}${chunk}`;
        if (outputTail.length > 12_000) {
          outputTail = outputTail.slice(-12_000);
        }

        const match = outputTail.match(markerRegex);
        if (match) {
          sawCompletion = true;
          exitCode = Number.parseInt(match[1], 10);
          break;
        }
      }

      if (sawCompletion) break;
    }
  } finally {
    try {
      await hostedRuntimeRequest(
        server,
        "DELETE",
        `/api/terminals/${encodeURIComponent(terminalId)}`,
      );
    } catch {
      // ignore cleanup failures
    }
  }

  if (!sawCompletion || !Number.isFinite(exitCode)) {
    const detail =
      lastPollError?.message || "timed_out_waiting_for_rebuild_completion_marker";
    throw new Error(`hosted_in_place_rebuild_timeout:${detail}`);
  }

  if (exitCode !== 0) {
    const compact = stripAnsi(outputTail).replace(/\s+/g, " ").trim();
    if (compact.includes(permissionMarker)) {
      throw new Error(
        "hosted_in_place_rebuild_failed:missing_sudo_upgrade_privilege:run_one_time_root_repair",
      );
    }
    const tail = compact.length > 320 ? `...${compact.slice(-320)}` : compact;
    throw new Error(`hosted_in_place_rebuild_failed:exit_${exitCode}:${tail || "no_output"}`);
  }
}

function parseNpmViewVersionOutput(stdout) {
  const raw = String(stdout || "").trim();
  if (!raw) return null;
  const parsed = safeJsonParse(raw);
  if (typeof parsed === "string" && parsed.trim()) return parsed.trim();
  if (Array.isArray(parsed)) {
    const first = parsed.find((value) => typeof value === "string" && value.trim());
    if (typeof first === "string") return first.trim();
  }
  const unquoted = raw.replace(/^"+|"+$/g, "").trim();
  return unquoted || null;
}

async function fetchLatestPublishedServerPackageVersion() {
  const { stdout } = await execFileAsync(
    "npm",
    ["view", VA_SERVER_NPM_PACKAGE, "version", "--json"],
    { timeout: NPM_VIEW_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
  );
  const version = parseNpmViewVersionOutput(stdout);
  if (!version) {
    throw new Error(`npm_view_empty_version:${VA_SERVER_NPM_PACKAGE}`);
  }
  return version;
}

async function resolveDesiredHostedPackageTarget({ allowLatestFallback = false } = {}) {
  if (VA_SERVER_NPM_VERSION !== "latest") {
    return {
      packageSpecifier: VA_SERVER_NPM_VERSION,
      trackedVersion: VA_SERVER_NPM_VERSION,
    };
  }

  try {
    const latestVersion = await fetchLatestPublishedServerPackageVersion();
    return { packageSpecifier: latestVersion, trackedVersion: latestVersion };
  } catch (err) {
    if (allowLatestFallback) {
      console.warn(
        "[hosting] failed to resolve latest npm version; falling back to npm tag latest:",
        err?.message || err,
      );
      return { packageSpecifier: "latest", trackedVersion: null };
    }
    throw err;
  }
}

function isHostedServerAutoUpdateCandidate(server) {
  if (!server || !server.runtimeBaseUrl) return false;
  const status = String(server.status || "").toLowerCase();
  if (!status) return false;
  if (["deleted", "stopped", "stopping", "provisioning", "starting"].includes(status)) {
    return false;
  }
  return true;
}

async function rebuildHostedServerForUser(userId, packageSpecifier, trackedVersion, reason) {
  const userState = await getHostedUserState(userId);
  const server = userState.server;
  if (!server) throw new Error("server_not_provisioned");
  const statusBeforeUpdate = server.status || "ready";

  stopCodexAuthSession(userId, `auto_update:${reason}`);
  server.lastAutoUpdateAttemptAt = nowIso();
  server.lastAutoUpdateError = null;
  server.status = "working";
  server.updatedAt = nowIso();
  userState.updatedAt = server.updatedAt;
  await queueHostedStatePersist();

  try {
    try {
      await runHostedInPlaceRebuild(server, packageSpecifier);
    } catch (err) {
      const message = String(err?.message || "");
      const shouldTrySshFallback =
        HOSTED_AUTO_UPDATE_SSH_FALLBACK_ENABLED &&
        (message.includes("missing_sudo_upgrade_privilege") ||
          message.includes("hosted_in_place_rebuild_timeout") ||
          message.includes("hosted_runtime_network_error"));
      if (!shouldTrySshFallback) {
        throw err;
      }
      try {
        await runHostedVaSshUpgrade(server, packageSpecifier);
      } catch (vaSshErr) {
        if (HOSTED_AUTO_UPDATE_SSH_FALLBACK_ENABLED && HOSTED_AUTO_UPDATE_SSH_KEY_PATH) {
          try {
            await runHostedRootSshUpgrade(server, packageSpecifier);
          } catch (rootSshErr) {
            throw new Error(
              `hosted_upgrade_fallback_failed:runtime=${truncateText(message, 180)} | va=${truncateText(vaSshErr?.message || String(vaSshErr), 180)} | root=${truncateText(rootSshErr?.message || String(rootSshErr), 180)}`,
            );
          }
        } else {
          throw new Error(
            `hosted_upgrade_fallback_failed:runtime=${truncateText(message, 180)} | va=${truncateText(vaSshErr?.message || String(vaSshErr), 180)}`,
          );
        }
      }
    }
    if (trackedVersion) {
      server.packageVersion = trackedVersion;
      server.packageVersionUpdatedAt = nowIso();
    } else {
      server.packageVersion = null;
      server.packageVersionUpdatedAt = nowIso();
    }
    server.lastError = null;
    server.lastAutoUpdateError = null;
    server.updatedAt = nowIso();
    userState.updatedAt = server.updatedAt;
    await queueHostedStatePersist();

    await sleep(1_500);
    await syncHostedServerStatus(userId);
    return { userId, ok: true };
  } catch (err) {
    server.status =
      statusBeforeUpdate && statusBeforeUpdate !== "working" ? statusBeforeUpdate : "ready";
    server.lastAutoUpdateError = truncateText(err?.message || String(err), 500);
    server.lastError = truncateText(err?.message || String(err), 500);
    server.updatedAt = nowIso();
    userState.updatedAt = server.updatedAt;
    await queueHostedStatePersist();
    try {
      await syncHostedServerStatus(userId);
    } catch {
      // keep prior status when sync is unavailable
    }
    throw err;
  }
}

async function runHostedAutoUpdateRollout({ force = false, reason = "interval" } = {}) {
  await ensureHostedStateLoaded();
  const rolloutState = getHostedRolloutState();

  const target = await resolveDesiredHostedPackageTarget({ allowLatestFallback: false });
  rolloutState.lastObservedPackageVersion = target.trackedVersion;
  rolloutState.lastRolloutTargetVersion = target.trackedVersion;
  rolloutState.lastRolloutReason = reason;
  rolloutState.lastRolloutStartedAt = nowIso();
  rolloutState.lastRolloutCompletedAt = null;
  rolloutState.lastRolloutError = null;

  const candidates = [];
  let totalServers = 0;
  let upToDate = 0;
  let skipped = 0;

  for (const [userId, userState] of Object.entries(hostedState.users || {})) {
    const server = userState?.server || null;
    if (!server || server.status === "deleted") continue;
    totalServers += 1;

    if (!isHostedServerAutoUpdateCandidate(server)) {
      skipped += 1;
      continue;
    }

    if (
      !force &&
      server.lastAutoUpdateError &&
      typeof server.lastAutoUpdateAttemptAt === "string"
    ) {
      const lastAttempt = Date.parse(server.lastAutoUpdateAttemptAt);
      if (Number.isFinite(lastAttempt)) {
        const ageMs = Date.now() - lastAttempt;
        if (ageMs >= 0 && ageMs < HOSTED_AUTO_UPDATE_RETRY_DELAY_MS) {
          skipped += 1;
          continue;
        }
      }
    }

    if (!force && server.packageVersion && server.packageVersion === target.trackedVersion) {
      upToDate += 1;
      continue;
    }

    candidates.push(userId);
  }

  const failures = [];
  let updated = 0;

  if (candidates.length > 0) {
    let cursor = 0;
    const workers = Array.from(
      { length: Math.min(HOSTED_AUTO_UPDATE_CONCURRENCY, candidates.length) },
      async () => {
        while (true) {
          const index = cursor++;
          if (index >= candidates.length) break;
          const userId = candidates[index];
          try {
            await rebuildHostedServerForUser(
              userId,
              target.packageSpecifier,
              target.trackedVersion,
              reason,
            );
            updated += 1;
          } catch (err) {
            failures.push({
              userId,
              error: truncateText(err?.message || String(err), 320),
            });
          }
        }
      },
    );
    await Promise.all(workers);
  }

  rolloutState.lastRolloutCompletedAt = nowIso();
  const summary = {
    reason,
    targetVersion: target.trackedVersion,
    totalServers,
    candidates: candidates.length,
    updated,
    upToDate,
    skipped,
    failed: failures.length,
    failures,
  };
  rolloutState.lastRolloutSummary = summary;
  if (failures.length === 0 && target.trackedVersion) {
    rolloutState.lastRolledOutPackageVersion = target.trackedVersion;
  } else if (failures.length > 0) {
    rolloutState.lastRolloutError = `failed_updates:${failures.length}`;
  }
  await queueHostedStatePersist();
  return summary;
}

async function triggerHostedAutoUpdateRollout(options = {}) {
  if (hostedAutoUpdateInFlight) {
    return hostedAutoUpdateInFlight;
  }

  hostedAutoUpdateInFlight = (async () => {
    try {
      return await runHostedAutoUpdateRollout(options);
    } catch (err) {
      const rolloutState = getHostedRolloutState();
      rolloutState.lastRolloutCompletedAt = nowIso();
      rolloutState.lastRolloutError = truncateText(err?.message || String(err), 500);
      await queueHostedStatePersist();
      throw err;
    } finally {
      hostedAutoUpdateInFlight = null;
    }
  })();

  return hostedAutoUpdateInFlight;
}

function startHostedAutoUpdateScheduler() {
  if (!HOSTED_AUTO_UPDATE_ENABLED) return;
  if (hostedAutoUpdateTimer) return;

  const tick = async () => {
    hostedAutoUpdateTimer = null;
    try {
      const summary = await triggerHostedAutoUpdateRollout({ reason: "interval" });
      if (summary?.updated > 0 || summary?.failed > 0) {
        console.log("[hosting] auto-update rollout:", summary);
      }
    } catch (err) {
      console.error("[hosting] auto-update rollout failed:", err?.message || err);
    } finally {
      hostedAutoUpdateTimer = setTimeout(tick, HOSTED_AUTO_UPDATE_INTERVAL_MS);
    }
  };

  hostedAutoUpdateTimer = setTimeout(tick, 20_000);
  console.log(
    `[hosting] auto-update scheduler enabled (interval=${HOSTED_AUTO_UPDATE_INTERVAL_MS}ms, concurrency=${HOSTED_AUTO_UPDATE_CONCURRENCY}, retryDelay=${HOSTED_AUTO_UPDATE_RETRY_DELAY_MS}ms, sshFallback=${HOSTED_AUTO_UPDATE_SSH_FALLBACK_ENABLED ? "on" : "off"}, sshKey=${HOSTED_AUTO_UPDATE_SSH_KEY_PATH ? "configured" : "missing"})`,
  );
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function buildCloudInit({ bootstrapToken, proxyToken, userId }) {
  const escapedPackage = `${VA_SERVER_NPM_PACKAGE}@${VA_SERVER_NPM_VERSION}`;
  const callbackUrl = `${BILLING_PUBLIC_URL.replace(/\/$/, "")}/api/hosting/internal/bootstrap-report`;

  return `#!/bin/bash
set -euo pipefail

exec > >(tee /var/log/virtualagency-bootstrap.log) 2>&1

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y curl ca-certificates gnupg ufw

if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

if ! id -u va >/dev/null 2>&1; then
  useradd -m -s /bin/bash va
fi

mkdir -p /opt/virtualagency/workspace
mkdir -p /etc/virtualagency
chown -R va:va /opt/virtualagency

npm install -g ${escapedPackage} @openai/codex @anthropic-ai/claude-code

cat > /usr/local/bin/virtualagency-upgrade.sh << 'UPGRADE_EOF'
#!/bin/bash
set -euo pipefail

PKG="$1"
if [ -z "$PKG" ]; then
  PKG="${escapedPackage}"
fi
case "$PKG" in
  @virtualagency/server@*|@virtualagency/server)
    ;;
  *)
    echo "Refusing unexpected package: $PKG" >&2
    exit 2
    ;;
esac

npm install -g "$PKG"
UPGRADE_EOF

chmod 755 /usr/local/bin/virtualagency-upgrade.sh
cat > /etc/sudoers.d/virtualagency-upgrade << 'SUDOERS_EOF'
va ALL=(root) NOPASSWD: /usr/local/bin/virtualagency-upgrade.sh *
SUDOERS_EOF
chmod 440 /etc/sudoers.d/virtualagency-upgrade

if [ ! -f /home/va/.ssh/id_ed25519 ]; then
  su - va -c 'mkdir -p ~/.ssh && chmod 700 ~/.ssh && ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N "" -C "virtualagency-${userId}"'
fi

cat > /etc/virtualagency/server.env << 'ENV_EOF'
WORKSPACE_DIR=/opt/virtualagency/workspace
VIRTUAL_AGENCY_PORT=${HOSTED_SERVER_PORT}
VIRTUAL_AGENCY_BIND_HOST=0.0.0.0
VA_HOSTED_PROXY_TOKEN=${proxyToken}
ENV_EOF

cat > /etc/systemd/system/virtualagency-server.service << 'SERVICE_EOF'
[Unit]
Description=Virtual Agency Hosted Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=va
Group=va
WorkingDirectory=/opt/virtualagency
EnvironmentFile=/etc/virtualagency/server.env
ExecStart=/usr/bin/env virtual-agency-server --port ${HOSTED_SERVER_PORT}
Restart=always
RestartSec=5
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
SERVICE_EOF

cat > /usr/local/bin/virtualagency-watchdog.sh << 'WATCHDOG_EOF'
#!/bin/bash
set -euo pipefail

HEALTH_URL="http://127.0.0.1:${HOSTED_SERVER_PORT}/api/health"

if ! timeout 8s curl -fsS "$HEALTH_URL" >/dev/null; then
  logger -t virtualagency-watchdog "health check failed; restarting virtualagency-server"
  systemctl restart virtualagency-server
fi
WATCHDOG_EOF

chmod 755 /usr/local/bin/virtualagency-watchdog.sh

cat > /etc/systemd/system/virtualagency-watchdog.service << 'WATCHDOG_SERVICE_EOF'
[Unit]
Description=Virtual Agency Hosted Runtime Watchdog
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/virtualagency-watchdog.sh
WATCHDOG_SERVICE_EOF

cat > /etc/systemd/system/virtualagency-watchdog.timer << 'WATCHDOG_TIMER_EOF'
[Unit]
Description=Run Virtual Agency Hosted Runtime Watchdog

[Timer]
OnBootSec=2min
OnUnitActiveSec=45s
Unit=virtualagency-watchdog.service
AccuracySec=10s
Persistent=true

[Install]
WantedBy=timers.target
WATCHDOG_TIMER_EOF

ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 1337:1350/tcp
ufw --force enable

systemctl daemon-reload
systemctl enable virtualagency-server
systemctl restart virtualagency-server
systemctl enable virtualagency-watchdog.timer
systemctl start virtualagency-watchdog.timer

SSH_PUB=$(cat /home/va/.ssh/id_ed25519.pub | tr -d '\n')

curl -sS -X POST '${callbackUrl}' \\
  -H 'Content-Type: application/json' \\
  -d '{"token":"${bootstrapToken}","status":"ready","sshPublicKey":"'"\${SSH_PUB}"'"}' || true
`;
}

async function createHostedServerForUser(userId) {
  const userState = await getHostedUserState(userId);

  if (userState.server && userState.server.status !== "deleted") {
    return sanitizeServerForClient(userState.server);
  }

  const bootstrapToken = randomToken(18);
  const proxyToken = randomToken(24);
  const pairingCode = randomCode(8);
  const now = nowIso();
  const userSlug = slugifyUserId(userId) || "user";
  const serverName = `va-${userSlug}`.slice(0, 62);

  const requestBody = {
    name: serverName,
    server_type: HETZNER_SERVER_TYPE,
    image: HETZNER_IMAGE,
    location: HETZNER_LOCATION,
    start_after_create: true,
    labels: {
      managed_by: "virtualagency",
      clerk_user_id: userId,
    },
    user_data: buildCloudInit({ bootstrapToken, proxyToken, userId }),
  };

  if (HETZNER_SSH_KEY_IDS.length > 0) {
    requestBody.ssh_keys = HETZNER_SSH_KEY_IDS;
  }

  const payload = await hetznerRequest("POST", "/servers", requestBody);
  const server = payload?.server || {};
  const ipv4 = server?.public_net?.ipv4?.ip || null;

  userState.server = {
    id: String(server.id),
    name: server.name || serverName,
    status: "provisioning",
    ipAddress: ipv4,
    runtimeBaseUrl: ipv4 ? `http://${ipv4}:${HOSTED_SERVER_PORT}` : null,
    sshPublicKey: null,
    bootstrapToken,
    proxyToken,
    pairingCode,
    pairingExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    codexAuth: defaultCodexAuthState(),
    packageVersion: VA_SERVER_NPM_VERSION === "latest" ? null : VA_SERVER_NPM_VERSION,
    packageVersionUpdatedAt: VA_SERVER_NPM_VERSION === "latest" ? null : now,
    lastAutoUpdateAttemptAt: null,
    lastAutoUpdateError: null,
    createdAt: now,
    updatedAt: now,
    lastError: null,
  };
  userState.updatedAt = now;

  await queueHostedStatePersist();
  return sanitizeServerForClient(userState.server);
}

async function syncHostedServerStatus(userId) {
  const userState = await getHostedUserState(userId);
  const server = userState.server;
  if (!server || !server.id) return null;

  try {
    const payload = await hetznerRequest("GET", `/servers/${server.id}`);
    const remote = payload?.server;
    const ipv4 = remote?.public_net?.ipv4?.ip || null;

    server.ipAddress = ipv4;
    server.runtimeBaseUrl = ipv4 ? `http://${ipv4}:${HOSTED_SERVER_PORT}` : null;

    const remoteStatus = String(remote?.status || "unknown");
    if (remoteStatus === "running" && server.status !== "ready") {
      // Keep bootstrap status unless we've already been marked ready.
      server.status = server.sshPublicKey ? "ready" : "bootstrapping";
    } else if (remoteStatus === "off") {
      server.status = "stopped";
    } else if (remoteStatus && remoteStatus !== "unknown") {
      server.status = remoteStatus;
    }

    // Clear stale transient errors once we can successfully talk to Hetzner again.
    server.lastError = null;
    server.updatedAt = nowIso();
    userState.updatedAt = server.updatedAt;
    await queueHostedStatePersist();
    return sanitizeServerForClient(server);
  } catch (err) {
    server.lastError = err?.message || String(err);
    server.updatedAt = nowIso();
    await queueHostedStatePersist();
    return sanitizeServerForClient(server);
  }
}

async function hostedServerAction(userId, action) {
  const userState = await getHostedUserState(userId);
  const server = userState.server;
  if (!server || !server.id) {
    throw new Error("server_not_provisioned");
  }

  if (action === "rebuild") {
    const target = await resolveDesiredHostedPackageTarget({ allowLatestFallback: true });
    stopCodexAuthSession(userId, "server_rebuild");
    server.status = "working";
    server.updatedAt = nowIso();
    userState.updatedAt = server.updatedAt;
    await queueHostedStatePersist();

    try {
      await runHostedInPlaceRebuild(server, target.packageSpecifier);
      server.packageVersion = target.trackedVersion;
      server.packageVersionUpdatedAt = nowIso();
      server.lastError = null;
      server.updatedAt = nowIso();
      userState.updatedAt = server.updatedAt;
      await queueHostedStatePersist();
      await sleep(1_500);

      const synced = await syncHostedServerStatus(userId);
      return synced || sanitizeServerForClient(server);
    } catch (err) {
      server.status = "error";
      server.lastError = truncateText(err?.message || String(err), 500);
      server.updatedAt = nowIso();
      userState.updatedAt = server.updatedAt;
      await queueHostedStatePersist();
      throw err;
    }
  }

  if (action === "destroy") {
    stopCodexAuthSession(userId, "server_destroyed");
    await hetznerRequest("DELETE", `/servers/${server.id}`);
    userState.server = {
      ...server,
      status: "deleted",
      updatedAt: nowIso(),
    };
    userState.updatedAt = userState.server.updatedAt;
    await queueHostedStatePersist();
    return sanitizeServerForClient(userState.server);
  }

  const apiAction =
    action === "start"
      ? "poweron"
      : action === "stop"
        ? "poweroff"
        : null;

  if (!apiAction) {
    throw new Error("unsupported_action");
  }

  await hetznerRequest("POST", `/servers/${server.id}/actions/${apiAction}`);
  server.status = action === "start" ? "starting" : "stopping";
  server.updatedAt = nowIso();
  userState.updatedAt = server.updatedAt;
  await queueHostedStatePersist();

  return sanitizeServerForClient(server);
}

async function destroyHostedServerIfProvisioned(userId, reason = "subscription_inactive") {
  const userState = await getHostedUserState(userId);
  if (!userState?.server?.id || userState.server.status === "deleted") {
    return false;
  }

  try {
    await hostedServerAction(userId, "destroy");
    console.log(`[hosting] auto-destroyed server for ${userId} (${reason})`);
    return true;
  } catch (err) {
    const message = err?.message || String(err);
    console.error(
      `[hosting] failed to auto-destroy server for ${userId} (${reason}): ${message}`,
    );
    return false;
  }
}

async function getUserWithMeta(userId) {
  const user = await clerkClient.users.getUser(userId);
  return {
    user,
    meta: user.privateMetadata || {},
  };
}

function ensureHostedServerAccess(userId) {
  return getHostedUserState(userId).then((state) => {
    const server = state.server;
    if (!server || !server.runtimeBaseUrl) {
      throw new Error("server_not_ready");
    }
    if (server.status === "deleted") {
      throw new Error("server_deleted");
    }
    return server;
  });
}

function ensureHostedEnabled() {
  if (!HETZNER_API_TOKEN) {
    const err = new Error("missing_hetzner_api_token");
    err.statusCode = 503;
    throw err;
  }
}

function hasValidControlPlaneToken(req) {
  if (!HOSTED_CONTROL_PLANE_TOKEN) return true;
  return req.headers["x-control-plane-token"] === HOSTED_CONTROL_PLANE_TOKEN;
}

// Stripe webhook must use raw body (must come before json() for this route)
app.post("/api/billing/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  if (!stripe) {
    return res.status(500).send("Missing STRIPE_SECRET_KEY");
  }
  if (!STRIPE_WEBHOOK_SECRET) {
    return res.status(500).send("Missing STRIPE_WEBHOOK_SECRET");
  }
  if (!hasClerk) {
    return res.status(500).send(`Missing ${missingClerkEnv.join(" / ")}`);
  }

  const sig = req.headers["stripe-signature"];
  if (!sig || typeof sig !== "string") {
    return res.status(400).send("Missing Stripe signature");
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("[billing] webhook signature verification failed:", err?.message || err);
    return res.status(400).send("Invalid signature");
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const clerkUserId = session.client_reference_id || session.metadata?.clerkUserId;
        const customerId = session.customer;
        const subscriptionId = session.subscription;
        const plan = session.metadata?.plan;

        if (!clerkUserId || typeof clerkUserId !== "string") break;
        if (!customerId || typeof customerId !== "string") break;

        await stripe.customers.update(customerId, {
          metadata: { clerkUserId },
        });

        let subscription = null;
        if (subscriptionId && typeof subscriptionId === "string") {
          subscription = await stripe.subscriptions.retrieve(subscriptionId);
        }

        if (plan === "hosted_server") {
          await updateUserPrivateMetadata(clerkUserId, {
            hostedServerStripeCustomerId: customerId,
            hostedServerSubscriptionId:
              typeof subscriptionId === "string" ? subscriptionId : null,
            hostedServerSubscriptionStatus: subscription?.status || "active",
            hostedServerCurrentPeriodEnd: subscription?.current_period_end || null,
            hostedServerCancelAtPeriodEnd:
              subscription?.cancel_at_period_end || false,
          });
        } else {
          await updateUserPrivateMetadata(clerkUserId, {
            stripeCustomerId: customerId,
            stripeSubscriptionId: typeof subscriptionId === "string" ? subscriptionId : null,
            subscriptionStatus: subscription?.status || "active",
            currentPeriodEnd: subscription?.current_period_end || null,
            cancelAtPeriodEnd: subscription?.cancel_at_period_end || false,
          });
        }

        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const customerId = sub.customer;
        if (!customerId || typeof customerId !== "string") break;

        const customer = await stripe.customers.retrieve(customerId);
        const clerkUserId =
          customer && !customer.deleted ? customer.metadata?.clerkUserId : null;

        if (!clerkUserId || typeof clerkUserId !== "string") break;

        if (isHostedSubscriptionPlan(sub)) {
          await updateUserPrivateMetadata(clerkUserId, {
            hostedServerStripeCustomerId: customerId,
            hostedServerSubscriptionId: sub.id,
            hostedServerSubscriptionStatus: sub.status,
            hostedServerCurrentPeriodEnd: sub.current_period_end,
            hostedServerCancelAtPeriodEnd: sub.cancel_at_period_end,
          });

          if (!isSubscriptionStatusActive(sub.status)) {
            await destroyHostedServerIfProvisioned(
              clerkUserId,
              `stripe_${event.type}:${sub.status}`,
            );
          }
        } else {
          await updateUserPrivateMetadata(clerkUserId, {
            stripeCustomerId: customerId,
            stripeSubscriptionId: sub.id,
            subscriptionStatus: sub.status,
            currentPeriodEnd: sub.current_period_end,
            cancelAtPeriodEnd: sub.cancel_at_period_end,
          });
        }

        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object;
        const customerId = invoice.customer;
        const subscriptionId = invoice.subscription;
        if (!customerId || typeof customerId !== "string") break;
        if (!subscriptionId || typeof subscriptionId !== "string") break;

        const customer = await stripe.customers.retrieve(customerId);
        const clerkUserId =
          customer && !customer.deleted ? customer.metadata?.clerkUserId : null;
        if (!clerkUserId || typeof clerkUserId !== "string") break;

        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        if (!isHostedSubscriptionPlan(sub)) break;

        await updateUserPrivateMetadata(clerkUserId, {
          hostedServerStripeCustomerId: customerId,
          hostedServerSubscriptionId: sub.id,
          hostedServerSubscriptionStatus: sub.status,
          hostedServerCurrentPeriodEnd: sub.current_period_end,
          hostedServerCancelAtPeriodEnd: sub.cancel_at_period_end,
        });

        await destroyHostedServerIfProvisioned(
          clerkUserId,
          `stripe_invoice.payment_failed:${sub.status}`,
        );
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.error("[billing] webhook handler error:", err);
    return res.status(500).send("Webhook handler error");
  }

  res.json({ received: true });
});

app.use(express.json({ limit: HOSTING_PROXY_JSON_LIMIT }));

app.get("/api/billing/me", requireAuth, async (req, res) => {
  const userId = req.auth?.userId;
  if (!userId) return res.status(401).json({ error: "unauthorized" });

  const { meta } = await getUserWithMeta(userId);

  res.json({
    userId,
    active: isSubscriptionActive(meta),
    status: meta.subscriptionStatus || null,
    currentPeriodEnd: meta.currentPeriodEnd || null,
    cancelAtPeriodEnd: meta.cancelAtPeriodEnd || false,
    stripeCustomerId: meta.stripeCustomerId || null,
    stripeSubscriptionId: meta.stripeSubscriptionId || null,
    hostedServerActive: isHostedSubscriptionActive(meta),
    hostedServerStatus: meta.hostedServerSubscriptionStatus || null,
    hostedServerCurrentPeriodEnd: meta.hostedServerCurrentPeriodEnd || null,
    hostedServerCancelAtPeriodEnd: meta.hostedServerCancelAtPeriodEnd || false,
  });
});

app.post("/api/billing/create-checkout-session", requireAuth, async (req, res) => {
  if (!stripe) {
    return res.status(500).json({ error: "missing_stripe_secret_key" });
  }
  const userId = req.auth?.userId;
  if (!userId) return res.status(401).json({ error: "unauthorized" });

  const user = await clerkClient.users.getUser(userId);
  const meta = user.privateMetadata || {};
  const existingCustomerId = meta.stripeCustomerId;

  let customerId = typeof existingCustomerId === "string" ? existingCustomerId : null;

  if (!customerId) {
    const email = user.primaryEmailAddress?.emailAddress || undefined;
    const customer = await stripe.customers.create({
      email,
      metadata: { clerkUserId: userId },
    });
    customerId = customer.id;
    await updateUserPrivateMetadata(userId, {
      stripeCustomerId: customerId,
    });
  } else {
    await stripe.customers.update(customerId, {
      metadata: { clerkUserId: userId },
    });
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: userId,
    line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
    success_url: `${APP_URL}/?checkout=success`,
    cancel_url: `${APP_URL}/?checkout=cancel`,
    subscription_data: {
      metadata: { clerkUserId: userId, plan: "core" },
    },
    metadata: {
      clerkUserId: userId,
      plan: "core",
    },
  });

  res.json({ url: session.url });
});

app.post("/api/billing/create-portal-session", requireAuth, async (req, res) => {
  if (!stripe) {
    return res.status(500).json({ error: "missing_stripe_secret_key" });
  }
  const userId = req.auth?.userId;
  if (!userId) return res.status(401).json({ error: "unauthorized" });

  const user = await clerkClient.users.getUser(userId);
  const customerId = user.privateMetadata?.stripeCustomerId;
  if (!customerId || typeof customerId !== "string") {
    return res.status(400).json({ error: "no_customer" });
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${APP_URL}/`,
  });

  res.json({ url: session.url });
});

app.post("/api/hosting/create-checkout-session", requireAuth, async (req, res) => {
  if (!stripe) {
    return res.status(500).json({ error: "missing_stripe_secret_key" });
  }
  if (!STRIPE_HOSTED_PRICE_ID) {
    return res.status(500).json({ error: "missing_hosted_price_id" });
  }

  const userId = req.auth?.userId;
  if (!userId) return res.status(401).json({ error: "unauthorized" });

  const user = await clerkClient.users.getUser(userId);
  const meta = user.privateMetadata || {};
  const existingCustomerId =
    (typeof meta.hostedServerStripeCustomerId === "string" &&
      meta.hostedServerStripeCustomerId) ||
    (typeof meta.stripeCustomerId === "string" && meta.stripeCustomerId) ||
    null;

  let customerId = existingCustomerId;
  if (!customerId) {
    const email = user.primaryEmailAddress?.emailAddress || undefined;
    const customer = await stripe.customers.create({
      email,
      metadata: { clerkUserId: userId },
    });
    customerId = customer.id;
  } else {
    await stripe.customers.update(customerId, {
      metadata: { clerkUserId: userId },
    });
  }

  await updateUserPrivateMetadata(userId, {
    hostedServerStripeCustomerId: customerId,
  });

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: userId,
    line_items: [{ price: STRIPE_HOSTED_PRICE_ID, quantity: 1 }],
    success_url: `${APP_URL}/?hostedCheckout=success`,
    cancel_url: `${APP_URL}/?hostedCheckout=cancel`,
    subscription_data: {
      metadata: { clerkUserId: userId, plan: "hosted_server" },
    },
    metadata: {
      clerkUserId: userId,
      plan: "hosted_server",
    },
  });

  res.json({ url: session.url });
});

app.get("/api/hosting/me", requireAuth, async (req, res) => {
  const userId = req.auth?.userId;
  if (!userId) return res.status(401).json({ error: "unauthorized" });

  const { meta } = await getUserWithMeta(userId);
  const userState = await getHostedUserState(userId);

  let server = sanitizeServerForClient(userState.server);
  if (userState.server?.id) {
    server = await syncHostedServerStatus(userId);
  }

  res.json({
    server,
    hostedSubscriptionActive: isHostedSubscriptionActive(meta),
    hostedSubscriptionStatus: meta.hostedServerSubscriptionStatus || null,
    hostedSubscriptionPeriodEnd: meta.hostedServerCurrentPeriodEnd || null,
  });
});

app.post("/api/hosting/server/provision", requireAuth, async (req, res) => {
  const userId = req.auth?.userId;
  if (!userId) return res.status(401).json({ error: "unauthorized" });

  ensureHostedEnabled();

  const { meta } = await getUserWithMeta(userId);
  if (!isHostedSubscriptionActive(meta)) {
    return res.status(402).json({ error: "hosted_subscription_required" });
  }

  const server = await createHostedServerForUser(userId);
  res.json({ server });
});

app.post("/api/hosting/server/start", requireAuth, async (req, res) => {
  const userId = req.auth?.userId;
  if (!userId) return res.status(401).json({ error: "unauthorized" });
  ensureHostedEnabled();

  const server = await hostedServerAction(userId, "start");
  res.json({ server });
});

app.post("/api/hosting/server/stop", requireAuth, async (req, res) => {
  const userId = req.auth?.userId;
  if (!userId) return res.status(401).json({ error: "unauthorized" });
  ensureHostedEnabled();

  const server = await hostedServerAction(userId, "stop");
  res.json({ server });
});

app.post("/api/hosting/server/rebuild", requireAuth, async (req, res) => {
  const userId = req.auth?.userId;
  if (!userId) return res.status(401).json({ error: "unauthorized" });
  ensureHostedEnabled();

  const server = await hostedServerAction(userId, "rebuild");
  res.json({ server });
});

app.post("/api/hosting/server/destroy", requireAuth, async (req, res) => {
  const userId = req.auth?.userId;
  if (!userId) return res.status(401).json({ error: "unauthorized" });
  ensureHostedEnabled();

  const server = await hostedServerAction(userId, "destroy");
  res.json({ server });
});

app.post("/api/hosting/server/pairing-code", requireAuth, async (req, res) => {
  const userId = req.auth?.userId;
  if (!userId) return res.status(401).json({ error: "unauthorized" });

  const userState = await getHostedUserState(userId);
  if (!userState.server) {
    return res.status(404).json({ error: "server_not_provisioned" });
  }

  userState.server.pairingCode = randomCode(8);
  userState.server.pairingExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  userState.server.updatedAt = nowIso();
  await queueHostedStatePersist();

  res.json({
    pairingCode: userState.server.pairingCode,
    pairingExpiresAt: userState.server.pairingExpiresAt,
  });
});

app.get("/api/hosting/server/ssh-public-key", requireAuth, async (req, res) => {
  const userId = req.auth?.userId;
  if (!userId) return res.status(401).json({ error: "unauthorized" });

  const userState = await getHostedUserState(userId);
  res.json({
    sshPublicKey: userState.server?.sshPublicKey || null,
  });
});

app.post("/api/hosting/server/ssh-authorized-key", requireAuth, async (req, res) => {
  const userId = req.auth?.userId;
  if (!userId) return res.status(401).json({ error: "unauthorized" });

  const publicKey =
    typeof req.body?.publicKey === "string" ? req.body.publicKey.trim() : "";
  if (!isLikelySshPublicKey(publicKey)) {
    return res.status(400).json({ error: "invalid_ssh_public_key" });
  }

  try {
    const server = await ensureHostedServerAccess(userId);
    await addHostedAuthorizedKey(server, publicKey);
    return res.json({ ok: true });
  } catch (err) {
    const message = err?.message || String(err);
    if (message === "server_not_provisioned") {
      return res.status(404).json({ error: "server_not_provisioned" });
    }
    if (message === "server_deleted") {
      return res.status(404).json({ error: "server_deleted" });
    }
    if (message === "server_not_ready") {
      return res.status(409).json({ error: "server_not_ready" });
    }
    return res.status(500).json({
      error: "ssh_authorized_key_apply_failed",
      message: truncateText(message, 320),
    });
  }
});

app.post("/api/hosting/server/codex-auth/start", requireAuth, async (req, res) => {
  const userId = req.auth?.userId;
  if (!userId) return res.status(401).json({ error: "unauthorized" });

  ensureHostedEnabled();
  const forceRestart = req.body?.force === true;

  try {
    const codexAuth = await startHostedCodexDeviceAuth(userId, { forceRestart });
    return res.json({ codexAuth });
  } catch (err) {
    const message = err?.message || String(err);
    if (message === "server_not_provisioned") {
      return res.status(404).json({ error: "server_not_provisioned" });
    }
    if (message === "server_deleted") {
      return res.status(404).json({ error: "server_deleted" });
    }
    if (message === "server_not_ready") {
      return res.status(409).json({ error: "server_not_ready" });
    }
    console.error("[hosting] codex auth start error:", err);
    return res.status(500).json({ error: "codex_auth_start_failed", message });
  }
});

app.get("/api/hosting/server/codex-auth/status", requireAuth, async (req, res) => {
  const userId = req.auth?.userId;
  if (!userId) return res.status(401).json({ error: "unauthorized" });

  const userState = await getHostedUserState(userId);
  if (!userState.server) {
    return res.status(404).json({ error: "server_not_provisioned" });
  }

  const codexAuth = sanitizeCodexAuthForClient(userState.server.codexAuth);
  return res.json({ codexAuth });
});

app.get("/api/hosting/internal/rollout-status", async (req, res) => {
  if (!hasValidControlPlaneToken(req)) {
    return res.status(403).json({ error: "forbidden" });
  }

  await ensureHostedStateLoaded();
  const rollout = getHostedRolloutState();
  return res.json({
    rollout,
    inFlight: Boolean(hostedAutoUpdateInFlight),
    config: {
      enabled: HOSTED_AUTO_UPDATE_ENABLED,
      intervalMs: HOSTED_AUTO_UPDATE_INTERVAL_MS,
      concurrency: HOSTED_AUTO_UPDATE_CONCURRENCY,
      retryDelayMs: HOSTED_AUTO_UPDATE_RETRY_DELAY_MS,
      package: VA_SERVER_NPM_PACKAGE,
      packageVersion: VA_SERVER_NPM_VERSION,
      sshFallbackEnabled: HOSTED_AUTO_UPDATE_SSH_FALLBACK_ENABLED,
      sshFallbackKeyConfigured: Boolean(HOSTED_AUTO_UPDATE_SSH_KEY_PATH),
      sshFallbackUser: HOSTED_AUTO_UPDATE_SSH_USER,
      sshFallbackPort: HOSTED_AUTO_UPDATE_SSH_PORT,
    },
  });
});

app.post("/api/hosting/internal/rollout-update", async (req, res) => {
  if (!hasValidControlPlaneToken(req)) {
    return res.status(403).json({ error: "forbidden" });
  }

  const force = req.body?.force === true;
  const reason =
    typeof req.body?.reason === "string" && req.body.reason.trim()
      ? truncateText(req.body.reason.trim(), 60)
      : "manual_internal";

  try {
    const summary = await triggerHostedAutoUpdateRollout({ force, reason });
    return res.json({ ok: true, summary });
  } catch (err) {
    return res.status(500).json({
      error: "rollout_failed",
      message: truncateText(err?.message || String(err), 320),
    });
  }
});

app.post("/api/hosting/internal/set-ssh-key", async (req, res) => {
  if (!hasValidControlPlaneToken(req)) {
    return res.status(403).json({ error: "forbidden" });
  }

  const userId = typeof req.body?.userId === "string" ? req.body.userId.trim() : "";
  const publicKey =
    typeof req.body?.publicKey === "string" ? req.body.publicKey.trim() : "";

  if (!userId) {
    return res.status(400).json({ error: "missing_user_id" });
  }
  if (!isLikelySshPublicKey(publicKey)) {
    return res.status(400).json({ error: "invalid_ssh_public_key" });
  }

  try {
    const server = await ensureHostedServerAccess(userId);
    await addHostedAuthorizedKey(server, publicKey);
    return res.json({ ok: true });
  } catch (err) {
    const message = err?.message || String(err);
    if (message === "server_not_provisioned") {
      return res.status(404).json({ error: "server_not_provisioned" });
    }
    if (message === "server_deleted") {
      return res.status(404).json({ error: "server_deleted" });
    }
    if (message === "server_not_ready") {
      return res.status(409).json({ error: "server_not_ready" });
    }
    return res.status(500).json({
      error: "set_ssh_key_failed",
      message: truncateText(message, 320),
    });
  }
});

app.post("/api/hosting/internal/bootstrap-report", async (req, res) => {
  if (!hasValidControlPlaneToken(req)) {
    return res.status(403).json({ error: "forbidden" });
  }

  const { token, status, sshPublicKey, error } = req.body || {};
  if (!token || typeof token !== "string") {
    return res.status(400).json({ error: "missing_token" });
  }

  await ensureHostedStateLoaded();

  let matchedUserId = null;
  for (const [userId, userState] of Object.entries(hostedState.users)) {
    if (userState?.server?.bootstrapToken === token) {
      matchedUserId = userId;
      break;
    }
  }

  if (!matchedUserId) {
    return res.status(404).json({ error: "token_not_found" });
  }

  const userState = hostedState.users[matchedUserId];
  if (!userState.server) {
    return res.status(404).json({ error: "server_not_found" });
  }

  if (typeof sshPublicKey === "string" && sshPublicKey.trim().length > 0) {
    userState.server.sshPublicKey = sshPublicKey.trim();
  }

  userState.server.status = status === "ready" ? "ready" : "bootstrapping";
  if (typeof error === "string" && error.trim()) {
    userState.server.status = "error";
    userState.server.lastError = error.trim();
  }

  userState.server.updatedAt = nowIso();
  userState.updatedAt = userState.server.updatedAt;

  await queueHostedStatePersist();
  res.json({ ok: true });
});

app.use("/api/hosting/va", requireAuth, async (req, res) => {
  const userId = req.auth?.userId;
  if (!userId) return res.status(401).json({ error: "unauthorized" });

  try {
    const server = await ensureHostedServerAccess(userId);

    const suffix = req.originalUrl.replace(/^\/api\/hosting\/va/, "") || "/";
    const targetUrl = `${server.runtimeBaseUrl}${suffix}`;

    const headers = {
      "Content-Type": "application/json",
      Accept: req.headers.accept || "application/json",
      "x-va-user-id": userId,
    };
    if (server.proxyToken) {
      headers["x-va-hosted-token"] = server.proxyToken;
    }

    const hasBody = !["GET", "HEAD"].includes(req.method.toUpperCase());
    const methodUpper = req.method.toUpperCase();

    let upstreamBody = req.body || {};
    if (methodUpper === "POST" && suffix === "/api/agents") {
      const requestedDir = String(req.body?.working_dir || "").trim();
      if (requestedDir === "") {
        upstreamBody = {
          ...(req.body || {}),
          working_dir: "/opt/virtualagency/workspace",
        };
      }
    }

    const timeoutMs =
      suffix.startsWith("/api/events")
        ? HOSTED_EVENTS_TIMEOUT_MS
        : suffix.startsWith("/api/files/tree/")
          ? HOSTED_FILE_TREE_TIMEOUT_MS
          : HOSTED_RUNTIME_TIMEOUT_MS;
    const upstreamResponse = await fetchWithTimeout(targetUrl, {
      method: req.method,
      headers,
      body: hasBody ? JSON.stringify(upstreamBody) : undefined,
    }, timeoutMs);

    const contentType = upstreamResponse.headers.get("content-type") || "";
    const text = await upstreamResponse.text();

    res.status(upstreamResponse.status);
    if (contentType) {
      res.setHeader("content-type", contentType);
    }

    if (!text) {
      return res.end();
    }

    return res.send(text);
  } catch (err) {
    const message = err?.message || String(err);
    if (message === "server_not_ready") {
      return res.status(409).json({ error: "server_not_ready" });
    }
    if (message === "server_deleted") {
      return res.status(404).json({ error: "server_deleted" });
    }
    if (typeof err?.statusCode === "number" && err.statusCode === 504) {
      return res
        .status(504)
        .json({ error: "hosting_runtime_timeout", message: "Hosted server request timed out" });
    }
    console.error("[hosting] proxy error:", err);
    return res.status(502).json({ error: "hosting_proxy_failed", message });
  }
});

app.get("/api/billing/health", (_req, res) =>
  res.json({
    ok: true,
    hostingEnabled: Boolean(HETZNER_API_TOKEN),
  }),
);

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err?.status || err?.statusCode;
  const message = String(err?.message || "").toLowerCase();

  if (status === 413 || err?.type === "entity.too.large") {
    return res.status(413).json({
      error: "payload_too_large",
      message:
        "Request payload is too large. Reduce attachment size or increase HOSTING_PROXY_JSON_LIMIT.",
    });
  }
  if (status === 401 || message.includes("unauthenticated") || message.includes("signed out")) {
    return res.status(401).json({ error: "unauthorized" });
  }
  if (status === 403 || message.includes("forbidden")) {
    return res.status(403).json({ error: "forbidden" });
  }

  if (err?.message === "missing_hetzner_api_token") {
    return res.status(503).json({ error: "missing_hetzner_api_token" });
  }

  console.error("[billing] unhandled error:", err);
  return res.status(500).json({ error: "internal_error" });
});

app.listen(PORT, "127.0.0.1", () => {
  const missing = [];
  if (!process.env.CLERK_SECRET_KEY) missing.push("CLERK_SECRET_KEY");
  if (!process.env.CLERK_PUBLISHABLE_KEY) missing.push("CLERK_PUBLISHABLE_KEY");
  if (!STRIPE_SECRET_KEY) missing.push("STRIPE_SECRET_KEY");
  if (!STRIPE_WEBHOOK_SECRET) missing.push("STRIPE_WEBHOOK_SECRET");
  if (!HETZNER_API_TOKEN) missing.push("HETZNER_API_TOKEN");
  if (!STRIPE_HOSTED_PRICE_ID) missing.push("STRIPE_HOSTED_PRICE_ID");
  if (missing.length > 0) {
    console.warn(`[billing] missing env: ${missing.join(", ")}`);
  }
  if (HOSTED_AUTO_UPDATE_SSH_FALLBACK_ENABLED && !HOSTED_AUTO_UPDATE_SSH_KEY_PATH) {
    console.warn(
      "[hosting] HOSTED_AUTO_UPDATE_SSH_FALLBACK_ENABLED=1 but HOSTED_AUTO_UPDATE_SSH_KEY_PATH is not set; fallback upgrades will fail when sudo is unavailable.",
    );
  }
  console.log(`[billing] listening on http://127.0.0.1:${PORT}`);
  if (HOSTED_AUTO_UPDATE_ENABLED) {
    void ensureHostedStateLoaded()
      .then(() => startHostedAutoUpdateScheduler())
      .catch((err) =>
        console.error("[hosting] failed initializing auto-update scheduler:", err),
      );
  } else {
    console.log("[hosting] auto-update scheduler disabled");
  }
});
