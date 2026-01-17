use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedAgent {
    pub id: String,
    pub name: String,
    pub working_directory: String,
    pub position: Position,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceData {
    pub agents: Vec<SavedAgent>,
    pub version: u32,
}

fn get_workspace_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    // Create directory if it doesn't exist
    fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Failed to create app data dir: {}", e))?;

    Ok(app_data_dir.join("workspace.json"))
}

#[tauri::command]
pub fn save_workspace(app_handle: AppHandle, data: WorkspaceData) -> Result<(), String> {
    let path = get_workspace_path(&app_handle)?;

    let json = serde_json::to_string_pretty(&data)
        .map_err(|e| format!("Failed to serialize workspace: {}", e))?;

    fs::write(&path, json).map_err(|e| format!("Failed to write workspace file: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn load_workspace(app_handle: AppHandle) -> Result<Option<WorkspaceData>, String> {
    let path = get_workspace_path(&app_handle)?;

    if !path.exists() {
        return Ok(None);
    }

    let contents =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read workspace file: {}", e))?;

    let data: WorkspaceData = serde_json::from_str(&contents)
        .map_err(|e| format!("Failed to parse workspace file: {}", e))?;

    Ok(Some(data))
}

#[tauri::command]
pub fn get_workspace_path_str(app_handle: AppHandle) -> Result<String, String> {
    let path = get_workspace_path(&app_handle)?;
    Ok(path.to_string_lossy().to_string())
}
