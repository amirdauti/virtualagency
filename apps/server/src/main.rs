mod agents;
mod files;
mod pty;
mod telegram;

use axum::{
    body::Bytes,
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        DefaultBodyLimit, OriginalUri, Path, Query, State,
    },
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    response::IntoResponse,
    routing::{any, delete, get, post},
    Json, Router,
};
use futures::{future::join_all, SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, VecDeque},
    net::{IpAddr, Ipv4Addr, SocketAddr},
    path::{Path as FsPath, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::sync::{broadcast, mpsc, RwLock};
use tokio::time::{Duration as TokioDuration, Instant as TokioInstant};
use tower_http::cors::CorsLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use agents::{AgentManager, AgentOutput, AgentSpecialty, AgentStatus, AgentStatusChange, CliType};
use pty::{TerminalManager, TerminalOutput};
use telegram::{
    TelegramAction, TelegramBindingConfigInput, TelegramBindingStatus, TelegramDispatch,
    TelegramInboundMedia, TelegramInboundMessage, TelegramManager,
};

type SharedState = Arc<AppState>;
static WHISPER_INSTALL_ATTEMPTED: AtomicBool = AtomicBool::new(false);

// Middleware to add Private Network Access headers for browser security
async fn private_network_access_middleware(
    request: axum::http::Request<axum::body::Body>,
    next: axum::middleware::Next,
) -> impl IntoResponse {
    let mut response = next.run(request).await;

    // Add the Private Network Access header to all responses
    response.headers_mut().insert(
        "Access-Control-Allow-Private-Network",
        HeaderValue::from_static("true"),
    );

    // Ensure PATCH is included in allowed methods for preflight
    response.headers_mut().insert(
        "Access-Control-Allow-Methods",
        HeaderValue::from_static("GET, POST, PUT, DELETE, PATCH, OPTIONS"),
    );

    response
}

async fn hosted_proxy_auth_middleware(
    State(state): State<SharedState>,
    request: axum::http::Request<axum::body::Body>,
    next: axum::middleware::Next,
) -> axum::response::Response {
    let Some(expected_token) = state.hosted_proxy_token.as_deref() else {
        return next.run(request).await;
    };

    let path = request.uri().path();
    let is_exempt_path = path == "/api/health"
        || path.starts_with("/api/public/")
        || path.starts_with("/api/agent-tools/");
    if is_exempt_path {
        return next.run(request).await;
    }

    let provided = request
        .headers()
        .get("x-va-hosted-token")
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .unwrap_or("");

    if provided.is_empty() {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": "missing_hosted_proxy_token" })),
        )
            .into_response();
    }

    if provided != expected_token {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": "invalid_hosted_proxy_token" })),
        )
            .into_response();
    }

    next.run(request).await
}

struct AppState {
    agent_manager: RwLock<AgentManager>,
    terminal_manager: RwLock<TerminalManager>,
    telegram_manager: RwLock<TelegramManager>,
    broadcast_tx: broadcast::Sender<BroadcastEnvelope>,
    events: RwLock<EventStore>,
    published_apps: RwLock<HashMap<String, PublishedApp>>,
    workspace_dir: PathBuf,
    agent_tools_token: String,
    hosted_proxy_token: Option<String>,
    public_base_url: Option<String>,
}

#[derive(Debug, Clone)]
struct PublishedApp {
    slug: String,
    source_agent_id: String,
    target_agent_id: String,
    local_host: String,
    local_port: u16,
    path_prefix: String,
    created_at: u64,
}

#[derive(Clone, Serialize)]
#[serde(tag = "type")]
enum BroadcastMessage {
    #[serde(rename = "agent-output")]
    AgentOutput(AgentOutput),
    #[serde(rename = "agent-status")]
    AgentStatus(AgentStatusChange),
    #[serde(rename = "terminal-output")]
    TerminalOutput(TerminalOutput),
}

#[derive(Clone, Serialize)]
struct BroadcastEnvelope {
    seq: u64,
    ts_ms: u64,
    #[serde(flatten)]
    message: BroadcastMessage,
}

struct EventStore {
    next_seq: u64,
    capacity: usize,
    events: VecDeque<BroadcastEnvelope>,
}

impl EventStore {
    fn new(capacity: usize) -> Self {
        Self {
            next_seq: 1,
            capacity,
            events: VecDeque::with_capacity(capacity),
        }
    }

    fn latest_seq(&self) -> u64 {
        self.next_seq.saturating_sub(1)
    }

    fn push(&mut self, message: BroadcastMessage) -> BroadcastEnvelope {
        let seq = self.next_seq;
        self.next_seq = self.next_seq.saturating_add(1);

        let ts_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        let envelope = BroadcastEnvelope {
            seq,
            ts_ms,
            message,
        };

        if self.events.len() >= self.capacity {
            self.events.pop_front();
        }
        self.events.push_back(envelope.clone());
        envelope
    }

    fn get_since(&self, since: Option<u64>) -> Vec<BroadcastEnvelope> {
        match since {
            Some(since_seq) => self
                .events
                .iter()
                .filter(|e| e.seq > since_seq)
                .cloned()
                .collect(),
            None => self.events.iter().cloned().collect(),
        }
    }
}

/// Incoming WebSocket messages from clients
#[derive(Deserialize, Debug)]
#[serde(tag = "type")]
enum WsClientMessage {
    #[serde(rename = "terminal-input")]
    TerminalInput { terminal_id: String, data: String },
    #[serde(rename = "terminal-resize")]
    TerminalResize {
        terminal_id: String,
        cols: u16,
        rows: u16,
    },
}

#[tokio::main]
async fn main() {
    // Initialize tracing
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "virtual_agency_server=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    // Create channel for server events.
    // - mpsc collects events even when no WS clients are connected
    // - broadcast streams events to active WS clients
    let (event_tx, mut event_rx) = mpsc::unbounded_channel::<BroadcastMessage>();
    let (telegram_inbound_tx, mut telegram_inbound_rx) =
        mpsc::unbounded_channel::<TelegramInboundMessage>();
    let (broadcast_tx, _) = broadcast::channel::<BroadcastEnvelope>(1000);

    // Get workspace directory from environment or use current directory
    let workspace_dir = std::env::var("WORKSPACE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    let agent_tools_token = std::env::var("VA_AGENT_CONTROL_TOKEN")
        .unwrap_or_else(|_| uuid::Uuid::new_v4().to_string());
    let hosted_proxy_token = std::env::var("VA_HOSTED_PROXY_TOKEN")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let public_base_url = std::env::var("VA_PUBLIC_BASE_URL")
        .ok()
        .map(|s| s.trim().trim_end_matches('/').to_string())
        .filter(|s| !s.is_empty());
    let telegram_bindings_path = workspace_dir
        .join(".virtual-agency")
        .join("telegram-bindings.json");

    let state = Arc::new(AppState {
        agent_manager: RwLock::new(AgentManager::new(event_tx.clone())),
        terminal_manager: RwLock::new(TerminalManager::new(event_tx.clone())),
        telegram_manager: RwLock::new(TelegramManager::new(
            telegram_inbound_tx,
            telegram_bindings_path,
        )),
        broadcast_tx,
        events: RwLock::new(EventStore::new(5000)),
        published_apps: RwLock::new(HashMap::new()),
        workspace_dir,
        agent_tools_token,
        hosted_proxy_token,
        public_base_url,
    });

    // Distributor: persists events to ring buffer and broadcasts to WS clients.
    let distributor_state = state.clone();
    tokio::spawn(async move {
        while let Some(msg) = event_rx.recv().await {
            let envelope = {
                let mut store = distributor_state.events.write().await;
                store.push(msg.clone())
            };
            let _ = distributor_state.broadcast_tx.send(envelope);

            let telegram_actions = {
                let mut telegram = distributor_state.telegram_manager.write().await;
                telegram.handle_broadcast(&msg)
            };
            execute_telegram_actions(distributor_state.clone(), telegram_actions).await;
        }
    });

    let telegram_dispatch_state = state.clone();
    tokio::spawn(async move {
        while let Some(msg) = telegram_inbound_rx.recv().await {
            let actions = {
                let mut telegram = telegram_dispatch_state.telegram_manager.write().await;
                telegram.handle_inbound(msg)
            };
            execute_telegram_actions(telegram_dispatch_state.clone(), actions).await;
        }
    });

    let telegram_typing_state = state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(TokioDuration::from_secs(1));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

        loop {
            interval.tick().await;
            let actions = {
                let mut telegram = telegram_typing_state.telegram_manager.write().await;
                telegram.collect_typing_heartbeats()
            };
            if !actions.is_empty() {
                execute_telegram_actions(telegram_typing_state.clone(), actions).await;
            }
        }
    });

    // Build router with CORS and Private Network Access support
    let cors = CorsLayer::new()
        .allow_origin(tower_http::cors::Any)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::PATCH,
            Method::OPTIONS,
        ])
        .allow_headers([
            header::CONTENT_TYPE,
            header::ACCEPT,
            header::AUTHORIZATION,
            header::HeaderName::from_static("x-va-agent-token"),
            header::HeaderName::from_static("x-va-hosted-token"),
        ])
        .expose_headers([header::CONTENT_TYPE]);

    let app = Router::new()
        .route("/api/agents", get(list_agents).post(create_agent))
        .route(
            "/api/agents/:id",
            delete(kill_agent).patch(update_agent_settings),
        )
        .route(
            "/api/agents/:id/telegram",
            get(get_agent_telegram)
                .put(set_agent_telegram)
                .delete(delete_agent_telegram),
        )
        .route("/api/agents/:id/messages", post(send_message))
        .route("/api/agents/:id/stop", post(stop_agent))
        .route(
            "/api/agent-tools/:source_agent_id/agents",
            get(agent_tools_list_agents),
        )
        .route(
            "/api/agent-tools/:source_agent_id/create-agent",
            post(agent_tools_create_agent),
        )
        .route(
            "/api/agent-tools/:source_agent_id/message-agent",
            post(agent_tools_message_agent),
        )
        .route(
            "/api/agent-tools/:source_agent_id/delegate-many",
            post(agent_tools_delegate_many),
        )
        .route(
            "/api/agent-tools/:source_agent_id/set-telegram",
            post(agent_tools_set_telegram),
        )
        .route(
            "/api/agent-tools/:source_agent_id/publish-app",
            post(agent_tools_publish_app),
        )
        .route("/api/events", get(get_events))
        .route("/api/terminals", get(list_terminals).post(create_terminal))
        .route("/api/terminals/:id", delete(kill_terminal))
        .route("/api/terminals/:id/input", post(write_terminal_input))
        .route("/api/terminals/:id/resize", post(resize_terminal))
        .route("/api/files/tree/:agent_id", get(get_file_tree))
        .route("/api/files/read/:agent_id", post(read_file))
        .route("/api/files/read_git/:agent_id", post(read_file_git))
        .route("/api/files/write/:agent_id", post(write_file))
        .route("/api/ports/find", get(find_available_port))
        .route("/api/public/:slug", any(proxy_public_app_root))
        .route("/api/public/:slug/*rest", any(proxy_public_app))
        .route("/api/health", get(health_check))
        .route("/api/browse", get(browse_directory))
        .route("/ws", get(ws_handler))
        .layer(DefaultBodyLimit::max(50 * 1024 * 1024)) // 50MB limit for large images
        .layer(cors)
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            hosted_proxy_auth_middleware,
        ))
        .layer(axum::middleware::from_fn(private_network_access_middleware))
        .with_state(state.clone());

    let bind_host = std::env::var("VIRTUAL_AGENCY_BIND_HOST")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "127.0.0.1".to_string());
    let bind_ip: IpAddr = bind_host.parse().unwrap_or_else(|_| {
        tracing::warn!(
            "Invalid VIRTUAL_AGENCY_BIND_HOST='{}'; falling back to 127.0.0.1",
            bind_host
        );
        IpAddr::V4(Ipv4Addr::LOCALHOST)
    });

    let preferred_port_raw = std::env::var("VIRTUAL_AGENCY_PORT").ok();
    let preferred_port = preferred_port_raw
        .as_deref()
        .and_then(|v| v.trim().parse::<u16>().ok())
        .filter(|p| *p > 0 && *p != 3001);

    if preferred_port_raw
        .as_deref()
        .and_then(|v| v.trim().parse::<u16>().ok())
        == Some(3001)
    {
        tracing::warn!(
            "Ignoring VIRTUAL_AGENCY_PORT=3001 (reserved). Use 1337 or another free port."
        );
    }

    // Prefer 1337, but fall back if in use. This avoids a "double click and nothing happens"
    // experience on Windows when the fixed port is already occupied.
    let mut candidates: Vec<u16> = Vec::new();
    if let Some(p) = preferred_port {
        candidates.push(p);
    }
    candidates.push(1337);
    for p in 1338..=1350 {
        candidates.push(p);
    }
    candidates.dedup();

    let mut bound_port: Option<u16> = None;
    let mut last_err: Option<std::io::Error> = None;
    let mut listener_opt: Option<tokio::net::TcpListener> = None;

    for port in candidates {
        match tokio::net::TcpListener::bind((bind_ip, port)).await {
            Ok(listener) => {
                bound_port = Some(port);
                listener_opt = Some(listener);
                break;
            }
            Err(e) => {
                last_err = Some(e);
            }
        }
    }

    let Some(listener) = listener_opt else {
        let err = last_err
            .map(|e| e.to_string())
            .unwrap_or_else(|| "unknown error".to_string());
        eprintln!("Failed to bind Virtual Agency server to any port: {}", err);
        return;
    };

    let port = bound_port.unwrap_or(1337);
    tracing::info!(
        "Virtual Agency server listening on http://{}:{}",
        bind_ip,
        port
    );

    {
        let mut manager = state.agent_manager.write().await;
        manager.configure_control_plane(
            format!("http://127.0.0.1:{}", port),
            state.agent_tools_token.clone(),
        );
    }

    axum::serve(listener, app).await.unwrap();
}

async fn health_check() -> Json<serde_json::Value> {
    Json(serde_json::json!({"status": "ok"}))
}

#[derive(Deserialize)]
struct EventsQuery {
    since: Option<u64>,
}

#[derive(Serialize)]
struct EventsResponse {
    latest_seq: u64,
    events: Vec<BroadcastEnvelope>,
}

async fn get_events(
    State(state): State<SharedState>,
    Query(query): Query<EventsQuery>,
) -> Json<EventsResponse> {
    let store = state.events.read().await;
    Json(EventsResponse {
        latest_seq: store.latest_seq(),
        events: store.get_since(query.since),
    })
}

#[derive(Deserialize)]
struct BrowseQuery {
    path: Option<String>,
}

#[derive(Serialize)]
struct DirEntry {
    name: String,
    path: String,
    is_dir: bool,
}

#[derive(Serialize)]
struct BrowseResponse {
    current_path: String,
    parent_path: Option<String>,
    entries: Vec<DirEntry>,
}

async fn browse_directory(
    Query(query): Query<BrowseQuery>,
) -> Result<Json<BrowseResponse>, (StatusCode, String)> {
    let path = query
        .path
        .map(PathBuf::from)
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_else(|| PathBuf::from("/")));

    if !path.exists() {
        return Err((StatusCode::NOT_FOUND, "Path does not exist".to_string()));
    }

    if !path.is_dir() {
        return Err((
            StatusCode::BAD_REQUEST,
            "Path is not a directory".to_string(),
        ));
    }

    let mut entries = Vec::new();

    match std::fs::read_dir(&path) {
        Ok(read_dir) => {
            for entry in read_dir.flatten() {
                let file_name = entry.file_name().to_string_lossy().to_string();
                // Skip hidden files
                if file_name.starts_with('.') {
                    continue;
                }
                let file_path = entry.path();
                let is_dir = file_path.is_dir();
                // Only show directories
                if is_dir {
                    entries.push(DirEntry {
                        name: file_name,
                        path: file_path.to_string_lossy().to_string(),
                        is_dir,
                    });
                }
            }
        }
        Err(e) => {
            return Err((
                StatusCode::FORBIDDEN,
                format!("Cannot read directory: {}", e),
            ));
        }
    }

    // Sort directories alphabetically
    entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    let parent_path = path.parent().map(|p| p.to_string_lossy().to_string());

    Ok(Json(BrowseResponse {
        current_path: path.to_string_lossy().to_string(),
        parent_path,
        entries,
    }))
}

// File system endpoints
async fn get_file_tree(
    State(state): State<SharedState>,
    Path(agent_id): Path<String>,
) -> Result<Json<files::FileNode>, (StatusCode, String)> {
    // Get agent's working directory
    let manager = state.agent_manager.read().await;
    let agents = manager.list_agents();

    let working_dir = agents
        .iter()
        .find(|(id, _, _, _, _, _, _, _)| id == &agent_id)
        .map(|(_, _, working_dir, _, _, _, _, _)| PathBuf::from(working_dir))
        .ok_or_else(|| (StatusCode::NOT_FOUND, "Agent not found".to_string()))?;

    drop(manager);

    files::get_file_tree(&working_dir)
        .await
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

async fn read_file(
    State(state): State<SharedState>,
    Path(agent_id): Path<String>,
    Json(req): Json<files::ReadFileRequest>,
) -> Result<Json<files::FileContent>, (StatusCode, String)> {
    // Get agent's working directory
    let manager = state.agent_manager.read().await;
    let agents = manager.list_agents();

    let working_dir = agents
        .iter()
        .find(|(id, _, _, _, _, _, _, _)| id == &agent_id)
        .map(|(_, _, working_dir, _, _, _, _, _)| PathBuf::from(working_dir))
        .ok_or_else(|| (StatusCode::NOT_FOUND, "Agent not found".to_string()))?;

    drop(manager);

    files::read_file(&working_dir, req)
        .await
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

async fn read_file_git(
    State(state): State<SharedState>,
    Path(agent_id): Path<String>,
    Json(req): Json<files::ReadFileRequest>,
) -> Result<Json<files::FileContent>, (StatusCode, String)> {
    // Get agent's working directory
    let manager = state.agent_manager.read().await;
    let agents = manager.list_agents();

    let working_dir = agents
        .iter()
        .find(|(id, _, _, _, _, _, _, _)| id == &agent_id)
        .map(|(_, _, working_dir, _, _, _, _, _)| PathBuf::from(working_dir))
        .ok_or_else(|| (StatusCode::NOT_FOUND, "Agent not found".to_string()))?;

    drop(manager);

    files::read_file_git(&working_dir, req)
        .await
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

async fn write_file(
    State(state): State<SharedState>,
    Path(agent_id): Path<String>,
    Json(req): Json<files::WriteFileRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    // Get agent's working directory
    let manager = state.agent_manager.read().await;
    let agents = manager.list_agents();

    let working_dir = agents
        .iter()
        .find(|(id, _, _, _, _, _, _, _)| id == &agent_id)
        .map(|(_, _, working_dir, _, _, _, _, _)| PathBuf::from(working_dir))
        .ok_or_else(|| (StatusCode::NOT_FOUND, "Agent not found".to_string()))?;

    drop(manager);

    files::write_file(&working_dir, req)
        .await
        .map(Json)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

#[derive(Deserialize)]
struct CreateAgentRequest {
    #[serde(default)]
    id: Option<String>,
    name: String,
    working_dir: String,
    #[serde(default = "default_model")]
    model: String,
    #[serde(default)]
    thinking_enabled: bool,
    #[serde(default = "default_reasoning_effort")]
    reasoning_effort: String, // For Codex: "low", "medium", "high"
    #[serde(default)]
    specialty: Option<String>,
    #[serde(default)]
    mcp_servers: Vec<String>,
    #[serde(default)]
    cli_type: Option<String>, // "claude" or "codex"
    #[serde(default)]
    session_id: Option<String>, // Session ID to resume conversation
}

fn default_model() -> String {
    "sonnet".to_string()
}

fn default_reasoning_effort() -> String {
    "medium".to_string()
}

#[derive(Serialize)]
struct AgentInfo {
    id: String,
    name: String,
    working_dir: String,
    model: String,
    thinking_enabled: bool,
    mcp_servers: Vec<String>,
    cli_type: String,
    specialty: String,
    status: AgentStatus,
    session_id: Option<String>,
}

async fn create_agent(
    State(state): State<SharedState>,
    Json(req): Json<CreateAgentRequest>,
) -> Result<Json<AgentInfo>, (StatusCode, String)> {
    let cli_type = req
        .cli_type
        .as_ref()
        .map(|s| CliType::from_str(s))
        .unwrap_or_default();
    let cli_type_str = match cli_type {
        CliType::Claude => "claude".to_string(),
        CliType::Codex => "codex".to_string(),
    };

    let specialty = req
        .specialty
        .as_deref()
        .map(AgentSpecialty::from_str)
        .unwrap_or_default();
    let specialty_str = match specialty {
        AgentSpecialty::Normal => "normal",
        AgentSpecialty::RobloxBuilder => "roblox_builder",
    };

    tracing::info!(
        "[create_agent] Received request - id: {:?}, name: {}, working_dir: {}, model: {}, thinking: {}, reasoning_effort: {}, specialty: {}, mcp_servers: {:?}, cli_type: {}, session_id: {:?}",
        req.id, req.name, req.working_dir, req.model, req.thinking_enabled, req.reasoning_effort, specialty_str, req.mcp_servers, cli_type_str, req.session_id
    );

    let mut manager = state.agent_manager.write().await;

    match manager.create_agent(
        req.id.as_deref(),
        &req.name,
        &req.working_dir,
        &req.model,
        req.thinking_enabled,
        &req.reasoning_effort,
        specialty,
        req.mcp_servers.clone(),
        cli_type,
        req.session_id.clone(),
    ) {
        Ok(id) => {
            tracing::info!("[create_agent] Successfully created agent with id: {}", id);
            let (status, session_id) = manager
                .get_agent_runtime(&id)
                .unwrap_or((AgentStatus::Idle, req.session_id.clone()));
            drop(manager);

            {
                let mut telegram = state.telegram_manager.write().await;
                telegram.ensure_binding_running(&id);
            }

            Ok(Json(AgentInfo {
                id,
                name: req.name,
                working_dir: req.working_dir,
                model: req.model,
                thinking_enabled: req.thinking_enabled,
                mcp_servers: req.mcp_servers,
                cli_type: cli_type_str,
                specialty: specialty_str.to_string(),
                status,
                session_id,
            }))
        }
        Err(e) => {
            tracing::error!("[create_agent] Failed to create agent: {}", e);
            Err((StatusCode::INTERNAL_SERVER_ERROR, e))
        }
    }
}

async fn list_agents(State(state): State<SharedState>) -> Json<Vec<AgentInfo>> {
    let manager = state.agent_manager.read().await;
    let agents = manager.list_agents_snapshot();
    Json(
        agents
            .into_iter()
            .map(
                |(
                    id,
                    name,
                    working_dir,
                    model,
                    thinking_enabled,
                    mcp_servers,
                    cli_type,
                    specialty,
                    status,
                    session_id,
                )| {
                    let cli_type_str = match cli_type {
                        CliType::Claude => "claude".to_string(),
                        CliType::Codex => "codex".to_string(),
                    };
                    let specialty_str = match specialty {
                        AgentSpecialty::Normal => "normal".to_string(),
                        AgentSpecialty::RobloxBuilder => "roblox_builder".to_string(),
                    };
                    AgentInfo {
                        id,
                        name,
                        working_dir,
                        model,
                        thinking_enabled,
                        mcp_servers,
                        cli_type: cli_type_str,
                        specialty: specialty_str,
                        status,
                        session_id,
                    }
                },
            )
            .collect(),
    )
}

async fn kill_agent(
    State(state): State<SharedState>,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    let mut manager = state.agent_manager.write().await;

    match manager.kill_agent(&id) {
        Ok(_) => {
            drop(manager);
            let mut telegram = state.telegram_manager.write().await;
            telegram.clear_for_agent(&id);
            Ok(StatusCode::NO_CONTENT)
        }
        Err(e) => Err((StatusCode::NOT_FOUND, e)),
    }
}

#[derive(Deserialize)]
struct UpdateAgentRequest {
    model: Option<String>,
    thinking_enabled: Option<bool>,
    reasoning_effort: Option<String>,
    mcp_servers: Option<Vec<String>>,
}

async fn update_agent_settings(
    State(state): State<SharedState>,
    Path(id): Path<String>,
    Json(req): Json<UpdateAgentRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    tracing::info!(
        "[update_agent_settings] Updating agent {} - model: {:?}, thinking: {:?}, reasoning_effort: {:?}, mcp_servers: {:?}",
        id, req.model, req.thinking_enabled, req.reasoning_effort, req.mcp_servers
    );

    let mut manager = state.agent_manager.write().await;

    match manager.update_agent_settings(
        &id,
        req.model,
        req.thinking_enabled,
        req.reasoning_effort,
        req.mcp_servers,
    ) {
        Ok(_) => {
            tracing::info!("[update_agent_settings] Successfully updated agent: {}", id);
            Ok(StatusCode::OK)
        }
        Err(e) => {
            tracing::error!("[update_agent_settings] Failed: {}", e);
            Err((StatusCode::NOT_FOUND, e))
        }
    }
}

#[derive(Deserialize)]
struct SetAgentTelegramRequest {
    enabled: bool,
    #[serde(default)]
    bot_token: Option<String>,
    allowed_handle: String,
    #[serde(default = "default_send_typing")]
    send_typing: bool,
    #[serde(default = "default_send_updates")]
    send_updates: bool,
}

fn default_send_typing() -> bool {
    true
}

fn default_send_updates() -> bool {
    false
}

#[derive(Serialize)]
struct AgentTelegramResponse {
    enabled: bool,
    polling: bool,
    connected: bool,
    has_token: bool,
    allowed_handle: String,
    allowed_chat_ids: Vec<i64>,
    send_typing: bool,
    send_updates: bool,
    queue_depth: usize,
    has_active_turn: bool,
    last_error: Option<String>,
    last_update_id: Option<i64>,
}

impl From<TelegramBindingStatus> for AgentTelegramResponse {
    fn from(value: TelegramBindingStatus) -> Self {
        Self {
            enabled: value.enabled,
            polling: value.polling,
            connected: value.connected,
            has_token: value.has_token,
            allowed_handle: value.allowed_handle,
            allowed_chat_ids: value.allowed_chat_ids,
            send_typing: value.send_typing,
            send_updates: value.send_updates,
            queue_depth: value.queue_depth,
            has_active_turn: value.has_active_turn,
            last_error: value.last_error,
            last_update_id: value.last_update_id,
        }
    }
}

async fn get_agent_telegram(
    State(state): State<SharedState>,
    Path(id): Path<String>,
) -> Result<Json<AgentTelegramResponse>, (StatusCode, String)> {
    let manager = state.agent_manager.read().await;
    if !manager.has_agent(&id) {
        return Err((StatusCode::NOT_FOUND, "Agent not found".to_string()));
    }
    drop(manager);

    let telegram = state.telegram_manager.read().await;
    Ok(Json(telegram.get_status(&id).into()))
}

async fn set_agent_telegram(
    State(state): State<SharedState>,
    Path(id): Path<String>,
    Json(req): Json<SetAgentTelegramRequest>,
) -> Result<Json<AgentTelegramResponse>, (StatusCode, String)> {
    let manager = state.agent_manager.read().await;
    if !manager.has_agent(&id) {
        return Err((StatusCode::NOT_FOUND, "Agent not found".to_string()));
    }
    drop(manager);

    let mut telegram = state.telegram_manager.write().await;
    let status = telegram
        .upsert_binding(
            &id,
            TelegramBindingConfigInput {
                enabled: req.enabled,
                bot_token: req.bot_token,
                allowed_handle: req.allowed_handle,
                send_typing: req.send_typing,
                send_updates: req.send_updates,
            },
        )
        .map_err(|e| (StatusCode::BAD_REQUEST, e))?;
    Ok(Json(status.into()))
}

async fn delete_agent_telegram(
    State(state): State<SharedState>,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    let manager = state.agent_manager.read().await;
    if !manager.has_agent(&id) {
        return Err((StatusCode::NOT_FOUND, "Agent not found".to_string()));
    }
    drop(manager);

    let mut telegram = state.telegram_manager.write().await;
    telegram.remove_binding(&id);
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct ImageData {
    data: String,      // base64 encoded
    mime_type: String, // e.g., "image/png"
}

#[derive(Deserialize)]
struct SendMessageRequest {
    message: String,
    #[serde(default)]
    images: Vec<ImageData>,
}

async fn send_message(
    State(state): State<SharedState>,
    Path(id): Path<String>,
    Json(req): Json<SendMessageRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    tracing::info!("[send_message] Attempting to send message to agent: {}", id);

    let manager = state.agent_manager.read().await;
    let existing_agents = manager.list_agents();
    tracing::info!(
        "[send_message] Existing agents: {:?}",
        existing_agents
            .iter()
            .map(|(id, _, _, _, _, _, _, _)| id)
            .collect::<Vec<_>>()
    );

    // Convert base64 images to temp files
    let mut image_paths: Vec<String> = Vec::new();
    for (i, img) in req.images.iter().enumerate() {
        match save_base64_image(&img.data, &img.mime_type, i) {
            Ok(path) => {
                tracing::info!("[send_message] Saved image {} to: {}", i, path);
                image_paths.push(path);
            }
            Err(e) => {
                tracing::error!("[send_message] Failed to save image {}: {}", i, e);
            }
        }
    }

    match manager.send_message(&id, &req.message, &image_paths) {
        Ok(_) => {
            tracing::info!("[send_message] Successfully sent message to agent: {}", id);
            Ok(StatusCode::ACCEPTED)
        }
        Err(e) => {
            tracing::error!("[send_message] Failed: {}", e);
            Err((StatusCode::NOT_FOUND, e))
        }
    }
}

fn require_agent_tools_auth(
    headers: &HeaderMap,
    expected_token: &str,
) -> Result<(), (StatusCode, String)> {
    let token = headers
        .get("x-va-agent-token")
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .unwrap_or("");
    if token.is_empty() {
        return Err((
            StatusCode::UNAUTHORIZED,
            "missing x-va-agent-token".to_string(),
        ));
    }
    if token != expected_token {
        return Err((
            StatusCode::FORBIDDEN,
            "invalid agent tools token".to_string(),
        ));
    }
    Ok(())
}

#[derive(Serialize)]
struct AgentToolsListResponse {
    agents: Vec<AgentInfo>,
}

async fn agent_tools_list_agents(
    State(state): State<SharedState>,
    Path(source_agent_id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<AgentToolsListResponse>, (StatusCode, String)> {
    require_agent_tools_auth(&headers, &state.agent_tools_token)?;

    let manager = state.agent_manager.read().await;
    if !manager.has_agent(&source_agent_id) {
        return Err((StatusCode::NOT_FOUND, "source agent not found".to_string()));
    }

    let agents = manager
        .list_agents_snapshot()
        .into_iter()
        .map(
            |(
                id,
                name,
                working_dir,
                model,
                thinking_enabled,
                mcp_servers,
                cli_type,
                specialty,
                status,
                session_id,
            )| AgentInfo {
                id,
                name,
                working_dir,
                model,
                thinking_enabled,
                mcp_servers,
                cli_type: match cli_type {
                    CliType::Claude => "claude".to_string(),
                    CliType::Codex => "codex".to_string(),
                },
                specialty: match specialty {
                    AgentSpecialty::Normal => "normal".to_string(),
                    AgentSpecialty::RobloxBuilder => "roblox_builder".to_string(),
                },
                status,
                session_id,
            },
        )
        .collect();

    Ok(Json(AgentToolsListResponse { agents }))
}

#[derive(Deserialize)]
struct AgentToolsCreateAgentRequest {
    #[serde(default)]
    id: Option<String>,
    name: String,
    working_dir: String,
    cli_type: String, // "claude" or "codex"
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    thinking_enabled: Option<bool>,
    #[serde(default)]
    reasoning_effort: Option<String>,
    #[serde(default)]
    specialty: Option<String>,
    #[serde(default)]
    mcp_servers: Option<Vec<String>>,
    #[serde(default)]
    session_id: Option<String>,
}

fn default_model_for_cli(cli_type: &CliType) -> String {
    match cli_type {
        CliType::Claude => "sonnet".to_string(),
        CliType::Codex => "gpt-5".to_string(),
    }
}

async fn agent_tools_create_agent(
    State(state): State<SharedState>,
    Path(source_agent_id): Path<String>,
    headers: HeaderMap,
    Json(req): Json<AgentToolsCreateAgentRequest>,
) -> Result<Json<AgentInfo>, (StatusCode, String)> {
    require_agent_tools_auth(&headers, &state.agent_tools_token)?;

    let cli_type = CliType::from_str(&req.cli_type);
    let cli_type_label = match cli_type {
        CliType::Claude => "claude".to_string(),
        CliType::Codex => "codex".to_string(),
    };
    let specialty = req
        .specialty
        .as_deref()
        .map(AgentSpecialty::from_str)
        .unwrap_or_default();
    let specialty_label = match specialty {
        AgentSpecialty::Normal => "normal".to_string(),
        AgentSpecialty::RobloxBuilder => "roblox_builder".to_string(),
    };

    let requested_dir = PathBuf::from(&req.working_dir);
    if !requested_dir.exists() || !requested_dir.is_dir() {
        return Err((
            StatusCode::BAD_REQUEST,
            "working_dir must exist and be a directory".to_string(),
        ));
    }

    let mut manager = state.agent_manager.write().await;
    if !manager.has_agent(&source_agent_id) {
        return Err((StatusCode::NOT_FOUND, "source agent not found".to_string()));
    }

    let model = req
        .model
        .clone()
        .unwrap_or_else(|| default_model_for_cli(&cli_type));
    let thinking_enabled = req.thinking_enabled.unwrap_or(false);
    let reasoning_effort = req.reasoning_effort.unwrap_or_else(|| "medium".to_string());
    let mcp_servers = req.mcp_servers.clone().unwrap_or_default();

    let created_id = manager
        .create_agent(
            req.id.as_deref(),
            &req.name,
            &req.working_dir,
            &model,
            thinking_enabled,
            &reasoning_effort,
            specialty,
            mcp_servers.clone(),
            cli_type,
            req.session_id.clone(),
        )
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    let (status, session_id) = manager
        .get_agent_runtime(&created_id)
        .unwrap_or((AgentStatus::Idle, req.session_id.clone()));
    drop(manager);

    {
        let mut telegram = state.telegram_manager.write().await;
        telegram.ensure_binding_running(&created_id);
    }

    Ok(Json(AgentInfo {
        id: created_id,
        name: req.name,
        working_dir: req.working_dir,
        model,
        thinking_enabled,
        mcp_servers,
        cli_type: cli_type_label,
        specialty: specialty_label,
        status,
        session_id,
    }))
}

#[derive(Deserialize)]
struct AgentToolsMessageRequest {
    target_agent_id: String,
    message: String,
    #[serde(default = "default_wait_for_completion")]
    wait_for_completion: bool,
    #[serde(default = "default_delegation_timeout_seconds")]
    timeout_seconds: u64,
    #[serde(default = "default_require_response")]
    require_response: bool,
}

#[derive(Deserialize, Clone)]
struct AgentToolsDelegateTask {
    target_agent_id: String,
    message: String,
}

#[derive(Deserialize)]
struct AgentToolsDelegateManyRequest {
    tasks: Vec<AgentToolsDelegateTask>,
    #[serde(default = "default_wait_for_completion")]
    wait_for_completion: bool,
    #[serde(default = "default_parallel_delegation")]
    parallel: bool,
    #[serde(default = "default_delegation_timeout_seconds")]
    timeout_seconds: u64,
    #[serde(default = "default_require_response")]
    require_response: bool,
}

#[derive(Serialize, Clone)]
struct AgentDelegationResult {
    target_agent_id: String,
    status: String,
    response: Option<String>,
    completed: bool,
    timed_out: bool,
}

#[derive(Serialize)]
struct AgentToolsDelegateManyResponse {
    ok: bool,
    source_agent_id: String,
    results: Vec<AgentDelegationResult>,
}

fn default_wait_for_completion() -> bool {
    true
}

fn default_require_response() -> bool {
    true
}

fn default_parallel_delegation() -> bool {
    true
}

fn default_delegation_timeout_seconds() -> u64 {
    240
}

fn build_delegation_message(source_agent_id: &str, message: &str) -> String {
    format!(
        "[Delegated task from agent {}]\n{}\n\nWhen done, respond with a concise summary of what you completed.",
        source_agent_id, message
    )
}

fn agent_status_label(status: &AgentStatus) -> &'static str {
    match status {
        AgentStatus::Idle => "idle",
        AgentStatus::Thinking => "thinking",
        AgentStatus::Working => "working",
        AgentStatus::Error => "error",
        AgentStatus::Exited => "exited",
    }
}

fn extract_assistant_text_from_output(data: &str) -> Option<String> {
    let value = serde_json::from_str::<serde_json::Value>(data).ok()?;
    let event_type = value.get("type").and_then(|v| v.as_str())?;

    match event_type {
        "assistant" => {
            let mut out = String::new();
            let blocks = value
                .get("message")
                .and_then(|v| v.get("content"))
                .and_then(|v| v.as_array())?;
            for block in blocks {
                if block.get("type").and_then(|v| v.as_str()) == Some("text") {
                    if let Some(text) = block.get("text").and_then(|v| v.as_str()) {
                        if !text.trim().is_empty() {
                            if !out.is_empty() {
                                out.push('\n');
                            }
                            out.push_str(text.trim());
                        }
                    }
                }
            }
            if out.trim().is_empty() {
                None
            } else {
                Some(out)
            }
        }
        "result" => value
            .get("result")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
        "item.completed" => {
            let item = value.get("item")?;
            if item.get("type").and_then(|v| v.as_str()) == Some("agent_message") {
                item.get("text")
                    .and_then(|v| v.as_str())
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
            } else {
                None
            }
        }
        _ => None,
    }
}

async fn wait_for_delegated_completion(
    state: SharedState,
    target_agent_id: String,
    since_seq: u64,
    timeout_seconds: u64,
    require_response: bool,
) -> AgentDelegationResult {
    let mut rx = state.broadcast_tx.subscribe();
    let deadline = TokioInstant::now() + TokioDuration::from_secs(timeout_seconds.max(1));
    let mut saw_activity = false;
    let mut latest_response: Option<String> = None;
    let mut last_status = AgentStatus::Idle;

    loop {
        if TokioInstant::now() >= deadline {
            return AgentDelegationResult {
                target_agent_id,
                status: agent_status_label(&last_status).to_string(),
                response: latest_response,
                completed: false,
                timed_out: true,
            };
        }

        let remaining = deadline.saturating_duration_since(TokioInstant::now());
        let recv_result = tokio::time::timeout(remaining, rx.recv()).await;

        let envelope = match recv_result {
            Ok(Ok(envelope)) => envelope,
            Ok(Err(_)) => continue,
            Err(_) => {
                return AgentDelegationResult {
                    target_agent_id,
                    status: agent_status_label(&last_status).to_string(),
                    response: latest_response,
                    completed: false,
                    timed_out: true,
                };
            }
        };

        if envelope.seq <= since_seq {
            continue;
        }

        match &envelope.message {
            BroadcastMessage::AgentOutput(output) if output.agent_id == target_agent_id => {
                if let Some(text) = extract_assistant_text_from_output(&output.data) {
                    latest_response = Some(text);
                }
            }
            BroadcastMessage::AgentStatus(status) if status.agent_id == target_agent_id => {
                last_status = status.status.clone();
                if matches!(status.status, AgentStatus::Thinking | AgentStatus::Working) {
                    saw_activity = true;
                }

                if saw_activity
                    && matches!(
                        status.status,
                        AgentStatus::Idle | AgentStatus::Error | AgentStatus::Exited
                    )
                {
                    let has_response = latest_response
                        .as_ref()
                        .map(|t| !t.trim().is_empty())
                        .unwrap_or(false);
                    if !require_response
                        || has_response
                        || !matches!(status.status, AgentStatus::Idle)
                    {
                        return AgentDelegationResult {
                            target_agent_id,
                            status: agent_status_label(&status.status).to_string(),
                            response: latest_response,
                            completed: true,
                            timed_out: false,
                        };
                    }
                }
            }
            _ => {}
        }
    }
}

async fn delegate_to_single_agent(
    state: SharedState,
    source_agent_id: String,
    task: AgentToolsDelegateTask,
    wait_for_completion: bool,
    timeout_seconds: u64,
    require_response: bool,
) -> Result<AgentDelegationResult, (StatusCode, String)> {
    let manager = state.agent_manager.read().await;
    let since_seq = state.events.read().await.latest_seq();
    let bridged_message = build_delegation_message(&source_agent_id, &task.message);
    manager
        .send_message(&task.target_agent_id, &bridged_message, &[])
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    drop(manager);

    if !wait_for_completion {
        return Ok(AgentDelegationResult {
            target_agent_id: task.target_agent_id,
            status: "accepted".to_string(),
            response: None,
            completed: false,
            timed_out: false,
        });
    }

    Ok(wait_for_delegated_completion(
        state,
        task.target_agent_id,
        since_seq,
        timeout_seconds,
        require_response,
    )
    .await)
}

async fn agent_tools_message_agent(
    State(state): State<SharedState>,
    Path(source_agent_id): Path<String>,
    headers: HeaderMap,
    Json(req): Json<AgentToolsMessageRequest>,
) -> Result<Json<AgentDelegationResult>, (StatusCode, String)> {
    require_agent_tools_auth(&headers, &state.agent_tools_token)?;

    {
        let manager = state.agent_manager.read().await;
        if !manager.has_agent(&source_agent_id) {
            return Err((StatusCode::NOT_FOUND, "source agent not found".to_string()));
        }
        if !manager.has_agent(&req.target_agent_id) {
            return Err((StatusCode::NOT_FOUND, "target agent not found".to_string()));
        }
    }

    let result = delegate_to_single_agent(
        state.clone(),
        source_agent_id,
        AgentToolsDelegateTask {
            target_agent_id: req.target_agent_id,
            message: req.message,
        },
        req.wait_for_completion,
        req.timeout_seconds,
        req.require_response,
    )
    .await?;

    Ok(Json(result))
}

async fn agent_tools_delegate_many(
    State(state): State<SharedState>,
    Path(source_agent_id): Path<String>,
    headers: HeaderMap,
    Json(req): Json<AgentToolsDelegateManyRequest>,
) -> Result<Json<AgentToolsDelegateManyResponse>, (StatusCode, String)> {
    require_agent_tools_auth(&headers, &state.agent_tools_token)?;

    if req.tasks.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "tasks cannot be empty".to_string()));
    }
    if req.tasks.len() > 24 {
        return Err((StatusCode::BAD_REQUEST, "tasks limit is 24".to_string()));
    }

    {
        let manager = state.agent_manager.read().await;
        if !manager.has_agent(&source_agent_id) {
            return Err((StatusCode::NOT_FOUND, "source agent not found".to_string()));
        }
        for task in &req.tasks {
            if !manager.has_agent(&task.target_agent_id) {
                return Err((
                    StatusCode::NOT_FOUND,
                    format!("target agent not found: {}", task.target_agent_id),
                ));
            }
        }
    }

    let results = if req.parallel {
        let futures = req.tasks.into_iter().map(|task| {
            delegate_to_single_agent(
                state.clone(),
                source_agent_id.clone(),
                task,
                req.wait_for_completion,
                req.timeout_seconds,
                req.require_response,
            )
        });
        let joined = join_all(futures).await;
        let mut out = Vec::new();
        for item in joined {
            out.push(item?);
        }
        out
    } else {
        let mut out = Vec::new();
        for task in req.tasks {
            out.push(
                delegate_to_single_agent(
                    state.clone(),
                    source_agent_id.clone(),
                    task,
                    req.wait_for_completion,
                    req.timeout_seconds,
                    req.require_response,
                )
                .await?,
            );
        }
        out
    };

    Ok(Json(AgentToolsDelegateManyResponse {
        ok: true,
        source_agent_id,
        results,
    }))
}

#[derive(Deserialize)]
struct AgentToolsSetTelegramRequest {
    target_agent_id: String,
    enabled: bool,
    #[serde(default)]
    bot_token: Option<String>,
    allowed_handle: String,
    #[serde(default = "default_send_typing")]
    send_typing: bool,
    #[serde(default = "default_send_updates")]
    send_updates: bool,
}

async fn agent_tools_set_telegram(
    State(state): State<SharedState>,
    Path(source_agent_id): Path<String>,
    headers: HeaderMap,
    Json(req): Json<AgentToolsSetTelegramRequest>,
) -> Result<Json<AgentTelegramResponse>, (StatusCode, String)> {
    require_agent_tools_auth(&headers, &state.agent_tools_token)?;

    {
        let manager = state.agent_manager.read().await;
        if !manager.has_agent(&source_agent_id) {
            return Err((StatusCode::NOT_FOUND, "source agent not found".to_string()));
        }
        if !manager.has_agent(&req.target_agent_id) {
            return Err((StatusCode::NOT_FOUND, "target agent not found".to_string()));
        }
    }

    let mut telegram = state.telegram_manager.write().await;
    let status = telegram
        .upsert_binding(
            &req.target_agent_id,
            TelegramBindingConfigInput {
                enabled: req.enabled,
                bot_token: req.bot_token,
                allowed_handle: req.allowed_handle,
                send_typing: req.send_typing,
                send_updates: req.send_updates,
            },
        )
        .map_err(|e| (StatusCode::BAD_REQUEST, e))?;

    Ok(Json(status.into()))
}

#[derive(Deserialize)]
struct AgentToolsPublishAppRequest {
    target_agent_id: String,
    local_port: u16,
    #[serde(default)]
    local_host: Option<String>,
    #[serde(default)]
    path_prefix: Option<String>,
    #[serde(default)]
    slug: Option<String>,
}

#[derive(Serialize)]
struct AgentToolsPublishAppResponse {
    ok: bool,
    source_agent_id: String,
    target_agent_id: String,
    slug: String,
    share_url: String,
    proxy_path: String,
}

fn sanitize_publish_slug(raw: &str) -> String {
    raw.trim()
        .to_ascii_lowercase()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

fn normalize_path_prefix(value: Option<&str>) -> String {
    let raw = value.unwrap_or("").trim();
    if raw.is_empty() || raw == "/" {
        return String::new();
    }
    let mut normalized = raw.replace('\\', "/");
    if !normalized.starts_with('/') {
        normalized = format!("/{}", normalized);
    }
    while normalized.ends_with('/') && normalized.len() > 1 {
        normalized.pop();
    }
    normalized
}

fn build_proxy_target_url(app: &PublishedApp, rest: &str, query: Option<&str>) -> String {
    let mut target = format!("http://{}:{}", app.local_host, app.local_port);
    if !app.path_prefix.is_empty() {
        target.push_str(&app.path_prefix);
    }

    if !rest.is_empty() {
        if !target.ends_with('/') {
            target.push('/');
        }
        target.push_str(rest.trim_start_matches('/'));
    }

    if let Some(q) = query {
        if !q.is_empty() {
            target.push('?');
            target.push_str(q);
        }
    }
    target
}

fn extract_reqwest_body(
    response: reqwest::Response,
) -> impl std::future::Future<Output = Result<(StatusCode, HeaderMap, Bytes), (StatusCode, String)>>
{
    async move {
        let status =
            StatusCode::from_u16(response.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
        let mut headers = HeaderMap::new();
        for (name, value) in response.headers() {
            if name.as_str().eq_ignore_ascii_case("connection")
                || name.as_str().eq_ignore_ascii_case("transfer-encoding")
                || name.as_str().eq_ignore_ascii_case("content-encoding")
            {
                continue;
            }
            headers.insert(name.clone(), value.clone());
        }
        let bytes = response.bytes().await.map_err(|e| {
            (
                StatusCode::BAD_GATEWAY,
                format!("failed reading upstream body: {}", e),
            )
        })?;
        Ok((status, headers, bytes))
    }
}

async fn infer_public_base_url(state: SharedState, headers: &HeaderMap) -> String {
    if let Some(base) = &state.public_base_url {
        return base.clone();
    }

    let host = headers
        .get("x-forwarded-host")
        .or_else(|| headers.get("host"))
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or("127.0.0.1:1337");
    let proto = headers
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or("http");

    let host_lower = host.to_ascii_lowercase();
    if !host_lower.starts_with("127.0.0.1")
        && !host_lower.starts_with("localhost")
        && !host_lower.starts_with("[::1]")
    {
        return format!("{}://{}", proto, host);
    }

    let port = host
        .split(':')
        .nth(1)
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(1337);

    match reqwest::get("https://api.ipify.org").await {
        Ok(resp) => match resp.text().await {
            Ok(ip) if !ip.trim().is_empty() => format!("http://{}:{}", ip.trim(), port),
            _ => format!("http://{}", host),
        },
        Err(_) => format!("http://{}", host),
    }
}

async fn agent_tools_publish_app(
    State(state): State<SharedState>,
    Path(source_agent_id): Path<String>,
    headers: HeaderMap,
    Json(req): Json<AgentToolsPublishAppRequest>,
) -> Result<Json<AgentToolsPublishAppResponse>, (StatusCode, String)> {
    require_agent_tools_auth(&headers, &state.agent_tools_token)?;

    if req.local_port == 0 {
        return Err((
            StatusCode::BAD_REQUEST,
            "local_port must be > 0".to_string(),
        ));
    }

    {
        let manager = state.agent_manager.read().await;
        if !manager.has_agent(&source_agent_id) {
            return Err((StatusCode::NOT_FOUND, "source agent not found".to_string()));
        }
        if !manager.has_agent(&req.target_agent_id) {
            return Err((StatusCode::NOT_FOUND, "target agent not found".to_string()));
        }
    }

    let local_host = req
        .local_host
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("127.0.0.1")
        .to_string();
    let path_prefix = normalize_path_prefix(req.path_prefix.as_deref());

    let desired_slug = req
        .slug
        .as_deref()
        .map(sanitize_publish_slug)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            let base = sanitize_publish_slug(&req.target_agent_id);
            let suffix = uuid::Uuid::new_v4().to_string()[..8].to_string();
            let prefix = if base.is_empty() {
                "app".to_string()
            } else {
                base
            };
            format!("{}-{}", prefix, suffix)
        });

    {
        let mut published = state.published_apps.write().await;
        if let Some(existing) = published.get(&desired_slug) {
            if existing.source_agent_id != source_agent_id {
                return Err((
                    StatusCode::CONFLICT,
                    "slug already exists and is owned by another agent".to_string(),
                ));
            }
        }

        published.insert(
            desired_slug.clone(),
            PublishedApp {
                slug: desired_slug.clone(),
                source_agent_id: source_agent_id.clone(),
                target_agent_id: req.target_agent_id.clone(),
                local_host,
                local_port: req.local_port,
                path_prefix,
                created_at: SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs(),
            },
        );
    }

    let base_url = infer_public_base_url(state.clone(), &headers).await;
    let proxy_path = format!("/api/public/{}/", desired_slug);
    let share_url = format!("{}{}", base_url.trim_end_matches('/'), proxy_path);

    Ok(Json(AgentToolsPublishAppResponse {
        ok: true,
        source_agent_id,
        target_agent_id: req.target_agent_id,
        slug: desired_slug,
        share_url,
        proxy_path,
    }))
}

async fn proxy_public_app_root(
    State(state): State<SharedState>,
    Path(slug): Path<String>,
    method: Method,
    headers: HeaderMap,
    uri: OriginalUri,
    body: Bytes,
) -> Result<(StatusCode, HeaderMap, Bytes), (StatusCode, String)> {
    proxy_public_app_impl(state, slug, String::new(), method, headers, body, uri).await
}

async fn proxy_public_app(
    State(state): State<SharedState>,
    Path((slug, rest)): Path<(String, String)>,
    method: Method,
    headers: HeaderMap,
    uri: OriginalUri,
    body: Bytes,
) -> Result<(StatusCode, HeaderMap, Bytes), (StatusCode, String)> {
    proxy_public_app_impl(state, slug, rest, method, headers, body, uri).await
}

async fn proxy_public_app_impl(
    state: SharedState,
    slug: String,
    rest: String,
    method: Method,
    headers: HeaderMap,
    body: Bytes,
    uri: OriginalUri,
) -> Result<(StatusCode, HeaderMap, Bytes), (StatusCode, String)> {
    let app = {
        let published = state.published_apps.read().await;
        published
            .get(&slug)
            .cloned()
            .ok_or_else(|| (StatusCode::NOT_FOUND, "published app not found".to_string()))?
    };

    let query = uri.0.query();
    let target_url = build_proxy_target_url(&app, &rest, query);

    let client = reqwest::Client::new();
    let mut req_builder = client.request(
        reqwest::Method::from_bytes(method.as_str().as_bytes())
            .map_err(|e| (StatusCode::BAD_REQUEST, format!("invalid method: {}", e)))?,
        target_url,
    );

    for (name, value) in &headers {
        if name == header::HOST
            || name.as_str().eq_ignore_ascii_case("connection")
            || name.as_str().eq_ignore_ascii_case("content-length")
        {
            continue;
        }
        req_builder = req_builder.header(name, value);
    }

    req_builder = req_builder
        .header("x-va-published-slug", app.slug)
        .header("x-va-source-agent-id", app.source_agent_id)
        .header("x-va-target-agent-id", app.target_agent_id)
        .header("x-va-published-created-at", app.created_at.to_string());

    if !matches!(method, Method::GET | Method::HEAD) {
        req_builder = req_builder.body(body);
    }

    let response = req_builder.send().await.map_err(|e| {
        (
            StatusCode::BAD_GATEWAY,
            format!("publish proxy request failed: {}", e),
        )
    })?;

    extract_reqwest_body(response).await
}

fn save_base64_image(base64_data: &str, mime_type: &str, index: usize) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use std::io::Write;

    // Decode base64
    let decoded = STANDARD
        .decode(base64_data)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;

    // Determine extension from mime type
    let extension = match mime_type {
        "image/png" => "png",
        "image/jpeg" | "image/jpg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/bmp" => "bmp",
        _ => "png",
    };

    // Create temp file with unique name (timestamp + random to prevent collisions)
    let temp_dir = std::env::temp_dir();
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let random_suffix: u32 = rand::random();
    let filename = format!(
        "virtual-agency-image-{}-{}-{}-{}.{}",
        std::process::id(),
        timestamp,
        random_suffix,
        index,
        extension
    );
    let file_path = temp_dir.join(&filename);

    // Write to file
    let mut file = std::fs::File::create(&file_path)
        .map_err(|e| format!("Failed to create temp file: {}", e))?;
    file.write_all(&decoded)
        .map_err(|e| format!("Failed to write image data: {}", e))?;

    Ok(file_path.to_string_lossy().to_string())
}

fn save_telegram_media(media: &TelegramInboundMedia, index: usize) -> Result<String, String> {
    use std::io::Write;

    let extension = media
        .file_name
        .as_ref()
        .and_then(|name| name.rsplit('.').next().map(|s| s.to_ascii_lowercase()))
        .or_else(|| {
            media.mime_type.as_ref().and_then(|mime| {
                if mime.contains("png") {
                    Some("png".to_string())
                } else if mime.contains("jpeg") || mime.contains("jpg") {
                    Some("jpg".to_string())
                } else if mime.contains("webp") {
                    Some("webp".to_string())
                } else if mime.contains("gif") {
                    Some("gif".to_string())
                } else if mime.contains("mp4") {
                    Some("mp4".to_string())
                } else if mime.contains("mpeg") || mime.contains("mp3") {
                    Some("mp3".to_string())
                } else if mime.contains("ogg") {
                    Some("ogg".to_string())
                } else if mime.contains("pdf") {
                    Some("pdf".to_string())
                } else {
                    None
                }
            })
        })
        .unwrap_or_else(|| "bin".to_string());

    let temp_dir = std::env::temp_dir();
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let random_suffix: u32 = rand::random();
    let filename = format!(
        "virtual-agency-telegram-{}-{}-{}-{}.{}",
        std::process::id(),
        timestamp,
        random_suffix,
        index,
        extension
    );
    let file_path = temp_dir.join(&filename);

    let mut file = std::fs::File::create(&file_path)
        .map_err(|e| format!("Failed to create media file: {}", e))?;
    file.write_all(&media.bytes)
        .map_err(|e| format!("Failed to write media file: {}", e))?;

    Ok(file_path.to_string_lossy().to_string())
}

fn parse_env_bool(name: &str, default_value: bool) -> bool {
    let Some(raw) = std::env::var(name).ok() else {
        return default_value;
    };
    match raw.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => true,
        "0" | "false" | "no" | "off" => false,
        _ => default_value,
    }
}

fn truncate_for_prompt(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let mut out: String = text.chars().take(max_chars).collect();
    out.push_str("...");
    out
}

fn is_telegram_audio_media(media: &TelegramInboundMedia) -> bool {
    if matches!(media.kind.as_str(), "voice" | "audio") {
        return true;
    }
    media
        .mime_type
        .as_deref()
        .map(|mime| mime.starts_with("audio/"))
        .unwrap_or(false)
}

fn find_whisper_cli() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("VA_TELEGRAM_WHISPER_PATH") {
        let candidate = PathBuf::from(path.trim());
        if candidate.exists() {
            return Some(candidate);
        }
    }

    if let Ok(path_env) = std::env::var("PATH") {
        let separator = if cfg!(windows) { ';' } else { ':' };
        let names: &[&str] = if cfg!(windows) {
            &["whisper.exe", "whisper.cmd", "whisper.bat"]
        } else {
            &["whisper"]
        };
        for dir in path_env.split(separator) {
            let trimmed = dir.trim();
            if trimmed.is_empty() {
                continue;
            }
            for name in names {
                let candidate = FsPath::new(trimmed).join(name);
                if candidate.exists() {
                    return Some(candidate);
                }
            }
        }
    }

    if cfg!(windows) {
        if let Ok(user) = std::env::var("USERPROFILE") {
            let candidate = PathBuf::from(user)
                .join("AppData")
                .join("Roaming")
                .join("Python")
                .join("Python39")
                .join("Scripts")
                .join("whisper.exe");
            if candidate.exists() {
                return Some(candidate);
            }
        }
    } else if let Ok(home) = std::env::var("HOME") {
        let candidates = [
            PathBuf::from(&home)
                .join("Library")
                .join("Python")
                .join("3.9")
                .join("bin")
                .join("whisper"),
            PathBuf::from(&home)
                .join(".local")
                .join("bin")
                .join("whisper"),
        ];
        for candidate in candidates {
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }

    None
}

fn install_whisper_cli_blocking() -> Result<(), String> {
    let mut plans: Vec<(String, Vec<String>)> = Vec::new();
    if let Ok(explicit_python) = std::env::var("VA_TELEGRAM_WHISPER_PYTHON") {
        let trimmed = explicit_python.trim();
        if !trimmed.is_empty() {
            plans.push((
                trimmed.to_string(),
                vec![
                    "-m".to_string(),
                    "pip".to_string(),
                    "install".to_string(),
                    "--user".to_string(),
                    "openai-whisper".to_string(),
                ],
            ));
        }
    }
    plans.push((
        "python3".to_string(),
        vec![
            "-m".to_string(),
            "pip".to_string(),
            "install".to_string(),
            "--user".to_string(),
            "openai-whisper".to_string(),
        ],
    ));
    plans.push((
        "python".to_string(),
        vec![
            "-m".to_string(),
            "pip".to_string(),
            "install".to_string(),
            "--user".to_string(),
            "openai-whisper".to_string(),
        ],
    ));
    #[cfg(windows)]
    {
        plans.push((
            "py".to_string(),
            vec![
                "-3".to_string(),
                "-m".to_string(),
                "pip".to_string(),
                "install".to_string(),
                "--user".to_string(),
                "openai-whisper".to_string(),
            ],
        ));
    }

    let mut failures = Vec::new();
    for (python, args) in plans {
        match Command::new(&python).args(&args).output() {
            Ok(output) => {
                if output.status.success() {
                    return Ok(());
                }
                let stderr = String::from_utf8_lossy(&output.stderr);
                failures.push(format!(
                    "{} exited {}: {}",
                    python,
                    output.status.code().unwrap_or(-1),
                    truncate_for_prompt(stderr.trim(), 240)
                ));
            }
            Err(err) => {
                failures.push(format!("{} failed to start: {}", python, err));
            }
        }
    }

    Err(format!(
        "whisper_auto_install_failed: {}",
        truncate_for_prompt(&failures.join(" | "), 480)
    ))
}

async fn ensure_whisper_cli_available() -> Result<PathBuf, String> {
    if let Some(path) = find_whisper_cli() {
        return Ok(path);
    }
    if !parse_env_bool("VA_TELEGRAM_AUTO_INSTALL_WHISPER", true) {
        return Err("whisper_cli_not_found".to_string());
    }
    if WHISPER_INSTALL_ATTEMPTED.swap(true, Ordering::SeqCst) {
        return find_whisper_cli().ok_or_else(|| "whisper_cli_not_found".to_string());
    }

    let install_timeout_secs = std::env::var("VA_TELEGRAM_WHISPER_INSTALL_TIMEOUT_SECS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(90);
    match tokio::time::timeout(
        TokioDuration::from_secs(install_timeout_secs),
        tokio::task::spawn_blocking(install_whisper_cli_blocking),
    )
    .await
    {
        Ok(Ok(Ok(()))) => {
            tracing::info!("[telegram] Auto-installed whisper for audio transcription");
        }
        Ok(Ok(Err(err))) => {
            tracing::warn!("[telegram] Whisper auto-install failed: {}", err);
        }
        Ok(Err(err)) => {
            tracing::warn!("[telegram] Whisper auto-install join error: {}", err);
        }
        Err(_) => {
            tracing::warn!(
                "[telegram] Whisper auto-install timed out after {}s",
                install_timeout_secs
            );
        }
    }

    find_whisper_cli().ok_or_else(|| "whisper_cli_not_found".to_string())
}

fn transcribe_audio_with_local_whisper_blocking(
    path: &str,
    whisper: &FsPath,
) -> Result<String, String> {
    let model =
        std::env::var("VA_TELEGRAM_WHISPER_MODEL").unwrap_or_else(|_| "tiny.en".to_string());
    let language =
        std::env::var("VA_TELEGRAM_WHISPER_LANGUAGE").unwrap_or_else(|_| "en".to_string());
    let output_dir = std::env::temp_dir();
    let output_dir_str = output_dir.to_string_lossy().to_string();

    let output = Command::new(whisper)
        .arg(path)
        .args([
            "--model",
            &model,
            "--language",
            &language,
            "--fp16",
            "False",
            "--output_format",
            "txt",
            "--output_dir",
            &output_dir_str,
            "--verbose",
            "False",
        ])
        .output()
        .map_err(|e| format!("failed starting whisper: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "whisper_failed_exit_{}: {}",
            output.status.code().unwrap_or(-1),
            truncate_for_prompt(stderr.trim(), 300)
        ));
    }

    let stem = FsPath::new(path)
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "invalid_audio_filename".to_string())?;
    let transcript_path = output_dir.join(format!("{}.txt", stem));
    let transcript = std::fs::read_to_string(&transcript_path)
        .map_err(|e| format!("failed reading whisper output: {}", e))?;
    let _ = std::fs::remove_file(&transcript_path);

    let cleaned = transcript.trim();
    if cleaned.is_empty() {
        return Err("empty_transcript".to_string());
    }
    Ok(cleaned.to_string())
}

async fn transcribe_audio_with_local_whisper(path: &str) -> Result<String, String> {
    let whisper_path = ensure_whisper_cli_available().await?;
    let path_owned = path.to_string();
    let whisper_owned = whisper_path.clone();
    let result = tokio::task::spawn_blocking(move || {
        transcribe_audio_with_local_whisper_blocking(&path_owned, &whisper_owned)
    })
    .await
    .map_err(|e| format!("whisper_task_join_error: {}", e))??;
    Ok(result)
}

async fn transcribe_audio_with_openai(path: &str) -> Result<String, String> {
    let api_key =
        std::env::var("OPENAI_API_KEY").map_err(|_| "OPENAI_API_KEY not configured".to_string())?;
    let bytes = tokio::fs::read(path)
        .await
        .map_err(|e| format!("failed reading audio file: {}", e))?;

    let filename = FsPath::new(path)
        .file_name()
        .and_then(|v| v.to_str())
        .unwrap_or("voice.ogg")
        .to_string();

    let part = reqwest::multipart::Part::bytes(bytes).file_name(filename);

    let model = std::env::var("VA_TELEGRAM_TRANSCRIBE_MODEL")
        .unwrap_or_else(|_| "gpt-4o-mini-transcribe".to_string());
    let language = std::env::var("VA_TELEGRAM_TRANSCRIBE_LANGUAGE").ok();

    let mut form = reqwest::multipart::Form::new()
        .text("model", model)
        .part("file", part);
    if let Some(lang) = language {
        if !lang.trim().is_empty() {
            form = form.text("language", lang.trim().to_string());
        }
    }

    let client = reqwest::Client::new();
    let response = client
        .post("https://api.openai.com/v1/audio/transcriptions")
        .bearer_auth(api_key)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("openai_transcribe_request_failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "unable_to_read_response".to_string());
        return Err(format!(
            "openai_transcribe_http_{}: {}",
            status,
            truncate_for_prompt(body.trim(), 300)
        ));
    }

    let payload = response
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("openai_transcribe_invalid_json: {}", e))?;
    let text = payload
        .get("text")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "openai_transcribe_missing_text".to_string())?;

    Ok(text.to_string())
}

async fn maybe_transcribe_telegram_audio(
    path: &str,
    media: &TelegramInboundMedia,
) -> Option<String> {
    if !is_telegram_audio_media(media) {
        return None;
    }
    if !parse_env_bool("VA_TELEGRAM_TRANSCRIBE_VOICE", true) {
        return None;
    }

    let openai_timeout_secs = std::env::var("VA_TELEGRAM_TRANSCRIBE_OPENAI_TIMEOUT_SECS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(12);
    if let Ok(Ok(transcript)) = tokio::time::timeout(
        TokioDuration::from_secs(openai_timeout_secs),
        transcribe_audio_with_openai(path),
    )
    .await
    {
        return Some(transcript);
    }

    let local_timeout_secs = std::env::var("VA_TELEGRAM_TRANSCRIBE_LOCAL_TIMEOUT_SECS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(16);
    if let Ok(Ok(transcript)) = tokio::time::timeout(
        TokioDuration::from_secs(local_timeout_secs),
        transcribe_audio_with_local_whisper(path),
    )
    .await
    {
        return Some(transcript);
    }

    None
}

async fn build_telegram_dispatch_payload(
    dispatch: &TelegramDispatch,
) -> Result<(String, Vec<String>), String> {
    let mut image_paths = Vec::new();
    let mut attachment_notes = Vec::new();
    let mut transcript_notes = Vec::new();

    for (idx, media) in dispatch.media.iter().enumerate() {
        let path = save_telegram_media(media, idx)?;
        let mime = media.mime_type.as_deref().unwrap_or("");
        let is_image = media.kind == "photo" || mime.starts_with("image/");

        if is_image {
            image_paths.push(path.clone());
        }

        let label = media
            .file_name
            .clone()
            .unwrap_or_else(|| format!("{} #{}", media.kind, idx + 1));
        attachment_notes.push(format!("- {} ({}) -> {}", label, media.kind, path));

        if let Some(transcript) = maybe_transcribe_telegram_audio(&path, media).await {
            transcript_notes.push(format!(
                "- {}: {}",
                label,
                truncate_for_prompt(transcript.trim(), 500)
            ));
        }
    }

    let mut message = dispatch.text.trim().to_string();
    if !transcript_notes.is_empty() {
        if !message.is_empty() {
            message.push_str("\n\n");
        }
        message.push_str("[Telegram Voice Transcript]\n");
        message.push_str(&transcript_notes.join("\n"));
    }
    if !attachment_notes.is_empty() {
        if !message.is_empty() {
            message.push_str("\n\n");
        }
        message.push_str("[Telegram Media Attachments]\n");
        message.push_str(&attachment_notes.join("\n"));
    }
    if message.is_empty() {
        message = "(media attached)".to_string();
    }

    Ok((message, image_paths))
}

async fn dispatch_telegram_turn(
    state: SharedState,
    dispatch: TelegramDispatch,
) -> Result<(), String> {
    let (message, image_paths) = build_telegram_dispatch_payload(&dispatch).await?;

    let manager = state.agent_manager.read().await;
    manager.send_message(&dispatch.agent_id, &message, &image_paths)
}

async fn execute_telegram_actions(state: SharedState, initial_actions: Vec<TelegramAction>) {
    let mut queue: VecDeque<TelegramAction> = initial_actions.into_iter().collect();

    while let Some(action) = queue.pop_front() {
        match action {
            TelegramAction::SendMessage {
                bot_token,
                chat_id,
                text,
            } => {
                if let Err(err) = telegram::send_telegram_text(&bot_token, chat_id, &text).await {
                    tracing::warn!("[telegram] Failed to send message: {}", err);
                }
            }
            TelegramAction::SendTyping { bot_token, chat_id } => {
                if let Err(err) = telegram::send_telegram_typing(&bot_token, chat_id).await {
                    tracing::debug!("[telegram] Failed to send typing action: {}", err);
                }
            }
            TelegramAction::DispatchToAgent(dispatch) => {
                let agent_id = dispatch.agent_id.clone();
                if let Err(err) = dispatch_telegram_turn(state.clone(), dispatch).await {
                    let follow_up = {
                        let mut telegram = state.telegram_manager.write().await;
                        telegram.notify_dispatch_failure(&agent_id, &err)
                    };
                    for next in follow_up {
                        queue.push_back(next);
                    }
                }
            }
        }
    }
}

async fn stop_agent(
    State(state): State<SharedState>,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    tracing::info!("[stop_agent] Stopping agent: {}", id);

    let manager = state.agent_manager.read().await;

    match manager.stop_agent(&id) {
        Ok(_) => {
            tracing::info!("[stop_agent] Successfully stopped agent: {}", id);
            Ok(StatusCode::OK)
        }
        Err(e) => {
            tracing::error!("[stop_agent] Failed: {}", e);
            Err((StatusCode::NOT_FOUND, e))
        }
    }
}

// Terminal endpoints
#[derive(Deserialize)]
struct CreateTerminalRequest {
    #[serde(default)]
    id: Option<String>,
    working_dir: String,
    #[serde(default = "default_cols")]
    cols: u16,
    #[serde(default = "default_rows")]
    rows: u16,
}

fn default_cols() -> u16 {
    80
}

fn default_rows() -> u16 {
    24
}

#[derive(Serialize)]
struct TerminalInfo {
    id: String,
    working_dir: String,
}

async fn create_terminal(
    State(state): State<SharedState>,
    Json(req): Json<CreateTerminalRequest>,
) -> Result<Json<TerminalInfo>, (StatusCode, String)> {
    tracing::info!(
        "[create_terminal] Creating terminal in {} ({}x{})",
        req.working_dir,
        req.cols,
        req.rows
    );

    let mut manager = state.terminal_manager.write().await;

    match manager.create_terminal(req.id.as_deref(), &req.working_dir, req.cols, req.rows) {
        Ok(id) => {
            tracing::info!("[create_terminal] Successfully created terminal: {}", id);
            Ok(Json(TerminalInfo {
                id,
                working_dir: req.working_dir,
            }))
        }
        Err(e) => {
            tracing::error!("[create_terminal] Failed: {}", e);
            Err((StatusCode::INTERNAL_SERVER_ERROR, e))
        }
    }
}

async fn list_terminals(State(state): State<SharedState>) -> Json<Vec<TerminalInfo>> {
    let manager = state.terminal_manager.read().await;
    let terminals = manager.list_terminals();
    Json(
        terminals
            .into_iter()
            .map(|(id, working_dir)| TerminalInfo { id, working_dir })
            .collect(),
    )
}

async fn kill_terminal(
    State(state): State<SharedState>,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    tracing::info!("[kill_terminal] Killing terminal: {}", id);

    let mut manager = state.terminal_manager.write().await;

    match manager.kill_terminal(&id) {
        Ok(_) => Ok(StatusCode::NO_CONTENT),
        Err(e) => Err((StatusCode::NOT_FOUND, e)),
    }
}

#[derive(Deserialize)]
struct TerminalInputRequest {
    data: String,
}

#[derive(Deserialize)]
struct TerminalResizeRequest {
    cols: u16,
    rows: u16,
}

async fn write_terminal_input(
    State(state): State<SharedState>,
    Path(id): Path<String>,
    Json(req): Json<TerminalInputRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    let terminal = {
        let manager = state.terminal_manager.read().await;
        manager.get_terminal(&id)
    };

    let Some(terminal) = terminal else {
        return Err((StatusCode::NOT_FOUND, format!("Terminal {} not found", id)));
    };

    terminal
        .write(req.data.as_bytes())
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    Ok(StatusCode::OK)
}

async fn resize_terminal(
    State(state): State<SharedState>,
    Path(id): Path<String>,
    Json(req): Json<TerminalResizeRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    let terminal = {
        let manager = state.terminal_manager.read().await;
        manager.get_terminal(&id)
    };

    let Some(terminal) = terminal else {
        return Err((StatusCode::NOT_FOUND, format!("Terminal {} not found", id)));
    };

    terminal
        .resize(req.cols, req.rows)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    Ok(StatusCode::OK)
}

#[derive(Deserialize)]
struct FindPortQuery {
    #[serde(default)]
    start: Option<u16>,
    #[serde(default)]
    end: Option<u16>,
}

#[derive(Serialize)]
struct FindPortResponse {
    port: u16,
    start: u16,
    end: u16,
}

async fn find_available_port(
    Query(query): Query<FindPortQuery>,
) -> Result<Json<FindPortResponse>, (StatusCode, String)> {
    // Default Rojo port range.
    let start = query.start.unwrap_or(34872);
    let end = query.end.unwrap_or(34972);

    if start == 0 || end == 0 {
        return Err((StatusCode::BAD_REQUEST, "start/end must be > 0".into()));
    }
    if start > end {
        return Err((StatusCode::BAD_REQUEST, "start must be <= end".into()));
    }
    // Guardrail: avoid scanning huge ranges accidentally.
    if (end - start) > 2000 {
        return Err((
            StatusCode::BAD_REQUEST,
            "port range too large (max 2000)".into(),
        ));
    }

    let ip = IpAddr::V4(Ipv4Addr::LOCALHOST);

    for port in start..=end {
        let addr = SocketAddr::new(ip, port);
        match tokio::net::TcpListener::bind(addr).await {
            Ok(listener) => {
                drop(listener);
                return Ok(Json(FindPortResponse { port, start, end }));
            }
            Err(_) => continue,
        }
    }

    Err((
        StatusCode::CONFLICT,
        format!("no available port in range {}-{}", start, end),
    ))
}

async fn ws_handler(ws: WebSocketUpgrade, State(state): State<SharedState>) -> impl IntoResponse {
    ws.on_upgrade(|socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: SharedState) {
    let (mut sender, mut receiver) = socket.split();

    // Subscribe to server event stream
    let mut rx = state.broadcast_tx.subscribe();

    // Clone state for the receive task
    let state_clone = state.clone();

    // Spawn task to forward broadcast messages to WebSocket
    let send_task = tokio::spawn(async move {
        while let Ok(msg) = rx.recv().await {
            if let Ok(json) = serde_json::to_string(&msg) {
                if sender.send(Message::Text(json)).await.is_err() {
                    break;
                }
            }
        }
    });

    // Handle incoming messages - now processes terminal input
    let recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            match msg {
                Message::Close(_) => break,
                Message::Text(text) => {
                    // Parse incoming message
                    if let Ok(client_msg) = serde_json::from_str::<WsClientMessage>(&text) {
                        match client_msg {
                            WsClientMessage::TerminalInput { terminal_id, data } => {
                                let terminal = {
                                    let manager = state_clone.terminal_manager.read().await;
                                    manager.get_terminal(&terminal_id)
                                };
                                if let Some(terminal) = terminal {
                                    if let Err(e) = terminal.write(data.as_bytes()).await {
                                        tracing::error!(
                                            "Failed to write to terminal {}: {}",
                                            terminal_id,
                                            e
                                        );
                                    }
                                } else {
                                    tracing::warn!("Terminal {} not found", terminal_id);
                                }
                            }
                            WsClientMessage::TerminalResize {
                                terminal_id,
                                cols,
                                rows,
                            } => {
                                let terminal = {
                                    let manager = state_clone.terminal_manager.read().await;
                                    manager.get_terminal(&terminal_id)
                                };
                                if let Some(terminal) = terminal {
                                    if let Err(e) = terminal.resize(cols, rows).await {
                                        tracing::error!(
                                            "Failed to resize terminal {}: {}",
                                            terminal_id,
                                            e
                                        );
                                    }
                                }
                            }
                        }
                    }
                }
                Message::Ping(_) => {
                    // Pong is handled automatically by axum
                }
                _ => {}
            }
        }
    });

    // Wait for either task to complete
    tokio::select! {
        _ = send_task => {},
        _ = recv_task => {},
    }

    tracing::debug!("WebSocket connection closed");
}
