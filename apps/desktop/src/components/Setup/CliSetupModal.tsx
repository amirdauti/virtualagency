import { useState, useEffect } from "react";
import { getCliStatus, CliStatus, isTauri } from "../../lib/api";

interface CliSetupModalProps {
  onReady: () => void;
}

export function CliSetupModal({ onReady }: CliSetupModalProps) {
  const [status, setStatus] = useState<CliStatus | null>(null);
  const [initialCheck, setInitialCheck] = useState(true);
  const [serverConnected, setServerConnected] = useState<boolean | null>(null);
  const inBrowser = !isTauri();

  const checkStatus = async (isInitial = false) => {
    // Only show loading state on initial check to prevent flickering
    if (isInitial) setInitialCheck(true);
    try {
      // Add timeout to prevent hanging
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Timeout")), 5000)
      );

      const result = await Promise.race([getCliStatus(), timeoutPromise]);
      setStatus(result);
      setServerConnected(true);
      if (result.installed) {
        onReady();
      }
    } catch (err) {
      console.error("Failed to check CLI status:", err);
      if (inBrowser) {
        // In browser mode, failed connection means server not running
        setServerConnected(false);
        setStatus(null);
      } else {
        // In Tauri mode, assume CLI is available
        setStatus({ installed: false, path: null, version: null });
      }
    } finally {
      setInitialCheck(false);
    }
  };

  useEffect(() => {
    checkStatus(true); // Initial check
    // In browser mode, keep polling for server connection
    if (inBrowser) {
      const interval = setInterval(() => checkStatus(false), 3000);
      return () => clearInterval(interval);
    }
  }, []);

  // Only show loading spinner on initial check
  if (initialCheck && !status && serverConnected === null) {
    return (
      <div style={overlayStyle}>
        <div style={modalStyle}>
          <div style={spinnerStyle} />
          <p style={{ color: "var(--text-secondary)", marginTop: 16 }}>
            Checking for Claude CLI...
          </p>
          <button
            onClick={onReady}
            style={{
              marginTop: 16,
              padding: "8px 16px",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text-secondary)",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            Skip check
          </button>
        </div>
      </div>
    );
  }

  if (status?.installed) {
    return null;
  }

  // Browser mode - server not connected
  if (inBrowser && serverConnected === false) {
    return (
      <div style={overlayStyle}>
        <div style={modalStyle}>
          <h2 style={{ margin: 0, marginBottom: 8 }}>Local Server Required</h2>
          <p style={{ color: "var(--text-secondary)", margin: 0, marginBottom: 24 }}>
            Virtual Agency runs on your local machine to use your Claude CLI.
            Download and run the server to get started.
          </p>

          <div style={instructionsStyle}>
            <h3 style={{ margin: 0, marginBottom: 16, fontSize: 14 }}>
              Step 1: Download & Run the Server
            </h3>
            <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
              <a
                href="/downloads/VirtualAgencyServer-macOS.zip"
                download
                style={downloadButtonStyle}
              >
                Download for macOS
              </a>
              <a
                href="/downloads/virtual-agency-server.exe"
                download
                style={downloadButtonStyle}
              >
                Download for Windows
              </a>
            </div>

            <p style={{ color: "var(--text-secondary)", fontSize: 13, margin: "0 0 16px 0" }}>
              Extract the zip and double-click the app to start the server.
            </p>

            <h3 style={{ margin: 0, marginBottom: 12, fontSize: 14 }}>
              Step 2: Install Claude CLI (if not already installed)
            </h3>
            <code style={codeBlockStyle}>npm install -g @anthropic-ai/claude-code</code>
          </div>

          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            marginTop: 20,
            padding: "12px 16px",
            background: "rgba(255, 107, 107, 0.1)",
            borderRadius: 8,
            border: "1px solid rgba(255, 107, 107, 0.3)",
          }}>
            <div style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: "#ff6b6b",
              animation: "pulse 2s infinite",
            }} />
            <span style={{ color: "#ff6b6b", fontSize: 13 }}>
              Waiting for local server connection...
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        <h2 style={{ margin: 0, marginBottom: 8 }}>Claude CLI Required</h2>
        <p style={{ color: "var(--text-secondary)", margin: 0, marginBottom: 24 }}>
          Virtual Agency needs the Claude CLI to spawn AI agents.
        </p>

        <div style={instructionsStyle}>
          <h3 style={{ margin: 0, marginBottom: 12, fontSize: 14 }}>
            Install via Homebrew (Recommended)
          </h3>
          <code style={codeBlockStyle}>brew install claude</code>

          <h3 style={{ margin: 0, marginTop: 20, marginBottom: 12, fontSize: 14 }}>
            Or install via npm
          </h3>
          <code style={codeBlockStyle}>npm install -g @anthropic-ai/claude-code</code>
        </div>

        <p style={{ color: "var(--text-secondary)", fontSize: 12, marginTop: 20 }}>
          After installing, click the button below to verify.
        </p>

        <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
          <button
            onClick={() => checkStatus(false)}
            style={{
              padding: "10px 20px",
              background: "var(--accent)",
              border: "none",
              borderRadius: 6,
              color: "white",
              cursor: "pointer",
              fontWeight: 600,
              flex: 1,
            }}
          >
            Check Again
          </button>
          <button
            onClick={onReady}
            style={{
              padding: "10px 20px",
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text-secondary)",
              cursor: "pointer",
              fontWeight: 500,
            }}
          >
            Skip for now
          </button>
        </div>

        {status && !status.installed && (
          <p style={{ color: "#fca5a5", fontSize: 12, marginTop: 16, textAlign: "center" }}>
            Claude CLI not found in PATH
          </p>
        )}
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: "rgba(0, 0, 0, 0.8)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
};

const modalStyle: React.CSSProperties = {
  background: "var(--bg-secondary)",
  borderRadius: 12,
  padding: 32,
  maxWidth: 480,
  width: "90%",
  boxShadow: "0 20px 50px rgba(0, 0, 0, 0.5)",
};

const instructionsStyle: React.CSSProperties = {
  background: "var(--bg-primary)",
  borderRadius: 8,
  padding: 20,
};

const codeBlockStyle: React.CSSProperties = {
  display: "block",
  background: "#000",
  padding: "12px 16px",
  borderRadius: 6,
  fontFamily: "'SF Mono', 'Fira Code', monospace",
  fontSize: 13,
  color: "#4ade80",
  userSelect: "all",
  cursor: "text",
};

const spinnerStyle: React.CSSProperties = {
  width: 40,
  height: 40,
  border: "3px solid var(--border)",
  borderTopColor: "var(--accent)",
  borderRadius: "50%",
  animation: "spin 1s linear infinite",
};

const downloadButtonStyle: React.CSSProperties = {
  flex: 1,
  padding: "12px 16px",
  background: "linear-gradient(135deg, #ff6b6b, #ff1493)",
  border: "none",
  borderRadius: 8,
  color: "white",
  fontWeight: 600,
  fontSize: 13,
  textDecoration: "none",
  textAlign: "center",
  cursor: "pointer",
  transition: "transform 0.2s, box-shadow 0.2s",
};
