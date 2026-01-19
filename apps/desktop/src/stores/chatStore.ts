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
  addUserMessage: (agentId: string, content: string, images?: string[]) => void;
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
    todoData?: ChatMessage["todoData"]
  ) => void;
  clearActivity: (agentId: string) => void;
  getActivity: (agentId: string) => string | undefined;
  setDraft: (agentId: string, draft: string) => void;
  getDraft: (agentId: string) => string;
  clearDraft: (agentId: string) => void;
}

const CHAT_STORAGE_KEY = "virtual-agency-chat";
const MAX_MESSAGES_TOTAL = 2000; // Limit total messages to prevent storage bloat

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      messages: [],
      activities: {},
      draftMessages: {},

      addUserMessage: (agentId, content, images) => {
        const message: ChatMessage = {
          id: `${agentId}-user-${Date.now()}`,
          agentId,
          role: "user",
          content,
          timestamp: Date.now(),
          images,
        };
        set((state) => ({
          messages: [...state.messages, message],
        }));
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

      addActivityMessage: (agentId, content, activityType, activityDetails, diffData, todoData) => {
        const message: ChatMessage = {
          id: `${agentId}-activity-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          agentId,
          role: "activity",
          content,
          timestamp: Date.now(),
          activityType,
          activityDetails,
          diffData,
          todoData,
        };
        set((state) => ({
          messages: [...state.messages, message],
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
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        // Only persist messages, not transient activities
        // Also filter out blob: URLs from images since they won't be valid after reload
        messages: state.messages
          .map((msg) => ({
            ...msg,
            // Clear streaming state on persist (should already be false, but just in case)
            isStreaming: false,
            // Filter out blob URLs from images (browser mode temporary URLs)
            images: msg.images?.filter((img) => !img.startsWith("blob:")),
          }))
          // Limit total messages to prevent storage bloat
          .slice(-MAX_MESSAGES_TOTAL),
      }),
    }
  )
);
