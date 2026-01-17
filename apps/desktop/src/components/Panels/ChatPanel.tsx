import { useState, useCallback, KeyboardEvent, ClipboardEvent } from "react";
import { sendMessage } from "../../lib/api";
import { useChatStore } from "../../stores/chatStore";
import { useAgentStore } from "../../stores/agentStore";
import { convertFileSrc } from "@tauri-apps/api/core";
import { writeFile, mkdir, BaseDirectory } from "@tauri-apps/plugin-fs";
import { tempDir } from "@tauri-apps/api/path";
import { readImage } from "@tauri-apps/plugin-clipboard-manager";

interface ChatPanelProps {
  agentId: string;
}

export function ChatPanel({ agentId }: ChatPanelProps) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [attachedImages, setAttachedImages] = useState<string[]>([]);
  const addUserMessage = useChatStore((state) => state.addUserMessage);
  const updateAgent = useAgentStore((state) => state.updateAgent);

  const handlePaste = useCallback(async (e: ClipboardEvent<HTMLTextAreaElement>) => {
    console.log("[ChatPanel] Paste event triggered");

    // First, try the web clipboard API for images from the event
    const items = e.clipboardData?.items;
    let foundWebImage = false;

    if (items) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        console.log("[ChatPanel] Clipboard item:", item.type);
        if (item.type.startsWith("image/")) {
          foundWebImage = true;
          break;
        }
      }
    }

    // If web API found an image, use the old method
    if (foundWebImage && items) {
      console.log("[ChatPanel] Using web clipboard API");
      e.preventDefault();

      try {
        const tempPath = await tempDir();
        const normalizedTempPath = tempPath.endsWith('/') ? tempPath : `${tempPath}/`;
        const pastedImagesDir = `${normalizedTempPath}virtual-agency-pasted-images`;

        try {
          await mkdir("virtual-agency-pasted-images", { baseDir: BaseDirectory.Temp });
        } catch (dirErr) {
          // Directory may already exist
        }

        const newImagePaths: string[] = [];

        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (!item.type.startsWith("image/")) continue;

          const blob = item.getAsFile();
          if (!blob) continue;

          const extension = blob.type.split("/")[1] || "png";
          const fileName = `pasted-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
          const filePath = `${pastedImagesDir}/${fileName}`;

          const arrayBuffer = await blob.arrayBuffer();
          const uint8Array = new Uint8Array(arrayBuffer);

          await writeFile(`virtual-agency-pasted-images/${fileName}`, uint8Array, {
            baseDir: BaseDirectory.Temp,
          });
          console.log("[ChatPanel] File written via web API:", filePath);

          newImagePaths.push(filePath);
        }

        if (newImagePaths.length > 0) {
          setAttachedImages((prev) => [...prev, ...newImagePaths]);
        }
        return;
      } catch (err) {
        console.error("[ChatPanel] Web clipboard API failed:", err);
      }
    }

    // Fallback: Try native Tauri clipboard API for images
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

              setAttachedImages((prev) => [...prev, filePath]);
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
    setSending(true);

    // Set agent to thinking state immediately for visual feedback
    updateAgent(agentId, { status: "thinking" });

    // Add user message to chat history immediately with images
    addUserMessage(agentId, messageContent, imagesToSend.length > 0 ? imagesToSend : undefined);
    setInput("");
    setAttachedImages([]);

    try {
      console.log("[ChatPanel] Sending message:", { agentId, messageContent, imagesToSend });
      await sendMessage(agentId, messageContent, imagesToSend);
      console.log("[ChatPanel] Message sent successfully");
    } catch (err) {
      console.error("[ChatPanel] Failed to send message:", err);
      // Reset agent status on error since the backend won't emit status events
      updateAgent(agentId, { status: "error" });
    } finally {
      setSending(false);
    }
  }, [agentId, input, attachedImages, sending, addUserMessage, updateAgent]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleImageSelect = useCallback(async () => {
    console.log("[ChatPanel] Opening file dialog");
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
        setAttachedImages((prev) => [...prev, ...paths]);
      }
    } catch (err) {
      console.error("[ChatPanel] Failed to open file dialog:", err);
    }
  }, []);

  const removeImage = useCallback((index: number) => {
    setAttachedImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const canSend = input.trim() || attachedImages.length > 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "12px 0 0 0",
        borderTop: "1px solid var(--border)",
      }}
    >
      {attachedImages.length > 0 && (
        <div style={imagePreviewContainerStyle}>
          {attachedImages.map((path, index) => {
            const imgSrc = convertFileSrc(path);
            console.log("[ChatPanel] Image preview src:", path, "->", imgSrc);
            return (
              <div key={`${path}-${index}`} style={imagePreviewStyle}>
                <img
                  src={imgSrc}
                  alt={`Attachment ${index + 1}`}
                  style={imagePreviewImgStyle}
                  onError={(e) => console.error("[ChatPanel] Image load error:", path, e)}
                />
                <button
                  onClick={() => removeImage(index)}
                  style={removeImageButtonStyle}
                  title="Remove image"
                >
                  x
                </button>
                <span style={imageNameStyle}>
                  {path.split("/").pop()?.slice(0, 15)}...
                </span>
              </div>
            );
          })}
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={handleImageSelect}
          disabled={sending}
          style={attachButtonStyle}
          title="Attach image"
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
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="Type a message or paste an image... (Enter to send)"
          disabled={sending}
          rows={2}
          style={{
            flex: 1,
            padding: 10,
            background: "var(--bg-primary)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            color: "var(--text-primary)",
            fontFamily: "inherit",
            fontSize: 13,
            resize: "none",
            outline: "none",
          }}
        />
        <button
          onClick={handleSend}
          disabled={!canSend || sending}
          style={{
            padding: "10px 16px",
            background: !canSend || sending ? "#444" : "var(--accent)",
            border: "none",
            borderRadius: 8,
            color: "white",
            cursor: !canSend || sending ? "not-allowed" : "pointer",
            fontWeight: 600,
            fontSize: 13,
            alignSelf: "flex-end",
          }}
        >
          {sending ? "..." : "Send"}
        </button>
      </div>
    </div>
  );
}

const attachButtonStyle: React.CSSProperties = {
  padding: 8,
  background: "transparent",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--text-primary)",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  alignSelf: "flex-end",
  height: 40,
  width: 40,
};

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
