import { ReactNode, useEffect, useState } from "react";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  width?: number;
}

export function Modal({ isOpen, onClose, title, subtitle, children, width = 520 }: ModalProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setIsVisible(true);
      requestAnimationFrame(() => setIsAnimating(true));
    } else {
      setIsAnimating(false);
      const timer = setTimeout(() => setIsVisible(false), 200);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  if (!isVisible) return null;

  return (
    <div
      style={{
        ...overlayStyle,
        opacity: isAnimating ? 1 : 0,
        transition: "opacity 0.2s ease-out",
      }}
      onClick={onClose}
    >
      <div
        style={{
          ...modalStyle,
          width,
          transform: isAnimating ? "translateY(0) scale(1)" : "translateY(-20px) scale(0.98)",
          opacity: isAnimating ? 1 : 0,
          transition: "transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with gradient accent */}
        <div style={headerStyle}>
          <div style={headerGradient} />
          <div style={headerContent}>
            <div>
              <h2 style={titleStyle}>{title}</h2>
              {subtitle && <p style={subtitleStyle}>{subtitle}</p>}
            </div>
            <button
              onClick={onClose}
              style={closeButtonStyle}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)";
                e.currentTarget.style.color = "#fff";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = "#6b7280";
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
        <div style={contentStyle}>{children}</div>
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
  background: "rgba(0, 0, 0, 0.75)",
  backdropFilter: "blur(4px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
};

const modalStyle: React.CSSProperties = {
  background: "linear-gradient(180deg, #1e1e2e 0%, #181825 100%)",
  borderRadius: 16,
  boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05)",
  maxWidth: "90%",
  maxHeight: "90vh",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
};

const headerStyle: React.CSSProperties = {
  position: "relative",
  overflow: "hidden",
  flexShrink: 0,
};

const headerGradient: React.CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  height: 3,
  background: "linear-gradient(90deg, #3b82f6 0%, #8b5cf6 50%, #ec4899 100%)",
};

const headerContent: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  padding: "20px 24px 16px",
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 20,
  fontWeight: 600,
  color: "#f3f4f6",
  letterSpacing: "-0.02em",
};

const subtitleStyle: React.CSSProperties = {
  margin: "4px 0 0",
  fontSize: 13,
  color: "#9ca3af",
  fontWeight: 400,
};

const closeButtonStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#6b7280",
  cursor: "pointer",
  padding: 8,
  borderRadius: 8,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  transition: "all 0.15s ease",
  marginTop: -4,
  marginRight: -4,
};

const contentStyle: React.CSSProperties = {
  padding: "0 24px 24px",
  overflowY: "auto",
  flex: 1,
};
