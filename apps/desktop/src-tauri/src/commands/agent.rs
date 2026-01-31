use crate::agents::{AgentSpecialty, CliType};
use crate::state::AppState;
use tauri::{AppHandle, State};

#[tauri::command]
pub fn create_agent(
    state: State<AppState>,
    app_handle: AppHandle,
    id: String,
    working_dir: String,
    model: Option<String>,
    thinking_enabled: Option<bool>,
    reasoning_effort: Option<String>,
    mcp_servers: Option<Vec<String>>,
    cli_type: Option<String>,
    specialty: Option<String>,
    session_id: Option<String>,
) -> Result<(), String> {
    let cli = cli_type.map(|s| CliType::from_str(&s)).unwrap_or_default();
    let default_model = if cli == CliType::Codex { "gpt-5.2-codex" } else { "sonnet" };
    let specialty = specialty.map(|s| AgentSpecialty::from_str(&s)).unwrap_or_default();
    let mut manager = state.agent_manager.lock().map_err(|e| e.to_string())?;
    manager.create_agent(
        id,
        working_dir,
        app_handle,
        model.unwrap_or_else(|| default_model.to_string()),
        thinking_enabled.unwrap_or(false),
        reasoning_effort.unwrap_or_else(|| "medium".to_string()),
        mcp_servers.unwrap_or_default(),
        cli,
        specialty,
        session_id,
    )
}

#[tauri::command]
pub fn kill_agent(state: State<AppState>, id: String) -> Result<(), String> {
    let mut manager = state.agent_manager.lock().map_err(|e| e.to_string())?;
    manager.kill_agent(&id)
}

#[tauri::command]
pub fn stop_agent(state: State<AppState>, id: String) -> Result<(), String> {
    let manager = state.agent_manager.lock().map_err(|e| e.to_string())?;
    manager.stop_agent(&id)
}

#[tauri::command]
pub fn send_message(state: State<AppState>, id: String, message: String, images: Vec<String>) -> Result<(), String> {
    let manager = state.agent_manager.lock().map_err(|e| e.to_string())?;
    manager.send_message(&id, &message, &images)
}

#[tauri::command]
pub fn list_agents(state: State<AppState>) -> Result<Vec<String>, String> {
    let manager = state.agent_manager.lock().map_err(|e| e.to_string())?;
    Ok(manager.list_agents())
}

#[tauri::command]
pub fn update_agent_settings(
    state: State<AppState>,
    id: String,
    model: Option<String>,
    thinking_enabled: Option<bool>,
    reasoning_effort: Option<String>,
    mcp_servers: Option<Vec<String>>,
) -> Result<(), String> {
    let mut manager = state.agent_manager.lock().map_err(|e| e.to_string())?;
    manager.update_agent_settings(&id, model, thinking_enabled, reasoning_effort, mcp_servers)
}
