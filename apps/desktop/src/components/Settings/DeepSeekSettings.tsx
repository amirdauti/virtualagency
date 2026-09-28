import { useEffect, useState } from "react";
import type { AgentRuntime } from "@virtual-agency/shared";
import { getDeepSeekStatus, saveDeepSeekKey, removeDeepSeekKey, testDeepSeekConnection, type DeepSeekStatus } from "../../lib/api";

export function DeepSeekSettings({ runtime, onRuntimeChange }: { runtime: AgentRuntime; onRuntimeChange?: (runtime: AgentRuntime) => void }) {
  const [status, setStatus] = useState<DeepSeekStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setChecking(true); setStatus(null); setKey(""); setError(""); setFeedback("");
    getDeepSeekStatus(runtime, controller.signal).then(value => { if (active) setStatus(value); })
      .catch((cause) => { if (active) setError(connectionError(cause, runtime)); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; controller.abort(); };
  }, [runtime, attempt]);
  async function run(action: "save" | "test" | "remove") {
    setBusy(true); setError(""); setFeedback("");
    try {
      if (action === "save") {
        setStatus(await saveDeepSeekKey(runtime, key)); setKey("");
        setFeedback("API key saved and connection verified.");
      } else if (action === "remove") {
        setStatus(await removeDeepSeekKey(runtime)); setKey(""); setFeedback("Saved API key removed.");
      } else { await testDeepSeekConnection(runtime); setFeedback("Connected to DeepSeek."); }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return <div style={{ padding: 16, border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg-primary)" }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
      <strong>DeepSeek · Claude Code</strong>
      <span style={{ color: status?.configured ? "#86efac" : "var(--text-secondary)", fontSize: 12 }}>
        {checking ? "Checking server…" : status ? status.configured ? "API key configured" : "API key needed" : "Server unavailable"}
      </span>
    </div>
    <p style={{ color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.6 }}>
      Use your own DeepSeek account on {runtime === "hosted" ? "your cloud server" : "the connected server"}. New agents default to DeepSeek 4.1 Flash with reasoning enabled.
    </p>
    {status?.externally_managed ? <p>The API key is managed in this server’s environment.</p> : <>
      <label style={{ display: "block", fontSize: 13, marginBottom: 6 }}>
        {status?.configured ? "Replace API key" : "DeepSeek API key"}
        <input type="password" autoComplete="off" spellCheck={false} value={key} onChange={e => setKey(e.target.value)}
          placeholder={status?.configured ? "Enter a new key to replace the saved key" : "sk-…"} disabled={busy || !status}
          style={{ display: "block", boxSizing: "border-box", width: "100%", marginTop: 8, padding: "10px 12px", borderRadius: 6, border: "1px solid var(--border)", color: "var(--text-primary)", background: "var(--bg-secondary)" }} />
      </label>
      <p style={{ color: "var(--text-secondary)", fontSize: 12 }}>Stored privately on this server. The saved key is never returned to your browser.</p>
    </>}
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {!checking && !status && <button type="button" onClick={() => setAttempt(value => value + 1)} style={button}>Try again</button>}
      {!checking && !status && runtime === "local" && onRuntimeChange && <button type="button" onClick={() => onRuntimeChange("hosted")} style={button}>Use Cloud Agents</button>}
      {!status?.externally_managed && <button type="button" disabled={busy || !status || !key.trim()} onClick={() => void run("save")} style={button}>Save &amp; connect</button>}
      {status?.configured && <button type="button" disabled={busy} onClick={() => void run("test")} style={button}>Test connection</button>}
      {status?.configured && !status.externally_managed && <button type="button" disabled={busy} onClick={() => void run("remove")} style={button}>Remove key</button>}
      <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noreferrer" style={{ fontSize: 12, alignSelf: "center", color: "#93c5fd" }}>Get an API key ↗</a>
    </div>
    <div aria-live="polite" style={{ marginTop: 10, fontSize: 12 }}>
      {busy && <span>Connecting…</span>}
      {feedback && <span style={{ color: "#86efac" }}>{feedback}</span>}
      {error && <span role="alert" style={{ color: "#fca5a5" }}>{error}</span>}
    </div>
    {status?.cli_version && <p style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 0 }}>Claude Code {status.cli_version} · compatibility checked</p>}
    {status?.cli_update?.status === "failed" && <p role="status" style={{ color: "#fcd34d", fontSize: 12 }}>The latest CLI update did not pass checks. The previous CLI remains active. {status.cli_update.message}</p>}
  </div>;
}
function connectionError(cause: unknown, runtime: AgentRuntime): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (message.includes("hosted_auth_required") || message.includes("unauthorized")) return "Sign in again to connect to your Cloud Agents server.";
  if (message.includes("hosting_proxy_forbidden_path")) return "The cloud gateway needs an update before DeepSeek settings can open. Try again once it has updated.";
  if (message.includes("took too long")) return message;
  return runtime === "hosted"
    ? "Could not reach DeepSeek settings on your Cloud Agents server. Check that the server is running and updated, then try again."
    : "Could not reach the connected server. If your agents run in the cloud, choose Use Cloud Agents. Otherwise, check your server connection and try again.";
}
const button = { padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text-primary)", cursor: "pointer", fontSize: 12 };
