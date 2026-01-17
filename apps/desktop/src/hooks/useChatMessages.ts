import { useCallback, useRef } from "react";
import { useAgentOutputListener } from "./useTauriEvents";
import { useChatStore, ChatMessage } from "../stores/chatStore";
import { useAgentStore } from "../stores/agentStore";

/**
 * Hook that listens to Claude CLI output and parses it into chat messages.
 * Claude CLI with -p --output-format stream-json --verbose outputs:
 * 1. system (init) - session start with session_id
 * 2. assistant - the response message with content (text + tool_use blocks)
 * 3. content_block_start - start of a content block (text or tool_use)
 * 4. content_block_delta - streaming delta for text blocks
 * 5. content_block_stop - end of a content block
 * 6. tool_use - tool being invoked
 * 7. tool_result - result from tool
 * 8. result - final result with complete text
 */
export function useChatMessages() {
  const addAssistantMessage = useChatStore((state) => state.addAssistantMessage);
  const appendToLastAssistantMessage = useChatStore(
    (state) => state.appendToLastAssistantMessage
  );
  const replaceLastAssistantMessage = useChatStore(
    (state) => state.replaceLastAssistantMessage
  );
  const finishStreaming = useChatStore((state) => state.finishStreaming);
  const updateAgent = useAgentStore((state) => state.updateAgent);
  const addActivity = useChatStore((state) => state.addActivity);
  const addActivityMessage = useChatStore((state) => state.addActivityMessage);

  // Track current message state per agent
  const messageState = useRef<
    Map<
      string,
      {
        currentMessageUuid: string | null;
        hasStartedMessage: boolean;
        accumulatedText: string;
        processedToolIds: Set<string>; // Track tool IDs to avoid duplicate activities
      }
    >
  >(new Map());

  // Get or initialize state for an agent
  const getState = (agentId: string) => {
    if (!messageState.current.has(agentId)) {
      messageState.current.set(agentId, {
        currentMessageUuid: null,
        hasStartedMessage: false,
        accumulatedText: "",
        processedToolIds: new Set(),
      });
    }
    return messageState.current.get(agentId)!;
  };

  const handleOutput = useCallback(
    (output: { agent_id: string; stream: string; data: string }) => {
      // Only process stdout for chat messages
      if (output.stream !== "stdout") return;

      try {
        const json = JSON.parse(output.data);
        const agentId = output.agent_id;
        const state = getState(agentId);

        switch (json.type) {
          case "system":
            // System init message - session starting
            if (json.subtype === "init") {
              updateAgent(agentId, { status: "working" });
              // Reset message state for new conversation turn
              state.currentMessageUuid = null;
              state.hasStartedMessage = false;
              state.accumulatedText = "";
              state.processedToolIds.clear();
            }
            break;

          case "assistant": {
            // Full assistant message - content is in json.message.content
            const msgUuid = json.uuid;
            const content = json.message?.content;

            // Check for tool_use blocks to log activity
            if (content && Array.isArray(content)) {
              const toolUseBlocks = content.filter(
                (block: { type: string }) => block.type === "tool_use"
              );
              for (const toolBlock of toolUseBlocks) {
                const toolId = toolBlock.id;
                // Skip if we've already processed this tool
                if (toolId && state.processedToolIds.has(toolId)) continue;
                if (toolId) state.processedToolIds.add(toolId);

                const toolName = toolBlock.name || "tool";
                const activityInfo = getActivityInfo(toolName, toolBlock.input);
                // Add activity as temporary indicator
                addActivity(agentId, activityInfo.text);
                // Also add as persistent message in chat
                addActivityMessage(
                  agentId,
                  activityInfo.text,
                  activityInfo.type,
                  activityInfo.details
                );
              }

              // Extract text content
              const textBlocks = content.filter(
                (block: { type: string }) => block.type === "text"
              );
              const text = textBlocks
                .map((block: { text: string }) => block.text)
                .join("");

              if (text) {
                // If this is a new message UUID or we haven't started yet
                if (msgUuid !== state.currentMessageUuid || !state.hasStartedMessage) {
                  // Start a new message
                  addAssistantMessage(agentId, text);
                  state.currentMessageUuid = msgUuid;
                  state.hasStartedMessage = true;
                  state.accumulatedText = text;
                } else {
                  // Replace/update existing message with full text
                  replaceLastAssistantMessage(agentId, text);
                  state.accumulatedText = text;
                }
              }
            }
            break;
          }

          case "content_block_start": {
            // Starting a new content block
            const blockType = json.content_block?.type;
            if (blockType === "text") {
              // If we haven't started a message yet, start one
              if (!state.hasStartedMessage) {
                addAssistantMessage(agentId, "");
                state.hasStartedMessage = true;
                state.accumulatedText = "";
              }
            } else if (blockType === "tool_use") {
              const toolName = json.content_block?.name || "tool";
              addActivity(agentId, `Using ${toolName}...`);
            }
            break;
          }

          case "content_block_delta": {
            // Streaming text delta
            const deltaType = json.delta?.type;
            if (deltaType === "text_delta") {
              const text = json.delta?.text || "";
              if (text) {
                if (!state.hasStartedMessage) {
                  addAssistantMessage(agentId, text);
                  state.hasStartedMessage = true;
                  state.accumulatedText = text;
                } else {
                  appendToLastAssistantMessage(agentId, text);
                  state.accumulatedText += text;
                }
              }
            }
            break;
          }

          case "content_block_stop":
            // Block finished - nothing special to do
            break;

          case "tool_use": {
            // Tool being used - show activity
            const toolId = json.id;
            // Skip if we've already processed this tool (from assistant message)
            if (toolId && state.processedToolIds.has(toolId)) break;
            if (toolId) state.processedToolIds.add(toolId);

            const toolName = json.name || json.tool || "tool";
            const activityInfo = getActivityInfo(toolName, json.input);
            addActivity(agentId, activityInfo.text);
            // Add as persistent message
            addActivityMessage(
              agentId,
              activityInfo.text,
              activityInfo.type,
              activityInfo.details
            );
            break;
          }

          case "tool_result":
            // Tool finished - clear temporary activity indicator
            addActivity(agentId, "");
            break;

          case "result": {
            // Final result - ensure we have the complete response
            if (json.result && typeof json.result === "string") {
              // If we have accumulated text that doesn't match the result,
              // or if we never started a message, add/update it
              if (!state.hasStartedMessage) {
                addAssistantMessage(agentId, json.result);
                state.hasStartedMessage = true;
              } else if (state.accumulatedText !== json.result) {
                // The result contains the final complete text
                replaceLastAssistantMessage(agentId, json.result);
              }
            }

            // Finish streaming and reset state
            finishStreaming(agentId);
            state.currentMessageUuid = null;
            state.hasStartedMessage = false;
            state.accumulatedText = "";
            state.processedToolIds.clear();
            updateAgent(agentId, { status: "idle" });
            break;
          }

          case "error": {
            // Error message
            const errorMsg =
              json.error?.message || json.message || "An error occurred";
            if (!state.hasStartedMessage) {
              addAssistantMessage(agentId, `**Error:** ${errorMsg}`);
            } else {
              appendToLastAssistantMessage(agentId, `\n\n**Error:** ${errorMsg}`);
            }
            finishStreaming(agentId);
            state.currentMessageUuid = null;
            state.hasStartedMessage = false;
            state.accumulatedText = "";
            state.processedToolIds.clear();
            updateAgent(agentId, { status: "error" });
            break;
          }

          default:
            break;
        }
      } catch {
        // Not valid JSON - ignore
      }
    },
    [
      addAssistantMessage,
      appendToLastAssistantMessage,
      replaceLastAssistantMessage,
      finishStreaming,
      updateAgent,
      addActivity,
      addActivityMessage,
    ]
  );

  useAgentOutputListener(handleOutput);
}

/**
 * Get activity info for a tool including type and details
 */
function getActivityInfo(
  toolName: string,
  input?: Record<string, unknown>
): { text: string; type: ChatMessage["activityType"]; details?: string } {
  switch (toolName) {
    case "Read":
      return {
        text: `Read ${getShortPath(input?.file_path as string)}`,
        type: "read",
        details: input?.file_path as string,
      };
    case "Write":
      return {
        text: `Wrote ${getShortPath(input?.file_path as string)}`,
        type: "write",
        details: input?.file_path as string,
      };
    case "Edit": {
      const filePath = input?.file_path as string;
      return {
        text: `Edited ${getShortPath(filePath)}`,
        type: "edit",
        details: filePath,
      };
    }
    case "Bash": {
      const cmd = input?.command as string;
      const shortCmd = cmd
        ? cmd.substring(0, 60) + (cmd.length > 60 ? "..." : "")
        : "command";
      return {
        text: `Ran: ${shortCmd}`,
        type: "bash",
        details: cmd,
      };
    }
    case "Glob":
      return {
        text: `Searched for ${input?.pattern || "files"}`,
        type: "search",
        details: input?.pattern as string,
      };
    case "Grep":
      return {
        text: `Searched for "${input?.pattern || "pattern"}"`,
        type: "search",
        details: input?.pattern as string,
      };
    case "WebFetch":
      return {
        text: `Fetched ${input?.url || "URL"}`,
        type: "tool",
        details: input?.url as string,
      };
    case "WebSearch":
      return {
        text: `Web search: "${input?.query || "query"}"`,
        type: "search",
        details: input?.query as string,
      };
    case "Task":
      return {
        text: `Task: ${input?.description || "subtask"}`,
        type: "tool",
        details: input?.description as string,
      };
    default:
      return {
        text: `${toolName}`,
        type: "tool",
      };
  }
}

/**
 * Get shortened path for display
 */
function getShortPath(path?: string): string {
  if (!path) return "file";
  const parts = path.split("/");
  if (parts.length <= 2) return path;
  return ".../" + parts.slice(-2).join("/");
}
