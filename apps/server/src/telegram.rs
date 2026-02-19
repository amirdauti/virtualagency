use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, watch};

const TELEGRAM_API_BASE: &str = "https://api.telegram.org";
const TELEGRAM_FILE_BASE: &str = "https://api.telegram.org/file";
const TELEGRAM_POLL_TIMEOUT_SECS: i64 = 25;
const TELEGRAM_TYPING_THROTTLE_SECS: u64 = 4;
const TELEGRAM_MAX_MEDIA_BYTES: usize = 20 * 1024 * 1024; // 20MB
const TELEGRAM_MESSAGE_CHUNK: usize = 3900;
const TELEGRAM_BINDINGS_VERSION: u32 = 1;
const TELEGRAM_CODE_SNIPPET_MAX_CHARS: usize = 1600;
const TELEGRAM_CODE_SNIPPET_MAX_LINES: usize = 120;

#[derive(Debug, Clone)]
pub struct TelegramInboundMedia {
    pub kind: String,
    pub mime_type: Option<String>,
    pub file_name: Option<String>,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct TelegramInboundMessage {
    pub agent_id: String,
    pub update_id: i64,
    pub chat_id: i64,
    pub from_handle: Option<String>,
    pub text: String,
    pub media: Vec<TelegramInboundMedia>,
}

#[derive(Debug, Clone)]
pub struct TelegramBindingConfigInput {
    pub enabled: bool,
    pub bot_token: Option<String>,
    pub allowed_handle: String,
    pub send_typing: bool,
    pub send_updates: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct TelegramBindingStatus {
    pub enabled: bool,
    pub polling: bool,
    pub connected: bool,
    pub has_token: bool,
    pub allowed_handle: String,
    pub allowed_chat_ids: Vec<i64>,
    pub send_typing: bool,
    pub send_updates: bool,
    pub queue_depth: usize,
    pub has_active_turn: bool,
    pub last_error: Option<String>,
    pub last_update_id: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct TelegramDispatch {
    pub agent_id: String,
    pub text: String,
    pub media: Vec<TelegramInboundMedia>,
}

#[derive(Debug, Clone)]
pub enum TelegramAction {
    DispatchToAgent(TelegramDispatch),
    SendMessage {
        bot_token: String,
        chat_id: i64,
        text: String,
    },
    SendTyping {
        bot_token: String,
        chat_id: i64,
    },
}

#[derive(Debug, Clone)]
struct TelegramBindingConfig {
    enabled: bool,
    bot_token: String,
    allowed_handle: String,
    send_typing: bool,
    send_updates: bool,
}

#[derive(Debug, Clone)]
struct TelegramQueuedTurn {
    chat_id: i64,
    text: String,
    media: Vec<TelegramInboundMedia>,
}

#[derive(Debug, Clone)]
struct TelegramActiveTurn {
    chat_id: i64,
    accumulated: String,
    latest_complete: Option<String>,
    last_typing_at: Option<Instant>,
    sent_update_ids: HashSet<String>,
}

struct TelegramAgentState {
    config: TelegramBindingConfig,
    polling: bool,
    connected: bool,
    last_error: Option<String>,
    last_update_id: Option<i64>,
    allowed_chat_ids: Vec<i64>,
    queue: VecDeque<TelegramQueuedTurn>,
    active_turn: Option<TelegramActiveTurn>,
    worker_stop: Option<watch::Sender<bool>>,
}

impl TelegramAgentState {
    fn status(&self) -> TelegramBindingStatus {
        TelegramBindingStatus {
            enabled: self.config.enabled,
            polling: self.polling,
            connected: self.connected,
            has_token: !self.config.bot_token.is_empty(),
            allowed_handle: self.config.allowed_handle.clone(),
            allowed_chat_ids: self.allowed_chat_ids.clone(),
            send_typing: self.config.send_typing,
            send_updates: self.config.send_updates,
            queue_depth: self.queue.len(),
            has_active_turn: self.active_turn.is_some(),
            last_error: self.last_error.clone(),
            last_update_id: self.last_update_id,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PersistedBinding {
    enabled: bool,
    bot_token: String,
    allowed_handle: String,
    send_typing: bool,
    #[serde(default)]
    send_updates: bool,
    #[serde(default)]
    allowed_chat_ids: Vec<i64>,
    #[serde(default)]
    last_update_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PersistedBindingsFile {
    version: u32,
    bindings: HashMap<String, PersistedBinding>,
}

pub struct TelegramManager {
    inbound_tx: mpsc::UnboundedSender<TelegramInboundMessage>,
    persistence_path: PathBuf,
    agents: HashMap<String, TelegramAgentState>,
}

impl TelegramManager {
    pub fn new(
        inbound_tx: mpsc::UnboundedSender<TelegramInboundMessage>,
        persistence_path: PathBuf,
    ) -> Self {
        let agents = load_persisted_bindings(&persistence_path)
            .unwrap_or_default()
            .into_iter()
            .map(|(agent_id, binding)| {
                let state = TelegramAgentState {
                    config: TelegramBindingConfig {
                        enabled: binding.enabled,
                        bot_token: binding.bot_token,
                        allowed_handle: normalize_handle(&binding.allowed_handle),
                        send_typing: binding.send_typing,
                        send_updates: binding.send_updates,
                    },
                    polling: false,
                    connected: false,
                    last_error: None,
                    last_update_id: binding.last_update_id,
                    allowed_chat_ids: binding.allowed_chat_ids,
                    queue: VecDeque::new(),
                    active_turn: None,
                    worker_stop: None,
                };
                (agent_id, state)
            })
            .collect();

        Self {
            inbound_tx,
            persistence_path,
            agents,
        }
    }

    pub fn ensure_binding_running(&mut self, agent_id: &str) {
        let Some(state) = self.agents.get_mut(agent_id) else {
            return;
        };
        if !state.config.enabled {
            return;
        }
        if state.worker_stop.is_some() {
            return;
        }

        let initial_offset = state.last_update_id.map(|id| id + 1).unwrap_or(0);
        let stop_tx = spawn_polling_worker(
            self.inbound_tx.clone(),
            agent_id.to_string(),
            state.config.bot_token.clone(),
            initial_offset,
        );
        state.worker_stop = Some(stop_tx);
        state.polling = true;
        state.connected = true;
    }

    fn persist_bindings(&self) -> Result<(), String> {
        let mut bindings: HashMap<String, PersistedBinding> = HashMap::new();

        for (agent_id, state) in &self.agents {
            bindings.insert(
                agent_id.clone(),
                PersistedBinding {
                    enabled: state.config.enabled,
                    bot_token: state.config.bot_token.clone(),
                    allowed_handle: state.config.allowed_handle.clone(),
                    send_typing: state.config.send_typing,
                    send_updates: state.config.send_updates,
                    allowed_chat_ids: state.allowed_chat_ids.clone(),
                    last_update_id: state.last_update_id,
                },
            );
        }

        let payload = PersistedBindingsFile {
            version: TELEGRAM_BINDINGS_VERSION,
            bindings,
        };

        if let Some(parent) = self.persistence_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                format!(
                    "failed to create bindings directory {}: {}",
                    parent.display(),
                    e
                )
            })?;
        }

        let json = serde_json::to_string_pretty(&payload)
            .map_err(|e| format!("failed to serialize bindings: {}", e))?;

        let tmp_path = self.persistence_path.with_extension("json.tmp");
        std::fs::write(&tmp_path, json)
            .map_err(|e| format!("failed to write temp bindings file: {}", e))?;
        std::fs::rename(&tmp_path, &self.persistence_path).map_err(|e| {
            format!(
                "failed to move bindings file {} -> {}: {}",
                tmp_path.display(),
                self.persistence_path.display(),
                e
            )
        })?;

        Ok(())
    }

    pub fn get_status(&self, agent_id: &str) -> TelegramBindingStatus {
        self.agents
            .get(agent_id)
            .map(|s| s.status())
            .unwrap_or_else(|| TelegramBindingStatus {
                enabled: false,
                polling: false,
                connected: false,
                has_token: false,
                allowed_handle: String::new(),
                allowed_chat_ids: Vec::new(),
                send_typing: true,
                send_updates: false,
                queue_depth: 0,
                has_active_turn: false,
                last_error: None,
                last_update_id: None,
            })
    }

    pub fn upsert_binding(
        &mut self,
        agent_id: &str,
        input: TelegramBindingConfigInput,
    ) -> Result<TelegramBindingStatus, String> {
        let allowed_handle = normalize_handle(&input.allowed_handle);
        if allowed_handle.is_empty() {
            return Err("allowed_handle is required".to_string());
        }

        let existing_token = self
            .agents
            .get(agent_id)
            .map(|state| state.config.bot_token.clone())
            .unwrap_or_default();

        let bot_token = input.bot_token.unwrap_or(existing_token);
        if bot_token.trim().is_empty() {
            return Err("bot_token is required".to_string());
        }

        let status = {
            let state =
                self.agents
                    .entry(agent_id.to_string())
                    .or_insert_with(|| TelegramAgentState {
                        config: TelegramBindingConfig {
                            enabled: false,
                            bot_token: String::new(),
                            allowed_handle: String::new(),
                            send_typing: true,
                            send_updates: false,
                        },
                        polling: false,
                        connected: false,
                        last_error: None,
                        last_update_id: None,
                        allowed_chat_ids: Vec::new(),
                        queue: VecDeque::new(),
                        active_turn: None,
                        worker_stop: None,
                    });

            if let Some(stop_tx) = state.worker_stop.take() {
                let _ = stop_tx.send(true);
            }

            state.config = TelegramBindingConfig {
                enabled: input.enabled,
                bot_token,
                allowed_handle,
                send_typing: input.send_typing,
                send_updates: input.send_updates,
            };
            state.last_error = None;
            state.connected = false;

            if state.config.enabled {
                let initial_offset = state.last_update_id.map(|id| id + 1).unwrap_or(0);
                let stop_tx = spawn_polling_worker(
                    self.inbound_tx.clone(),
                    agent_id.to_string(),
                    state.config.bot_token.clone(),
                    initial_offset,
                );
                state.worker_stop = Some(stop_tx);
                state.polling = true;
                state.connected = true;
            } else {
                state.worker_stop = None;
                state.polling = false;
            }

            state.status()
        };

        self.persist_bindings()?;

        Ok(status)
    }

    pub fn remove_binding(&mut self, agent_id: &str) {
        if let Some(mut state) = self.agents.remove(agent_id) {
            if let Some(stop_tx) = state.worker_stop.take() {
                let _ = stop_tx.send(true);
            }
        }
        if let Err(err) = self.persist_bindings() {
            tracing::warn!(
                "[telegram] Failed to persist bindings after removal: {}",
                err
            );
        }
    }

    pub fn clear_for_agent(&mut self, agent_id: &str) {
        self.remove_binding(agent_id);
    }

    pub fn handle_inbound(&mut self, msg: TelegramInboundMessage) -> Vec<TelegramAction> {
        let mut actions = Vec::new();
        let agent_id = msg.agent_id.clone();
        let should_persist = {
            let Some(state) = self.agents.get_mut(&agent_id) else {
                return actions;
            };
            if !state.config.enabled {
                return actions;
            }

            let mut should_persist = false;
            if state.last_update_id != Some(msg.update_id) {
                state.last_update_id = Some(msg.update_id);
                should_persist = true;
            }

            let from_handle = normalize_handle(msg.from_handle.as_deref().unwrap_or_default());
            if from_handle.is_empty() || from_handle != state.config.allowed_handle {
                return actions;
            }

            if !state.allowed_chat_ids.iter().any(|id| *id == msg.chat_id) {
                state.allowed_chat_ids.push(msg.chat_id);
                state.allowed_chat_ids.sort_unstable();
                state.allowed_chat_ids.dedup();
                should_persist = true;
            }

            state.queue.push_back(TelegramQueuedTurn {
                chat_id: msg.chat_id,
                text: msg.text,
                media: msg.media,
            });

            maybe_start_next_turn(&agent_id, state, &mut actions);
            should_persist
        };

        if !should_persist {
            return actions;
        }

        let persist_error = self.persist_bindings().err();

        if let Some(err) = persist_error {
            if let Some(state) = self.agents.get_mut(&agent_id) {
                state.last_error = Some(format!("Failed to persist bindings: {}", err));
            }
        }

        actions
    }

    pub fn notify_dispatch_failure(&mut self, agent_id: &str, error: &str) -> Vec<TelegramAction> {
        let mut actions = Vec::new();
        let Some(state) = self.agents.get_mut(agent_id) else {
            return actions;
        };

        state.last_error = Some(error.to_string());

        if let Some(active) = state.active_turn.take() {
            actions.push(TelegramAction::SendMessage {
                bot_token: state.config.bot_token.clone(),
                chat_id: active.chat_id,
                text: format!("Failed to deliver message to agent: {}", error),
            });
        }

        maybe_start_next_turn(agent_id, state, &mut actions);
        actions
    }

    pub fn handle_broadcast(&mut self, message: &crate::BroadcastMessage) -> Vec<TelegramAction> {
        let mut actions = Vec::new();

        match message {
            crate::BroadcastMessage::AgentOutput(output) => {
                let Some(state) = self.agents.get_mut(&output.agent_id) else {
                    return actions;
                };
                if !state.config.enabled {
                    return actions;
                }

                let bot_token = state.config.bot_token.clone();
                let Some(active) = state.active_turn.as_mut() else {
                    return actions;
                };

                apply_agent_output_to_turn(&output.data, active);

                if state.config.send_updates {
                    for message in collect_incremental_updates(&output.data, active) {
                        for chunk in split_for_telegram(&message) {
                            actions.push(TelegramAction::SendMessage {
                                bot_token: bot_token.clone(),
                                chat_id: active.chat_id,
                                text: chunk,
                            });
                        }
                    }
                }

                maybe_enqueue_typing(state, &mut actions);
            }
            crate::BroadcastMessage::AgentStatus(status) => {
                let Some(state) = self.agents.get_mut(&status.agent_id) else {
                    return actions;
                };
                if !state.config.enabled {
                    return actions;
                }

                if matches!(
                    status.status,
                    crate::agents::AgentStatus::Thinking | crate::agents::AgentStatus::Working
                ) {
                    maybe_enqueue_typing(state, &mut actions);
                }

                if matches!(
                    status.status,
                    crate::agents::AgentStatus::Idle
                        | crate::agents::AgentStatus::Error
                        | crate::agents::AgentStatus::Exited
                ) {
                    if let Some(active) = state.active_turn.take() {
                        let response = finalize_turn_text(&active, &status.status);
                        for chunk in split_for_telegram(&response) {
                            actions.push(TelegramAction::SendMessage {
                                bot_token: state.config.bot_token.clone(),
                                chat_id: active.chat_id,
                                text: chunk,
                            });
                        }
                        maybe_start_next_turn(&status.agent_id, state, &mut actions);
                    }
                }
            }
            _ => {}
        }

        actions
    }
}

fn maybe_start_next_turn(
    agent_id: &str,
    state: &mut TelegramAgentState,
    actions: &mut Vec<TelegramAction>,
) {
    if state.active_turn.is_some() {
        return;
    }
    let Some(next) = state.queue.pop_front() else {
        return;
    };

    let chat_id = next.chat_id;
    state.active_turn = Some(TelegramActiveTurn {
        chat_id,
        accumulated: String::new(),
        latest_complete: None,
        last_typing_at: None,
        sent_update_ids: HashSet::new(),
    });

    actions.push(TelegramAction::DispatchToAgent(TelegramDispatch {
        agent_id: agent_id.to_string(),
        text: next.text,
        media: next.media,
    }));
}

fn maybe_enqueue_typing(state: &mut TelegramAgentState, actions: &mut Vec<TelegramAction>) {
    if !state.config.send_typing {
        return;
    }

    let Some(active) = state.active_turn.as_mut() else {
        return;
    };

    let should_send = active
        .last_typing_at
        .map(|last| last.elapsed() >= Duration::from_secs(TELEGRAM_TYPING_THROTTLE_SECS))
        .unwrap_or(true);

    if !should_send {
        return;
    }

    active.last_typing_at = Some(Instant::now());
    actions.push(TelegramAction::SendTyping {
        bot_token: state.config.bot_token.clone(),
        chat_id: active.chat_id,
    });
}

fn apply_agent_output_to_turn(raw: &str, turn: &mut TelegramActiveTurn) {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) else {
        return;
    };
    let Some(event_type) = value.get("type").and_then(|v| v.as_str()) else {
        return;
    };

    match event_type {
        // Claude streaming delta
        "content_block_delta" => {
            if let Some(delta) = value
                .get("delta")
                .and_then(|v| v.get("text"))
                .and_then(|v| v.as_str())
            {
                turn.accumulated.push_str(delta);
            }
        }
        // Claude final assistant shape
        "assistant" => {
            let mut collected = String::new();
            if let Some(content) = value
                .get("message")
                .and_then(|v| v.get("content"))
                .and_then(|v| v.as_array())
            {
                for block in content {
                    if block.get("type").and_then(|v| v.as_str()) == Some("text") {
                        if let Some(text) = block.get("text").and_then(|v| v.as_str()) {
                            if !collected.is_empty() {
                                collected.push('\n');
                            }
                            collected.push_str(text);
                        }
                    }
                }
            }
            if !collected.trim().is_empty() {
                turn.latest_complete = Some(collected);
            }
        }
        // Claude result fallback
        "result" => {
            if let Some(text) = value.get("result").and_then(|v| v.as_str()) {
                if !text.trim().is_empty() {
                    turn.latest_complete = Some(text.to_string());
                }
            }
        }
        // Codex final message
        "item.completed" => {
            let item = value.get("item");
            let is_agent_message =
                item.and_then(|v| v.get("type")).and_then(|v| v.as_str()) == Some("agent_message");
            if is_agent_message {
                if let Some(text) = item.and_then(|v| v.get("text")).and_then(|v| v.as_str()) {
                    if !text.trim().is_empty() {
                        turn.latest_complete = Some(text.to_string());
                    }
                }
            }
        }
        _ => {}
    }
}

fn collect_incremental_updates(raw: &str, turn: &mut TelegramActiveTurn) -> Vec<String> {
    let mut updates = Vec::new();
    let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) else {
        return updates;
    };

    let Some(event_type) = json_get_str(&value, "type") else {
        return updates;
    };

    match event_type {
        "assistant" => {
            if let Some(content) = value
                .get("message")
                .and_then(|v| v.get("content"))
                .and_then(|v| v.as_array())
            {
                for (idx, block) in content.iter().enumerate() {
                    if json_get_str(block, "type") != Some("tool_use") {
                        continue;
                    }
                    let tool_name = json_get_first_str(block, &["name", "tool"]).unwrap_or("tool");
                    let tool_id = json_get_first_str(block, &["id", "tool_id", "toolId"])
                        .map(|s| s.to_string())
                        .or_else(|| Some(format!("assistant-tool-{}", idx)));
                    if let Some(update) =
                        format_claude_tool_use_update(tool_name, block.get("input"), turn, tool_id)
                    {
                        updates.push(update);
                    }
                }
            }
        }
        "tool_use" => {
            let tool_name = json_get_first_str(&value, &["name", "tool"]).unwrap_or("tool");
            let tool_id =
                json_get_first_str(&value, &["id", "tool_id", "toolId"]).map(|s| s.to_string());
            if let Some(update) =
                format_claude_tool_use_update(tool_name, value.get("input"), turn, tool_id)
            {
                updates.push(update);
            }
        }
        "content_block_start" => {
            let block = value.get("content_block");
            if block.and_then(|v| json_get_str(v, "type")) == Some("tool_use") {
                let tool_name = block
                    .and_then(|v| json_get_first_str(v, &["name", "tool"]))
                    .unwrap_or("tool");
                let tool_id = block
                    .and_then(|v| json_get_first_str(v, &["id", "tool_id", "toolId"]))
                    .map(|s| s.to_string());
                if let Some(update) = format_claude_tool_use_update(tool_name, None, turn, tool_id)
                {
                    updates.push(update);
                }
            }
        }
        "item.started" => {
            if let Some(item) = value.get("item") {
                if let Some(update) = format_codex_item_started_update(item, turn) {
                    updates.push(update);
                }
            }
        }
        "item.completed" => {
            if let Some(item) = value.get("item") {
                if let Some(update) = format_codex_item_completed_update(item, turn) {
                    updates.push(update);
                }
            }
        }
        "turn.failed" => {
            if let Some(err) = value
                .get("error")
                .and_then(|v| json_get_first_str(v, &["message", "detail"]))
                .or_else(|| json_get_first_str(&value, &["message"]))
            {
                updates.push(format!("Error: {}", err));
            }
        }
        _ => {}
    }

    updates
}

fn format_claude_tool_use_update(
    tool_name: &str,
    input: Option<&serde_json::Value>,
    turn: &mut TelegramActiveTurn,
    tool_id: Option<String>,
) -> Option<String> {
    let fallback_key = format!(
        "{}:{}:{}",
        tool_name,
        input
            .and_then(|v| json_get_first_str(v, &["file_path", "filePath", "path"]))
            .unwrap_or(""),
        input
            .and_then(|v| json_get_first_str(v, &["command", "cmd"]))
            .unwrap_or("")
    );
    let key = tool_id
        .map(|id| format!("claude-tool:{}", id))
        .unwrap_or_else(|| format!("claude-tool:{}", fallback_key));
    if !turn.sent_update_ids.insert(key) {
        return None;
    }

    let file_path = input
        .and_then(|v| json_get_first_str(v, &["file_path", "filePath", "path"]))
        .unwrap_or("");
    let file_label = if file_path.is_empty() {
        "file".to_string()
    } else {
        short_path(file_path)
    };

    match tool_name {
        "Read" => Some(format!("Read {}", file_label)),
        "Write" => {
            let content = input
                .and_then(|v| json_get_first_str(v, &["content", "new_content", "newContent"]))
                .unwrap_or("");
            if content.is_empty() {
                return Some(format!("Write {}", file_label));
            }
            let language = language_from_path(file_path);
            Some(format_code_update_message(
                &format!("Write {}", file_label),
                &language,
                content,
            ))
        }
        "Edit" => {
            let new_text = input
                .and_then(|v| json_get_first_str(v, &["new_string", "newString", "new_content"]))
                .unwrap_or("");
            if new_text.is_empty() {
                return Some(format!("Edit {}", file_label));
            }
            let old_text = input
                .and_then(|v| json_get_first_str(v, &["old_string", "oldString", "old_content"]))
                .unwrap_or("");
            let added_only = extract_added_lines(old_text, new_text);
            let snippet = if added_only.trim().is_empty() {
                new_text
            } else {
                added_only.as_str()
            };
            let language = language_from_path(file_path);
            Some(format_code_update_message(
                &format!("Edit {}", file_label),
                &language,
                snippet,
            ))
        }
        "Bash" => {
            let command = input
                .and_then(|v| {
                    json_get_first_str(v, &["command", "cmd", "shell_command", "shellCommand"])
                })
                .unwrap_or("");
            if command.is_empty() {
                Some("Ran command".to_string())
            } else {
                Some(format_code_update_message("Ran command", "bash", command))
            }
        }
        "Glob" => {
            let pattern = input
                .and_then(|v| json_get_first_str(v, &["pattern"]))
                .unwrap_or("files");
            Some(format!("Searched for {}", pattern))
        }
        "Grep" => {
            let pattern = input
                .and_then(|v| json_get_first_str(v, &["pattern"]))
                .unwrap_or("pattern");
            Some(format!("Searched for \"{}\"", pattern))
        }
        _ => Some(format!("Using {}...", tool_name)),
    }
}

fn format_codex_item_started_update(
    item: &serde_json::Value,
    turn: &mut TelegramActiveTurn,
) -> Option<String> {
    let item_type = json_get_str(item, "type")?;
    if item_type == "agent_message" || item_type == "file_change" {
        return None;
    }

    let fallback =
        json_get_first_str(item, &["command", "tool_name", "name", "summary"]).unwrap_or(item_type);
    let key = get_codex_item_id(item)
        .map(|id| format!("codex-start:{}", id))
        .unwrap_or_else(|| format!("codex-start:{}:{}", item_type, fallback));
    if !turn.sent_update_ids.insert(key) {
        return None;
    }

    match item_type {
        "reasoning" => {
            let summary = json_get_first_str(item, &["text", "summary", "reasoning"])
                .unwrap_or("Thinking...");
            Some(format!("Reasoning: {}", truncate_text(summary, 240)))
        }
        "command_execution" => {
            let command =
                json_get_first_str(item, &["command", "cmd", "shell_command", "shellCommand"])
                    .unwrap_or("command");
            Some(format_code_update_message("Ran command", "bash", command))
        }
        "mcp_tool_call" => {
            let tool_name = json_get_first_str(item, &["tool_name", "toolName", "name", "tool"])
                .unwrap_or("MCP tool");
            Some(format!("Using {}...", tool_name))
        }
        "todo_list" => Some("Updating todos...".to_string()),
        _ => Some(item_type.to_string()),
    }
}

fn format_codex_item_completed_update(
    item: &serde_json::Value,
    turn: &mut TelegramActiveTurn,
) -> Option<String> {
    let item_type = json_get_str(item, "type")?;
    if item_type == "agent_message" {
        return None;
    }

    if item_type == "todo_list" {
        let key = get_codex_item_id(item)
            .map(|id| format!("codex-complete:{}", id))
            .unwrap_or_else(|| "codex-complete:todo_list".to_string());
        if !turn.sent_update_ids.insert(key) {
            return None;
        }
        return Some("Todos updated.".to_string());
    }

    if item_type != "file_change" {
        return None;
    }

    let key = get_codex_item_id(item)
        .map(|id| format!("codex-complete:{}", id))
        .unwrap_or_else(|| "codex-complete:file_change".to_string());
    if !turn.sent_update_ids.insert(key) {
        return None;
    }

    let changes = get_codex_file_changes(item);
    let first_change = changes.first();
    let path = first_change.map(|(path, _)| path.as_str()).unwrap_or("");
    let label = if path.is_empty() {
        "file".to_string()
    } else {
        short_path(path)
    };

    let new_text = json_get_first_str(
        item,
        &[
            "new_string",
            "newString",
            "new_content",
            "newContent",
            "content",
        ],
    )
    .unwrap_or("");
    let old_text = json_get_first_str(
        item,
        &["old_string", "oldString", "old_content", "oldContent"],
    )
    .unwrap_or("");
    if !new_text.is_empty() {
        let added_only = extract_added_lines(old_text, new_text);
        let snippet = if added_only.trim().is_empty() {
            new_text
        } else {
            added_only.as_str()
        };
        let language = language_from_path(path);
        return Some(format_code_update_message(
            &format!("Edit {}", label),
            &language,
            snippet,
        ));
    }

    if changes.is_empty() {
        return Some("Updated files.".to_string());
    }

    let mut lines = Vec::new();
    for (path, kind) in changes.iter().take(5) {
        let action = match kind.as_str() {
            "create" | "add" => "Write",
            "delete" | "remove" => "Delete",
            _ => "Edit",
        };
        lines.push(format!("{} {}", action, short_path(path)));
    }

    Some(lines.join("\n"))
}

fn get_codex_item_id(item: &serde_json::Value) -> Option<String> {
    for key in [
        "id",
        "item_id",
        "itemId",
        "call_id",
        "callId",
        "tool_call_id",
        "toolCallId",
    ] {
        if let Some(value) = item.get(key) {
            if let Some(s) = value.as_str() {
                let trimmed = s.trim();
                if !trimmed.is_empty() {
                    return Some(trimmed.to_string());
                }
            }
            if let Some(n) = value.as_i64() {
                return Some(n.to_string());
            }
            if let Some(n) = value.as_u64() {
                return Some(n.to_string());
            }
        }
    }
    None
}

fn get_codex_file_changes(item: &serde_json::Value) -> Vec<(String, String)> {
    let mut out = Vec::new();

    if let Some(changes) = item.get("changes").and_then(|v| v.as_array()) {
        for change in changes {
            let Some(path) = json_get_first_str(change, &["path"]) else {
                continue;
            };
            let kind = json_get_first_str(change, &["kind"]).unwrap_or("modify");
            out.push((path.to_string(), kind.to_lowercase()));
        }
        if !out.is_empty() {
            return out;
        }
    }

    if let Some(path) = json_get_first_str(
        item,
        &[
            "file_path",
            "filePath",
            "path",
            "absolute_file_path",
            "absoluteFilePath",
        ],
    ) {
        let kind =
            json_get_first_str(item, &["change_kind", "changeKind", "kind"]).unwrap_or("modify");
        out.push((path.to_string(), kind.to_lowercase()));
    }

    out
}

fn json_get_str<'a>(value: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    value
        .get(key)
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

fn json_get_first_str<'a>(value: &'a serde_json::Value, keys: &[&str]) -> Option<&'a str> {
    for key in keys {
        if let Some(found) = json_get_str(value, key) {
            return Some(found);
        }
    }
    None
}

fn short_path(path: &str) -> String {
    let parts: Vec<&str> = path.split('/').collect();
    if parts.len() <= 2 {
        return path.to_string();
    }
    format!(".../{}/{}", parts[parts.len() - 2], parts[parts.len() - 1])
}

fn language_from_path(path: &str) -> String {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase());
    match ext.as_deref() {
        Some("rs") => "rust",
        Some("ts") => "typescript",
        Some("tsx") => "tsx",
        Some("js") => "javascript",
        Some("jsx") => "jsx",
        Some("py") => "python",
        Some("go") => "go",
        Some("java") => "java",
        Some("kt") => "kotlin",
        Some("swift") => "swift",
        Some("json") => "json",
        Some("toml") => "toml",
        Some("yaml") | Some("yml") => "yaml",
        Some("md") => "markdown",
        Some("sh") => "bash",
        Some("sql") => "sql",
        Some("html") => "html",
        Some("css") => "css",
        _ => "",
    }
    .to_string()
}

fn format_code_update_message(title: &str, language: &str, raw_code: &str) -> String {
    let snippet = clamp_code_snippet(raw_code);
    let escaped_title = escape_markdown_v2_text(title);
    let escaped_code = escape_markdown_v2_code(&snippet);
    if language.is_empty() {
        format!("{}\n```\n{}\n```", escaped_title, escaped_code)
    } else {
        format!("{}\n```{}\n{}\n```", escaped_title, language, escaped_code)
    }
}

fn clamp_code_snippet(raw: &str) -> String {
    let mut lines: Vec<&str> = raw.lines().collect();
    if lines.len() > TELEGRAM_CODE_SNIPPET_MAX_LINES {
        lines.truncate(TELEGRAM_CODE_SNIPPET_MAX_LINES);
        lines.push("// ... truncated");
    }

    let mut out = lines.join("\n");
    if out.chars().count() > TELEGRAM_CODE_SNIPPET_MAX_CHARS {
        out = out
            .chars()
            .take(TELEGRAM_CODE_SNIPPET_MAX_CHARS)
            .collect::<String>();
        out.push_str("\n// ... truncated");
    }
    out
}

fn truncate_text(input: &str, max_chars: usize) -> String {
    if input.chars().count() <= max_chars {
        return input.to_string();
    }
    let mut out: String = input.chars().take(max_chars).collect();
    out.push_str("...");
    out
}

fn extract_added_lines(old_text: &str, new_text: &str) -> String {
    if old_text.trim().is_empty() {
        return new_text.to_string();
    }

    let old_lines: HashSet<String> = old_text.lines().map(|line| line.to_string()).collect();
    let mut added = Vec::new();
    for line in new_text.lines() {
        if !old_lines.contains(line) {
            added.push(line);
        }
    }

    if added.is_empty() {
        new_text.to_string()
    } else {
        added.join("\n")
    }
}

fn escape_markdown_v2_text(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for ch in input.chars() {
        if matches!(
            ch,
            '_' | '*'
                | '['
                | ']'
                | '('
                | ')'
                | '~'
                | '`'
                | '>'
                | '#'
                | '+'
                | '-'
                | '='
                | '|'
                | '{'
                | '}'
                | '.'
                | '!'
                | '\\'
        ) {
            out.push('\\');
        }
        out.push(ch);
    }
    out
}

fn escape_markdown_v2_code(input: &str) -> String {
    input.replace('\\', "\\\\").replace('`', "\\`")
}

fn finalize_turn_text(turn: &TelegramActiveTurn, status: &crate::agents::AgentStatus) -> String {
    let mut text = turn
        .latest_complete
        .clone()
        .unwrap_or_else(|| turn.accumulated.clone());
    text = text.trim().to_string();

    if text.is_empty() {
        text = match status {
            crate::agents::AgentStatus::Error => {
                "Agent encountered an error while processing your request.".to_string()
            }
            _ => "Completed.".to_string(),
        };
    }

    text
}

fn split_for_telegram(text: &str) -> Vec<String> {
    if text.chars().count() <= TELEGRAM_MESSAGE_CHUNK {
        return vec![text.to_string()];
    }

    let mut parts = Vec::new();
    let mut start = 0usize;
    let chars: Vec<char> = text.chars().collect();
    while start < chars.len() {
        let end = (start + TELEGRAM_MESSAGE_CHUNK).min(chars.len());
        let chunk: String = chars[start..end].iter().collect();
        parts.push(chunk);
        start = end;
    }
    parts
}

fn normalize_handle(raw: &str) -> String {
    raw.trim().trim_start_matches('@').to_ascii_lowercase()
}

fn load_persisted_bindings(path: &Path) -> Result<HashMap<String, PersistedBinding>, String> {
    if !path.exists() {
        return Ok(HashMap::new());
    }

    let raw = std::fs::read_to_string(path)
        .map_err(|e| format!("failed to read {}: {}", path.display(), e))?;
    if raw.trim().is_empty() {
        return Ok(HashMap::new());
    }

    let parsed = serde_json::from_str::<PersistedBindingsFile>(&raw)
        .map_err(|e| format!("failed to parse {}: {}", path.display(), e))?;

    if parsed.version != TELEGRAM_BINDINGS_VERSION {
        tracing::warn!(
            "[telegram] Ignoring persisted bindings at {} due to version mismatch: {} != {}",
            path.display(),
            parsed.version,
            TELEGRAM_BINDINGS_VERSION
        );
        return Ok(HashMap::new());
    }

    Ok(parsed.bindings)
}

fn spawn_polling_worker(
    inbound_tx: mpsc::UnboundedSender<TelegramInboundMessage>,
    agent_id: String,
    bot_token: String,
    initial_offset: i64,
) -> watch::Sender<bool> {
    let (stop_tx, mut stop_rx) = watch::channel(false);

    tokio::spawn(async move {
        let client = reqwest::Client::new();
        let mut offset: i64 = initial_offset;

        loop {
            if *stop_rx.borrow() {
                break;
            }

            let poll_fut = poll_once(&client, &bot_token, offset);
            let updates = tokio::select! {
                _ = stop_rx.changed() => {
                    if *stop_rx.borrow() {
                        break;
                    }
                    continue;
                }
                result = poll_fut => result
            };

            match updates {
                Ok(list) => {
                    for update in list {
                        offset = update.update_id + 1;
                        if let Some(msg) = update.message {
                            if msg.from.as_ref().and_then(|u| u.is_bot).unwrap_or(false) {
                                continue;
                            }

                            let text = msg
                                .text
                                .as_deref()
                                .or(msg.caption.as_deref())
                                .unwrap_or_default()
                                .trim()
                                .to_string();
                            let media = collect_message_media(&client, &bot_token, &msg).await;

                            if text.is_empty() && media.is_empty() {
                                continue;
                            }

                            let normalized_text = if text.is_empty() {
                                "(media attached)".to_string()
                            } else {
                                text
                            };

                            let _ = inbound_tx.send(TelegramInboundMessage {
                                agent_id: agent_id.clone(),
                                update_id: update.update_id,
                                chat_id: msg.chat.id,
                                from_handle: msg.from.and_then(|u| u.username),
                                text: normalized_text,
                                media,
                            });
                        }
                    }
                }
                Err(err) => {
                    tracing::warn!("[telegram] Polling error for agent {}: {}", agent_id, err);
                    tokio::time::sleep(Duration::from_secs(2)).await;
                }
            }
        }
    });

    stop_tx
}

async fn poll_once(
    client: &reqwest::Client,
    bot_token: &str,
    offset: i64,
) -> Result<Vec<TelegramUpdate>, String> {
    let url = format!("{}/bot{}/getUpdates", TELEGRAM_API_BASE, bot_token);
    let response = client
        .post(url)
        .json(&serde_json::json!({
            "offset": offset,
            "timeout": TELEGRAM_POLL_TIMEOUT_SECS,
            "allowed_updates": ["message"],
        }))
        .send()
        .await
        .map_err(|e| format!("request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("telegram getUpdates HTTP {}", response.status()));
    }

    let payload = response
        .json::<TelegramApiResponse<Vec<TelegramUpdate>>>()
        .await
        .map_err(|e| format!("invalid getUpdates response: {}", e))?;

    if !payload.ok {
        return Err(payload
            .description
            .unwrap_or_else(|| "telegram returned ok=false".to_string()));
    }

    Ok(payload.result.unwrap_or_default())
}

async fn collect_message_media(
    client: &reqwest::Client,
    bot_token: &str,
    message: &TelegramMessage,
) -> Vec<TelegramInboundMedia> {
    let mut out = Vec::new();
    let mut refs = Vec::new();

    if let Some(photo_sizes) = &message.photo {
        if let Some(best) = photo_sizes
            .iter()
            .max_by_key(|item| item.file_size.unwrap_or(0))
        {
            refs.push(MediaRef {
                file_id: best.file_id.clone(),
                file_size: best.file_size.unwrap_or(0),
                kind: "photo".to_string(),
                file_name: Some("photo.jpg".to_string()),
                mime_type: Some("image/jpeg".to_string()),
            });
        }
    }

    if let Some(doc) = &message.document {
        refs.push(MediaRef {
            file_id: doc.file_id.clone(),
            file_size: doc.file_size.unwrap_or(0),
            kind: "document".to_string(),
            file_name: doc.file_name.clone(),
            mime_type: doc.mime_type.clone(),
        });
    }

    if let Some(video) = &message.video {
        refs.push(MediaRef {
            file_id: video.file_id.clone(),
            file_size: video.file_size.unwrap_or(0),
            kind: "video".to_string(),
            file_name: video.file_name.clone(),
            mime_type: video.mime_type.clone(),
        });
    }

    if let Some(audio) = &message.audio {
        refs.push(MediaRef {
            file_id: audio.file_id.clone(),
            file_size: audio.file_size.unwrap_or(0),
            kind: "audio".to_string(),
            file_name: audio.file_name.clone(),
            mime_type: audio.mime_type.clone(),
        });
    }

    if let Some(voice) = &message.voice {
        refs.push(MediaRef {
            file_id: voice.file_id.clone(),
            file_size: voice.file_size.unwrap_or(0),
            kind: "voice".to_string(),
            file_name: Some("voice.ogg".to_string()),
            mime_type: voice.mime_type.clone(),
        });
    }

    for media_ref in refs {
        if media_ref.file_size > TELEGRAM_MAX_MEDIA_BYTES as i64 {
            continue;
        }
        if let Ok(media) = download_media(client, bot_token, &media_ref).await {
            out.push(media);
        }
    }

    out
}

async fn download_media(
    client: &reqwest::Client,
    bot_token: &str,
    media_ref: &MediaRef,
) -> Result<TelegramInboundMedia, String> {
    let get_file_url = format!("{}/bot{}/getFile", TELEGRAM_API_BASE, bot_token);
    let response = client
        .get(get_file_url)
        .query(&[("file_id", media_ref.file_id.as_str())])
        .send()
        .await
        .map_err(|e| format!("getFile failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("getFile HTTP {}", response.status()));
    }

    let payload = response
        .json::<TelegramApiResponse<TelegramFile>>()
        .await
        .map_err(|e| format!("invalid getFile response: {}", e))?;

    if !payload.ok {
        return Err(payload
            .description
            .unwrap_or_else(|| "getFile ok=false".to_string()));
    }

    let file_path = payload
        .result
        .and_then(|f| f.file_path)
        .ok_or_else(|| "missing file_path".to_string())?;

    let download_url = format!("{}/bot{}/{}", TELEGRAM_FILE_BASE, bot_token, file_path);
    let bytes = client
        .get(download_url)
        .send()
        .await
        .map_err(|e| format!("download failed: {}", e))?
        .bytes()
        .await
        .map_err(|e| format!("read body failed: {}", e))?;

    if bytes.len() > TELEGRAM_MAX_MEDIA_BYTES {
        return Err("media too large".to_string());
    }

    Ok(TelegramInboundMedia {
        kind: media_ref.kind.clone(),
        mime_type: media_ref.mime_type.clone(),
        file_name: media_ref.file_name.clone(),
        bytes: bytes.to_vec(),
    })
}

pub async fn send_telegram_text(bot_token: &str, chat_id: i64, text: &str) -> Result<(), String> {
    let client = reqwest::Client::new();
    let url = format!("{}/bot{}/sendMessage", TELEGRAM_API_BASE, bot_token);
    let has_code_fence = text.contains("```");

    if has_code_fence {
        match send_telegram_text_request(&client, &url, chat_id, text, Some("MarkdownV2")).await {
            Ok(_) => return Ok(()),
            Err(v2_err) => {
                tracing::debug!(
                    "[telegram] MarkdownV2 send failed, retrying as Markdown/plain: {}",
                    v2_err
                );
                match send_telegram_text_request(&client, &url, chat_id, text, Some("Markdown"))
                    .await
                {
                    Ok(_) => return Ok(()),
                    Err(md_err) => {
                        return send_telegram_text_request(&client, &url, chat_id, text, None)
                            .await
                            .map_err(|plain_err| {
                                format!(
                                    "{} (markdown fallback failed: {}, plain fallback failed: {})",
                                    v2_err, md_err, plain_err
                                )
                            });
                    }
                }
            }
        }
    }

    // Normal path: keep backward-compatible markdown behavior, then fallback to plain text.
    match send_telegram_text_request(&client, &url, chat_id, text, Some("Markdown")).await {
        Ok(_) => Ok(()),
        Err(markdown_err) => {
            tracing::debug!(
                "[telegram] Markdown send failed, retrying as plain text: {}",
                markdown_err
            );
            send_telegram_text_request(&client, &url, chat_id, text, None)
                .await
                .map_err(|plain_err| format!("{} (fallback failed: {})", markdown_err, plain_err))
        }
    }
}

async fn send_telegram_text_request(
    client: &reqwest::Client,
    url: &str,
    chat_id: i64,
    text: &str,
    parse_mode: Option<&str>,
) -> Result<(), String> {
    let mut body = serde_json::json!({
        "chat_id": chat_id,
        "text": text,
        "disable_web_page_preview": true,
    });
    if let Some(mode) = parse_mode {
        body["parse_mode"] = serde_json::Value::String(mode.to_string());
    }

    let response = client
        .post(url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("sendMessage request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("sendMessage HTTP {}: {}", status, body));
    }

    let payload = response
        .json::<TelegramApiResponse<serde_json::Value>>()
        .await
        .map_err(|e| format!("invalid sendMessage response: {}", e))?;

    if !payload.ok {
        return Err(payload
            .description
            .unwrap_or_else(|| "sendMessage ok=false".to_string()));
    }

    Ok(())
}

pub async fn send_telegram_typing(bot_token: &str, chat_id: i64) -> Result<(), String> {
    let client = reqwest::Client::new();
    let url = format!("{}/bot{}/sendChatAction", TELEGRAM_API_BASE, bot_token);
    let response = client
        .post(url)
        .json(&serde_json::json!({
            "chat_id": chat_id,
            "action": "typing",
        }))
        .send()
        .await
        .map_err(|e| format!("sendChatAction request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("sendChatAction HTTP {}", response.status()));
    }
    Ok(())
}

#[derive(Debug, Clone)]
struct MediaRef {
    file_id: String,
    file_size: i64,
    kind: String,
    file_name: Option<String>,
    mime_type: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TelegramApiResponse<T> {
    ok: bool,
    result: Option<T>,
    description: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TelegramUpdate {
    update_id: i64,
    message: Option<TelegramMessage>,
}

#[derive(Debug, Deserialize)]
struct TelegramMessage {
    chat: TelegramChat,
    from: Option<TelegramUser>,
    text: Option<String>,
    caption: Option<String>,
    photo: Option<Vec<TelegramPhotoSize>>,
    document: Option<TelegramDocument>,
    video: Option<TelegramVideo>,
    audio: Option<TelegramAudio>,
    voice: Option<TelegramVoice>,
}

#[derive(Debug, Deserialize)]
struct TelegramChat {
    id: i64,
}

#[derive(Debug, Deserialize)]
struct TelegramUser {
    username: Option<String>,
    is_bot: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct TelegramPhotoSize {
    file_id: String,
    file_size: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct TelegramDocument {
    file_id: String,
    file_name: Option<String>,
    mime_type: Option<String>,
    file_size: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct TelegramVideo {
    file_id: String,
    file_name: Option<String>,
    mime_type: Option<String>,
    file_size: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct TelegramAudio {
    file_id: String,
    file_name: Option<String>,
    mime_type: Option<String>,
    file_size: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct TelegramVoice {
    file_id: String,
    mime_type: Option<String>,
    file_size: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct TelegramFile {
    file_path: Option<String>,
}
