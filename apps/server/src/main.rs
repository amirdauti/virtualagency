mod agents;

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, State,
    },
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, post},
    Json, Router,
};
use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::Arc,
};
use tokio::sync::{broadcast, RwLock};
use tower_http::cors::{Any, CorsLayer};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use agents::{AgentManager, AgentOutput, AgentStatusChange};

type SharedState = Arc<AppState>;

struct AppState {
    agent_manager: RwLock<AgentManager>,
    broadcast_tx: broadcast::Sender<BroadcastMessage>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "type")]
enum BroadcastMessage {
    #[serde(rename = "agent-output")]
    AgentOutput(AgentOutput),
    #[serde(rename = "agent-status")]
    AgentStatus(AgentStatusChange),
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

    let state = Arc::new(AppState {
        agent_manager: RwLock::new(AgentManager::new(broadcast_tx.clone())),
        broadcast_tx,
    });

    // Build router
    let app = Router::new()
        .route("/api/agents", get(list_agents).post(create_agent))
        .route("/api/agents/:id", delete(kill_agent))
        .route("/api/agents/:id/messages", post(send_message))
        .route("/api/health", get(health_check))
        .route("/ws", get(ws_handler))
        .layer(CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers(Any))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:3001").await.unwrap();
    tracing::info!("Virtual Agency server listening on http://127.0.0.1:3001");

    axum::serve(listener, app).await.unwrap();
}

async fn health_check() -> &'static str {
    "OK"
}

#[derive(Deserialize)]
struct CreateAgentRequest {
    name: String,
    working_dir: String,
}

#[derive(Serialize)]
struct AgentInfo {
    id: String,
    name: String,
    working_dir: String,
}

async fn create_agent(
    State(state): State<SharedState>,
    Json(req): Json<CreateAgentRequest>,
) -> Result<Json<AgentInfo>, (StatusCode, String)> {
    let mut manager = state.agent_manager.write().await;

    match manager.create_agent(&req.name, &req.working_dir) {
        Ok(id) => Ok(Json(AgentInfo {
            id,
            name: req.name,
            working_dir: req.working_dir,
        })),
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e)),
    }
}

async fn list_agents(State(state): State<SharedState>) -> Json<Vec<AgentInfo>> {
    let manager = state.agent_manager.read().await;
    let agents = manager.list_agents();
    Json(agents.into_iter().map(|(id, name, working_dir)| AgentInfo {
        id,
        name,
        working_dir,
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
struct SendMessageRequest {
    message: String,
    #[serde(default)]
    images: Vec<String>,
}

async fn send_message(
    State(state): State<SharedState>,
    Path(id): Path<String>,
    Json(req): Json<SendMessageRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    let manager = state.agent_manager.read().await;

    match manager.send_message(&id, &req.message, &req.images) {
        Ok(_) => Ok(StatusCode::ACCEPTED),
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

    // Subscribe to broadcast channel
    let mut rx = state.broadcast_tx.subscribe();

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

    // Handle incoming messages (for future use, e.g., ping/pong)
    let recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            match msg {
                Message::Close(_) => break,
                Message::Ping(data) => {
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
