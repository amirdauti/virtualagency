import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export interface ChatMessage {
  id: string;
  agentId: string;
  role: "user" | "assistant" | "activity";
  content: string;
  timestamp: number;
  isStreaming?: boolean;
  // Activity-specific fields
  activityType?: "read" | "write" | "edit" | "bash" | "search" | "tool" | "thinking" | "todo";
  activityDetails?: string; // e.g., file path, command
  // Image attachments (for user messages)
  images?: string[]; // Array of image file paths
  // Thinking content (for expandable thinking blocks)
  thinkingContent?: string;
  thinkingTokens?: number;
  // Diff data for Edit/Write activities
  diffData?: {
    filePath: string;
    oldContent?: string;
    newContent?: string;
    // Optional 1-based start line numbers for the preview blocks, so diffs can show
    // real file line numbers even when we only render a window around the change.
    oldStartLine?: number;
    newStartLine?: number;
    linesAdded?: number;
    linesRemoved?: number;
  };
  // Todo data for TodoWrite activities
  todoData?: {
    todos: Array<{
      content: string;
      status: "pending" | "in_progress" | "completed";
      activeForm: string;
    }>;
  };
}

interface ChatState {
  messages: ChatMessage[];
  activities: Record<string, string>; // agentId -> current activity
  draftMessages: Record<string, string>; // agentId -> draft message text
  addUserMessage: (
    agentId: string,
    content: string,
    images?: string[],
    messageId?: string
  ) => void;
  addAssistantMessage: (agentId: string, content: string) => void;
  appendToLastAssistantMessage: (agentId: string, content: string) => void;
  replaceLastAssistantMessage: (agentId: string, content: string) => void;
  finishStreaming: (agentId: string) => void;
  getMessagesForAgent: (agentId: string) => ChatMessage[];
  clearMessagesForAgent: (agentId: string) => void;
  addActivity: (agentId: string, activity: string) => void;
  addActivityMessage: (
    agentId: string,
    content: string,
    type: ChatMessage["activityType"],
    details?: string,
    diffData?: ChatMessage["diffData"],
    todoData?: ChatMessage["todoData"],
    thinkingContent?: string,
    thinkingTokens?: number
  ) => string;
  updateMessage: (messageId: string, updates: Partial<ChatMessage>) => void;
  clearActivity: (agentId: string) => void;
  getActivity: (agentId: string) => string | undefined;
  setDraft: (agentId: string, draft: string) => void;
  getDraft: (agentId: string) => string;
  clearDraft: (agentId: string) => void;
}

const CHAT_STORAGE_KEY = "virtual-agency-chat";
// localStorage is tiny (~5MB). Keep persisted history bounded and aggressively
// strip heavy fields to avoid QuotaExceededError crashes in the web app.
const MAX_PERSIST_MESSAGES_TOTAL = 400;
const MAX_PERSIST_MESSAGE_CHARS = 12_000;
const MAX_PERSIST_THINKING_CHARS = 12_000;
const MAX_PERSIST_DIFF_CHARS = 8_000;
const MAX_PERSIST_DIFF_LINES = 220;
const MAX_PERSIST_TOTAL_CHARS = 2_500_000; // ~2.5MB JSON safety margin

function clampString(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "…";
}

function clampMultiline(text: string, maxLines: number, maxChars: number): string {
  let out = text;
  const lines = out.split("\n");
  if (maxLines > 0 && lines.length > maxLines) {
    out = lines.slice(0, maxLines).join("\n") + "\n… (truncated)";
  }
  if (maxChars > 0 && out.length > maxChars) {
    out = out.slice(0, maxChars) + "\n… (truncated)";
  }
  return out;
}

function isQuotaExceededError(err: unknown): boolean {
  const anyErr = err as { name?: string; message?: string; code?: unknown } | null;
  const name = anyErr?.name || "";
  const message = anyErr?.message || "";
  // Common cases: QuotaExceededError (Chrome), NS_ERROR_DOM_QUOTA_REACHED (Firefox)
  return (
    name.includes("Quota") ||
    name.includes("NS_ERROR_DOM_QUOTA_REACHED") ||
    message.toLowerCase().includes("quota")
  );
}

function createSafeStorage(storage: Storage) {
  return {
    getItem: (name: string) => {
      try {
        return storage.getItem(name);
      } catch {
        return null;
      }
    },
    setItem: (name: string, value: string) => {
      try {
        storage.setItem(name, value);
      } catch (err) {
        // Never crash the UI because localStorage is full.
        if (isQuotaExceededError(err)) {
          try {
            storage.removeItem(name);
            storage.setItem(name, value);
            console.warn(`[chatStore] localStorage quota exceeded; cleared '${name}' and retried`);
            return;
          } catch {
            // ignore
          }
        }
        console.warn("[chatStore] Failed to persist chat state:", err);
      }
    },
    removeItem: (name: string) => {
      try {
        storage.removeItem(name);
      } catch {
        // ignore
      }
    },
  };
}

function buildPersistedMessages(messages: ChatMessage[]): ChatMessage[] {
  const sanitized = messages
    .slice(-MAX_PERSIST_MESSAGES_TOTAL)
    .map((msg) => {
      const images = msg.images
        ?.filter((img) => !img.startsWith("blob:") && !img.startsWith("data:"))
        ?.slice(0, 3);

      return {
        ...msg,
        isStreaming: false,
        content:
          typeof msg.content === "string"
            ? clampString(msg.content, MAX_PERSIST_MESSAGE_CHARS)
            : "",
        thinkingContent:
          typeof msg.thinkingContent === "string"
            ? clampString(msg.thinkingContent, MAX_PERSIST_THINKING_CHARS)
            : undefined,
        images: images && images.length > 0 ? images : undefined,
        diffData: msg.diffData
          ? {
              filePath: msg.diffData.filePath,
              oldStartLine: msg.diffData.oldStartLine,
              newStartLine: msg.diffData.newStartLine,
              linesAdded: msg.diffData.linesAdded,
              linesRemoved: msg.diffData.linesRemoved,
              // Keep only a small preview so localStorage doesn't explode.
              oldContent:
                typeof msg.diffData.oldContent === "string"
                  ? clampMultiline(msg.diffData.oldContent, MAX_PERSIST_DIFF_LINES, MAX_PERSIST_DIFF_CHARS)
                  : undefined,
              newContent:
                typeof msg.diffData.newContent === "string"
                  ? clampMultiline(msg.diffData.newContent, MAX_PERSIST_DIFF_LINES, MAX_PERSIST_DIFF_CHARS)
                  : undefined,
            }
          : undefined,
      };
    });

  // Ensure total payload stays under our target size (best-effort, avoids crashes).
  let trimmed = sanitized;
  for (let guard = 0; guard < 25; guard++) {
    const payload = JSON.stringify({ messages: trimmed });
    if (payload.length <= MAX_PERSIST_TOTAL_CHARS) break;
    if (trimmed.length <= 50) break;
    trimmed = trimmed.slice(50); // drop oldest chunk
  }

  return trimmed;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      messages: [],
      activities: {},
      draftMessages: {},

      addUserMessage: (agentId, content, images, messageId) => {
        const id = messageId || `${agentId}-user-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const message: ChatMessage = {
          id,
          agentId,
          role: "user",
          content,
          timestamp: Date.now(),
          images,
        };
        set((state) => {
          if (state.messages.some((existing) => existing.id === id)) {
            return state;
          }
          return {
            messages: [...state.messages, message],
          };
        });
      },

      addAssistantMessage: (agentId, content) => {
        const message: ChatMessage = {
          id: `${agentId}-assistant-${Date.now()}`,
          agentId,
          role: "assistant",
          content,
          timestamp: Date.now(),
          isStreaming: true,
        };
        set((state) => ({
          messages: [...state.messages, message],
          activities: { ...state.activities, [agentId]: "" }, // Clear activity when message starts
        }));
      },

      appendToLastAssistantMessage: (agentId, content) => {
        set((state) => {
          const messages = [...state.messages];
          // Find the last assistant message for this agent that is streaming
          for (let i = messages.length - 1; i >= 0; i--) {
            if (
              messages[i].agentId === agentId &&
              messages[i].role === "assistant" &&
              messages[i].isStreaming
            ) {
              messages[i] = {
                ...messages[i],
                content: messages[i].content + content,
              };
              break;
            }
          }
          return { messages };
        });
      },

      replaceLastAssistantMessage: (agentId, content) => {
        set((state) => {
          const messages = [...state.messages];
          // Find the last assistant message for this agent that is streaming
          for (let i = messages.length - 1; i >= 0; i--) {
            if (
              messages[i].agentId === agentId &&
              messages[i].role === "assistant" &&
              messages[i].isStreaming
            ) {
              messages[i] = {
                ...messages[i],
                content,
              };
              break;
            }
          }
          return { messages };
        });
      },

      finishStreaming: (agentId) => {
        set((state) => {
          const messages = state.messages.map((msg) => {
            if (msg.agentId === agentId && msg.isStreaming) {
              return { ...msg, isStreaming: false };
            }
            return msg;
          });
          const activities = { ...state.activities };
          delete activities[agentId];
          return { messages, activities };
        });
      },

      getMessagesForAgent: (agentId) => {
        return get().messages.filter((msg) => msg.agentId === agentId);
      },

      clearMessagesForAgent: (agentId) => {
        set((state) => ({
          messages: state.messages.filter((msg) => msg.agentId !== agentId),
          activities: { ...state.activities, [agentId]: "" },
        }));
      },

      addActivity: (agentId, activity) => {
        set((state) => ({
          activities: { ...state.activities, [agentId]: activity },
        }));
      },

      addActivityMessage: (
        agentId,
        content,
        activityType,
        activityDetails,
        diffData,
        todoData,
        thinkingContent,
        thinkingTokens
      ) => {
        const id = `${agentId}-activity-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const message: ChatMessage = {
          id,
          agentId,
          role: "activity",
          content,
          timestamp: Date.now(),
          activityType,
          activityDetails,
          diffData,
          todoData,
          thinkingContent,
          thinkingTokens,
        };
        set((state) => ({
          messages: [...state.messages, message],
        }));
        return id;
      },

      updateMessage: (messageId, updates) => {
        set((state) => ({
          messages: state.messages.map((msg) =>
            msg.id === messageId ? { ...msg, ...updates } : msg
          ),
        }));
      },

      clearActivity: (agentId) => {
        set((state) => {
          const activities = { ...state.activities };
          delete activities[agentId];
          return { activities };
        });
      },

      getActivity: (agentId) => {
        return get().activities[agentId];
      },

      setDraft: (agentId, draft) => {
        set((state) => ({
          draftMessages: { ...state.draftMessages, [agentId]: draft },
        }));
      },

      getDraft: (agentId) => {
        return get().draftMessages[agentId] || "";
      },

      clearDraft: (agentId) => {
        set((state) => {
          const draftMessages = { ...state.draftMessages };
          delete draftMessages[agentId];
          return { draftMessages };
        });
      },
    }),
    {
      name: CHAT_STORAGE_KEY,
      storage: createJSONStorage(() => createSafeStorage(localStorage)),
      partialize: (state) => ({
        // Only persist messages, not transient activities
        messages: buildPersistedMessages(state.messages),
      }),
    }
  )
);
