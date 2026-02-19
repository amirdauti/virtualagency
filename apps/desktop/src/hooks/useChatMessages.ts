import { useCallback, useRef } from "react";
import { useAgentOutputListener } from "./useTauriEvents";
import { useChatStore, ChatMessage } from "../stores/chatStore";
import { useAgentStore } from "../stores/agentStore";
import { fetchAgentApi } from "../lib/api";
const MAX_DIFF_PREVIEW_CHARS = 20_000;
const MAX_DIFF_PREVIEW_LINES = 400;
const MAX_FILE_CACHE_CHARS = 200_000;

/**
 * Hook that listens to agent CLI output and parses it into chat messages.
 *
 * Claude CLI with -p --output-format stream-json --verbose outputs:
 * 1. system (init) - session start with session_id
 * 2. assistant - the response message with content (text + tool_use blocks)
 * 3. content_block_start - start of a content block (text or tool_use)
 * 4. content_block_delta - streaming delta for text blocks
 * 5. content_block_stop - end of a content block
 * 6. tool_use - tool being invoked
 * 7. tool_result - result from tool
 * 8. result - final result with complete text
 *
 * Codex CLI with `--json` outputs JSONL events like:
 * - thread.started (thread_id)
 * - turn.started / turn.completed / turn.failed
 * - item.started / item.updated / item.completed (e.g. agent_message, command_execution, file_change)
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
  const updateMessage = useChatStore((state) => state.updateMessage);

  // Track current message state per agent
  const messageState = useRef<
    Map<
      string,
      {
        currentMessageUuid: string | null;
        hasStartedMessage: boolean;
        accumulatedText: string;
        processedToolIds: Set<string>; // Track tool IDs to avoid duplicate activities
        codexItemMessageIds: Map<string, string>; // Codex item_id -> chat message id (for updates)
        fileContentCache: Map<string, string>; // workspace-relative path -> last known content
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
        codexItemMessageIds: new Map(),
        fileContentCache: new Map(),
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

        // Codex JSONL events (codex --json)
        if (
          typeof json.type === "string" &&
          (json.type.startsWith("thread.") ||
            json.type.startsWith("turn.") ||
            json.type.startsWith("item."))
        ) {
          switch (json.type) {
            case "thread.started": {
              if (json.thread_id) {
                updateAgent(agentId, { sessionId: json.thread_id });
              }
              break;
            }
            case "turn.started": {
              // Reset per-turn state to avoid leaking tool IDs across turns
              state.currentMessageUuid = null;
              state.hasStartedMessage = false;
              state.accumulatedText = "";
              state.processedToolIds.clear();
              state.codexItemMessageIds.clear();
              break;
            }
            case "item.started": {
              const item = json.item;
              const itemType = item?.type as string | undefined;
              if (itemType === "file_change") break;

              const activityInfo = getCodexItemActivityInfo(item);
              if (!activityInfo) break;

              const itemId = getCodexItemId(item);
              const startKey = itemId ? `codex-start:${itemId}` : null;
              if (startKey && state.processedToolIds.has(startKey)) break;
              if (startKey) state.processedToolIds.add(startKey);

              addActivity(agentId, activityInfo.text);
              const messageId = addActivityMessage(
                agentId,
                activityInfo.text,
                activityInfo.type,
                activityInfo.details,
                activityInfo.diffData,
                activityInfo.todoData,
                activityInfo.thinkingContent,
                activityInfo.thinkingTokens
              );

              if (itemType === "todo_list" && itemId) {
                state.codexItemMessageIds.set(itemId, messageId);
              }
              break;
            }
            case "item.updated": {
              const item = json.item;
              const itemType = item?.type as string | undefined;
              const itemId = getCodexItemId(item);

              // Codex todo lists stream updates via item.updated; update the existing card.
              if (itemType === "todo_list" && itemId) {
                const activityInfo = getCodexItemActivityInfo(item);
                if (!activityInfo?.todoData) break;

                const messageId = state.codexItemMessageIds.get(itemId);
                if (messageId) {
                  updateMessage(messageId, {
                    content: activityInfo.text,
                    activityType: activityInfo.type,
                    activityDetails: activityInfo.details,
                    todoData: activityInfo.todoData,
                  });
                } else {
                  const createdId = addActivityMessage(
                    agentId,
                    activityInfo.text,
                    activityInfo.type,
                    activityInfo.details,
                    activityInfo.diffData,
                    activityInfo.todoData,
                    activityInfo.thinkingContent,
                    activityInfo.thinkingTokens
                  );
                  state.codexItemMessageIds.set(itemId, createdId);
                }
              }
              break;
            }
            case "item.completed": {
              const item = json.item;
              const itemType = item?.type as string | undefined;
              const itemId = getCodexItemId(item);
              const completeKey = itemId ? `codex-complete:${itemId}` : null;
              if (completeKey && state.processedToolIds.has(completeKey)) break;
              if (completeKey) state.processedToolIds.add(completeKey);

              if (item?.type === "agent_message" && typeof item.text === "string") {
                addAssistantMessage(agentId, item.text);
                finishStreaming(agentId);
                addActivity(agentId, "");
                break;
              }

              if (itemType === "file_change") {
                const changes = getCodexFileChanges(item);
                if (changes.length === 0) break;

                // Build a rich diff card by reading the file content after the change.
                for (const change of changes) {
                  void (async () => {
                    const agent = useAgentStore
                      .getState()
                      .agents.find((a) => a.id === agentId);
                    const workingDir = agent?.workingDirectory;
                    const relativePath = toWorkspaceRelativePath(change.path, workingDir);

                    const kind = (change.kind || "").toLowerCase();
                    const isDelete = kind === "delete" || kind === "remove" || kind === "del";
                    const isAdd = kind === "add" || kind === "create" || kind === "new";

                    const newContent = isDelete
                      ? null
                      : await readWorkspaceFile(agentId, relativePath);

                    let oldContent = state.fileContentCache.get(relativePath);
                    if (!oldContent && !isAdd && !isDelete) {
                      // First time we see this file change: fall back to git HEAD for baseline when possible.
                      oldContent = (await readWorkspaceGitFile(agentId, relativePath)) || undefined;
                    }

                    const oldLineCount = oldContent ? oldContent.split("\n").length : 0;
                    const newLineCount =
                      typeof newContent === "string" ? newContent.split("\n").length : 0;

                    if (!isDelete && typeof newContent === "string") {
                      state.fileContentCache.set(
                        relativePath,
                        clampString(newContent, MAX_FILE_CACHE_CHARS)
                      );
                    } else if (isDelete) {
                      state.fileContentCache.delete(relativePath);
                    }

                    const oldPreview = oldContent
                      ? oldContent
                      : undefined;

                    const windowed =
                      !isDelete && typeof newContent === "string"
                        ? buildWindowedDiffPreview(
                            oldPreview,
                            newContent,
                            MAX_DIFF_PREVIEW_LINES,
                            MAX_DIFF_PREVIEW_CHARS
                          )
                        : null;

                    const diffData =
                      !isDelete && typeof newContent === "string"
                        ? {
                            filePath: relativePath,
                            oldContent: windowed?.oldPreview,
                            newContent: windowed?.newPreview,
                            oldStartLine: windowed?.oldStartLine,
                            newStartLine: windowed?.newStartLine,
                            linesAdded: Math.max(
                              0,
                              newLineCount - oldLineCount
                            ),
                            linesRemoved: Math.max(0, oldLineCount - newLineCount),
                          }
                        : undefined;

                    const shortPath = getShortPath(relativePath);
                    if (isDelete) {
                      addActivityMessage(agentId, `Delete ${shortPath}`, "edit", relativePath);
                    } else if (isAdd) {
                      addActivityMessage(agentId, `Write ${shortPath}`, "write", relativePath, diffData);
                    } else {
                      addActivityMessage(agentId, `Edit ${shortPath}`, "edit", relativePath, diffData);
                    }

                    addActivity(agentId, "");
                  })();
                }

                break;
              }

              // Codex todo_list completion contains the final todo state; update existing card.
              if (itemType === "todo_list" && itemId) {
                const activityInfo = getCodexItemActivityInfo(item);
                if (activityInfo?.todoData) {
                  const messageId = state.codexItemMessageIds.get(itemId);
                  if (messageId) {
                    updateMessage(messageId, {
                      content: activityInfo.text,
                      activityType: activityInfo.type,
                      activityDetails: activityInfo.details,
                      todoData: activityInfo.todoData,
                    });
                  } else {
                    const createdId = addActivityMessage(
                      agentId,
                      activityInfo.text,
                      activityInfo.type,
                      activityInfo.details,
                      activityInfo.diffData,
                      activityInfo.todoData,
                      activityInfo.thinkingContent,
                      activityInfo.thinkingTokens
                    );
                    state.codexItemMessageIds.set(itemId, createdId);
                  }
                }
                addActivity(agentId, "");
                break;
              }

              // For non-message items, add an activity entry (if we didn't already
              // add one on item.started) and clear the transient activity indicator.
              const activityInfo = getCodexItemActivityInfo(item);
              if (activityInfo) {
                const startKey = itemId ? `codex-start:${itemId}` : null;
                const alreadyAddedAtStart = !!(startKey && state.processedToolIds.has(startKey));
                if (!alreadyAddedAtStart) {
                  addActivityMessage(
                    agentId,
                    activityInfo.text,
                    activityInfo.type,
                    activityInfo.details,
                    activityInfo.diffData,
                    activityInfo.todoData,
                    activityInfo.thinkingContent,
                    activityInfo.thinkingTokens
                  );
                }
                addActivity(agentId, "");
              }
              break;
            }
            case "turn.completed": {
              // Ensure we don't leave a message in streaming state if Codex didn't emit agent_message
              finishStreaming(agentId);
              addActivity(agentId, "");
              break;
            }
            case "turn.failed": {
              const errorMsg =
                json.error?.message || json.error?.detail || json.message || "An error occurred";
              addAssistantMessage(agentId, `**Error:** ${errorMsg}`);
              finishStreaming(agentId);
              addActivity(agentId, "");
              updateAgent(agentId, { status: "error" });
              break;
            }
            default:
              break;
          }
          return;
        }

        switch (json.type) {
          case "system":
            // System init message - session starting
            if (json.subtype === "init") {
              updateAgent(agentId, { status: "working" });
              // Capture session_id for conversation continuity
              if (json.session_id) {
                updateAgent(agentId, { sessionId: json.session_id });
              }
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
                  activityInfo.details,
                  activityInfo.diffData,
                  activityInfo.todoData,
                  activityInfo.thinkingContent,
                  activityInfo.thinkingTokens
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
              activityInfo.details,
              activityInfo.diffData,
              activityInfo.todoData,
              activityInfo.thinkingContent,
              activityInfo.thinkingTokens
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

            // Capture session_id for conversation continuity (also included in result)
            if (json.session_id) {
              updateAgent(agentId, { sessionId: json.session_id });
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
      updateMessage,
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
): {
  text: string;
  type: ChatMessage["activityType"];
  details?: string;
  diffData?: ChatMessage["diffData"];
  todoData?: ChatMessage["todoData"];
  thinkingContent?: string;
  thinkingTokens?: number;
} {
  switch (toolName) {
    case "Read":
      return {
        text: `Read ${getShortPath(input?.file_path as string)}`,
        type: "read",
        details: input?.file_path as string,
      };
    case "Write": {
      const filePath = input?.file_path as string;
      const content = input?.content as string;
      const lineCount = content ? content.split('\n').length : 0;
      return {
        text: `Write ${getShortPath(filePath)}`,
        type: "write",
        details: filePath,
        diffData: {
          filePath,
          newContent: content,
          linesAdded: lineCount,
        },
      };
    }
    case "Edit": {
      const filePath = input?.file_path as string;
      const oldString = input?.old_string as string;
      const newString = input?.new_string as string;

      // Calculate lines added/removed
      const oldLines = oldString ? oldString.split('\n').length : 0;
      const newLines = newString ? newString.split('\n').length : 0;
      const linesAdded = Math.max(0, newLines - oldLines);
      const linesRemoved = Math.max(0, oldLines - newLines);

      return {
        text: `Edit ${getShortPath(filePath)}`,
        type: "edit",
        details: filePath,
        diffData: {
          filePath,
          oldContent: oldString,
          newContent: newString,
          linesAdded,
          linesRemoved,
        },
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
    case "TodoWrite": {
      const todos = input?.todos as Array<{
        content: string;
        status: "pending" | "in_progress" | "completed";
        activeForm: string;
      }>;
      return {
        text: `Update Todos`,
        type: "todo",
        todoData: {
          todos: todos || [],
        },
      };
    }
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

function clampString(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

function truncateForDiff(text: string, maxLines: number, maxChars: number): string {
  let truncated = text;

  if (maxLines > 0) {
    const lines = truncated.split("\n");
    if (lines.length > maxLines) {
      truncated = lines.slice(0, maxLines).join("\n") + "\n… (truncated)";
    }
  }

  if (maxChars > 0 && truncated.length > maxChars) {
    truncated = truncated.slice(0, maxChars) + "\n… (truncated)";
  }

  return truncated;
}

function buildWindowedDiffPreview(
  oldContent: string | undefined,
  newContent: string,
  maxLines: number,
  maxChars: number
): {
  oldPreview?: string;
  newPreview: string;
  oldStartLine?: number;
  newStartLine: number;
} {
  const oldLines = (oldContent ?? "").split("\n");
  const newLines = newContent.split("\n");

  // Fast path: if either side is small, just truncate normally.
  if (oldLines.length <= maxLines && newLines.length <= maxLines && newContent.length <= maxChars) {
    return {
      oldPreview: typeof oldContent === "string" ? truncateForDiff(oldContent, maxLines, maxChars) : undefined,
      newPreview: truncateForDiff(newContent, maxLines, maxChars),
      oldStartLine: typeof oldContent === "string" ? 1 : undefined,
      newStartLine: 1,
    };
  }

  // Find common prefix
  let prefix = 0;
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  ) {
    prefix++;
  }

  // Find common suffix (bounded so it doesn't cross the prefix)
  let oldEnd = oldLines.length - 1;
  let newEnd = newLines.length - 1;
  while (oldEnd >= prefix && newEnd >= prefix && oldLines[oldEnd] === newLines[newEnd]) {
    oldEnd--;
    newEnd--;
  }

  // If everything is equal (can happen if we only truncated upstream), fall back to head.
  if (oldEnd < prefix && newEnd < prefix) {
    return {
      oldPreview: typeof oldContent === "string" ? truncateForDiff(oldContent, maxLines, maxChars) : undefined,
      newPreview: truncateForDiff(newContent, maxLines, maxChars),
      oldStartLine: typeof oldContent === "string" ? 1 : undefined,
      newStartLine: 1,
    };
  }

  const context = 30;
  const oldWinStart = Math.max(0, prefix - context);
  const newWinStart = Math.max(0, prefix - context);
  const oldWinEnd = Math.min(oldLines.length, oldEnd + context + 1);
  const newWinEnd = Math.min(newLines.length, newEnd + context + 1);

  const clampWindow = (lines: string[], start: number, end: number, changeStart: number) => {
    let winStart = start;
    let winEnd = end;
    const winLen = winEnd - winStart;
    if (winLen <= maxLines) return { winStart, winEnd };

    // Keep the window anchored around the first change (plus context), so we always show "what changed".
    winStart = Math.max(0, Math.min(changeStart - context, lines.length - maxLines));
    winEnd = Math.min(lines.length, winStart + maxLines);
    return { winStart, winEnd };
  };

  const oldClamped = clampWindow(oldLines, oldWinStart, oldWinEnd, prefix);
  const newClamped = clampWindow(newLines, newWinStart, newWinEnd, prefix);

  const oldSlice = oldLines.slice(oldClamped.winStart, oldClamped.winEnd).join("\n");
  const newSlice = newLines.slice(newClamped.winStart, newClamped.winEnd).join("\n");

  return {
    oldPreview: typeof oldContent === "string" ? truncateForDiff(oldSlice, maxLines, maxChars) : undefined,
    newPreview: truncateForDiff(newSlice, maxLines, maxChars),
    oldStartLine: typeof oldContent === "string" ? oldClamped.winStart + 1 : undefined,
    newStartLine: newClamped.winStart + 1,
  };
}

function toWorkspaceRelativePath(path: string, workingDir?: string): string {
  if (!workingDir) return path;

  const normalizedWorkingDir = workingDir.replace(/\\/g, "/").replace(/\/$/, "");
  const normalizedPath = path.replace(/\\/g, "/");

  if (normalizedPath.startsWith(normalizedWorkingDir + "/")) {
    return normalizedPath.slice(normalizedWorkingDir.length + 1);
  }
  return path;
}

async function readWorkspaceFile(agentId: string, path: string): Promise<string | null> {
  try {
    const data = await fetchAgentApi<{ content?: string }>(agentId, `/api/files/read/${agentId}`, {
      method: "POST",
      body: JSON.stringify({ path }),
    });
    return typeof data.content === "string" ? data.content : null;
  } catch {
    return null;
  }
}

async function readWorkspaceGitFile(agentId: string, path: string): Promise<string | null> {
  try {
    const data = await fetchAgentApi<{ content?: string }>(agentId, `/api/files/read_git/${agentId}`, {
      method: "POST",
      body: JSON.stringify({ path }),
    });
    return typeof data.content === "string" ? data.content : null;
  } catch {
    return null;
  }
}

function getCodexFileChanges(item: unknown): Array<{ path: string; kind: string }> {
  if (!item || typeof item !== "object") return [];
  const anyItem = item as Record<string, unknown>;

  const rawChanges = anyItem.changes;
  if (Array.isArray(rawChanges)) {
    return rawChanges
      .map((c) => {
        if (!c || typeof c !== "object") return null;
        const change = c as Record<string, unknown>;
        const path = change.path as string | undefined;
        const kind = (change.kind as string | undefined) || "modify";
        return path ? { path, kind } : null;
      })
      .filter((c): c is { path: string; kind: string } => Boolean(c));
  }

  // Fallback: legacy shapes that include path/kind directly on the item.
  const path =
    (anyItem.file_path as string | undefined) ||
    (anyItem.filePath as string | undefined) ||
    (anyItem.path as string | undefined) ||
    (anyItem.absolute_file_path as string | undefined) ||
    (anyItem.absoluteFilePath as string | undefined);
  const kind =
    (anyItem.change_kind as string | undefined) ||
    (anyItem.changeKind as string | undefined) ||
    (anyItem.kind as string | undefined) ||
    "modify";

  return path ? [{ path, kind }] : [];
}

function getCodexItemId(item: unknown): string | undefined {
  if (!item || typeof item !== "object") return undefined;
  const anyItem = item as Record<string, unknown>;
  const candidates: Array<unknown> = [
    anyItem.id,
    anyItem.item_id,
    anyItem.itemId,
    anyItem.call_id,
    anyItem.callId,
    anyItem.tool_call_id,
    anyItem.toolCallId,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate;
    if (typeof candidate === "number") return String(candidate);
  }
  return undefined;
}

function getCodexItemActivityInfo(
  item: unknown
): {
  text: string;
  type: ChatMessage["activityType"];
  details?: string;
  diffData?: ChatMessage["diffData"];
  todoData?: ChatMessage["todoData"];
  thinkingContent?: string;
  thinkingTokens?: number;
} | null {
  if (!item || typeof item !== "object") return null;
  const anyItem = item as Record<string, unknown>;
  const type = anyItem.type as string | undefined;

  if (type === "agent_message") return null;

  if (type === "reasoning") {
    const summary =
      (anyItem.text as string | undefined) ||
      (anyItem.summary as string | undefined) ||
      (anyItem.reasoning as string | undefined);
    if (!summary) return null;
    return {
      text: "Reasoning",
      type: "thinking",
      details: summary,
      thinkingContent: summary,
    };
  }

  if (type === "command_execution") {
    const command =
      (anyItem.command as string | undefined) ||
      (anyItem.cmd as string | undefined) ||
      (anyItem.shell_command as string | undefined) ||
      (anyItem.shellCommand as string | undefined);
    if (!command) return { text: "Ran a command", type: "bash" };

    const shortCmd =
      command.length > 60 ? command.substring(0, 60) + "..." : command;
    return {
      text: `Ran: ${shortCmd}`,
      type: "bash",
      details: command,
    };
  }

  if (type === "file_change") {
    const filePath =
      (anyItem.file_path as string | undefined) ||
      (anyItem.filePath as string | undefined) ||
      (anyItem.path as string | undefined) ||
      (anyItem.absolute_file_path as string | undefined) ||
      (anyItem.absoluteFilePath as string | undefined);

    const changeKind =
      (anyItem.change_kind as string | undefined) ||
      (anyItem.changeKind as string | undefined) ||
      (anyItem.kind as string | undefined);

    // Handle moves when available
    const fromPath =
      (anyItem.from_path as string | undefined) ||
      (anyItem.fromPath as string | undefined) ||
      (anyItem.old_path as string | undefined) ||
      (anyItem.oldPath as string | undefined);
    const toPath =
      (anyItem.to_path as string | undefined) ||
      (anyItem.toPath as string | undefined) ||
      (anyItem.new_path as string | undefined) ||
      (anyItem.newPath as string | undefined);

    if (changeKind === "move_path" && (fromPath || toPath)) {
      const fromLabel = getShortPath(fromPath || "from");
      const toLabel = getShortPath(toPath || "to");
      return {
        text: `Move ${fromLabel} → ${toLabel}`,
        type: "edit",
        details: `${fromPath || ""} -> ${toPath || ""}`.trim(),
      };
    }

    const label = getShortPath(filePath || "file");
    switch (changeKind) {
      case "create":
      case "add":
        return { text: `Write ${label}`, type: "write", details: filePath };
      case "delete":
        return { text: `Delete ${label}`, type: "edit", details: filePath };
      default:
        return { text: `Edit ${label}`, type: "edit", details: filePath };
    }
  }

  if (type === "mcp_tool_call") {
    const toolName =
      (anyItem.tool_name as string | undefined) ||
      (anyItem.toolName as string | undefined) ||
      (anyItem.name as string | undefined) ||
      (anyItem.tool as string | undefined);
    if (!toolName) return { text: "Using MCP tool...", type: "tool" };
    return { text: `Using ${toolName}...`, type: "tool", details: toolName };
  }

  if (type === "todo_list") {
    const todosRaw =
      (anyItem.todos as unknown[]) ||
      (anyItem.items as unknown[]) ||
      (anyItem.todo_list as unknown[]) ||
      (anyItem.todoList as unknown[]);

    const todos =
      Array.isArray(todosRaw)
        ? todosRaw
            .map((t) => {
              if (!t || typeof t !== "object") return null;
              const todo = t as Record<string, unknown>;
              const content =
                (todo.content as string | undefined) ||
                (todo.text as string | undefined) ||
                (todo.title as string | undefined);

              const statusRaw = todo.status as string | undefined;
              const completed =
                (todo.completed as boolean | undefined) ||
                (todo.done as boolean | undefined) ||
                false;
              const inProgress =
                (todo.in_progress as boolean | undefined) ||
                (todo.inProgress as boolean | undefined) ||
                false;

              const status =
                statusRaw === "completed" || statusRaw === "in_progress" || statusRaw === "pending"
                  ? statusRaw
                  : statusRaw === "done"
                    ? "completed"
                    : completed
                      ? "completed"
                      : inProgress
                        ? "in_progress"
                        : "pending";

              return content
                ? {
                    content,
                    status: status as "pending" | "in_progress" | "completed",
                    activeForm: (todo.activeForm as string | undefined) || content,
                  }
                : null;
            })
            .filter(
              (
                t
              ): t is {
                content: string;
                status: "pending" | "in_progress" | "completed";
                activeForm: string;
              } => Boolean(t)
            )
        : [];

    return {
      text: "Update Todos",
      type: "todo",
      todoData: { todos },
    };
  }

  // Fallback for other Codex item types
  if (typeof type === "string" && type) {
    return { text: type, type: "tool" };
  }

  return null;
}
