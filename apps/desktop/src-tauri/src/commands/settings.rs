use crate::utils::cli::{check_cli_status, CliStatus};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub claude_cli_path: Option<String>,
    pub theme: String,
    pub auto_save_enabled: bool,
    pub auto_save_interval_seconds: u32,
    pub default_working_directory: Option<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            claude_cli_path: None,
            theme: "dark".to_string(),
            auto_save_enabled: true,
            auto_save_interval_seconds: 30,
            default_working_directory: None,
        }
    }
}

fn get_settings_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Failed to create app data dir: {}", e))?;

    Ok(app_data_dir.join("settings.json"))
}

#[tauri::command]
pub fn get_cli_status() -> CliStatus {
    check_cli_status()
}

#[tauri::command]
pub fn save_settings(app_handle: AppHandle, settings: AppSettings) -> Result<(), String> {
    let path = get_settings_path(&app_handle)?;

    let json = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    fs::write(&path, json).map_err(|e| format!("Failed to write settings file: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn load_settings(app_handle: AppHandle) -> Result<AppSettings, String> {
    let path = get_settings_path(&app_handle)?;

    if !path.exists() {
        return Ok(AppSettings::default());
    }

    let contents =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read settings file: {}", e))?;

    let settings: AppSettings = serde_json::from_str(&contents)
        .map_err(|e| format!("Failed to parse settings file: {}", e))?;

    Ok(settings)
}

#[tauri::command]
pub fn get_settings_path_str(app_handle: AppHandle) -> Result<String, String> {
    let path = get_settings_path(&app_handle)?;
    Ok(path.to_string_lossy().to_string())
}
