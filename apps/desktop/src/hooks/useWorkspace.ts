import { useEffect, useState } from "react";
import { useWorkspaceStore, setupAutoSave } from "../stores/workspaceStore";

export function useWorkspaceInit(ready: boolean = true) {
  const [initialized, setInitialized] = useState(false);
  const load = useWorkspaceStore((state) => state.load);
  const isLoading = useWorkspaceStore((state) => state.isLoading);

  useEffect(() => {
    // Only load workspace after server/CLI is ready
    if (ready && !initialized) {
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
  }, [ready, initialized, load]);

  return { initialized, isLoading };
}
