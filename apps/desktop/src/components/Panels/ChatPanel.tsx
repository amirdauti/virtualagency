import { useState, useCallback, useRef, KeyboardEvent, ClipboardEvent, ChangeEvent, useEffect } from "react";
import { sendMessage, stopAgent, isTauri, updateAgentSettings, ClaudeModel } from "../../lib/api";
import { useChatStore } from "../../stores/chatStore";
import { useAgentStore } from "../../stores/agentStore";
import { convertFileSrc } from "@tauri-apps/api/core";
import { writeFile, mkdir, BaseDirectory } from "@tauri-apps/plugin-fs";
import { tempDir } from "@tauri-apps/api/path";
import { readImage } from "@tauri-apps/plugin-clipboard-manager";

interface ChatPanelProps {
  agentId: string;
}

// Track both file paths (for Tauri) and File objects (for browser)
interface AttachedImage {
  path: string; // File path for Tauri, or object URL for browser
  file?: File;  // Original File object for browser mode (for upload)
}

const MODEL_OPTIONS: { value: ClaudeModel; label: string }[] = [
  { value: "sonnet", label: "Sonnet" },
  { value: "opus", label: "Opus" },
  { value: "haiku", label: "Haiku" },
];

export function ChatPanel({ agentId }: ChatPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addUserMessage = useChatStore((state) => state.addUserMessage);
  const setDraft = useChatStore((state) => state.setDraft);
  const getDraft = useChatStore((state) => state.getDraft);
  const clearDraft = useChatStore((state) => state.clearDraft);
  const updateAgent = useAgentStore((state) => state.updateAgent);
  const agent = useAgentStore((state) => state.agents.find(a => a.id === agentId));

  // Initialize input from draft if available
  const [input, setInput] = useState(() => getDraft(agentId));
  const [sending, setSending] = useState(false);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);

  // Local state for model and thinking, initialized from agent
  const [selectedModel, setSelectedModel] = useState<ClaudeModel>(agent?.model || "sonnet");
  const [thinkingEnabled, setThinkingEnabled] = useState(agent?.thinkingEnabled || false);

  // Sync with agent state when it changes
  useEffect(() => {
    if (agent) {
      if (agent.model) setSelectedModel(agent.model);
      if (agent.thinkingEnabled !== undefined) setThinkingEnabled(agent.thinkingEnabled);
    }
  }, [agent?.model, agent?.thinkingEnabled]);

  // Load draft when agentId changes (switching between agents)
  useEffect(() => {
    const draft = getDraft(agentId);
    setInput(draft);
  }, [agentId, getDraft]);

  // Save draft whenever input changes
  useEffect(() => {
    setDraft(agentId, input);
  }, [input, agentId, setDraft]);

  const handleModelChange = useCallback(async (newModel: ClaudeModel) => {
    setSelectedModel(newModel);
    updateAgent(agentId, { model: newModel });
    try {
      await updateAgentSettings(agentId, newModel, undefined);
    } catch (err) {
      console.error("[ChatPanel] Failed to update model:", err);
    }
  }, [agentId, updateAgent]);

  const handleThinkingToggle = useCallback(async () => {
    const newValue = !thinkingEnabled;
    setThinkingEnabled(newValue);
    updateAgent(agentId, { thinkingEnabled: newValue });
    try {
      await updateAgentSettings(agentId, undefined, newValue);
    } catch (err) {
      console.error("[ChatPanel] Failed to update thinking mode:", err);
    }
  }, [agentId, thinkingEnabled, updateAgent]);

  const handlePaste = useCallback(async (e: ClipboardEvent<HTMLTextAreaElement>) => {
    console.log("[ChatPanel] Paste event triggered, isTauri:", isTauri());
    console.log("[ChatPanel] clipboardData:", e.clipboardData);

    // First, try the web clipboard API for images from the event
    const items = e.clipboardData?.items;
    let foundWebImage = false;

    if (items) {
      console.log("[ChatPanel] Clipboard items count:", items.length);
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        console.log("[ChatPanel] Clipboard item:", item.type, "kind:", item.kind);
        if (item.type.startsWith("image/")) {
          foundWebImage = true;
          console.log("[ChatPanel] Found image item!");
          break;
        }
      }
    } else {
      console.log("[ChatPanel] No clipboard items found");
    }

    // If web API found an image, use the old method
    if (foundWebImage && items) {
      console.log("[ChatPanel] Using web clipboard API for image");
      e.preventDefault();

      try {
        const newImages: AttachedImage[] = [];

        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (!item.type.startsWith("image/")) continue;

          console.log("[ChatPanel] Processing image item:", item.type);
          const blob = item.getAsFile();
          if (!blob) {
            console.log("[ChatPanel] Could not get blob from item");
            continue;
          }

          console.log("[ChatPanel] Got blob:", blob.size, "bytes, type:", blob.type);

          if (isTauri()) {
            // Tauri mode: save to temp directory
            try {
              const tempPath = await tempDir();
              const normalizedTempPath = tempPath.endsWith('/') ? tempPath : `${tempPath}/`;
              const pastedImagesDir = `${normalizedTempPath}virtual-agency-pasted-images`;

              try {
                await mkdir("virtual-agency-pasted-images", { baseDir: BaseDirectory.Temp });
              } catch (dirErr) {
                // Directory may already exist
              }

              const extension = blob.type.split("/")[1] || "png";
              const fileName = `pasted-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
              const filePath = `${pastedImagesDir}/${fileName}`;

              const arrayBuffer = await blob.arrayBuffer();
              const uint8Array = new Uint8Array(arrayBuffer);

              await writeFile(`virtual-agency-pasted-images/${fileName}`, uint8Array, {
                baseDir: BaseDirectory.Temp,
              });
              console.log("[ChatPanel] File written via web API:", filePath);

              newImages.push({ path: filePath });
            } catch (tauriErr) {
              // Tauri APIs not actually available (e.g., running in browser with Tauri globals present)
              console.log("[ChatPanel] Tauri file APIs not available, falling back to browser mode:", tauriErr);
              const objectUrl = URL.createObjectURL(blob);
              console.log("[ChatPanel] Created object URL for pasted image:", objectUrl);
              newImages.push({ path: objectUrl, file: blob });
            }
          } else {
            // Browser mode: use object URL for preview, keep File for upload
            const objectUrl = URL.createObjectURL(blob);
            console.log("[ChatPanel] Created object URL for pasted image:", objectUrl);
            newImages.push({ path: objectUrl, file: blob });
          }
        }

        if (newImages.length > 0) {
          console.log("[ChatPanel] Adding", newImages.length, "images to attachedImages");
          setAttachedImages((prev) => [...prev, ...newImages]);
        } else {
          console.log("[ChatPanel] No images were processed");
        }
        return;
      } catch (err) {
        console.error("[ChatPanel] Web clipboard API failed:", err);
      }
    }

    // Fallback: Try native Tauri clipboard API for images (only in Tauri mode)
    if (!isTauri()) {
      console.log("[ChatPanel] Not in Tauri mode, skipping native clipboard API");
      return;
    }

    console.log("[ChatPanel] Trying native Tauri clipboard API");
    try {
      const imageData = await readImage();

      if (imageData) {
        // Tauri clipboard-manager v2 API: rgba() and size() are async methods
        const [rgbaData, sizeData] = await Promise.all([
          imageData.rgba(),
          imageData.size()
        ]);
        const { width, height } = sizeData;

        if (rgbaData && rgbaData.length > 0) {
          console.log("[ChatPanel] Got image from native clipboard:", width, "x", height);
          e.preventDefault();

          const tempPath = await tempDir();
          const normalizedTempPath = tempPath.endsWith('/') ? tempPath : `${tempPath}/`;
          const pastedImagesDir = `${normalizedTempPath}virtual-agency-pasted-images`;

          try {
            await mkdir("virtual-agency-pasted-images", { baseDir: BaseDirectory.Temp });
          } catch (dirErr) {
            // Directory may already exist
          }

          // Convert RGBA to PNG using canvas
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');

          if (ctx) {
            const imgData = new ImageData(
              new Uint8ClampedArray(rgbaData),
              width,
              height
            );
            ctx.putImageData(imgData, 0, 0);

            const blob = await new Promise<Blob | null>((resolve) => {
              canvas.toBlob(resolve, 'image/png');
            });

            if (blob) {
              const fileName = `pasted-${Date.now()}-${Math.random().toString(36).slice(2)}.png`;
              const filePath = `${pastedImagesDir}/${fileName}`;

              const arrayBuffer = await blob.arrayBuffer();
              const uint8Array = new Uint8Array(arrayBuffer);

              await writeFile(`virtual-agency-pasted-images/${fileName}`, uint8Array, {
                baseDir: BaseDirectory.Temp,
              });
              console.log("[ChatPanel] File written via native API:", filePath);

              setAttachedImages((prev) => [...prev, { path: filePath }]);
            }
          }
        } else {
          console.log("[ChatPanel] No image data in native clipboard");
        }
      } else {
        console.log("[ChatPanel] No image in native clipboard");
      }
    } catch (err) {
      console.log("[ChatPanel] Native clipboard API failed or no image:", err);
      // Not an error - just means no image in clipboard, let text paste through
    }
  }, []);

  const handleSend = useCallback(async () => {
    if ((!input.trim() && attachedImages.length === 0) || sending) return;

    const messageContent = input.trim() || "(image attached)";
    const imagesToSend = [...attachedImages];

    // Extract paths for API call and preview URLs for chat history
    const imagePaths = imagesToSend.map(img => img.path);

    setSending(true);

    // Set agent to thinking state immediately for visual feedback
    updateAgent(agentId, { status: "thinking" });

    // Add user message to chat history immediately with images
    addUserMessage(agentId, messageContent, imagePaths.length > 0 ? imagePaths : undefined);
    setInput("");
    clearDraft(agentId); // Clear the draft after sending

    // Note: We intentionally don't revoke blob URLs here because they're used
    // by the chat history for displaying image previews. They'll be cleaned up
    // when the page is closed/refreshed.
    setAttachedImages([]);

    try {
      console.log("[ChatPanel] Sending message:", { agentId, messageContent, imagePaths });
      await sendMessage(agentId, messageContent, imagePaths);
      console.log("[ChatPanel] Message sent successfully");
    } catch (err) {
      console.error("[ChatPanel] Failed to send message:", err);
      // Reset agent status on error since the backend won't emit status events
      updateAgent(agentId, { status: "error" });
    } finally {
      setSending(false);
    }
  }, [agentId, input, attachedImages, sending, addUserMessage, updateAgent, clearDraft]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleStop = useCallback(async () => {
    try {
      console.log("[ChatPanel] Stopping agent:", agentId);
      await stopAgent(agentId);
      console.log("[ChatPanel] Agent stopped successfully");
    } catch (err) {
      console.error("[ChatPanel] Failed to stop agent:", err);
    }
  }, [agentId]);

  // Check if agent is currently working (thinking or working status)
  const isAgentWorking = agent?.status === "thinking" || agent?.status === "working";

  const handleImageSelect = useCallback(async () => {
    console.log("[ChatPanel] Opening file dialog, isTauri:", isTauri());

    if (isTauri()) {
      // Tauri mode: use native file dialog
      try {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const selected = await open({
          multiple: true,
          filters: [
            {
              name: "Images",
              extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"],
            },
          ],
        });

        console.log("[ChatPanel] File dialog result:", selected);
        if (selected) {
          const paths = Array.isArray(selected) ? selected : [selected];
          console.log("[ChatPanel] Selected paths:", paths);
          setAttachedImages((prev) => [...prev, ...paths.map(p => ({ path: p }))]);
        }
      } catch (err) {
        console.error("[ChatPanel] Failed to open file dialog:", err);
      }
    } else {
      // Browser mode: trigger hidden file input
      fileInputRef.current?.click();
    }
  }, []);

  // Handle file selection from browser file input
  const handleFileInputChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    console.log("[ChatPanel] Browser file input selected:", files.length, "files");

    const newImages: AttachedImage[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type.startsWith("image/")) continue;

      const objectUrl = URL.createObjectURL(file);
      console.log("[ChatPanel] Created object URL for selected image:", objectUrl);
      newImages.push({ path: objectUrl, file });
    }

    if (newImages.length > 0) {
      setAttachedImages((prev) => [...prev, ...newImages]);
    }

    // Reset the input so the same file can be selected again
    e.target.value = "";
  }, []);

  const removeImage = useCallback((index: number) => {
    setAttachedImages((prev) => {
      const imageToRemove = prev[index];
      // Clean up object URL for browser mode
      if (imageToRemove?.file && imageToRemove.path.startsWith('blob:')) {
        URL.revokeObjectURL(imageToRemove.path);
      }
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const canSend = input.trim() || attachedImages.length > 0;

  return (
    <div style={{ display: "flex", background: "#1a1a1a", borderTop: "1px solid var(--border)" }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          padding: "16px 16px 20px 16px",
          width: "100%",
        }}
      >
      {/* Model and Thinking Mode Controls */}
      <div style={settingsBarStyle}>
        <div style={settingGroupStyle}>
          <label style={settingLabelStyle}>Model:</label>
          <select
            value={selectedModel}
            onChange={(e) => handleModelChange(e.target.value as ClaudeModel)}
            disabled={sending}
            style={selectStyle}
          >
            {MODEL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div style={settingGroupStyle}>
          <label style={checkboxLabelStyle}>
            <input
              type="checkbox"
              checked={thinkingEnabled}
              onChange={handleThinkingToggle}
              disabled={sending}
              style={checkboxStyle}
            />
            Thinking
          </label>
        </div>
      </div>

      {attachedImages.length > 0 && (
        <div style={imagePreviewContainerStyle}>
          {attachedImages.map((img, index) => {
            // For browser mode (object URLs), use the path directly
            // For Tauri mode (file paths), use convertFileSrc
            const imgSrc = img.file ? img.path : convertFileSrc(img.path);
            const fileName = img.file ? img.file.name : img.path.split("/").pop() || "image";
            console.log("[ChatPanel] Image preview src:", img.path, "->", imgSrc);
            return (
              <div key={`${img.path}-${index}`} style={imagePreviewStyle}>
                <img
                  src={imgSrc}
                  alt={`Attachment ${index + 1}`}
                  style={imagePreviewImgStyle}
                  onError={(e) => console.error("[ChatPanel] Image load error:", img.path, e)}
                />
                <button
                  onClick={() => removeImage(index)}
                  style={removeImageButtonStyle}
                  title="Remove image"
                >
                  x
                </button>
                <span style={imageNameStyle}>
                  {fileName.slice(0, 15)}...
                </span>
              </div>
            );
          })}
        </div>
      )}
      {/* Hidden file input for browser mode */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
        multiple
        onChange={handleFileInputChange}
        style={{ display: "none" }}
      />

      {/* Modern input container with buttons inside */}
      <div style={{
        position: "relative",
        width: "100%",
        display: "flex",
        alignItems: "flex-end",
        background: "#252526",
        border: "1px solid #3c3c3c",
        borderRadius: 8,
        transition: "border-color 0.2s ease",
      }}
        onFocus={(e) => e.currentTarget.style.borderColor = "#007fd4"}
        onBlur={(e) => e.currentTarget.style.borderColor = "#3c3c3c"}
      >
        {/* Attach image button - inside input on left */}
        <button
          onClick={handleImageSelect}
          disabled={sending}
          style={{
            padding: "10px",
            background: "transparent",
            border: "none",
            color: sending ? "#666" : "#969696",
            cursor: sending ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            transition: "color 0.2s ease",
          }}
          title="Attach image (Ctrl+V to paste)"
          aria-label="Attach image"
          onMouseEnter={(e) => {
            if (!sending) e.currentTarget.style.color = "#cccccc";
          }}
          onMouseLeave={(e) => {
            if (!sending) e.currentTarget.style.color = "#969696";
          }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        </button>

        {/* Textarea */}
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="Ask me anything... (Shift+Enter for new line, Ctrl+V to paste images)"
          disabled={sending}
          rows={2}
          className="chat-textarea"
          style={{
            flex: 1,
            padding: "12px 8px",
            background: "transparent",
            border: "none",
            color: "#cccccc",
            fontFamily: "inherit",
            fontSize: 13,
            resize: "none",
            minHeight: 44,
            maxHeight: 200,
            outline: "none",
          }}
        />

        {/* Send/Stop button - inside input on right */}
        {isAgentWorking ? (
          <button
            onClick={handleStop}
            style={{
              margin: "6px",
              padding: "8px 16px",
              background: "#854d0e",
              border: "1px solid #a16207",
              borderRadius: 6,
              color: "#fef3c7",
              cursor: "pointer",
              fontWeight: 500,
              fontSize: 13,
              flexShrink: 0,
              height: 32,
              transition: "all 0.2s ease",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#a16207";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "#854d0e";
            }}
            aria-label="Stop agent"
          >
            Stop
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!canSend || sending}
            style={{
              margin: "6px",
              padding: "8px 16px",
              background: !canSend || sending ? "#2d2d2d" : "#007fd4",
              border: "1px solid " + (!canSend || sending ? "#3c3c3c" : "#0098ff"),
              borderRadius: 6,
              color: !canSend || sending ? "#666" : "white",
              cursor: !canSend || sending ? "not-allowed" : "pointer",
              fontWeight: 500,
              fontSize: 13,
              flexShrink: 0,
              height: 32,
              transition: "all 0.2s ease",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            onMouseEnter={(e) => {
              if (canSend && !sending) {
                e.currentTarget.style.background = "#0098ff";
              }
            }}
            onMouseLeave={(e) => {
              if (canSend && !sending) {
                e.currentTarget.style.background = "#007fd4";
              }
            }}
            aria-label="Send message"
          >
            {sending ? "Sending..." : "Send"}
          </button>
        )}
      </div>
      </div>
    </div>
  );
}

const imagePreviewContainerStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  padding: 8,
  background: "var(--bg-primary)",
  borderRadius: 8,
  border: "1px solid var(--border)",
};

const imagePreviewStyle: React.CSSProperties = {
  position: "relative",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 4,
};

const imagePreviewImgStyle: React.CSSProperties = {
  width: 60,
  height: 60,
  objectFit: "cover",
  borderRadius: 6,
  border: "1px solid var(--border)",
};

const removeImageButtonStyle: React.CSSProperties = {
  position: "absolute",
  top: -6,
  right: -6,
  width: 18,
  height: 18,
  borderRadius: "50%",
  background: "#ef4444",
  border: "none",
  color: "white",
  fontSize: 12,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  lineHeight: 1,
};

const imageNameStyle: React.CSSProperties = {
  fontSize: 10,
  color: "#888",
  maxWidth: 60,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const settingsBarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
};

const settingGroupStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  height: 28,
};

const settingLabelStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text-secondary)",
};

const selectStyle: React.CSSProperties = {
  padding: "4px 8px",
  height: 28,
  background: "var(--bg-primary)",
  border: "1px solid var(--border)",
  borderRadius: 4,
  color: "var(--text-primary)",
  fontSize: 12,
  cursor: "pointer",
  outline: "none",
};

const checkboxLabelStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 12,
  color: "var(--text-secondary)",
  cursor: "pointer",
  height: 28,
  padding: "0 10px",
  borderRadius: 4,
  border: "1px solid var(--border)",
  background: "var(--bg-primary)",
  transition: "all 0.2s ease",
  userSelect: "none",
};

const checkboxStyle: React.CSSProperties = {
  width: 16,
  height: 16,
  cursor: "pointer",
  accentColor: "#3b82f6",
  flexShrink: 0,
};
