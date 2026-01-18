import { useState } from "react";
import { Modal } from "../common/Modal";
import { AVATAR_OPTIONS, AvatarId } from "@virtual-agency/shared";
import { useAgentStore } from "../../stores/agentStore";

interface EditAvatarDialogProps {
  isOpen: boolean;
  onClose: () => void;
  agentId: string;
  currentAvatarId: AvatarId;
}

export function EditAvatarDialog({
  isOpen,
  onClose,
  agentId,
  currentAvatarId,
}: EditAvatarDialogProps) {
  const [selectedAvatarId, setSelectedAvatarId] = useState<AvatarId>(currentAvatarId);
  const updateAgent = useAgentStore((state) => state.updateAgent);

  const handleSave = () => {
    updateAgent(agentId, { avatarId: selectedAvatarId });
    onClose();
  };

  const handleClose = () => {
    setSelectedAvatarId(currentAvatarId);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Change Avatar">
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <label style={labelStyle}>Select Avatar</label>
          <div style={avatarGridStyle}>
            {AVATAR_OPTIONS.map((avatar) => (
              <button
                key={avatar.id}
                type="button"
                onClick={() => setSelectedAvatarId(avatar.id)}
                style={{
                  ...avatarOptionStyle,
                  borderColor: selectedAvatarId === avatar.id ? "var(--accent)" : "var(--border)",
                  background: selectedAvatarId === avatar.id ? "var(--bg-tertiary)" : "var(--bg-primary)",
                }}
              >
                <div style={avatarIconStyle}>
                  {avatar.id === "default" ? "🤖" : "👤"}
                </div>
                <span style={avatarNameStyle}>{avatar.name}</span>
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
          <button
            onClick={handleSave}
            style={{
              ...buttonStyle,
              background: "var(--accent)",
              flex: 1,
            }}
          >
            Save
          </button>
          <button
            onClick={handleClose}
            style={{
              ...buttonStyle,
              background: "transparent",
              border: "1px solid var(--border)",
              color: "var(--text-secondary)",
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  marginBottom: 8,
  fontSize: 13,
  color: "var(--text-secondary)",
};

const buttonStyle: React.CSSProperties = {
  padding: "10px 20px",
  border: "none",
  borderRadius: 6,
  color: "white",
  fontWeight: 600,
  fontSize: 14,
  cursor: "pointer",
};

const avatarGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  gap: 8,
  maxHeight: 300,
  overflow: "auto",
  padding: 4,
};

const avatarOptionStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 4,
  padding: "8px 4px",
  border: "2px solid var(--border)",
  borderRadius: 8,
  cursor: "pointer",
  transition: "all 0.15s ease",
};

const avatarIconStyle: React.CSSProperties = {
  fontSize: 24,
  lineHeight: 1,
};

const avatarNameStyle: React.CSSProperties = {
  fontSize: 10,
  color: "var(--text-secondary)",
  textAlign: "center",
  lineHeight: 1.2,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  width: "100%",
};
