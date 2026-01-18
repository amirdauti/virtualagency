mod agents;
mod commands;
mod state;
mod utils;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::agent::create_agent,
            commands::agent::kill_agent,
            commands::agent::send_message,
            commands::agent::list_agents,
            commands::agent::update_agent_settings,
            commands::settings::get_cli_status,
            commands::settings::save_settings,
            commands::settings::load_settings,
            commands::settings::get_settings_path_str,
            commands::workspace::save_workspace,
            commands::workspace::load_workspace,
            commands::workspace::get_workspace_path_str,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
