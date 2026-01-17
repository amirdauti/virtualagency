use super::output::{AgentOutput, AgentStatus, AgentStatusChange, OutputStream};
use std::env;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter};

pub struct AgentProcess {
    pub id: String,
    pub working_dir: String,
    session_id: Arc<Mutex<Option<String>>>,
    current_child: Arc<Mutex<Option<Child>>>,
    app_handle: AppHandle,
}

fn find_claude_cli() -> Result<PathBuf, String> {
    // Try common locations for the Claude CLI
    let home = env::var("HOME").unwrap_or_default();

    let candidates = vec![
        // Direct command (if in PATH)
        "claude".to_string(),
        // Homebrew on Apple Silicon
        "/opt/homebrew/bin/claude".to_string(),
        // Homebrew on Intel Mac
        "/usr/local/bin/claude".to_string(),
        // npm global (default)
        format!("{}/.npm-global/bin/claude", home),
        // npm global (alternate)
        format!("{}/node_modules/.bin/claude", home),
        // nvm
        format!("{}/.nvm/versions/node/*/bin/claude", home),
        // Local node_modules
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

impl AgentProcess {
    pub fn new(id: String, working_dir: String, app_handle: AppHandle) -> Result<Self, String> {
        // Verify claude CLI exists
        find_claude_cli()?;

        Ok(Self {
            id,
            working_dir,
            session_id: Arc::new(Mutex::new(None)),
            current_child: Arc::new(Mutex::new(None)),
            app_handle,
        })
    }

    pub fn send_message(&self, message: &str, images: &[String]) -> Result<(), String> {
        let claude_path = find_claude_cli()?;

        // Log the received images for debugging
        if !images.is_empty() {
            eprintln!("[AgentProcess] Received {} image(s): {:?}", images.len(), images);
        }

        // Emit thinking status
        let _ = self.app_handle.emit(
            "agent-status",
            AgentStatusChange {
                agent_id: self.id.clone(),
                status: AgentStatus::Thinking,
            },
        );

        // Build the prompt with embedded image paths
        // Claude CLI reads images when file paths are included directly in the message
        let prompt = if images.is_empty() {
            message.to_string()
        } else {
            // Format: "Please analyze these images: /path/1.png /path/2.png\n\nUser message here"
            let image_paths = images.join(" ");
            format!("Images attached: {}\n\n{}", image_paths, message)
        };

        // Build command args
        // Use -p (print) mode for non-interactive execution
        // Use --output-format stream-json for streaming responses
        // --verbose is required when using stream-json with -p
        // --dangerously-skip-permissions allows file modifications without prompts
        let mut args = vec![
            "-p".to_string(),
            prompt,
            "--output-format".to_string(),
            "stream-json".to_string(),
            "--verbose".to_string(),
            "--dangerously-skip-permissions".to_string(),
        ];

        // Check if we have a session ID for continuation
        let session_id_opt = self.session_id.lock().map_err(|e| e.to_string())?.clone();
        if let Some(ref sid) = session_id_opt {
            args.push("--resume".to_string());
            args.push(sid.clone());
        }

        // Log the command being executed for debugging
        eprintln!("[AgentProcess] Executing: {} {:?}", claude_path.display(), args);

        // Spawn the claude process
        let mut child = match Command::new(&claude_path)
            .current_dir(&self.working_dir)
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(child) => child,
            Err(e) => {
                // Emit error status if spawn fails
                let _ = self.app_handle.emit(
                    "agent-status",
                    AgentStatusChange {
                        agent_id: self.id.clone(),
                        status: AgentStatus::Error,
                    },
                );
                return Err(format!("Failed to spawn claude process: {}", e));
            }
        };

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        // Store the child process
        if let Ok(mut guard) = self.current_child.lock() {
            *guard = Some(child);
        }

        // Spawn stdout reader thread
        if let Some(stdout_handle) = stdout {
            let agent_id = self.id.clone();
            let handle = self.app_handle.clone();
            let session_id_arc = Arc::clone(&self.session_id);

            thread::spawn(move || {
                eprintln!("[AgentProcess] stdout reader thread started for {}", agent_id);
                let reader = BufReader::new(stdout_handle);
                for line in reader.lines() {
                    match line {
                        Ok(data) => {
                            eprintln!("[AgentProcess] STDOUT: {}", &data[..std::cmp::min(200, data.len())]);
                            // Try to parse JSON to extract session_id and detect status
                            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&data) {
                                // Extract session_id if present
                                if let Some(sid) = json.get("session_id").and_then(|v| v.as_str()) {
                                    if let Ok(mut guard) = session_id_arc.lock() {
                                        if guard.is_none() {
                                            *guard = Some(sid.to_string());
                                        }
                                    }
                                }

                                // Check for message type to determine status
                                if let Some(msg_type) = json.get("type").and_then(|v| v.as_str()) {
                                    match msg_type {
                                        "assistant" | "content_block_delta" | "content_block_start" => {
                                            let _ = handle.emit(
                                                "agent-status",
                                                AgentStatusChange {
                                                    agent_id: agent_id.clone(),
                                                    status: AgentStatus::Working,
                                                },
                                            );
                                        }
                                        "result" => {
                                            // Extract session_id from result
                                            if let Some(sid) = json.get("session_id").and_then(|v| v.as_str()) {
                                                if let Ok(mut guard) = session_id_arc.lock() {
                                                    *guard = Some(sid.to_string());
                                                }
                                            }
                                            let _ = handle.emit(
                                                "agent-status",
                                                AgentStatusChange {
                                                    agent_id: agent_id.clone(),
                                                    status: AgentStatus::Idle,
                                                },
                                            );
                                        }
                                        "message_stop" | "content_block_stop" | "message_end" => {
                                            let _ = handle.emit(
                                                "agent-status",
                                                AgentStatusChange {
                                                    agent_id: agent_id.clone(),
                                                    status: AgentStatus::Idle,
                                                },
                                            );
                                        }
                                        "error" => {
                                            let _ = handle.emit(
                                                "agent-status",
                                                AgentStatusChange {
                                                    agent_id: agent_id.clone(),
                                                    status: AgentStatus::Error,
                                                },
                                            );
                                        }
                                        _ => {}
                                    }
                                }
                            }

                            let output = AgentOutput {
                                agent_id: agent_id.clone(),
                                stream: OutputStream::Stdout,
                                data,
                            };
                            let _ = handle.emit("agent-output", output);
                        }
                        Err(_) => break,
                    }
                }

                // Process finished - set to idle
                eprintln!("[AgentProcess] stdout reader thread finished for {}", agent_id);
                let _ = handle.emit(
                    "agent-status",
                    AgentStatusChange {
                        agent_id: agent_id.clone(),
                        status: AgentStatus::Idle,
                    },
                );
            });
        }

        // Spawn stderr reader thread
        if let Some(stderr_handle) = stderr {
            let agent_id = self.id.clone();
            let handle = self.app_handle.clone();
            thread::spawn(move || {
                eprintln!("[AgentProcess] stderr reader thread started for {}", agent_id);
                let reader = BufReader::new(stderr_handle);
                for line in reader.lines() {
                    match line {
                        Ok(data) => {
                            // Log stderr to terminal for debugging
                            eprintln!("[AgentProcess] STDERR: {}", data);
                            let output = AgentOutput {
                                agent_id: agent_id.clone(),
                                stream: OutputStream::Stderr,
                                data,
                            };
                            let _ = handle.emit("agent-output", output);
                        }
                        Err(_) => break,
                    }
                }
                eprintln!("[AgentProcess] stderr reader thread finished for {}", agent_id);
            });
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
}

impl Drop for AgentProcess {
    fn drop(&mut self) {
        let _ = self.kill();
    }
}
