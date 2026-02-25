import { SignedIn, UserButton, useAuth } from "@clerk/clerk-react";
import type { CSSProperties } from "react";
import { useCallback, useMemo, useState } from "react";
import { isTauri } from "../../lib/api";
import { useIsMobile } from "../../hooks/useIsMobile";

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

export function AccountControls() {
  const hasClerk = Boolean(
    import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ||
      import.meta.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  );
  if (isTauri() || !hasClerk) return null;

  return <AccountControlsInner />;
}

function AccountControlsInner() {
  const isMobile = useIsMobile(900);
  const isSmallPhone = useIsMobile(640);
  const { getToken } = useAuth();
  const [loading, setLoading] = useState(false);

  const baseUrl = useMemo(() => {
    const envUrl = import.meta.env.VITE_BILLING_API_URL as string | undefined;
    return envUrl && envUrl.length > 0 ? envUrl.replace(/\/$/, "") : "";
  }, []);

  const portalUrl = `${baseUrl}/api/billing/create-portal-session`;

  const openPortal = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Missing auth token");
      const resp = await postJson<{ url: string }>(portalUrl, token);
      if (resp?.url) window.location.href = resp.url;
    } catch (err) {
      console.error("[billing] Failed to open portal:", err);
    } finally {
      setLoading(false);
    }
  }, [baseUrl, getToken, portalUrl]);

  return (
    <SignedIn>
      <div style={{ ...containerStyle, gap: isMobile ? 8 : 10 }}>
        <button
          type="button"
          style={{
            ...manageButtonStyle,
            padding: isMobile ? "7px 10px" : "8px 14px",
            fontSize: isMobile ? 12 : 13,
            minHeight: isMobile ? 36 : undefined,
          }}
          onClick={() => openPortal().catch(() => {})}
          disabled={loading}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(55, 55, 70, 0.95)";
            e.currentTarget.style.borderColor = "rgba(75, 85, 99, 0.8)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(30, 30, 46, 0.95)";
            e.currentTarget.style.borderColor = "rgba(60, 60, 60, 0.8)";
          }}
          title="Manage subscription"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="2" y="5" width="20" height="14" rx="2" />
            <line x1="2" y1="10" x2="22" y2="10" />
          </svg>
          <span>{loading ? "Opening…" : isSmallPhone ? "Billing" : "Manage subscription"}</span>
        </button>

        <div
          style={{
            ...userButtonWrapperStyle,
            width: isMobile ? 36 : 38,
            height: isMobile ? 36 : 38,
          }}
          title="Account"
        >
          <UserButton />
        </div>
      </div>
    </SignedIn>
  );
}

const containerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
};

const manageButtonStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "8px 14px",
  background: "rgba(30, 30, 46, 0.95)",
  backdropFilter: "blur(8px)",
  border: "1px solid rgba(60, 60, 60, 0.8)",
  borderRadius: 10,
  color: "#e5e7eb",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
  transition: "all 0.2s ease",
  boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
};

const userButtonWrapperStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 38,
  height: 38,
  background: "rgba(30, 30, 46, 0.95)",
  backdropFilter: "blur(8px)",
  border: "1px solid rgba(60, 60, 60, 0.8)",
  borderRadius: 10,
  boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
};
