import { useEffect, useState } from "react";
import { useWorkspaceStore, setupAutoSave } from "../stores/workspaceStore";

export function useWorkspaceInit() {
  const [initialized, setInitialized] = useState(false);
  const load = useWorkspaceStore((state) => state.load);
  const isLoading = useWorkspaceStore((state) => state.isLoading);

  useEffect(() => {
    if (!initialized) {
      // Load saved workspace on startup
      load()
        .then(() => {
          // Setup auto-save after loading
          setupAutoSave();
        })
        .catch((err) => {
          console.error("Failed to load workspace:", err);
        })
        .finally(() => {
          // Always mark as initialized, even if load fails
          setInitialized(true);
        });
    }
  }, [initialized, load]);

  return { initialized, isLoading };
}
