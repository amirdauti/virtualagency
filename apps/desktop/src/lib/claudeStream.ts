// Claude Code emits wrapped partial events and completed content blocks. Give
// each block a stable identity so its final event updates, rather than duplicates,
// the streamed card. Ignore nested agents here; they belong to their tool call.
type Event = Record<string, any>;
export class ClaudeStream {
  private message = "";
  private session = "";
  private blocks = new Map<number, Event>();
  private tasks = new Map<string, Event>();
  private calls = new Map<string, Event>();
  private seenResults = new Set<string>();
  private completed = new Set<string>();
  private lastText = "";

  private item(index: number, block: Event, complete: boolean): Event | null {
    if (!["text", "thinking"].includes(block.type)) return null;
    const id = `claude:${this.session}:${this.message}:${index}:${block.type}`;
    if (this.completed.has(id)) return null;
    if (complete) this.completed.add(id);
    const text = block.type === "thinking" ? block.thinking : block.text;
    if (block.type === "text" && text) this.lastText = text;
    return { type: complete ? "item.completed" : "item.updated", item: {
      id, type: block.type === "thinking" ? "reasoning" : "agent_message", text: text || "",
    }};
  }

  process(value: Event): Event[] | null {
    if (!["system", "stream_event", "assistant", "user", "result"].includes(value.type)) return null;
    if (value.parent_tool_use_id) return [];
    if (value.session_id && value.session_id !== this.session) {
      this.session = value.session_id; this.blocks.clear(); this.tasks.clear(); this.calls.clear(); this.completed.clear(); this.seenResults.clear(); this.lastText = "";
    }
    if (value.type === "system") {
      if (value.subtype === "init") this.lastText = "";
      if (value.subtype === "api_retry") return [{type: "va_claude_retry", message: `Connection retry ${value.attempt || 1}${value.max_retries ? ` of ${value.max_retries}` : ""}…`}];
      return null;
    }
    if (value.type === "stream_event") {
      const event = value.event || {};
      if (event.type === "message_start") { this.message = event.message?.id || value.uuid; this.blocks.clear(); }
      if (event.type === "content_block_start") this.blocks.set(event.index, {...event.content_block});
      if (event.type === "content_block_delta") {
        const block = this.blocks.get(event.index);
        if (!block) return [];
        if (event.delta?.type === "text_delta") block.text = (block.text || "") + event.delta.text;
        if (event.delta?.type === "thinking_delta") block.thinking = (block.thinking || "") + event.delta.thinking;
        const item = this.item(event.index, block, false);
        return item ? [item] : [];
      }
      if (event.type === "content_block_stop") {
        const block = this.blocks.get(event.index);
        const item = block && this.item(event.index, block, true);
        return item ? [item] : [];
      }
      return [];
    }
    if (value.type === "assistant") {
      this.message = value.message?.id || value.uuid || this.message;
      const output: Event[] = [];
      const tools: Event[] = [];
      const content = value.message?.content || [];
      for (const [index, block] of content.entries()) {
        // Partial mode emits one completed block per assistant event. Locate its
        // original index; without partial events, content indexes are sufficient.
        const streamedIndex = content.length === 1 ? [...this.blocks].find(([, b]) => b.type === block.type && (b.id ? b.id === block.id : (b.text || b.thinking) === (block.text || block.thinking)))?.[0] : undefined;
        const item = this.item(streamedIndex ?? index, block, true);
        if (item) output.push(item);
        if (block.type === "tool_use") {
          if (["TaskCreate", "TaskUpdate", "TaskList", "TodoWrite"].includes(block.name)) this.calls.set(block.id, block);
          else tools.push(block);
        }
      }
      if (tools.length) output.push({...value, type: "va_claude_tools", message: {...value.message, content: tools}});
      return output;
    }
    if (value.type === "user") {
      let changed = false;
      for (const result of Array.isArray(value.message?.content) ? value.message.content : []) {
        if (result.type !== "tool_result" || this.seenResults.has(result.tool_use_id)) continue;
        const call = this.calls.get(result.tool_use_id);
        if (!call) continue;
        this.seenResults.add(result.tool_use_id);
        if (result.is_error) continue;
        const input = call.input || {};
        const text = typeof result.content === "string" ? result.content : JSON.stringify(result.content);
        if (call.name === "TaskCreate") {
          const id = text.match(/Task\s+#?(\d+)/i)?.[1] || result.tool_use_id;
          this.tasks.set(id, {content: input.subject || "Task", status: "pending"}); changed = true;
        } else if (call.name === "TaskUpdate") {
          const id = String(input.taskId);
          const previous = this.tasks.get(id) || {content: input.subject || `Task ${id}`, status: "pending"};
          if (input.status === "deleted") this.tasks.delete(id);
          else this.tasks.set(id, {...previous, ...(input.subject ? {content: input.subject} : {}), ...(input.status ? {status: input.status} : {})});
          changed = true;
        } else if (call.name === "TodoWrite") {
          this.tasks.clear();
          (input.todos || []).forEach((task: Event, index: number) => this.tasks.set(String(index), task)); changed = true;
        }
      }
      return changed ? [{type: "item.updated", item: {id: `claude:tasks:${this.session}`, type: "todo_list", items: [...this.tasks.values()]}}] : [];
    }
    if (value.type === "result") {
      const output: Event[] = [];
      if (value.result && value.result !== this.lastText) output.push({type: "item.completed", item: {id: `claude:result:${value.uuid || this.message}`, type: "agent_message", text: value.result}});
      output.push({type: value.is_error ? "turn.failed" : "va_claude_end", error: value.is_error ? {message: (value.errors || []).join("\n") || value.result || "Claude Code could not complete this turn."} : undefined});
      return output;
    }
    return null;
  }
}
