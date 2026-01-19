use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use tokio::sync::broadcast;

use crate::BroadcastMessage;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentOutput {
    pub agent_id: String,
    pub stream: OutputStream,
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OutputStream {
    Stdout,
    Stderr,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentStatusChange {
    pub agent_id: String,
    pub status: AgentStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentStatus {
    Idle,
    Thinking,
    Working,
    Error,
    Exited,
}

fn find_claude_cli() -> Result<PathBuf, String> {
    let home = env::var("HOME").unwrap_or_default();

    let candidates = vec![
        "claude".to_string(),
        "/opt/homebrew/bin/claude".to_string(),
        "/usr/local/bin/claude".to_string(),
        format!("{}/.npm-global/bin/claude", home),
        format!("{}/node_modules/.bin/claude", home),
        format!("{}/.nvm/versions/node/*/bin/claude", home),
        "./node_modules/.bin/claude".to_string(),
    ];

    // First, try to find it via `which`
    if let Ok(output) = Command::new("which").arg("claude").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Ok(PathBuf::from(path));
            }
        }
    }

    // Try each candidate
    for candidate in candidates {
        let path = PathBuf::from(&candidate);
        if path.exists() {
            return Ok(path);
        }
    }

    Err("Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code".to_string())
}

pub struct AgentProcess {
    pub id: String,
    pub name: String,
    pub working_dir: String,
    pub model: String,
    pub thinking_enabled: bool,
    pub mcp_servers: Vec<String>,
    session_id: Arc<Mutex<Option<String>>>,
    current_child: Arc<Mutex<Option<Child>>>,
    broadcast_tx: broadcast::Sender<BroadcastMessage>,
}

impl AgentProcess {
    pub fn new(
        id: String,
        name: String,
        working_dir: String,
        model: String,
        thinking_enabled: bool,
        mcp_servers: Vec<String>,
        broadcast_tx: broadcast::Sender<BroadcastMessage>,
    ) -> Result<Self, String> {
        find_claude_cli()?;

        Ok(Self {
            id,
            name,
            working_dir,
            model,
            thinking_enabled,
            mcp_servers,
            session_id: Arc::new(Mutex::new(None)),
            current_child: Arc::new(Mutex::new(None)),
            broadcast_tx,
        })
    }

    pub fn send_message(&self, message: &str, images: &[String]) -> Result<(), String> {
        let claude_path = find_claude_cli()?;

        if !images.is_empty() {
            tracing::debug!("[AgentProcess] Received {} image(s): {:?}", images.len(), images);
        }

        // Emit thinking status
        let _ = self.broadcast_tx.send(BroadcastMessage::AgentStatus(AgentStatusChange {
            agent_id: self.id.clone(),
            status: AgentStatus::Thinking,
        }));

        // Build the prompt with embedded image paths
        let prompt = if images.is_empty() {
            message.to_string()
        } else {
            let image_paths = images.join(" ");
            format!("Images attached: {}\n\n{}", image_paths, message)
        };

        let mut args = vec![
            "-p".to_string(),
            prompt,
            "--output-format".to_string(),
            "stream-json".to_string(),
            "--verbose".to_string(),
            "--dangerously-skip-permissions".to_string(),
        ];

        // Add model selection
        args.push("--model".to_string());
        args.push(self.model.clone());

        // Check for session continuation
        let session_id_opt = self.session_id.lock().map_err(|e| e.to_string())?.clone();
        if let Some(ref sid) = session_id_opt {
            args.push("--resume".to_string());
            args.push(sid.clone());
        }

        tracing::debug!("[AgentProcess] Executing: {} {:?}", claude_path.display(), args);

        let mut cmd = Command::new(&claude_path);
        cmd.current_dir(&self.working_dir)
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        // Enable extended thinking via environment variable
        if self.thinking_enabled {
            cmd.env("MAX_THINKING_TOKENS", "31999");
        }

        // Configure MCP servers via environment variable
        // Claude CLI reads CLAUDE_MCP_SERVERS as a JSON array
        if !self.mcp_servers.is_empty() {
            let mcp_config = serde_json::to_string(&self.mcp_servers)
                .unwrap_or_else(|_| "[]".to_string());
            cmd.env("CLAUDE_MCP_SERVERS", mcp_config);
            tracing::info!("[AgentProcess] Configured MCP servers: {:?}", self.mcp_servers);
        }

        let mut child = match cmd.spawn()
        {
            Ok(child) => child,
            Err(e) => {
                let _ = self.broadcast_tx.send(BroadcastMessage::AgentStatus(AgentStatusChange {
                    agent_id: self.id.clone(),
                    status: AgentStatus::Error,
                }));
                return Err(format!("Failed to spawn claude process: {}", e));
            }
        };

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        if let Ok(mut guard) = self.current_child.lock() {
            *guard = Some(child);
        }

        // Spawn stdout reader thread
        if let Some(stdout_handle) = stdout {
            let agent_id = self.id.clone();
            let tx = self.broadcast_tx.clone();
            let session_id_arc = Arc::clone(&self.session_id);

            thread::spawn(move || {
                let reader = BufReader::new(stdout_handle);
                for line in reader.lines() {
                    match line {
                        Ok(data) => {
                            // Parse JSON to extract session_id and status
                            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&data) {
                                if let Some(sid) = json.get("session_id").and_then(|v| v.as_str()) {
                                    if let Ok(mut guard) = session_id_arc.lock() {
                                        if guard.is_none() {
                                            *guard = Some(sid.to_string());
                                        }
                                    }
                                }

                                if let Some(msg_type) = json.get("type").and_then(|v| v.as_str()) {
                                    let status = match msg_type {
                                        "assistant" | "content_block_delta" | "content_block_start" => {
                                            Some(AgentStatus::Working)
                                        }
                                        "result" => {
                                            if let Some(sid) = json.get("session_id").and_then(|v| v.as_str()) {
                                                if let Ok(mut guard) = session_id_arc.lock() {
                                                    *guard = Some(sid.to_string());
                                                }
                                            }
                                            Some(AgentStatus::Idle)
                                        }
                                        "message_stop" | "content_block_stop" | "message_end" => {
                                            Some(AgentStatus::Idle)
                                        }
                                        "error" => Some(AgentStatus::Error),
                                        _ => None,
                                    };

                                    if let Some(s) = status {
                                        let _ = tx.send(BroadcastMessage::AgentStatus(AgentStatusChange {
                                            agent_id: agent_id.clone(),
                                            status: s,
                                        }));
                                    }
                                }
                            }

                            let _ = tx.send(BroadcastMessage::AgentOutput(AgentOutput {
                                agent_id: agent_id.clone(),
                                stream: OutputStream::Stdout,
                                data,
                            }));
                        }
                        Err(_) => break,
                    }
                }

                let _ = tx.send(BroadcastMessage::AgentStatus(AgentStatusChange {
                    agent_id: agent_id.clone(),
                    status: AgentStatus::Idle,
                }));
            });
        }

        // Spawn stderr reader thread
        if let Some(stderr_handle) = stderr {
            let agent_id = self.id.clone();
            let tx = self.broadcast_tx.clone();

            thread::spawn(move || {
                let reader = BufReader::new(stderr_handle);
                for line in reader.lines() {
                    match line {
                        Ok(data) => {
                            tracing::debug!("[AgentProcess] STDERR: {}", data);
                            let _ = tx.send(BroadcastMessage::AgentOutput(AgentOutput {
                                agent_id: agent_id.clone(),
                                stream: OutputStream::Stderr,
                                data,
                            }));
                        }
                        Err(_) => break,
                    }
                }
            });
        }

        Ok(())
    }

    /// Stop the current operation by killing the child process, but keep the agent alive
    pub fn stop(&self) -> Result<(), String> {
        if let Ok(mut guard) = self.current_child.lock() {
            if let Some(ref mut child) = *guard {
                child.kill().map_err(|e| format!("Failed to stop process: {}", e))?;
                *guard = None;
                // Emit idle status after stopping
                let _ = self.broadcast_tx.send(BroadcastMessage::AgentStatus(AgentStatusChange {
                    agent_id: self.id.clone(),
                    status: AgentStatus::Idle,
                }));
            }
        }
        Ok(())
    }

    pub fn kill(&mut self) -> Result<(), String> {
        if let Ok(mut guard) = self.current_child.lock() {
            if let Some(ref mut child) = *guard {
                child.kill().map_err(|e| format!("Failed to kill process: {}", e))?;
            }
            *guard = None;
        }
        Ok(())
    }

    pub fn update_settings(&mut self, model: Option<String>, thinking_enabled: Option<bool>, mcp_servers: Option<Vec<String>>) {
        if let Some(m) = model {
            self.model = m;
        }
        if let Some(t) = thinking_enabled {
            self.thinking_enabled = t;
        }
        if let Some(s) = mcp_servers {
            self.mcp_servers = s;
        }
    }

    pub fn get_settings(&self) -> (String, bool, Vec<String>) {
        (self.model.clone(), self.thinking_enabled, self.mcp_servers.clone())
    }
}

impl Drop for AgentProcess {
    fn drop(&mut self) {
        let _ = self.kill();
    }
}

pub struct AgentManager {
    agents: HashMap<String, AgentProcess>,
    broadcast_tx: broadcast::Sender<BroadcastMessage>,
}

impl AgentManager {
    pub fn new(broadcast_tx: broadcast::Sender<BroadcastMessage>) -> Self {
        Self {
            agents: HashMap::new(),
            broadcast_tx,
        }
    }

    pub fn create_agent(
        &mut self,
        id: Option<&str>,
        name: &str,
        working_dir: &str,
        model: &str,
        thinking_enabled: bool,
        mcp_servers: Vec<String>,
    ) -> Result<String, String> {
        // Use provided ID or generate a new one
        let id = id.map(|s| s.to_string()).unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let agent = AgentProcess::new(
            id.clone(),
            name.to_string(),
            working_dir.to_string(),
            model.to_string(),
            thinking_enabled,
            mcp_servers,
            self.broadcast_tx.clone(),
        )?;
        self.agents.insert(id.clone(), agent);
        Ok(id)
    }

    pub fn kill_agent(&mut self, id: &str) -> Result<(), String> {
        if let Some(mut agent) = self.agents.remove(id) {
            agent.kill()
        } else {
            Err(format!("Agent not found: {}", id))
        }
    }

    pub fn send_message(&self, id: &str, message: &str, images: &[String]) -> Result<(), String> {
        if let Some(agent) = self.agents.get(id) {
            agent.send_message(message, images)
        } else {
            Err(format!("Agent not found: {}", id))
        }
    }

    pub fn stop_agent(&self, id: &str) -> Result<(), String> {
        if let Some(agent) = self.agents.get(id) {
            agent.stop()
        } else {
            Err(format!("Agent not found: {}", id))
        }
    }

    pub fn list_agents(&self) -> Vec<(String, String, String, String, bool, Vec<String>)> {
        self.agents
            .iter()
            .map(|(id, agent)| {
                let (model, thinking_enabled, mcp_servers) = agent.get_settings();
                (id.clone(), agent.name.clone(), agent.working_dir.clone(), model, thinking_enabled, mcp_servers)
            })
            .collect()
    }

    pub fn update_agent_settings(
        &mut self,
        id: &str,
        model: Option<String>,
        thinking_enabled: Option<bool>,
        mcp_servers: Option<Vec<String>>,
    ) -> Result<(), String> {
        if let Some(agent) = self.agents.get_mut(id) {
            agent.update_settings(model, thinking_enabled, mcp_servers);
            Ok(())
        } else {
            Err(format!("Agent not found: {}", id))
        }
    }
}
