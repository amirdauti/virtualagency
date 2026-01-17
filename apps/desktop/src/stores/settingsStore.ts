import { create } from "zustand";
import {
  loadSettings,
  saveSettings,
  AppSettings,
} from "../lib/api";

interface SettingsState {
  settings: AppSettings;
  isLoading: boolean;
  error: string | null;
  load: () => Promise<void>;
  save: () => Promise<void>;
  updateSettings: (updates: Partial<AppSettings>) => void;
}

const defaultSettings: AppSettings = {
  claude_cli_path: null,
  theme: "dark",
  auto_save_enabled: true,
  auto_save_interval_seconds: 30,
  default_working_directory: null,
};

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: defaultSettings,
  isLoading: false,
  error: null,

  load: async () => {
    set({ isLoading: true, error: null });
    try {
      const settings = await loadSettings();
      set({ settings, isLoading: false });
    } catch (error) {
      console.error("Failed to load settings:", error);
      set({ error: String(error), isLoading: false });
    }
  },

  save: async () => {
    const { settings } = get();
    set({ error: null });
    try {
      await saveSettings(settings);
    } catch (error) {
      console.error("Failed to save settings:", error);
      set({ error: String(error) });
    }
  },

  updateSettings: (updates) => {
    set((state) => ({
      settings: { ...state.settings, ...updates },
    }));
    // Auto-save after update
    get().save();
  },
}));
