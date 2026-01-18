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
use std::{path::PathBuf, sync::Arc};
use tokio::sync::{broadcast, RwLock};
use tower_http::cors::CorsLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use agents::{AgentManager, AgentOutput, AgentStatusChange};
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
    broadcast_tx: broadcast::Sender<BroadcastMessage>,
    terminal_broadcast_tx: broadcast::Sender<TerminalOutput>,
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

    // Create broadcast channel for WebSocket clients
    let (broadcast_tx, _) = broadcast::channel::<BroadcastMessage>(1000);
    let (terminal_broadcast_tx, _) = broadcast::channel::<TerminalOutput>(1000);

    // Get workspace directory from environment or use current directory
    let workspace_dir = std::env::var("WORKSPACE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));

    let state = Arc::new(AppState {
        agent_manager: RwLock::new(AgentManager::new(broadcast_tx.clone())),
        terminal_manager: RwLock::new(TerminalManager::new(terminal_broadcast_tx.clone())),
        broadcast_tx,
        terminal_broadcast_tx,
        workspace_dir,
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
        .route("/api/terminals", get(list_terminals).post(create_terminal))
        .route("/api/terminals/:id", delete(kill_terminal))
        .route("/api/files/tree/:agent_id", get(get_file_tree))
        .route("/api/files/read/:agent_id", post(read_file))
        .route("/api/files/write/:agent_id", post(write_file))
        .route("/api/health", get(health_check))
        .route("/api/browse", get(browse_directory))
        .route("/ws", get(ws_handler))
        .layer(DefaultBodyLimit::max(50 * 1024 * 1024)) // 50MB limit for large images
        .layer(cors)
        .layer(axum::middleware::from_fn(private_network_access_middleware))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:3001").await.unwrap();
    tracing::info!("Virtual Agency server listening on http://127.0.0.1:3001");

    axum::serve(listener, app).await.unwrap();
}

async fn health_check() -> Json<serde_json::Value> {
    Json(serde_json::json!({"status": "ok"}))
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
        .find(|(id, _, _, _, _)| id == &agent_id)
        .map(|(_, _, working_dir, _, _)| PathBuf::from(working_dir))
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
        .find(|(id, _, _, _, _)| id == &agent_id)
        .map(|(_, _, working_dir, _, _)| PathBuf::from(working_dir))
        .ok_or_else(|| (StatusCode::NOT_FOUND, "Agent not found".to_string()))?;

    drop(manager);

    files::read_file(&working_dir, req)
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
        .find(|(id, _, _, _, _)| id == &agent_id)
        .map(|(_, _, working_dir, _, _)| PathBuf::from(working_dir))
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
}

fn default_model() -> String {
    "sonnet".to_string()
}

#[derive(Serialize)]
struct AgentInfo {
    id: String,
    name: String,
    working_dir: String,
    model: String,
    thinking_enabled: bool,
}

async fn create_agent(
    State(state): State<SharedState>,
    Json(req): Json<CreateAgentRequest>,
) -> Result<Json<AgentInfo>, (StatusCode, String)> {
    tracing::info!(
        "[create_agent] Received request - id: {:?}, name: {}, working_dir: {}, model: {}, thinking: {}",
        req.id, req.name, req.working_dir, req.model, req.thinking_enabled
    );

    let mut manager = state.agent_manager.write().await;

    match manager.create_agent(
        req.id.as_deref(),
        &req.name,
        &req.working_dir,
        &req.model,
        req.thinking_enabled,
    ) {
        Ok(id) => {
            tracing::info!("[create_agent] Successfully created agent with id: {}", id);
            Ok(Json(AgentInfo {
                id,
                name: req.name,
                working_dir: req.working_dir,
                model: req.model,
                thinking_enabled: req.thinking_enabled,
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
    let agents = manager.list_agents();
    Json(agents.into_iter().map(|(id, name, working_dir, model, thinking_enabled)| AgentInfo {
        id,
        name,
        working_dir,
        model,
        thinking_enabled,
    }).collect())
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
}

async fn update_agent_settings(
    State(state): State<SharedState>,
    Path(id): Path<String>,
    Json(req): Json<UpdateAgentRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    tracing::info!(
        "[update_agent_settings] Updating agent {} - model: {:?}, thinking: {:?}",
        id, req.model, req.thinking_enabled
    );

    let mut manager = state.agent_manager.write().await;

    match manager.update_agent_settings(&id, req.model, req.thinking_enabled) {
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
    tracing::info!("[send_message] Existing agents: {:?}", existing_agents.iter().map(|(id, _, _, _, _)| id).collect::<Vec<_>>());

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

    // Create temp file
    let temp_dir = std::env::temp_dir();
    let filename = format!("virtual-agency-image-{}-{}.{}", std::process::id(), index, extension);
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

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<SharedState>,
) -> impl IntoResponse {
    ws.on_upgrade(|socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: SharedState) {
    let (mut sender, mut receiver) = socket.split();

    // Subscribe to broadcast channels
    let mut agent_rx = state.broadcast_tx.subscribe();
    let mut terminal_rx = state.terminal_broadcast_tx.subscribe();

    // Clone state for the receive task
    let state_clone = state.clone();

    // Spawn task to forward broadcast messages to WebSocket
    let send_task = tokio::spawn(async move {
        loop {
            tokio::select! {
                // Agent messages
                Ok(msg) = agent_rx.recv() => {
                    if let Ok(json) = serde_json::to_string(&msg) {
                        if sender.send(Message::Text(json)).await.is_err() {
                            break;
                        }
                    }
                }
                // Terminal output messages
                Ok(output) = terminal_rx.recv() => {
                    let msg = BroadcastMessage::TerminalOutput(output);
                    if let Ok(json) = serde_json::to_string(&msg) {
                        if sender.send(Message::Text(json)).await.is_err() {
                            break;
                        }
                    }
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
