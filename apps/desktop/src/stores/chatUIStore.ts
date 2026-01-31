import { create } from "zustand";

export interface DraftImageAttachment {
  // File path for Tauri, or object URL for browser
  path: string;
  // Original File object for browser mode (for upload)
  file?: File;
}

interface ChatUIState {
  // Draft (unsent) image attachments per agent
  draftImagesByAgent: Record<string, DraftImageAttachment[]>;
  setDraftImages: (agentId: string, images: DraftImageAttachment[]) => void;
  addDraftImages: (agentId: string, images: DraftImageAttachment[]) => void;
  removeDraftImage: (agentId: string, index: number) => void;
  clearDraftImages: (agentId: string) => void;

  // Chat scroll state per agent (so scrolling one chat doesn't affect others)
  isUserAtBottomByAgent: Record<string, boolean>;
  setIsUserAtBottom: (agentId: string, isAtBottom: boolean) => void;

  // Best-effort scroll position restore per agent
  scrollTopByAgent: Record<string, number>;
  setScrollTop: (agentId: string, scrollTop: number) => void;
  getScrollTop: (agentId: string) => number | undefined;
}

export const useChatUIStore = create<ChatUIState>()((set, get) => ({
  draftImagesByAgent: {},
  setDraftImages: (agentId, images) =>
    set((state) => ({ draftImagesByAgent: { ...state.draftImagesByAgent, [agentId]: images } })),
  addDraftImages: (agentId, images) =>
    set((state) => ({
      draftImagesByAgent: {
        ...state.draftImagesByAgent,
        [agentId]: [...(state.draftImagesByAgent[agentId] ?? []), ...images],
      },
    })),
  removeDraftImage: (agentId, index) =>
    set((state) => {
      const current = state.draftImagesByAgent[agentId] ?? [];
      return {
        draftImagesByAgent: {
          ...state.draftImagesByAgent,
          [agentId]: current.filter((_, i) => i !== index),
        },
      };
    }),
  clearDraftImages: (agentId) =>
    set((state) => {
      if (!(agentId in state.draftImagesByAgent)) return state;
      const next = { ...state.draftImagesByAgent };
      delete next[agentId];
      return { draftImagesByAgent: next };
    }),

  isUserAtBottomByAgent: {},
  setIsUserAtBottom: (agentId, isAtBottom) =>
    set((state) => {
      if (state.isUserAtBottomByAgent[agentId] === isAtBottom) return state;
      return { isUserAtBottomByAgent: { ...state.isUserAtBottomByAgent, [agentId]: isAtBottom } };
    }),

  scrollTopByAgent: {},
  setScrollTop: (agentId, scrollTop) =>
    set((state) => ({ scrollTopByAgent: { ...state.scrollTopByAgent, [agentId]: scrollTop } })),
  getScrollTop: (agentId) => get().scrollTopByAgent[agentId],
}));

