import { useCallback, useState } from "react";
import {
  useAgentOutputListener,
  useAgentStatusListener,
} from "./useTauriEvents";
import { useAgentStore } from "../stores/agentStore";

export interface OutputLine {
  id: string;
  agentId: string;
  stream: "stdout" | "stderr";
  data: string;
  timestamp: number;
}

const MAX_LINES = 1000;

export function useAgentOutput() {
  const [outputLines, setOutputLines] = useState<OutputLine[]>([]);
  const updateAgent = useAgentStore((state) => state.updateAgent);

  const handleOutput = useCallback(
    (output: { agent_id: string; stream: "stdout" | "stderr"; data: string }) => {
      const line: OutputLine = {
        id: `${output.agent_id}-${Date.now()}-${Math.random()}`,
        agentId: output.agent_id,
        stream: output.stream,
        data: output.data,
        timestamp: Date.now(),
      };

      setOutputLines((prev) => {
        const newLines = [...prev, line];
        // Keep only last MAX_LINES
        if (newLines.length > MAX_LINES) {
          return newLines.slice(-MAX_LINES);
        }
        return newLines;
      });
    },
    []
  );

  const handleStatusChange = useCallback(
    (status: { agent_id: string; status: string }) => {
      updateAgent(status.agent_id, {
        status: status.status as "idle" | "thinking" | "working" | "error",
      });
    },
    [updateAgent]
  );

  useAgentOutputListener(handleOutput);
  useAgentStatusListener(handleStatusChange);

  const getOutputForAgent = useCallback(
    (agentId: string) => {
      return outputLines.filter((line) => line.agentId === agentId);
    },
    [outputLines]
  );

  const clearOutput = useCallback((agentId?: string) => {
    if (agentId) {
      setOutputLines((prev) => prev.filter((line) => line.agentId !== agentId));
    } else {
      setOutputLines([]);
    }
  }, []);

  return {
    outputLines,
    getOutputForAgent,
    clearOutput,
  };
}
