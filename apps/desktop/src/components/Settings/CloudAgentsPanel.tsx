import { useEffect, useMemo, useState } from "react";
import { Modal } from "../common/Modal";
import {
  createHostedCheckoutSession,
  destroyHostedServer,
  getHostedCodexAuthStatus,
  getHostedServerState,
  provisionHostedServer,
  rebuildHostedServer,
  rotateHostedPairingCode,
  startHostedCodexAuth,
  startHostedServer,
  stopHostedServer,
  type HostedCodexAuthState,
  type HostedServerStateResponse,
} from "../../lib/api";

interface CloudAgentsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CloudAgentsPanel({ isOpen, onClose }: CloudAgentsPanelProps) {
  const [state, setState] = useState<HostedServerStateResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<"cloud_25" | "cloud_50" | "cloud_75">(
    "cloud_25",
  );

  const refresh = async () => {
    if (!isOpen) return;
    setLoading(true);
    try {
      const next = await getHostedServerState();
      setState(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    void refresh();
  }, [isOpen]);

  const applyCodexAuthState = (codexAuth: HostedCodexAuthState) => {
    setState((prev) => {
      if (!prev?.server) return prev;
      return {
        ...prev,
        server: {
          ...prev.server,
          codexAuth,
        },
      };
    });
  };

  useEffect(() => {
    if (!isOpen) return undefined;
    const status = state?.server?.codexAuth?.status;
    if (!status || !["starting", "awaiting_user", "authorizing"].includes(status)) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      getHostedCodexAuthStatus()
        .then((codexAuth) => applyCodexAuthState(codexAuth))
        .catch((err) => setError(err instanceof Error ? err.message : String(err)));
    }, 2000);
    return () => window.clearInterval(timer);
  }, [isOpen, state?.server?.codexAuth?.status]);

  const runAction = async (name: string, fn: () => Promise<unknown>) => {
    setAction(name);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAction(null);
    }
  };

  const hostedServerStatus = state?.server?.status?.toLowerCase() || "";
  const hasHostedServer = Boolean(state?.server && hostedServerStatus !== "deleted");
  const hostedIsReady = hostedServerStatus === "ready";
  const hostedIsStopped = hostedServerStatus === "stopped";
  const hostedCanManage = hostedIsReady || hostedIsStopped;
  const codexAuth = state?.server?.codexAuth;
  const codexAuthStatus = codexAuth?.status || "not_started";
  const codexAuthInProgress = ["starting", "awaiting_user", "authorizing"].includes(
    codexAuthStatus,
  );

  const primaryServerAction = useMemo(() => {
    if (!hasHostedServer) return null;
    if (hostedIsStopped) return "start";
    if (hostedIsReady) return "stop";
    return null;
  }, [hasHostedServer, hostedIsReady, hostedIsStopped]);

  const canProvisionHostedServer =
    action === null &&
    Boolean(state?.hostedSubscriptionActive) &&
    (!hasHostedServer || hostedServerStatus === "deleted");

  const effectivePlan = state?.hostedSubscriptionPlan || selectedPlan;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Cloud Agents"
      subtitle="Guided setup for your managed cloud runtime"
      width={760}
    >
      <div style={containerStyle}>
        <StepCard
          step="Step 1"
          title="Activate Cloud Plan"
          description="Start by enabling your Cloud Agents subscription."
        >
          <StatusRow
            label="Subscription"
            value={
              state?.hostedSubscriptionActive
                ? `Active (${state.hostedSubscriptionStatus || "active"}) • ${effectivePlan.replace(
                    "cloud_",
                    "$",
                  )}/mo`
                : "Not active"
            }
            tone={state?.hostedSubscriptionActive ? "good" : "muted"}
          />
          <div style={planChooserStyle}>
            <div style={planChooserLabelStyle}>Choose Cloud Tier</div>
            <div style={planButtonsRowStyle}>
              {[
                { id: "cloud_25", label: "$25", note: "2 vCPU • 2GB RAM" },
                { id: "cloud_50", label: "$50", note: "3 vCPU • 4GB RAM" },
                { id: "cloud_75", label: "$75", note: "4 vCPU • 8GB RAM" },
              ].map((plan) => {
                const selected = selectedPlan === plan.id;
                return (
                  <button
                    key={plan.id}
                    type="button"
                    onClick={() => setSelectedPlan(plan.id as "cloud_25" | "cloud_50" | "cloud_75")}
                    style={{
                      ...planButtonStyle,
                      borderColor: selected ? "#7c3aed" : "#3f3f46",
                      background: selected ? "rgba(124,58,237,0.2)" : "rgba(17,24,39,0.5)",
                      color: selected ? "#ede9fe" : "#cbd5e1",
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>{plan.label}</div>
                    <div style={{ fontSize: 11, opacity: 0.8 }}>{plan.note}</div>
                  </button>
                );
              })}
            </div>
          </div>
          <div style={actionsRowStyle}>
            <button
              type="button"
              style={primaryButtonStyle}
              disabled={action !== null}
              onClick={() => {
                setAction("checkout");
                createHostedCheckoutSession(selectedPlan)
                  .then((resp) => {
                    if (resp?.url) window.location.href = resp.url;
                  })
                  .catch((err) => setError(err instanceof Error ? err.message : String(err)))
                  .finally(() => setAction(null));
              }}
            >
              {action === "checkout" ? "Opening..." : "Purchase Cloud Agents"}
            </button>
            <span style={helpTextStyle}>
              If already active, continue to Step 2.
            </span>
          </div>
        </StepCard>

        <StepCard
          step="Step 2"
          title="Provision Cloud Server"
          description="Create your server once. This can take a few minutes."
        >
          <StatusGrid>
            <StatusRow label="Server Status" value={state?.server?.status || "Not provisioned"} />
            <StatusRow label="Server IP" value={state?.server?.ipAddress || "—"} />
          </StatusGrid>
          <div style={actionsRowStyle}>
            <button
              type="button"
              style={primaryButtonStyle}
              disabled={!canProvisionHostedServer}
              onClick={() =>
                runAction("provision", async () => {
                  await provisionHostedServer();
                })
              }
            >
              {action === "provision" ? "Provisioning..." : "Provision Server"}
            </button>
            <span style={helpTextStyle}>
              {state?.hostedSubscriptionActive
                ? "After provisioning, move to Step 3."
                : "Subscription must be active first."}
            </span>
          </div>
        </StepCard>

        <StepCard
          step="Step 3"
          title="Connect and Manage"
          description="Authorize Codex and manage server lifecycle."
        >
          <StatusGrid>
            <StatusRow label="Codex Auth" value={codexAuthStatus} />
            <StatusRow
              label="Pairing Code"
              value={
                state?.server?.pairingCode
                  ? `${state.server.pairingCode}${state.server.pairingExpiresAt ? ` (expires ${state.server.pairingExpiresAt})` : ""}`
                  : "Not generated"
              }
            />
          </StatusGrid>

          {codexAuth?.userCode && (
            <div style={codeCardStyle}>
              <div style={codeTitleStyle}>Device Code</div>
              <div style={codeTextStyle}>{codexAuth.userCode}</div>
              {codexAuth.verificationUri && (
                <div style={codeHintStyle}>Open: {codexAuth.verificationUri}</div>
              )}
            </div>
          )}

          <div style={actionsRowStyle}>
            <button
              type="button"
              style={primaryButtonStyle}
              disabled={action !== null || !hasHostedServer}
              onClick={() =>
                runAction("codex-auth", async () => {
                  const next = await startHostedCodexAuth({ forceRestart: codexAuthInProgress });
                  applyCodexAuthState(next);
                })
              }
            >
              {action === "codex-auth"
                ? codexAuthInProgress
                  ? "Restarting Auth..."
                  : "Starting Auth..."
                : codexAuthInProgress
                  ? "Restart Codex Auth"
                  : "Set Up Codex Auth"}
            </button>

            {primaryServerAction === "start" && (
              <button
                type="button"
                style={secondaryButtonStyle}
                disabled={action !== null}
                onClick={() =>
                  runAction("start", async () => {
                    await startHostedServer();
                  })
                }
              >
                {action === "start" ? "Starting..." : "Start Server"}
              </button>
            )}

            {primaryServerAction === "stop" && (
              <button
                type="button"
                style={secondaryButtonStyle}
                disabled={action !== null}
                onClick={() =>
                  runAction("stop", async () => {
                    await stopHostedServer();
                  })
                }
              >
                {action === "stop" ? "Stopping..." : "Stop Server"}
              </button>
            )}
          </div>

          <details style={advancedStyle}>
            <summary style={advancedSummaryStyle}>Advanced Actions</summary>
            <div style={advancedActionsStyle}>
              <button
                type="button"
                style={secondaryButtonStyle}
                disabled={action !== null || !hasHostedServer || !hostedIsReady}
                onClick={() =>
                  runAction("pairing", async () => {
                    await rotateHostedPairingCode();
                  })
                }
              >
                Rotate Pairing Code
              </button>
              <button
                type="button"
                style={secondaryButtonStyle}
                disabled={action !== null || !hasHostedServer || !hostedCanManage}
                onClick={() =>
                  runAction("rebuild", async () => {
                    await rebuildHostedServer();
                  })
                }
              >
                Rebuild Server
              </button>
              <button
                type="button"
                style={dangerButtonStyle}
                disabled={action !== null || !hasHostedServer || !hostedCanManage}
                onClick={() =>
                  runAction("destroy", async () => {
                    await destroyHostedServer();
                  })
                }
              >
                Destroy Server
              </button>
            </div>
          </details>
        </StepCard>

        <div style={footerRowStyle}>
          <button
            type="button"
            style={secondaryButtonStyle}
            disabled={loading || action !== null}
            onClick={() => void refresh()}
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
          {error && <div style={errorStyle}>{error}</div>}
          {!error && state?.server?.lastError && <div style={errorStyle}>{state.server.lastError}</div>}
        </div>
      </div>
    </Modal>
  );
}

function StepCard({
  step,
  title,
  description,
  children,
}: {
  step: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section style={stepCardStyle}>
      <div style={stepHeaderStyle}>
        <span style={stepBadgeStyle}>{step}</span>
        <h3 style={stepTitleStyle}>{title}</h3>
      </div>
      <p style={stepDescriptionStyle}>{description}</p>
      <div style={{ marginTop: 12 }}>{children}</div>
    </section>
  );
}

function StatusGrid({ children }: { children: React.ReactNode }) {
  return <div style={statusGridStyle}>{children}</div>;
}

function StatusRow({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "good" | "muted";
}) {
  return (
    <div style={statusCardStyle}>
      <div style={statusLabelStyle}>{label}</div>
      <div
        style={{
          ...statusValueStyle,
          color:
            tone === "good" ? "#4ade80" : tone === "muted" ? "#9ca3af" : "#f3f4f6",
        }}
      >
        {value}
      </div>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const stepCardStyle: React.CSSProperties = {
  border: "1px solid #313244",
  borderRadius: 12,
  background: "rgba(17, 24, 39, 0.55)",
  padding: 14,
};

const stepHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
};

const stepBadgeStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "4px 8px",
  borderRadius: 999,
  background: "rgba(59,130,246,0.2)",
  border: "1px solid rgba(59,130,246,0.4)",
  color: "#93c5fd",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 0.2,
};

const stepTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 16,
  color: "#f3f4f6",
};

const stepDescriptionStyle: React.CSSProperties = {
  margin: "8px 0 0",
  color: "#9ca3af",
  fontSize: 13,
};

const statusGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
  gap: 8,
};

const statusCardStyle: React.CSSProperties = {
  border: "1px solid #2f3349",
  borderRadius: 8,
  padding: "8px 10px",
  background: "rgba(10, 15, 26, 0.65)",
};

const statusLabelStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#94a3b8",
  marginBottom: 4,
  textTransform: "uppercase",
  letterSpacing: 0.4,
};

const statusValueStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#f3f4f6",
  lineHeight: 1.35,
  wordBreak: "break-word",
};

const actionsRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
  marginTop: 10,
};

const planChooserStyle: React.CSSProperties = {
  marginTop: 10,
};

const planChooserLabelStyle: React.CSSProperties = {
  color: "#94a3b8",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: 0.4,
  marginBottom: 6,
};

const planButtonsRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
};

const planButtonStyle: React.CSSProperties = {
  border: "1px solid #3f3f46",
  borderRadius: 8,
  padding: "8px 10px",
  minWidth: 98,
  cursor: "pointer",
  textAlign: "left",
};

const helpTextStyle: React.CSSProperties = {
  color: "#94a3b8",
  fontSize: 12,
};

const codeCardStyle: React.CSSProperties = {
  marginTop: 10,
  border: "1px dashed #3b82f6",
  borderRadius: 8,
  padding: "10px 12px",
  background: "rgba(30, 64, 175, 0.12)",
};

const codeTitleStyle: React.CSSProperties = {
  color: "#bfdbfe",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: 0.5,
};

const codeTextStyle: React.CSSProperties = {
  marginTop: 4,
  color: "#eff6ff",
  fontFamily: "monospace",
  fontSize: 18,
  letterSpacing: 1.2,
};

const codeHintStyle: React.CSSProperties = {
  marginTop: 6,
  color: "#cbd5e1",
  fontSize: 12,
  wordBreak: "break-all",
};

const advancedStyle: React.CSSProperties = {
  marginTop: 12,
};

const advancedSummaryStyle: React.CSSProperties = {
  color: "#a5b4fc",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
};

const advancedActionsStyle: React.CSSProperties = {
  marginTop: 10,
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
};

const footerRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  marginTop: 4,
  flexWrap: "wrap",
};

const errorStyle: React.CSSProperties = {
  color: "#ef4444",
  fontSize: 12,
};

const baseButtonStyle: React.CSSProperties = {
  borderRadius: 8,
  padding: "8px 12px",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
};

const primaryButtonStyle: React.CSSProperties = {
  ...baseButtonStyle,
  background: "#2563eb",
  color: "white",
  border: "1px solid #3b82f6",
};

const secondaryButtonStyle: React.CSSProperties = {
  ...baseButtonStyle,
  background: "rgba(30,41,59,0.65)",
  color: "#e2e8f0",
  border: "1px solid #475569",
};

const dangerButtonStyle: React.CSSProperties = {
  ...baseButtonStyle,
  background: "rgba(127,29,29,0.45)",
  color: "#fecaca",
  border: "1px solid #ef4444",
};
