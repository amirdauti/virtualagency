import { SignedIn, SignedOut, SignIn, UserButton, useAuth } from "@clerk/clerk-react";
import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { setHostedAuthTokenProvider } from "../../lib/api";

type BillingMe = {
  active: boolean;
  status: string | null;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  hostedServerActive?: boolean;
  hostedServerStatus?: string | null;
};

async function fetchJson<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

async function postJson<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export function AuthBillingGate({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [billing, setBilling] = useState<BillingMe | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasAccess = Boolean(billing?.active || billing?.hostedServerActive);

  // Clerk's `getToken` reference may not be stable across renders.
  // Store the latest function in a ref so our effects/callbacks don't re-run in a loop.
  const getTokenRef = useRef(getToken);
  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  useLayoutEffect(() => {
    if (!isLoaded || !isSignedIn) {
      setHostedAuthTokenProvider(null);
      return;
    }

    setHostedAuthTokenProvider(async () => getTokenRef.current());
    return () => {
      setHostedAuthTokenProvider(null);
    };
  }, [isLoaded, isSignedIn]);

  const baseUrl = useMemo(() => {
    const envUrl = import.meta.env.VITE_BILLING_API_URL as string | undefined;
    return envUrl && envUrl.length > 0 ? envUrl.replace(/\/$/, "") : "";
  }, []);

  const meUrl = `${baseUrl}/api/billing/me`;
  const checkoutUrl = `${baseUrl}/api/billing/create-checkout-session`;
  const portalUrl = `${baseUrl}/api/billing/create-portal-session`;

  const refreshInFlight = useRef(false);
  const refresh = useCallback(async () => {
    if (!isLoaded || !isSignedIn) return;
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const token = await getTokenRef.current();
      if (!token) throw new Error("Missing auth token");
      const me = await fetchJson<BillingMe>(meUrl, token);
      setBilling(me);
    } catch (e: any) {
      setError(e?.message || String(e));
      setBilling(null);
    } finally {
      setLoading(false);
      refreshInFlight.current = false;
    }
  }, [isLoaded, isSignedIn, meUrl]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") === "success") {
      refresh();
    }
  }, [refresh]);

  const startCheckout = useCallback(async () => {
    const token = await getTokenRef.current();
    if (!token) throw new Error("Missing auth token");
    const resp = await postJson<{ url: string }>(checkoutUrl, token);
    if (resp?.url) window.location.href = resp.url;
  }, [checkoutUrl]);

  const openPortal = useCallback(async () => {
    const token = await getTokenRef.current();
    if (!token) throw new Error("Missing auth token");
    const resp = await postJson<{ url: string }>(portalUrl, token);
    if (resp?.url) window.location.href = resp.url;
  }, [portalUrl]);

  if (!isLoaded) {
    return (
      <div style={fullScreenCenterStyle}>
        <div style={{ color: "#fff" }}>Loading…</div>
      </div>
    );
  }

  return (
    <>
      <SignedOut>
        <div style={fullScreenCenterStyle}>
          <div style={{ width: 360, maxWidth: "90vw" }}>
            <div style={{ marginBottom: 16, color: "#fff", fontWeight: 600, fontSize: 20 }}>
              Sign in to Virtual Agency
            </div>
            <SignIn routing="hash" />
          </div>
        </div>
      </SignedOut>

      <SignedIn>
        {loading && (
          <div style={fullScreenCenterStyle}>
            <div style={{ color: "#fff" }}>Checking subscription…</div>
          </div>
        )}

        {!loading && error && (
          <div style={fullScreenCenterStyle}>
            <div style={{ width: 520, maxWidth: "92vw", color: "#fff" }}>
              <div style={{ fontWeight: 600, fontSize: 18, marginBottom: 8 }}>Billing check failed</div>
              <div style={{ opacity: 0.8, marginBottom: 16, whiteSpace: "pre-wrap" }}>{error}</div>
              <button style={primaryButtonStyle} onClick={refresh}>
                Retry
              </button>
              <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
                <UserButton />
              </div>
            </div>
          </div>
        )}

        {!loading && !error && billing && !hasAccess && (
          <div style={fullScreenCenterStyle}>
            <div style={{ width: 520, maxWidth: "92vw", color: "#fff" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontWeight: 700, fontSize: 22 }}>Virtual Agency Pro</div>
                <UserButton />
              </div>
              <div style={{ marginTop: 10, opacity: 0.85 }}>
                Subscribe for <strong>$10/month</strong> to use Virtual Agency.
              </div>
              <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  style={primaryButtonStyle}
                  onClick={() => startCheckout().catch((e) => setError(e?.message || String(e)))}
                >
                  Subscribe
                </button>
                <button style={secondaryButtonStyle} onClick={refresh}>
                  Refresh status
                </button>
                <button
                  style={secondaryButtonStyle}
                  onClick={() => openPortal().catch((e) => setError(e?.message || String(e)))}
                >
                  Manage billing
                </button>
              </div>
              <div style={{ marginTop: 14, fontSize: 12, opacity: 0.7 }}>
                Status: {billing.status ?? "none"}{billing.hostedServerStatus ? ` · Hosted: ${billing.hostedServerStatus}` : ""}
              </div>
            </div>
          </div>
        )}

        {!loading && !error && billing && hasAccess && <>{children}</>}
      </SignedIn>
    </>
  );
}

const fullScreenCenterStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "#0b0b12",
};

const primaryButtonStyle: CSSProperties = {
  padding: "10px 14px",
  background: "#0078d4",
  border: "1px solid #3aa0ff",
  borderRadius: 8,
  color: "#fff",
  cursor: "pointer",
  fontWeight: 600,
};

const secondaryButtonStyle: CSSProperties = {
  padding: "10px 14px",
  background: "transparent",
  border: "1px solid #444",
  borderRadius: 8,
  color: "#fff",
  cursor: "pointer",
  fontWeight: 500,
};
