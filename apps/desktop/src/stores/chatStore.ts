import { create } from "zustand";

export interface ChatMessage {
  id: string;
  agentId: string;
  role: "user" | "assistant" | "activity";
  content: string;
  timestamp: number;
  isStreaming?: boolean;
  // Activity-specific fields
  activityType?: "read" | "write" | "edit" | "bash" | "search" | "tool";
  activityDetails?: string; // e.g., file path, command
  // Image attachments (for user messages)
  images?: string[]; // Array of image file paths
}

interface ChatState {
  messages: ChatMessage[];
  activities: Record<string, string>; // agentId -> current activity
  addUserMessage: (agentId: string, content: string, images?: string[]) => void;
  addAssistantMessage: (agentId: string, content: string) => void;
  appendToLastAssistantMessage: (agentId: string, content: string) => void;
  replaceLastAssistantMessage: (agentId: string, content: string) => void;
  finishStreaming: (agentId: string) => void;
  getMessagesForAgent: (agentId: string) => ChatMessage[];
  clearMessagesForAgent: (agentId: string) => void;
  addActivity: (agentId: string, activity: string) => void;
  addActivityMessage: (agentId: string, content: string, type: ChatMessage["activityType"], details?: string) => void;
  clearActivity: (agentId: string) => void;
  getActivity: (agentId: string) => string | undefined;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  activities: {},

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

  addActivityMessage: (agentId, content, activityType, activityDetails) => {
    const message: ChatMessage = {
      id: `${agentId}-activity-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      agentId,
      role: "activity",
      content,
      timestamp: Date.now(),
      activityType,
      activityDetails,
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
}));
