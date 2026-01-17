use crate::state::AppState;
use tauri::{AppHandle, State};

#[tauri::command]
pub fn create_agent(
    state: State<AppState>,
    app_handle: AppHandle,
    id: String,
    working_dir: String,
) -> Result<(), String> {
    let mut manager = state.agent_manager.lock().map_err(|e| e.to_string())?;
    manager.create_agent(id, working_dir, app_handle)
}

#[tauri::command]
pub fn kill_agent(state: State<AppState>, id: String) -> Result<(), String> {
    let mut manager = state.agent_manager.lock().map_err(|e| e.to_string())?;
    manager.kill_agent(&id)
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
