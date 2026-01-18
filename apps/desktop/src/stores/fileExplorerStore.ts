import { create } from 'zustand';

const API_BASE = import.meta.env.VITE_SERVER_URL || 'http://127.0.0.1:3001';

export interface FileNode {
  name: string;
  path: string;
  is_directory: boolean;
  children?: FileNode[];
}

export interface OpenFile {
  path: string;
  name: string;
  content: string;
  originalContent: string;
  isDirty: boolean;
}

interface FileExplorerState {
  fileTree: FileNode | null;
  openFiles: OpenFile[];
  activeFilePath: string | null;
  isLoading: boolean;
  error: string | null;
  agentId: string | null;

  // Actions
  setAgentId: (agentId: string) => void;
  loadFileTree: () => Promise<void>;
  openFile: (path: string, name: string) => Promise<void>;
  closeFile: (path: string) => void;
  setActiveFile: (path: string) => void;
  updateFileContent: (path: string, content: string) => void;
  saveFile: (path: string) => Promise<void>;
  saveAllFiles: () => Promise<void>;
}

export const useFileExplorerStore = create<FileExplorerState>((set, get) => ({
  fileTree: null,
  openFiles: [],
  activeFilePath: null,
  isLoading: false,
  error: null,
  agentId: null,

  setAgentId: (agentId: string) => {
    const { openFiles, agentId: currentAgentId } = get();

    // Don't switch if it's the same agent
    if (currentAgentId === agentId) {
      return;
    }

    // Check for unsaved changes
    const dirtyFiles = openFiles.filter(f => f.isDirty);
    if (dirtyFiles.length > 0) {
      const fileNames = dirtyFiles.map(f => f.name).join(', ');
      const confirmed = window.confirm(
        `You have unsaved changes in: ${fileNames}\n\nSwitching agents will close these files. Continue?`
      );
      if (!confirmed) {
        return;
      }
    }

    set({ agentId, fileTree: null, openFiles: [], activeFilePath: null });
  },

  loadFileTree: async () => {
    const { agentId } = get();
    if (!agentId) {
      set({ error: 'No agent selected' });
      return;
    }

    set({ isLoading: true, error: null });
    try {
      const response = await fetch(`${API_BASE}/api/files/tree/${agentId}`);
      if (!response.ok) {
        throw new Error('Failed to load file tree');
      }
      const tree = await response.json();
      set({ fileTree: tree, isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        isLoading: false
      });
    }
  },

  openFile: async (path: string, name: string) => {
    const { openFiles, agentId } = get();

    if (!agentId) {
      set({ error: 'No agent selected' });
      return;
    }

    // Check if file is already open
    const existingFile = openFiles.find(f => f.path === path);
    if (existingFile) {
      set({ activeFilePath: path });
      return;
    }

    set({ error: null });
    try {
      const response = await fetch(`${API_BASE}/api/files/read/${agentId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });

      if (!response.ok) {
        throw new Error('Failed to read file');
      }

      const { content } = await response.json();

      const newFile: OpenFile = {
        path,
        name,
        content,
        originalContent: content,
        isDirty: false,
      };

      set({
        openFiles: [...openFiles, newFile],
        activeFilePath: path,
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  },

  closeFile: (path: string) => {
    const { openFiles, activeFilePath } = get();
    const newOpenFiles = openFiles.filter(f => f.path !== path);

    let newActiveFile = activeFilePath;
    if (activeFilePath === path && newOpenFiles.length > 0) {
      newActiveFile = newOpenFiles[newOpenFiles.length - 1].path;
    } else if (newOpenFiles.length === 0) {
      newActiveFile = null;
    }

    set({
      openFiles: newOpenFiles,
      activeFilePath: newActiveFile,
    });
  },

  setActiveFile: (path: string) => {
    set({ activeFilePath: path });
  },

  updateFileContent: (path: string, content: string) => {
    const { openFiles } = get();
    const newOpenFiles = openFiles.map(file => {
      if (file.path === path) {
        return {
          ...file,
          content,
          isDirty: content !== file.originalContent,
        };
      }
      return file;
    });
    set({ openFiles: newOpenFiles });
  },

  saveFile: async (path: string) => {
    const { openFiles, agentId } = get();

    if (!agentId) {
      set({ error: 'No agent selected' });
      return;
    }

    const file = openFiles.find(f => f.path === path);

    if (!file) return;

    set({ error: null });
    try {
      const response = await fetch(`${API_BASE}/api/files/write/${agentId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: file.path,
          content: file.content,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to save file');
      }

      const newOpenFiles = openFiles.map(f => {
        if (f.path === path) {
          return {
            ...f,
            originalContent: f.content,
            isDirty: false,
          };
        }
        return f;
      });

      set({ openFiles: newOpenFiles });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  },

  saveAllFiles: async () => {
    const { openFiles } = get();
    const dirtyFiles = openFiles.filter(f => f.isDirty);

    for (const file of dirtyFiles) {
      await get().saveFile(file.path);
    }
  },
}));
