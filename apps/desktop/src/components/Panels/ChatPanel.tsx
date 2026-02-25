import { useState, useCallback, useRef, KeyboardEvent, ClipboardEvent, ChangeEvent, useEffect } from "react";
import { createAgent, sendMessage, stopAgent, isTauri, updateAgentSettings, ClaudeModel, CodexModel, ReasoningEffort } from "../../lib/api";
import { useChatStore } from "../../stores/chatStore";
import { useAgentStore } from "../../stores/agentStore";
import { useChatUIStore, DraftImageAttachment } from "../../stores/chatUIStore";
import type { AgentAutomation } from "@virtual-agency/shared";
import { convertFileSrc } from "@tauri-apps/api/core";
import { writeFile, mkdir, BaseDirectory } from "@tauri-apps/plugin-fs";
import { join, tempDir } from "@tauri-apps/api/path";
import { readImage } from "@tauri-apps/plugin-clipboard-manager";
import { useIsMobile } from "../../hooks/useIsMobile";

interface ChatPanelProps {
  agentId: string;
}

type PromptKind = "one_off" | "scheduled";

const EMPTY_DRAFT_IMAGES: DraftImageAttachment[] = [];

const CLAUDE_MODEL_OPTIONS: { value: ClaudeModel; label: string }[] = [
  { value: "sonnet", label: "Sonnet 4.5 (Latest)" },
  { value: "opus", label: "Opus 4.6 (Latest)" },
  { value: "haiku", label: "Haiku" },
];

const CODEX_MODEL_OPTIONS: { value: CodexModel; label: string }[] = [
  { value: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
  { value: "gpt-5.2-codex", label: "GPT-5.2 Codex" },
  { value: "gpt-5.2", label: "GPT-5.2" },
  { value: "gpt-5.1-codex-max", label: "GPT-5.1 Codex Max" },
  { value: "gpt-5.1-codex", label: "GPT-5.1 Codex" },
  { value: "gpt-5.1", label: "GPT-5.1" },
  { value: "gpt-5-codex", label: "GPT-5 Codex" },
  { value: "gpt-5", label: "GPT-5" },
  { value: "gpt-5-mini", label: "GPT-5 Mini" },
  { value: "o3", label: "o3" },
  { value: "o4-mini", label: "o4-mini" },
  { value: "gpt-4.1", label: "GPT-4.1" },
];

const REASONING_EFFORT_OPTIONS: { value: ReasoningEffort; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra High" },
];

const SCHEDULED_TASK_EXAMPLES = [
  "See if you need to reply to any tweets or DMs",
  "See if you need to reply to emails",
];

const AUTOMATION_INTERVAL_OPTIONS = [
  { value: 5, label: "Every 5m" },
  { value: 15, label: "Every 15m" },
  { value: 30, label: "Every 30m" },
  { value: 60, label: "Every 1h" },
  { value: 180, label: "Every 3h" },
  { value: 360, label: "Every 6h" },
  { value: 720, label: "Every 12h" },
  { value: 1440, label: "Every 24h" },
];

function formatInterval(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

function buildScheduledMessage(taskDescription: string, prompt: string, automationId?: string): string {
  return [
    "[SCHEDULED_TASK]",
    ...(automationId ? [`automation_id: ${automationId}`] : []),
    `scheduled_at: ${new Date().toISOString()}`,
    `task_description: ${taskDescription.trim() || "Run recurring check task"}`,
    "",
    "This prompt was triggered by a recurring scheduled task. Complete the task now and report findings clearly.",
    "",
    prompt,
  ].join("\n");
}

function createClientMessageId(agentId: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${agentId}-user-${crypto.randomUUID()}`;
  }
  return `${agentId}-user-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function ChatPanel({ agentId }: ChatPanelProps) {
  const isMobile = useIsMobile(900);
  const isSmallPhone = useIsMobile(640);
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
  const attachedImages = useChatUIStore((state) => state.draftImagesByAgent[agentId] ?? EMPTY_DRAFT_IMAGES);
  const addDraftImages = useChatUIStore((state) => state.addDraftImages);
  const removeDraftImage = useChatUIStore((state) => state.removeDraftImage);
  const clearDraftImages = useChatUIStore((state) => state.clearDraftImages);

  // Determine if this is a Codex agent
  const isCodexAgent = agent?.cliType === "codex";

  // Local state for model and thinking/reasoning, initialized from agent
  const defaultModel = isCodexAgent ? "gpt-5.2-codex" : "sonnet";
  const [selectedModel, setSelectedModel] = useState<string>(agent?.model || defaultModel);
  const [thinkingEnabled, setThinkingEnabled] = useState(agent?.thinkingEnabled || false);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(agent?.reasoningEffort || "medium");
  const [promptKind, setPromptKind] = useState<PromptKind>("one_off");
  const [scheduledTaskDescription, setScheduledTaskDescription] = useState<string>(SCHEDULED_TASK_EXAMPLES[0]);
  const [automationIntervalMinutes, setAutomationIntervalMinutes] = useState<number>(60);
  const [runningAutomationId, setRunningAutomationId] = useState<string | null>(null);

  const automations = agent?.automations ?? [];

  const isAgentNotFoundError = useCallback((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err || "");
    return /agent not found/i.test(message);
  }, []);

  // Sync with agent state when it changes
  useEffect(() => {
    if (agent) {
      if (agent.model) setSelectedModel(agent.model);
      if (agent.thinkingEnabled !== undefined) setThinkingEnabled(agent.thinkingEnabled);
      if (agent.reasoningEffort) setReasoningEffort(agent.reasoningEffort);
    }
  }, [agent?.model, agent?.thinkingEnabled, agent?.reasoningEffort]);

  // Load draft when agentId changes (switching between agents)
  useEffect(() => {
    const draft = getDraft(agentId);
    setInput(draft);
  }, [agentId, getDraft]);

  // Save draft whenever input changes
  useEffect(() => {
    setDraft(agentId, input);
  }, [input, agentId, setDraft]);

  const handleModelChange = useCallback(async (newModel: string) => {
    setSelectedModel(newModel);
    updateAgent(agentId, { model: newModel });
    try {
      await updateAgentSettings(agentId, { model: newModel });
    } catch (err) {
      console.error("[ChatPanel] Failed to update model:", err);
    }
  }, [agentId, updateAgent, isCodexAgent]);

  const handleThinkingToggle = useCallback(async () => {
    const newValue = !thinkingEnabled;
    setThinkingEnabled(newValue);
    updateAgent(agentId, { thinkingEnabled: newValue });
    try {
      await updateAgentSettings(agentId, { thinkingEnabled: newValue });
    } catch (err) {
      console.error("[ChatPanel] Failed to update thinking mode:", err);
    }
  }, [agentId, thinkingEnabled, updateAgent]);

  const handleReasoningEffortChange = useCallback(async (effort: ReasoningEffort) => {
    setReasoningEffort(effort);
    updateAgent(agentId, { reasoningEffort: effort });
    try {
      await updateAgentSettings(agentId, { reasoningEffort: effort });
    } catch (err) {
      console.error("[ChatPanel] Failed to update reasoning effort:", err);
    }
  }, [agentId, updateAgent]);

  const handleCreateAutomation = useCallback(() => {
    const prompt = input.trim() || scheduledTaskDescription.trim();
    if (!prompt) return;

    const now = Date.now();
    const automation: AgentAutomation = {
      id: `automation-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      taskDescription: scheduledTaskDescription.trim() || prompt,
      prompt,
      intervalMinutes: automationIntervalMinutes,
      enabled: true,
      createdAt: new Date(now).toISOString(),
      nextRunAt: new Date(now + automationIntervalMinutes * 60_000).toISOString(),
    };

    updateAgent(agentId, {
      automations: [...automations, automation],
    });
    setInput("");
    clearDraft(agentId);
  }, [
    agentId,
    input,
    scheduledTaskDescription,
    automationIntervalMinutes,
    updateAgent,
    automations,
    clearDraft,
  ]);

  const handleToggleAutomation = useCallback((automationId: string, enabled: boolean) => {
    const now = Date.now();
    updateAgent(agentId, {
      automations: automations.map((automation) => {
        if (automation.id !== automationId) return automation;
        return {
          ...automation,
          enabled,
          nextRunAt: enabled
            ? new Date(now + automation.intervalMinutes * 60_000).toISOString()
            : automation.nextRunAt,
        };
      }),
    });
  }, [agentId, automations, updateAgent]);

  const handleDeleteAutomation = useCallback((automationId: string) => {
    updateAgent(agentId, {
      automations: automations.filter((automation) => automation.id !== automationId),
    });
  }, [agentId, automations, updateAgent]);

  const handleRunAutomationNow = useCallback(async (automation: AgentAutomation) => {
    if (runningAutomationId) return;
    setRunningAutomationId(automation.id);
    const now = Date.now();

    try {
      const message = buildScheduledMessage(automation.taskDescription, automation.prompt, automation.id);
      const clientMessageId = createClientMessageId(agentId);
      addUserMessage(agentId, `[Automation] ${automation.taskDescription}`, undefined, clientMessageId);
      updateAgent(agentId, { status: "thinking" });
      await sendMessage(
        agentId,
        message,
        undefined,
        clientMessageId,
        agent?.runtime === "hosted" ? "hosted" : "local",
      );

      updateAgent(agentId, {
        automations: automations.map((entry) =>
          entry.id === automation.id
            ? {
                ...entry,
                lastRunAt: new Date(now).toISOString(),
                nextRunAt: new Date(now + entry.intervalMinutes * 60_000).toISOString(),
              }
            : entry,
        ),
      });
    } catch (err) {
      console.error("[ChatPanel] Failed to run automation now:", err);
      updateAgent(agentId, { status: "error" });
    } finally {
      setRunningAutomationId(null);
    }
  }, [agent?.runtime, agentId, automations, addUserMessage, runningAutomationId, updateAgent]);

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
        const newImages: DraftImageAttachment[] = [];

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

              try {
                await mkdir("virtual-agency-pasted-images", { baseDir: BaseDirectory.Temp });
              } catch (dirErr) {
                // Directory may already exist
              }

              const extension = blob.type.split("/")[1] || "png";
              const fileName = `pasted-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
              const filePath = await join(tempPath, "virtual-agency-pasted-images", fileName);

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
          addDraftImages(agentId, newImages);
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
              const filePath = await join(tempPath, "virtual-agency-pasted-images", fileName);

              const arrayBuffer = await blob.arrayBuffer();
              const uint8Array = new Uint8Array(arrayBuffer);

              await writeFile(`virtual-agency-pasted-images/${fileName}`, uint8Array, {
                baseDir: BaseDirectory.Temp,
              });
              console.log("[ChatPanel] File written via native API:", filePath);

              addDraftImages(agentId, [{ path: filePath }]);
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
  }, [addDraftImages, agentId]);

  const handleSend = useCallback(async () => {
    if ((!input.trim() && attachedImages.length === 0) || sending) return;

    const messageContent = input.trim() || "(image attached)";
    const outgoingMessage = promptKind === "scheduled"
      ? buildScheduledMessage(scheduledTaskDescription, messageContent)
      : messageContent;
    const imagesToSend = [...attachedImages];

    // Resolve paths for API call (in Tauri mode we need real filesystem paths)
    const imagePaths: string[] = [];
    if (isTauri()) {
      for (const img of imagesToSend) {
        if (img.path.startsWith("blob:") && img.file) {
          try {
            const tempPath = await tempDir();
            await mkdir("virtual-agency-pasted-images", { baseDir: BaseDirectory.Temp }).catch(() => {});

            const inferredExt = img.file.type?.split("/")[1] || "png";
            const fileName = `pasted-${Date.now()}-${Math.random().toString(36).slice(2)}.${inferredExt}`;
            const filePath = await join(tempPath, "virtual-agency-pasted-images", fileName);

            const arrayBuffer = await img.file.arrayBuffer();
            await writeFile(`virtual-agency-pasted-images/${fileName}`, new Uint8Array(arrayBuffer), {
              baseDir: BaseDirectory.Temp,
            });

            imagePaths.push(filePath);
          } catch (err) {
            console.warn("[ChatPanel] Failed to materialize blob image to file path for Tauri:", err);
          }
        } else {
          imagePaths.push(img.path);
        }
      }
    } else {
      // Browser mode: paths are blob: URLs for upload conversion
      imagePaths.push(...imagesToSend.map((img) => img.path));
    }

    setSending(true);

    // Set agent to thinking state immediately for visual feedback
    updateAgent(agentId, { status: "thinking" });

    const clientMessageId = createClientMessageId(agentId);

    // Add user message to chat history immediately with images.
    // Server echo (browser mode) uses the same message id, so it de-dupes cleanly.
    addUserMessage(
      agentId,
      messageContent,
      imagePaths.length > 0 ? imagePaths : undefined,
      clientMessageId
    );
    setInput("");
    clearDraft(agentId); // Clear the draft after sending

    // Note: We intentionally don't revoke blob URLs here because they're used
    // by the chat history for displaying image previews. They'll be cleaned up
    // when the page is closed/refreshed.
    clearDraftImages(agentId);

    try {
      console.log("[ChatPanel] Sending message:", { agentId, outgoingMessage, imagePaths, promptKind });
      await sendMessage(
        agentId,
        outgoingMessage,
        imagePaths,
        clientMessageId,
        agent?.runtime === "hosted" ? "hosted" : "local",
      );
      console.log("[ChatPanel] Message sent successfully");
    } catch (err) {
      if (!isTauri() && agent && isAgentNotFoundError(err)) {
        try {
          console.warn("[ChatPanel] Agent missing on server, attempting recreate + retry:", agentId);
          await createAgent(agent.id, agent.workingDirectory, {
            model: agent.model,
            thinkingEnabled: agent.thinkingEnabled,
            reasoningEffort: agent.reasoningEffort,
            mcpServers: agent.mcpServers,
            sessionId: agent.sessionId,
            cliType: agent.cliType,
            specialty: agent.specialty,
            runtime: agent.runtime || "local",
          });
          await sendMessage(
            agentId,
            outgoingMessage,
            imagePaths,
            clientMessageId,
            agent.runtime === "hosted" ? "hosted" : "local",
          );
          console.log("[ChatPanel] Message sent successfully after agent recreate");
          return;
        } catch (recreateErr) {
          console.error("[ChatPanel] Agent recreate + retry failed:", recreateErr);
        }
      }
      console.error("[ChatPanel] Failed to send message:", err);
      // Reset agent status on error since the backend won't emit status events
      updateAgent(agentId, { status: "error" });
    } finally {
      setSending(false);
    }
  }, [
    agentId,
    input,
    attachedImages,
    sending,
    addUserMessage,
    updateAgent,
    clearDraft,
    clearDraftImages,
    agent,
    isAgentNotFoundError,
    promptKind,
    scheduledTaskDescription,
  ]);

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
          addDraftImages(agentId, paths.map((p) => ({ path: p })));
        }
      } catch (err) {
        console.error("[ChatPanel] Failed to open file dialog:", err);
      }
    } else {
      // Browser mode: trigger hidden file input
      fileInputRef.current?.click();
    }
  }, [addDraftImages, agentId]);

  // Handle file selection from browser file input
  const handleFileInputChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    console.log("[ChatPanel] Browser file input selected:", files.length, "files");

    const newImages: DraftImageAttachment[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type.startsWith("image/")) continue;

      const objectUrl = URL.createObjectURL(file);
      console.log("[ChatPanel] Created object URL for selected image:", objectUrl);
      newImages.push({ path: objectUrl, file });
    }

    if (newImages.length > 0) {
      addDraftImages(agentId, newImages);
    }

    // Reset the input so the same file can be selected again
    e.target.value = "";
  }, [addDraftImages, agentId]);

  const removeImage = useCallback((index: number) => {
    const imageToRemove = attachedImages[index];
    // Clean up object URL for browser mode
    if (imageToRemove?.file && imageToRemove.path.startsWith("blob:")) {
      URL.revokeObjectURL(imageToRemove.path);
    }
    removeDraftImage(agentId, index);
  }, [agentId, attachedImages, removeDraftImage]);

  const canSend = input.trim() || attachedImages.length > 0;

  return (
    <div style={{ display: "flex", flex: 1, minHeight: 0, height: "100%", background: "#1a1a1a", borderTop: "1px solid var(--border)" }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
          height: "100%",
          gap: isMobile ? 10 : 12,
          padding: isMobile
            ? "10px 12px calc(12px + env(safe-area-inset-bottom, 0px)) 12px"
            : "16px 16px 20px 16px",
          width: "100%",
        }}
      >
      {/* Model and Thinking/Reasoning Controls */}
      <div
        style={{
          ...settingsBarStyle,
          flexWrap: "wrap",
          alignItems: isMobile ? "stretch" : "center",
          gap: isMobile ? 8 : 12,
        }}
      >
        <div
          style={{
            ...settingGroupStyle,
            height: isMobile ? "auto" : 28,
            width: isMobile ? "100%" : "auto",
            flexWrap: isMobile ? "wrap" : "nowrap",
          }}
        >
          <label style={settingLabelStyle}>Model:</label>
          <select
            value={selectedModel}
            onChange={(e) => handleModelChange(e.target.value)}
            disabled={sending}
            style={{
              ...selectStyle,
              height: isMobile ? 38 : 28,
              width: isMobile ? "100%" : undefined,
              fontSize: isMobile ? 13 : 12,
            }}
          >
            {(isCodexAgent ? CODEX_MODEL_OPTIONS : CLAUDE_MODEL_OPTIONS).map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        {isCodexAgent ? (
          // Codex: Show reasoning effort selector
          <div
            style={{
              ...settingGroupStyle,
              height: isMobile ? "auto" : 28,
              width: isMobile ? "100%" : "auto",
              flexWrap: isMobile ? "wrap" : "nowrap",
            }}
          >
            <label style={settingLabelStyle}>Reasoning:</label>
            <select
              value={reasoningEffort}
              onChange={(e) => handleReasoningEffortChange(e.target.value as ReasoningEffort)}
              disabled={sending}
              style={{
                ...selectStyle,
                height: isMobile ? 38 : 28,
                width: isMobile ? "100%" : undefined,
                fontSize: isMobile ? 13 : 12,
              }}
            >
              {REASONING_EFFORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        ) : (
          // Claude: Show thinking toggle
          <div style={{ ...settingGroupStyle, width: isMobile ? "100%" : "auto", height: isMobile ? 38 : 28 }}>
            <label
              style={{
                ...checkboxLabelStyle,
                height: isMobile ? 38 : 28,
                width: isMobile ? "100%" : undefined,
              }}
            >
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
        )}
        <div
          style={{
            ...settingGroupStyle,
            width: isMobile ? "100%" : "auto",
            height: isMobile ? "auto" : 28,
            flexWrap: isMobile ? "wrap" : "nowrap",
          }}
        >
          <label style={settingLabelStyle}>Prompt Type:</label>
          <select
            value={promptKind}
            onChange={(e) => setPromptKind(e.target.value as PromptKind)}
            disabled={sending}
            style={{
              ...selectStyle,
              height: isMobile ? 38 : 28,
              width: isMobile ? "100%" : undefined,
              fontSize: isMobile ? 13 : 12,
            }}
          >
            <option value="one_off">One-off</option>
            <option value="scheduled">Scheduled Task</option>
          </select>
        </div>
        {promptKind === "scheduled" && (
          <div style={{ ...settingGroupStyle, minWidth: isMobile ? 0 : 260, flex: 1, width: isMobile ? "100%" : undefined }}>
            <input
              value={scheduledTaskDescription}
              onChange={(e) => setScheduledTaskDescription(e.target.value)}
              disabled={sending}
              placeholder='e.g. "See if you need to reply to emails"'
              style={{
                ...selectStyle,
                width: "100%",
                height: isMobile ? 38 : 28,
                fontSize: isMobile ? 13 : 12,
                cursor: "text",
                fontFamily: "inherit",
              }}
            />
          </div>
        )}
      </div>

      {promptKind === "scheduled" && (
        <div
          style={{
            ...automationComposerStyle,
            padding: isMobile ? "10px" : "8px 10px",
          }}
        >
          <div style={{ ...automationComposerControlsStyle, gap: isMobile ? 10 : 8 }}>
            <label style={settingLabelStyle}>Run Every:</label>
            <select
              value={automationIntervalMinutes}
              onChange={(e) => setAutomationIntervalMinutes(Number(e.target.value))}
              disabled={sending}
              style={{
                ...selectStyle,
                height: isMobile ? 38 : 28,
                fontSize: isMobile ? 13 : 12,
              }}
            >
              {AUTOMATION_INTERVAL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <button
              onClick={handleCreateAutomation}
              disabled={sending || (!input.trim() && !scheduledTaskDescription.trim())}
              style={{
                ...automationPrimaryButtonStyle,
                height: isMobile ? 38 : 28,
                fontSize: isMobile ? 13 : 12,
              }}
            >
              Save Automation
            </button>
          </div>
        </div>
      )}

      {automations.length > 0 && (
        <div
          style={{
            ...automationListStyle,
            maxHeight: isMobile ? 200 : 220,
          }}
        >
          <div style={automationListHeaderStyle}>Automations</div>
          {automations.map((automation) => (
            <div key={automation.id} style={automationCardStyle}>
              <div style={automationCardTopStyle}>
                <div style={automationTitleStyle}>{automation.taskDescription || automation.prompt}</div>
                <div style={automationMetaStyle}>
                  {formatInterval(automation.intervalMinutes)}
                </div>
              </div>
              <div style={automationMetaStyle}>
                Next: {new Date(automation.nextRunAt).toLocaleString()}
                {automation.lastRunAt ? ` • Last: ${new Date(automation.lastRunAt).toLocaleString()}` : ""}
              </div>
              <div style={automationActionsStyle}>
                <label style={automationToggleLabelStyle}>
                  <input
                    type="checkbox"
                    checked={automation.enabled}
                    onChange={(e) => handleToggleAutomation(automation.id, e.target.checked)}
                    style={checkboxStyle}
                  />
                  Enabled
                </label>
                <button
                  onClick={() => handleRunAutomationNow(automation)}
                  disabled={runningAutomationId === automation.id}
                  style={automationSecondaryButtonStyle}
                >
                  {runningAutomationId === automation.id ? "Running..." : "Run Now"}
                </button>
                <button
                  onClick={() => handleDeleteAutomation(automation.id)}
                  style={automationDeleteButtonStyle}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {attachedImages.length > 0 && (
        <div style={{ ...imagePreviewContainerStyle, maxHeight: isMobile ? 112 : 96 }}>
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
        flex: 1,
        minHeight: isMobile ? 118 : 0,
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
            padding: isMobile ? "12px" : "10px",
            background: "transparent",
            border: "none",
            color: sending ? "#666" : "#969696",
            cursor: sending ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            transition: "color 0.2s ease",
            minWidth: isMobile ? 44 : undefined,
            minHeight: isMobile ? 44 : undefined,
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
          placeholder={isSmallPhone ? "Ask anything… (Shift+Enter for newline)" : "Ask me anything... (Shift+Enter for new line, Ctrl+V to paste images)"}
          disabled={sending}
          rows={2}
          className="chat-textarea"
          style={{
            flex: 1,
            padding: isMobile ? "12px 10px" : "12px 8px",
            background: "transparent",
            border: "none",
            color: "#cccccc",
            fontFamily: "inherit",
            fontSize: isMobile ? 16 : 13,
            resize: "none",
            minHeight: 0,
            height: "100%",
            maxHeight: "none",
            outline: "none",
          }}
        />

        {/* Send/Stop button - inside input on right */}
        {isAgentWorking ? (
          <button
            onClick={handleStop}
            style={{
              margin: isMobile ? "8px" : "6px",
              padding: isMobile ? "10px 14px" : "8px 16px",
              background: "#854d0e",
              border: "1px solid #a16207",
              borderRadius: 6,
              color: "#fef3c7",
              cursor: "pointer",
              fontWeight: 500,
              fontSize: isMobile ? 14 : 13,
              flexShrink: 0,
              height: isMobile ? 40 : 32,
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
              margin: isMobile ? "8px" : "6px",
              padding: isMobile ? "10px 14px" : "8px 16px",
              background: !canSend || sending ? "#2d2d2d" : "#007fd4",
              border: "1px solid " + (!canSend || sending ? "#3c3c3c" : "#0098ff"),
              borderRadius: 6,
              color: !canSend || sending ? "#666" : "white",
              cursor: !canSend || sending ? "not-allowed" : "pointer",
              fontWeight: 500,
              fontSize: isMobile ? 14 : 13,
              flexShrink: 0,
              height: isMobile ? 40 : 32,
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
            {sending ? (isSmallPhone ? "..." : "Sending...") : "Send"}
          </button>
        )}
      </div>
      </div>
    </div>
  );
}

const imagePreviewContainerStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "nowrap",
  gap: 8,
  padding: 8,
  background: "var(--bg-primary)",
  borderRadius: 8,
  border: "1px solid var(--border)",
  overflowX: "auto",
  maxHeight: 96,
};

const imagePreviewStyle: React.CSSProperties = {
  position: "relative",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 4,
  flexShrink: 0,
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

const automationComposerStyle: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "8px 10px",
  background: "var(--bg-primary)",
};

const automationComposerControlsStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
};

const automationPrimaryButtonStyle: React.CSSProperties = {
  height: 28,
  padding: "0 10px",
  borderRadius: 4,
  border: "1px solid #2f6f42",
  background: "#11301b",
  color: "#9ae6b4",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};

const automationListStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: "8px 10px",
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "var(--bg-primary)",
  maxHeight: 220,
  overflowY: "auto",
};

const automationListHeaderStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: "var(--text-secondary)",
};

const automationCardStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  padding: 8,
  borderRadius: 6,
  border: "1px solid #3c3c3c",
  background: "#1e1e1e",
};

const automationCardTopStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 8,
};

const automationTitleStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "#e5e7eb",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const automationMetaStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#9ca3af",
};

const automationActionsStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
};

const automationToggleLabelStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 11,
  color: "#cbd5e1",
};

const automationSecondaryButtonStyle: React.CSSProperties = {
  height: 24,
  padding: "0 8px",
  borderRadius: 4,
  border: "1px solid #3c3c3c",
  background: "#252526",
  color: "#d1d5db",
  fontSize: 11,
  cursor: "pointer",
};

const automationDeleteButtonStyle: React.CSSProperties = {
  height: 24,
  padding: "0 8px",
  borderRadius: 4,
  border: "1px solid rgba(239,68,68,0.35)",
  background: "rgba(239,68,68,0.12)",
  color: "#fca5a5",
  fontSize: 11,
  cursor: "pointer",
};
