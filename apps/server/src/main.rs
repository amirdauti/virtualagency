mod agents;
mod files;
mod pty;

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        DefaultBodyLimit, Path, Query, State,
    },
    http::{header, HeaderValue, Method, StatusCode},
    response::IntoResponse,
    routing::{delete, get, post},
    Json, Router,
};
use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    net::{IpAddr, Ipv4Addr, SocketAddr},
    path::PathBuf,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::sync::{broadcast, mpsc, RwLock};
use tower_http::cors::CorsLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use agents::{AgentManager, AgentOutput, AgentSpecialty, AgentStatus, AgentStatusChange, CliType};
use pty::{TerminalManager, TerminalOutput};

type SharedState = Arc<AppState>;

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
        HeaderValue::from_static("GET, POST, DELETE, PATCH, OPTIONS"),
    );

    response
}

struct AppState {
    agent_manager: RwLock<AgentManager>,
    terminal_manager: RwLock<TerminalManager>,
    broadcast_tx: broadcast::Sender<BroadcastEnvelope>,
    events: RwLock<EventStore>,
    workspace_dir: PathBuf,
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

        let envelope = BroadcastEnvelope { seq, ts_ms, message };

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
        .with(tracing_subscriber::EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| "virtual_agency_server=debug,tower_http=debug".into()))
        .with(tracing_subscriber::fmt::layer())
        .init();

    // Create channel for server events.
    // - mpsc collects events even when no WS clients are connected
    // - broadcast streams events to active WS clients
    let (event_tx, mut event_rx) = mpsc::unbounded_channel::<BroadcastMessage>();
    let (broadcast_tx, _) = broadcast::channel::<BroadcastEnvelope>(1000);

    // Get workspace directory from environment or use current directory
    let workspace_dir = std::env::var("WORKSPACE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));

    let state = Arc::new(AppState {
        agent_manager: RwLock::new(AgentManager::new(event_tx.clone())),
        terminal_manager: RwLock::new(TerminalManager::new(event_tx.clone())),
        broadcast_tx,
        events: RwLock::new(EventStore::new(5000)),
        workspace_dir,
    });

    // Distributor: persists events to ring buffer and broadcasts to WS clients.
    let distributor_state = state.clone();
    tokio::spawn(async move {
        while let Some(msg) = event_rx.recv().await {
            let envelope = {
                let mut store = distributor_state.events.write().await;
                store.push(msg)
            };
            let _ = distributor_state.broadcast_tx.send(envelope);
        }
    });

    // Build router with CORS and Private Network Access support
    let cors = CorsLayer::new()
        .allow_origin(tower_http::cors::Any)
        .allow_methods([Method::GET, Method::POST, Method::DELETE, Method::PATCH, Method::OPTIONS])
        .allow_headers([header::CONTENT_TYPE, header::ACCEPT, header::AUTHORIZATION])
        .expose_headers([header::CONTENT_TYPE]);

    let app = Router::new()
        .route("/api/agents", get(list_agents).post(create_agent))
        .route("/api/agents/:id", delete(kill_agent).patch(update_agent_settings))
        .route("/api/agents/:id/messages", post(send_message))
        .route("/api/agents/:id/stop", post(stop_agent))
        .route("/api/events", get(get_events))
        .route("/api/terminals", get(list_terminals).post(create_terminal))
        .route("/api/terminals/:id", delete(kill_terminal))
        .route("/api/files/tree/:agent_id", get(get_file_tree))
        .route("/api/files/read/:agent_id", post(read_file))
        .route("/api/files/read_git/:agent_id", post(read_file_git))
        .route("/api/files/write/:agent_id", post(write_file))
        .route("/api/ports/find", get(find_available_port))
        .route("/api/health", get(health_check))
        .route("/api/browse", get(browse_directory))
        .route("/ws", get(ws_handler))
        .layer(DefaultBodyLimit::max(50 * 1024 * 1024)) // 50MB limit for large images
        .layer(cors)
        .layer(axum::middleware::from_fn(private_network_access_middleware))
        .with_state(state);

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
        match tokio::net::TcpListener::bind(("127.0.0.1", port)).await {
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
    tracing::info!("Virtual Agency server listening on http://127.0.0.1:{}", port);

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
    let path = query.path
        .map(PathBuf::from)
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_else(|| PathBuf::from("/")));

    if !path.exists() {
        return Err((StatusCode::NOT_FOUND, "Path does not exist".to_string()));
    }

    if !path.is_dir() {
        return Err((StatusCode::BAD_REQUEST, "Path is not a directory".to_string()));
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
            return Err((StatusCode::FORBIDDEN, format!("Cannot read directory: {}", e)));
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
    let cli_type = req.cli_type.as_ref().map(|s| CliType::from_str(s)).unwrap_or_default();
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
        },
        Err(e) => {
            tracing::error!("[create_agent] Failed to create agent: {}", e);
            Err((StatusCode::INTERNAL_SERVER_ERROR, e))
        },
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
        Ok(_) => Ok(StatusCode::NO_CONTENT),
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

    match manager.update_agent_settings(&id, req.model, req.thinking_enabled, req.reasoning_effort, req.mcp_servers) {
        Ok(_) => {
            tracing::info!("[update_agent_settings] Successfully updated agent: {}", id);
            Ok(StatusCode::OK)
        },
        Err(e) => {
            tracing::error!("[update_agent_settings] Failed: {}", e);
            Err((StatusCode::NOT_FOUND, e))
        },
    }
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
    tracing::info!("[send_message] Existing agents: {:?}", existing_agents.iter().map(|(id, _, _, _, _, _, _, _)| id).collect::<Vec<_>>());

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
        },
        Err(e) => {
            tracing::error!("[send_message] Failed: {}", e);
            Err((StatusCode::NOT_FOUND, e))
        },
    }
}

fn save_base64_image(base64_data: &str, mime_type: &str, index: usize) -> Result<String, String> {
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    use std::io::Write;

    // Decode base64
    let decoded = STANDARD.decode(base64_data)
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
    let filename = format!("virtual-agency-image-{}-{}-{}-{}.{}",
        std::process::id(), timestamp, random_suffix, index, extension);
    let file_path = temp_dir.join(&filename);

    // Write to file
    let mut file = std::fs::File::create(&file_path)
        .map_err(|e| format!("Failed to create temp file: {}", e))?;
    file.write_all(&decoded)
        .map_err(|e| format!("Failed to write image data: {}", e))?;

    Ok(file_path.to_string_lossy().to_string())
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
        },
        Err(e) => {
            tracing::error!("[stop_agent] Failed: {}", e);
            Err((StatusCode::NOT_FOUND, e))
        },
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

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<SharedState>,
) -> impl IntoResponse {
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
                                let manager = state_clone.terminal_manager.read().await;
                                if let Some(terminal) = manager.get_terminal(&terminal_id) {
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
                                let manager = state_clone.terminal_manager.read().await;
                                if let Some(terminal) = manager.get_terminal(&terminal_id) {
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
