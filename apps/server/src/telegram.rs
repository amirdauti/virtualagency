use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
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
    SendMessage { bot_token: String, chat_id: i64, text: String },
    SendTyping { bot_token: String, chat_id: i64 },
}

#[derive(Debug, Clone)]
struct TelegramBindingConfig {
    enabled: bool,
    bot_token: String,
    allowed_handle: String,
    send_typing: bool,
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
    pub fn new(inbound_tx: mpsc::UnboundedSender<TelegramInboundMessage>, persistence_path: PathBuf) -> Self {
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
            let state = self
                .agents
                .entry(agent_id.to_string())
                .or_insert_with(|| TelegramAgentState {
                    config: TelegramBindingConfig {
                        enabled: false,
                        bot_token: String::new(),
                        allowed_handle: String::new(),
                        send_typing: true,
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
            tracing::warn!("[telegram] Failed to persist bindings after removal: {}", err);
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

    pub fn notify_dispatch_failure(
        &mut self,
        agent_id: &str,
        error: &str,
    ) -> Vec<TelegramAction> {
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
                let Some(active) = state.active_turn.as_mut() else {
                    return actions;
                };
                apply_agent_output_to_turn(&output.data, active);
            }
            crate::BroadcastMessage::AgentStatus(status) => {
                let Some(state) = self.agents.get_mut(&status.agent_id) else {
                    return actions;
                };
                if !state.config.enabled {
                    return actions;
                }

                if let Some(active) = state.active_turn.as_mut() {
                    if state.config.send_typing
                        && matches!(
                            status.status,
                            crate::agents::AgentStatus::Thinking | crate::agents::AgentStatus::Working
                        )
                    {
                        let should_send = active
                            .last_typing_at
                            .map(|last| {
                                last.elapsed() >= Duration::from_secs(TELEGRAM_TYPING_THROTTLE_SECS)
                            })
                            .unwrap_or(true);
                        if should_send {
                            active.last_typing_at = Some(Instant::now());
                            actions.push(TelegramAction::SendTyping {
                                bot_token: state.config.bot_token.clone(),
                                chat_id: active.chat_id,
                            });
                        }
                    }
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
    });

    actions.push(TelegramAction::DispatchToAgent(TelegramDispatch {
        agent_id: agent_id.to_string(),
        text: next.text,
        media: next.media,
    }));
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
    raw.trim()
        .trim_start_matches('@')
        .to_ascii_lowercase()
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

pub async fn send_telegram_text(
    bot_token: &str,
    chat_id: i64,
    text: &str,
) -> Result<(), String> {
    let client = reqwest::Client::new();
    let url = format!("{}/bot{}/sendMessage", TELEGRAM_API_BASE, bot_token);
    let response = client
        .post(url)
        .json(&serde_json::json!({
            "chat_id": chat_id,
            "text": text,
            "disable_web_page_preview": true,
        }))
        .send()
        .await
        .map_err(|e| format!("sendMessage request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("sendMessage HTTP {}", response.status()));
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
