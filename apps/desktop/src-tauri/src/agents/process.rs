use super::output::{AgentOutput, AgentStatus, AgentStatusChange, OutputStream};
use serde::{Deserialize, Serialize};
use std::env;
use std::io::{BufRead, BufReader};
use std::io::Write;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter};

fn get_mcp_server_package(id: &str) -> Option<&'static str> {
    match id {
        "dritan" => Some("@dritan/mcp"),
        "playwright" => Some("@playwright/mcp"),
        "context7" => Some("@upstash/context7-mcp"),
        "memory" => Some("@modelcontextprotocol/server-memory"),
        "filesystem" => Some("@modelcontextprotocol/server-filesystem"),
        "git" => Some("@modelcontextprotocol/server-git"),
        "fetch" => Some("@modelcontextprotocol/server-fetch"),
        "sequential-thinking" => Some("@modelcontextprotocol/server-sequentialthinking"),
        "brave-search" => Some("@modelcontextprotocol/server-brave-search"),
        "sqlite" => Some("@modelcontextprotocol/server-sqlite"),
        "postgres" => Some("@modelcontextprotocol/server-postgres"),
        "tailwindcss" => Some("tailwindcss-mcp-server"),
        "shadcn" => Some("@jpisnice/shadcn-ui-mcp-server"),
        _ => None,
    }
}

fn toml_escape_string(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn build_codex_mcp_overrides(mcp_servers: &[String]) -> Vec<String> {
    let mut overrides = Vec::new();

    for server_id in mcp_servers {
        let Some(npm_package) = get_mcp_server_package(server_id) else {
            eprintln!("[AgentProcess] Unknown MCP server id ignored: {}", server_id);
            continue;
        };

        overrides.push(format!("mcp_servers.{server_id}.command=\"npx\""));
        overrides.push(format!(
            "mcp_servers.{server_id}.args=[\"-y\",\"{}\"]",
            toml_escape_string(npm_package)
        ));

        if server_id == "brave-search" {
            if let Ok(key) = env::var("BRAVE_API_KEY") {
                overrides.push(format!(
                    "mcp_servers.{server_id}.env={{ BRAVE_API_KEY = \"{}\" }}",
                    toml_escape_string(&key)
                ));
            }
        }
    }

    overrides
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum CliType {
    #[default]
    Claude,
    Codex,
}

impl CliType {
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "codex" => CliType::Codex,
            _ => CliType::Claude,
        }
    }
}

const ROBLOX_BUILDER_SYSTEM_PROMPT: &str = include_str!("../../../../../prompts/roblox_builder_system_prompt.txt");

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "snake_case")]
pub enum AgentSpecialty {
    #[default]
    Normal,
    RobloxBuilder,
}

impl AgentSpecialty {
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "roblox_builder" | "roblox builder" | "roblox" => AgentSpecialty::RobloxBuilder,
            _ => AgentSpecialty::Normal,
        }
    }
}

pub struct AgentProcess {
    pub id: String,
    pub working_dir: String,
    pub model: String,
    pub thinking_enabled: bool,
    pub reasoning_effort: String, // For Codex: "low", "medium", "high"
    pub specialty: AgentSpecialty,
    pub mcp_servers: Vec<String>,
    pub cli_type: CliType,
    session_id: Arc<Mutex<Option<String>>>,
    current_child: Arc<Mutex<Option<Child>>>,
    images_sent_count: Arc<Mutex<u32>>,
    app_handle: AppHandle,
}

fn find_on_path(cmd: &str) -> Option<PathBuf> {
    #[cfg(windows)]
    {
        if let Ok(output) = Command::new("where").arg(cmd).output() {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let mut candidates: Vec<PathBuf> = stdout
                    .lines()
                    .map(|l| l.trim())
                    .filter(|l| !l.is_empty())
                    .map(PathBuf::from)
                    .collect();

                let ext_rank = |p: &PathBuf| -> u8 {
                    match p.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()) {
                        Some(ref e) if e == "exe" => 0,
                        Some(ref e) if e == "cmd" => 1,
                        Some(ref e) if e == "bat" => 2,
                        Some(ref e) if e == "ps1" => 3,
                        _ => 10,
                    }
                };
                candidates.sort_by_key(ext_rank);

                for candidate in candidates {
                    if candidate.extension().is_none() {
                        continue;
                    }
                    return Some(candidate);
                }
            }
        }
        None
    }

    #[cfg(not(windows))]
    {
        if let Ok(output) = Command::new("which").arg(cmd).output() {
            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !path.is_empty() {
                    return Some(PathBuf::from(path));
                }
            }
        }
        None
    }
}

#[cfg(windows)]
fn find_cli_via_npm_prefix(bin: &str) -> Option<PathBuf> {
    let output = Command::new("npm")
        .args(["prefix", "-g"])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let prefix = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if prefix.is_empty() {
        return None;
    }

    let prefix_path = PathBuf::from(prefix);
    let cmd = prefix_path.join(format!("{}.cmd", bin));
    if cmd.exists() {
        return Some(cmd);
    }

    let exe = prefix_path.join(format!("{}.exe", bin));
    if exe.exists() {
        return Some(exe);
    }

    None
}

fn find_claude_cli() -> Result<PathBuf, String> {
    if let Some(path) = find_on_path("claude") {
        return Ok(path);
    }

    let mut candidates: Vec<PathBuf> = Vec::new();

    #[cfg(windows)]
    {
        if let Ok(appdata) = env::var("APPDATA") {
            let npm_bin = PathBuf::from(appdata).join("npm");
            candidates.push(npm_bin.join("claude.cmd"));
            candidates.push(npm_bin.join("claude.exe"));
        }
        if let Ok(local) = env::var("LOCALAPPDATA") {
            candidates.push(PathBuf::from(&local).join("pnpm").join("claude.cmd"));
            candidates.push(PathBuf::from(&local).join("Yarn").join("bin").join("claude.cmd"));
        }
        if let Ok(user) = env::var("USERPROFILE") {
            candidates.push(PathBuf::from(user).join(".bun").join("bin").join("claude.exe"));
        }
        candidates.push(PathBuf::from("node_modules").join(".bin").join("claude.cmd"));
    }

    #[cfg(not(windows))]
    {
        let home = env::var("HOME").unwrap_or_default();
        candidates.extend([
            PathBuf::from("/opt/homebrew/bin/claude"),
            PathBuf::from("/usr/local/bin/claude"),
            PathBuf::from(format!("{}/.npm-global/bin/claude", home)),
            PathBuf::from(format!("{}/node_modules/.bin/claude", home)),
            PathBuf::from(format!("{}/.nvm/versions/node/*/bin/claude", home)),
            PathBuf::from("./node_modules/.bin/claude"),
        ]);
    }

    for candidate in candidates {
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    #[cfg(windows)]
    if let Some(path) = find_cli_via_npm_prefix("claude") {
        return Ok(path);
    }

    Err("Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code".to_string())
}

fn find_codex_cli() -> Result<PathBuf, String> {
    if let Some(path) = find_on_path("codex") {
        return Ok(path);
    }

    let mut candidates: Vec<PathBuf> = Vec::new();

    #[cfg(windows)]
    {
        if let Ok(appdata) = env::var("APPDATA") {
            let npm_bin = PathBuf::from(appdata).join("npm");
            candidates.push(npm_bin.join("codex.cmd"));
            candidates.push(npm_bin.join("codex.exe"));
        }
        if let Ok(local) = env::var("LOCALAPPDATA") {
            candidates.push(PathBuf::from(&local).join("pnpm").join("codex.cmd"));
            candidates.push(PathBuf::from(&local).join("Yarn").join("bin").join("codex.cmd"));
        }
        if let Ok(user) = env::var("USERPROFILE") {
            candidates.push(PathBuf::from(user).join(".bun").join("bin").join("codex.exe"));
        }
        candidates.push(PathBuf::from("node_modules").join(".bin").join("codex.cmd"));
    }

    #[cfg(not(windows))]
    {
        let home = env::var("HOME").unwrap_or_default();
        candidates.extend([
            PathBuf::from("/opt/homebrew/bin/codex"),
            PathBuf::from("/usr/local/bin/codex"),
            PathBuf::from(format!("{}/.npm-global/bin/codex", home)),
            PathBuf::from(format!("{}/node_modules/.bin/codex", home)),
            PathBuf::from(format!("{}/.nvm/versions/node/*/bin/codex", home)),
            PathBuf::from("./node_modules/.bin/codex"),
        ]);
    }

    for candidate in candidates {
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    #[cfg(windows)]
    if let Some(path) = find_cli_via_npm_prefix("codex") {
        return Ok(path);
    }

    Err("Codex CLI not found. Install with: npm install -g @openai/codex".to_string())
}

fn find_cli(cli_type: &CliType) -> Result<PathBuf, String> {
    match cli_type {
        CliType::Claude => find_claude_cli(),
        CliType::Codex => find_codex_cli(),
    }
}

impl AgentProcess {
    pub fn new(
        id: String,
        working_dir: String,
        app_handle: AppHandle,
        model: String,
        thinking_enabled: bool,
        reasoning_effort: String,
        mcp_servers: Vec<String>,
        cli_type: CliType,
        specialty: AgentSpecialty,
        initial_session_id: Option<String>,
    ) -> Result<Self, String> {
        // Verify CLI exists
        find_cli(&cli_type)?;

        Ok(Self {
            id,
            working_dir,
            model,
            thinking_enabled,
            reasoning_effort,
            specialty,
            mcp_servers,
            cli_type,
            session_id: Arc::new(Mutex::new(initial_session_id)),
            current_child: Arc::new(Mutex::new(None)),
            images_sent_count: Arc::new(Mutex::new(0)),
            app_handle,
        })
    }

    pub fn send_message(&self, message: &str, images: &[String]) -> Result<(), String> {
        let cli_path = find_cli(&self.cli_type)?;

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

        // Build command args based on CLI type
        let (args, cli_name, prompt_for_stdin) = match self.cli_type {
            CliType::Claude => {
                // Build the prompt with embedded image paths and metadata for Claude
                let prompt = if images.is_empty() {
                    message.to_string()
                } else {
                    // Get current image count and update it
                    let (previous_count, new_total) = {
                        let mut count_guard = self.images_sent_count.lock().map_err(|e| e.to_string())?;
                        let prev = *count_guard;
                        let new_count = images.len() as u32;
                        *count_guard = prev + new_count;
                        (prev, prev + new_count)
                    };

                    // Use @-prefixed paths on their own lines so the Claude CLI can reliably
                    // detect and attach images (especially on Windows).
                    let image_list: Vec<String> = images
                        .iter()
                        .map(|path| {
                            let display_path = if cfg!(windows) {
                                path.replace('\\', "/")
                            } else {
                                path.clone()
                            };
                            format!("@{}", display_path)
                        })
                        .collect();

                    // Format with clear metadata to help Claude distinguish new vs old images
                    if previous_count == 0 {
                        format!(
                            "=== NEW IMAGE(S) ATTACHED TO THIS MESSAGE ===\n\
                            Images in this message: {}\n\
                            {}\n\
                            ==============================================\n\n\
                            {}",
                            images.len(),
                            image_list.join("\n"),
                            message
                        )
                    } else {
                        format!(
                            "=== NEW IMAGE(S) ATTACHED TO THIS MESSAGE ===\n\
                            Images in this message: {} (new)\n\
                            Total images in session: {} (images #1-{} were in previous messages)\n\
                            New image(s):\n\
                            {}\n\
                            ==============================================\n\n\
                            {}",
                            images.len(),
                            new_total,
                            previous_count,
                            image_list.join("\n"),
                            message
                        )
                    }
                };

                // Build Claude CLI args
                let session_id_opt = self.session_id.lock().map_err(|e| e.to_string())?.clone();

                // On Windows, passing large prompts (or system prompts) via argv can hit the
                // cmd.exe command-line length limit when the CLI is installed as a `.cmd` shim.
                // To avoid this, always send the prompt via stdin.
                #[cfg(windows)]
                let prompt = if self.specialty == AgentSpecialty::RobloxBuilder && session_id_opt.is_none() {
                    format!("{}\n\n---\n\n{}", ROBLOX_BUILDER_SYSTEM_PROMPT, prompt)
                } else {
                    prompt
                };

                #[cfg(not(windows))]
                let prompt = prompt;

                let prompt_for_stdin = Some(prompt);

                let mut args = vec![
                    "-p".to_string(),
                    "--output-format".to_string(),
                    "stream-json".to_string(),
                    "--input-format".to_string(),
                    "text".to_string(),
                    "--verbose".to_string(),
                    "--dangerously-skip-permissions".to_string(),
                ];

                // Add model selection
                args.push("--model".to_string());
                args.push(self.model.clone());

                // Add specialty system prompt if configured
                #[cfg(not(windows))]
                if self.specialty == AgentSpecialty::RobloxBuilder && session_id_opt.is_none() {
                    args.push("--system-prompt".to_string());
                    args.push(ROBLOX_BUILDER_SYSTEM_PROMPT.to_string());
                }

                // Enable/disable extended thinking via CLI settings
                if self.thinking_enabled {
                    args.push("--settings".to_string());
                    args.push(r#"{"alwaysThinkingEnabled": true}"#.to_string());
                }

                if let Some(ref sid) = session_id_opt {
                    args.push("--resume".to_string());
                    args.push(sid.clone());
                }

                // Add MCP server configuration if any servers are enabled
                if !self.mcp_servers.is_empty() {
                    let mut mcp_servers_obj = serde_json::Map::new();

                    for server_id in &self.mcp_servers {
                        let Some(npm_package) = get_mcp_server_package(server_id) else {
                            eprintln!("[AgentProcess] Unknown MCP server id ignored: {}", server_id);
                            continue;
                        };

                        let mut server_cfg = serde_json::Map::new();
                        server_cfg.insert(
                            "command".to_string(),
                            serde_json::Value::String("npx".to_string()),
                        );
                        server_cfg.insert(
                            "args".to_string(),
                            serde_json::json!(["-y", npm_package]),
                        );

                        // Optional env injection for known servers
                        if server_id == "brave-search" {
                            if let Ok(key) = env::var("BRAVE_API_KEY") {
                                server_cfg.insert(
                                    "env".to_string(),
                                    serde_json::json!({ "BRAVE_API_KEY": key }),
                                );
                            }
                        }

                        mcp_servers_obj.insert(server_id.clone(), serde_json::Value::Object(server_cfg));
                    }

                    if !mcp_servers_obj.is_empty() {
                        let mcp_config = serde_json::Value::Object({
                            let mut root = serde_json::Map::new();
                            root.insert(
                                "mcpServers".to_string(),
                                serde_json::Value::Object(mcp_servers_obj),
                            );
                            root
                        });

                        args.push("--mcp-config".to_string());
                        args.push(mcp_config.to_string());
                        args.push("--strict-mcp-config".to_string());

                        eprintln!("[AgentProcess] MCP servers enabled: {:?}", self.mcp_servers);
                    }
                }

                (args, "claude", prompt_for_stdin)
            }
            CliType::Codex => {
                // Build Codex CLI args
                // Check if we have a session ID for continuation
                let session_id_opt = self.session_id.lock().map_err(|e| e.to_string())?.clone();
                let prompt = if session_id_opt.is_none() && self.specialty == AgentSpecialty::RobloxBuilder {
                    format!("{}\n\n---\n\n{}", ROBLOX_BUILDER_SYSTEM_PROMPT, message)
                } else {
                    message.to_string()
                };
                let prompt_for_stdin = Some(prompt);

                // Codex CLI structure: codex exec [OPTIONS] <PROMPT>
                // or: codex exec resume [OPTIONS] <SESSION_ID> <PROMPT>
                // Options must come after exec/exec resume.
                let mut args = if let Some(ref sid) = session_id_opt {
                    vec![
                        "exec".to_string(),
                        "resume".to_string(),
                        "--ask-for-approval".to_string(),
                        "never".to_string(),
                        "--sandbox".to_string(),
                        "workspace-write".to_string(),
                        "--json".to_string(),
                        "--skip-git-repo-check".to_string(),
                        "--model".to_string(),
                        self.model.clone(),
                        sid.clone(),
                        "-".to_string(),
                    ]
                } else {
                    vec![
                        "exec".to_string(),
                        "--ask-for-approval".to_string(),
                        "never".to_string(),
                        "--sandbox".to_string(),
                        "workspace-write".to_string(),
                        "--json".to_string(),
                        "--skip-git-repo-check".to_string(),
                        "--model".to_string(),
                        self.model.clone(),
                        "-".to_string(),
                    ]
                };

                // Add reasoning effort via config flag for models that support it
                // GPT-5.x models and o-series models all support reasoning effort
                let supports_reasoning = self.model.starts_with("gpt-5")
                    || self.model.starts_with("o3")
                    || self.model.starts_with("o4");
                if supports_reasoning && !self.reasoning_effort.is_empty() {
                    let insert_pos = if session_id_opt.is_some() {
                        args.len() - 2 // before session_id and prompt
                    } else {
                        args.len() - 1 // before prompt
                    };
                    args.insert(insert_pos, "-c".to_string());
                    args.insert(
                        insert_pos + 1,
                        format!("model_reasoning_effort=\"{}\"", self.reasoning_effort),
                    );
                }

                // Add MCP server configuration if any servers are enabled.
                // Codex expects MCP servers via config overrides (TOML), not Claude's `--mcp-config` JSON.
                if !self.mcp_servers.is_empty() {
                    let insert_pos = if session_id_opt.is_some() { args.len() - 2 } else { args.len() - 1 };
                    let overrides = build_codex_mcp_overrides(&self.mcp_servers);
                    for kv in overrides.into_iter().rev() {
                        args.insert(insert_pos, kv);
                        args.insert(insert_pos, "-c".to_string());
                    }
                }

                // Add images via -i flag for Codex
                for img_path in images {
                    let insert_pos = if session_id_opt.is_some() {
                        args.len() - 2
                    } else {
                        args.len() - 1
                    };
                    args.insert(insert_pos, "-i".to_string());
                    args.insert(insert_pos + 1, img_path.clone());
                }

                (args, "codex", prompt_for_stdin)
            }
        };

        // Log the command being executed for debugging
        eprintln!("[AgentProcess] Executing {} CLI: {} {:?}", cli_name, cli_path.display(), args);

        let mut cmd = {
            #[cfg(windows)]
            {
                let mut resolved_cli = cli_path.clone();
                if resolved_cli.extension().is_none() {
                    let cmd = resolved_cli.with_extension("cmd");
                    if cmd.exists() {
                        resolved_cli = cmd;
                    } else {
                        let ps1 = resolved_cli.with_extension("ps1");
                        if ps1.exists() {
                            resolved_cli = ps1;
                        } else {
                            let bat = resolved_cli.with_extension("bat");
                            if bat.exists() {
                                resolved_cli = bat;
                            }
                        }
                    }
                }

                let ext = resolved_cli
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|e| e.to_ascii_lowercase());

                if matches!(ext.as_deref(), Some("cmd") | Some("bat")) {
                    let comspec = env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string());
                    let mut cmd = Command::new(comspec);
                    cmd.arg("/C").arg(&resolved_cli);
                    cmd
                } else if matches!(ext.as_deref(), Some("ps1")) {
                    let mut cmd = Command::new("powershell.exe");
                    cmd.args([
                        "-NoLogo",
                        "-NoProfile",
                        "-ExecutionPolicy",
                        "Bypass",
                        "-File",
                    ])
                    .arg(&resolved_cli);
                    cmd
                } else {
                    Command::new(&resolved_cli)
                }
            }

            #[cfg(not(windows))]
            {
                Command::new(&cli_path)
            }
        };
        cmd.current_dir(&self.working_dir)
            .args(&args)
            .stdin(if prompt_for_stdin.is_some() {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        // On Unix, put the spawned CLI into its own process group so "stop" can
        // terminate the full tree (e.g., `codex` Node wrapper + native binary).
        #[cfg(unix)]
        {
            use std::io;
            use std::os::unix::process::CommandExt;

            unsafe {
                cmd.pre_exec(|| {
                    if libc::setpgid(0, 0) == 0 {
                        Ok(())
                    } else {
                        Err(io::Error::last_os_error())
                    }
                });
            }
        }

        // Spawn the CLI process
        let mut child = match cmd.spawn()
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
                return Err(format!("Failed to spawn {} process: {}", cli_name, e));
            }
        };

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        if let Some(prompt) = prompt_for_stdin {
            if let Some(mut stdin) = child.stdin.take() {
                let _ = stdin.write_all(prompt.as_bytes());
                let _ = stdin.write_all(b"\n");
            }
        }

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

    /// Stop the current operation by killing the child process, but keep the agent alive.
    pub fn stop(&self) -> Result<(), String> {
        if let Ok(mut guard) = self.current_child.lock() {
            if let Some(ref mut child) = *guard {
                let pid = child.id();

                #[cfg(windows)]
                {
                    let _ = Command::new("taskkill")
                        .args(["/PID", &pid.to_string(), "/T", "/F"])
                        .output();
                }

                #[cfg(unix)]
                {
                    let pid_i32 = pid as i32;
                    // Best-effort: ask the whole process group to stop gracefully first.
                    unsafe {
                        let _ = libc::kill(-pid_i32, libc::SIGINT);
                        let _ = libc::kill(pid_i32, libc::SIGINT);
                    }

                    // Escalate to SIGKILL shortly after in case the CLI ignores SIGINT.
                    thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(800));
                        unsafe {
                            let _ = libc::kill(-pid_i32, libc::SIGKILL);
                            let _ = libc::kill(pid_i32, libc::SIGKILL);
                        }
                    });
                }

                // Fallback: If signals didn't work (or on platforms where we don't have process groups),
                // attempt to kill the immediate child.
                let _ = child.kill();
                *guard = None;

                let _ = self.app_handle.emit(
                    "agent-status",
                    AgentStatusChange {
                        agent_id: self.id.clone(),
                        status: AgentStatus::Idle,
                    },
                );
            }
        }
        Ok(())
    }

    pub fn kill(&mut self) -> Result<(), String> {
        if let Ok(mut guard) = self.current_child.lock() {
            if let Some(ref mut child) = *guard {
                #[cfg(windows)]
                {
                    let pid = child.id();
                    let _ = Command::new("taskkill")
                        .args(["/PID", &pid.to_string(), "/T", "/F"])
                        .output();
                }
                let _ = child.kill();
            }
            *guard = None;
        }
        Ok(())
    }

    pub fn update_settings(
        &mut self,
        model: Option<String>,
        thinking_enabled: Option<bool>,
        reasoning_effort: Option<String>,
        mcp_servers: Option<Vec<String>>,
    ) {
        if let Some(m) = model {
            self.model = m;
        }
        if let Some(t) = thinking_enabled {
            self.thinking_enabled = t;
        }
        if let Some(r) = reasoning_effort {
            self.reasoning_effort = r;
        }
        if let Some(servers) = mcp_servers {
            self.mcp_servers = servers;
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
