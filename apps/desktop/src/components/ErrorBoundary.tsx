import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: { componentStack: string }) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
    this.setState({
      error,
      errorInfo: errorInfo.componentStack,
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "#1a1a1a",
            color: "#fff",
            padding: 40,
            fontFamily: "monospace",
            overflow: "auto",
          }}
        >
          <h1 style={{ color: "#ef4444", marginBottom: 20 }}>
            Something went wrong
          </h1>
          <div
            style={{
              background: "#2a2a2a",
              padding: 20,
              borderRadius: 8,
              marginBottom: 20,
            }}
          >
            <h3 style={{ marginTop: 0 }}>Error:</h3>
            <pre style={{ color: "#fca5a5", whiteSpace: "pre-wrap" }}>
              {this.state.error?.message}
            </pre>
          </div>
          {this.state.errorInfo && (
            <div
              style={{
                background: "#2a2a2a",
                padding: 20,
                borderRadius: 8,
                marginBottom: 20,
              }}
            >
              <h3 style={{ marginTop: 0 }}>Component Stack:</h3>
              <pre
                style={{
                  color: "#fcd34d",
                  whiteSpace: "pre-wrap",
                  fontSize: 12,
                }}
              >
                {this.state.errorInfo}
              </pre>
            </div>
          )}
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "12px 24px",
              background: "#3b82f6",
              border: "none",
              borderRadius: 6,
              color: "#fff",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Reload App
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
