use serde::{Deserialize, Serialize};
use std::env;
use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CliStatus {
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
}

pub fn find_claude_cli() -> Option<PathBuf> {
    let home = env::var("HOME").unwrap_or_default();

    // First, try to find it via `which`
    if let Ok(output) = Command::new("which").arg("claude").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Some(PathBuf::from(path));
            }
        }
    }

    // Try common locations
    let candidates = vec![
        "/opt/homebrew/bin/claude".to_string(),
        "/usr/local/bin/claude".to_string(),
        format!("{}/.npm-global/bin/claude", home),
        format!("{}/node_modules/.bin/claude", home),
    ];

    for candidate in candidates {
        let path = PathBuf::from(&candidate);
        if path.exists() {
            return Some(path);
        }
    }

    None
}

pub fn check_cli_status() -> CliStatus {
    match find_claude_cli() {
        Some(path) => {
            // Skip version check to avoid potential hanging
            // Just verify the CLI exists
            CliStatus {
                installed: true,
                path: Some(path.to_string_lossy().to_string()),
                version: None,
            }
        }
        None => CliStatus {
            installed: false,
            path: None,
            version: None,
        },
    }
}
