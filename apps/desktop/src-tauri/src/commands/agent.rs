use crate::agents::{AgentSpecialty, CliType};
use crate::state::AppState;
use std::fs;
use std::io::ErrorKind;
use std::path::PathBuf;
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
    let default_model = if cli == CliType::Codex { "gpt-5.5" } else { "sonnet" };
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

const INTEGRATIONS_FILE_REL_PATH: &str = ".virtual-agency/integrations.md";

#[tauri::command]
pub fn save_integrations_markdown(state: State<AppState>, id: String, markdown: String) -> Result<(), String> {
    let manager = state.agent_manager.lock().map_err(|e| e.to_string())?;
    let working_dir = manager.get_agent_working_dir(&id)?;
    drop(manager);

    let path = PathBuf::from(working_dir).join(INTEGRATIONS_FILE_REL_PATH);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create integrations directory: {}", e))?;
    }

    fs::write(&path, markdown).map_err(|e| format!("Failed to write integrations markdown: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn load_integrations_markdown(state: State<AppState>, id: String) -> Result<String, String> {
    let manager = state.agent_manager.lock().map_err(|e| e.to_string())?;
    let working_dir = manager.get_agent_working_dir(&id)?;
    drop(manager);

    let path = PathBuf::from(working_dir).join(INTEGRATIONS_FILE_REL_PATH);
    match fs::read_to_string(&path) {
        Ok(content) => Ok(content),
        Err(err) if err.kind() == ErrorKind::NotFound => Ok(String::new()),
        Err(err) => Err(format!("Failed to read integrations markdown: {}", err)),
    }
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
