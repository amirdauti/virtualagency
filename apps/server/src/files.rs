use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Deserialize)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub children: Option<Vec<FileNode>>,
}

#[derive(Debug, Deserialize)]
pub struct ReadFileRequest {
    pub path: String,
}

#[derive(Debug, Deserialize)]
pub struct WriteFileRequest {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
pub struct FileContent {
    pub content: String,
}

fn should_ignore(name: &str) -> bool {
    matches!(
        name,
        ".git" | "node_modules" | "target" | ".next" | "dist" | "build" | ".DS_Store"
    )
}

fn build_file_tree(path: &Path, base_path: &Path) -> Result<FileNode, std::io::Error> {
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();

    let relative_path = path
        .strip_prefix(base_path)
        .unwrap_or(path)
        .to_string_lossy()
        .to_string();

    if path.is_dir() {
        let mut children = Vec::new();
        if let Ok(entries) = fs::read_dir(path) {
            for entry in entries.flatten() {
                let entry_path = entry.path();
                if let Some(entry_name) = entry_path.file_name().and_then(|n| n.to_str()) {
                    if !should_ignore(entry_name) {
                        if let Ok(child) = build_file_tree(&entry_path, base_path) {
                            children.push(child);
                        }
                    }
                }
            }
        }
        children.sort_by(|a, b| {
            match (a.is_directory, b.is_directory) {
                (true, false) => std::cmp::Ordering::Less,
                (false, true) => std::cmp::Ordering::Greater,
                _ => a.name.cmp(&b.name),
            }
        });

        Ok(FileNode {
            name,
            path: relative_path,
            is_directory: true,
            children: Some(children),
        })
    } else {
        Ok(FileNode {
            name,
            path: relative_path,
            is_directory: false,
            children: None,
        })
    }
}

pub async fn get_file_tree(workspace_dir: &PathBuf) -> Result<FileNode, String> {
    build_file_tree(workspace_dir, workspace_dir)
        .map_err(|e| e.to_string())
}

pub async fn read_file(
    workspace_dir: &PathBuf,
    req: ReadFileRequest,
) -> Result<FileContent, String> {
    let file_path = workspace_dir.join(&req.path);

    // Canonicalize to resolve symlinks and prevent path traversal
    let canonical_workspace = workspace_dir
        .canonicalize()
        .map_err(|e| format!("Invalid workspace directory: {}", e))?;
    let canonical_file = file_path
        .canonicalize()
        .map_err(|e| format!("File not found: {}", e))?;

    if !canonical_file.starts_with(&canonical_workspace) {
        return Err("Access denied: path outside workspace".to_string());
    }

    let content = fs::read_to_string(&canonical_file)
        .map_err(|e| e.to_string())?;

    Ok(FileContent { content })
}

pub async fn write_file(
    workspace_dir: &PathBuf,
    req: WriteFileRequest,
) -> Result<serde_json::Value, String> {
    let file_path = workspace_dir.join(&req.path);

    // Canonicalize workspace directory
    let canonical_workspace = workspace_dir
        .canonicalize()
        .map_err(|e| format!("Invalid workspace directory: {}", e))?;

    // For write operations, we need to handle the case where the file doesn't exist yet
    // So we check the parent directory instead
    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;

        let canonical_parent = parent
            .canonicalize()
            .map_err(|e| format!("Invalid parent directory: {}", e))?;

        if !canonical_parent.starts_with(&canonical_workspace) {
            return Err("Access denied: path outside workspace".to_string());
        }
    }

    fs::write(&file_path, &req.content)
        .map_err(|e| e.to_string())?;

    Ok(serde_json::json!({"success": true}))
}
