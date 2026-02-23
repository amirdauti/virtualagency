use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::env;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use tokio::sync::mpsc;

use crate::BroadcastMessage;

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
            tracing::warn!(
                "[AgentProcess] Unknown MCP server id ignored: {}",
                server_id
            );
            continue;
        };

        overrides.push(format!("mcp_servers.{server_id}.command=\"npx\""));
        overrides.push(format!(
            "mcp_servers.{server_id}.args=[\"-y\",\"{}\"]",
            toml_escape_string(npm_package)
        ));

        // Optional env injection for known servers
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

const ROBLOX_BUILDER_SYSTEM_PROMPT: &str =
    include_str!("../../../prompts/roblox_builder_system_prompt.txt");

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
pub struct UserMessageEvent {
    pub agent_id: String,
    pub message_id: String,
    pub content: String,
    #[serde(default)]
    pub images: Vec<String>,
    #[serde(default)]
    pub source: String,
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

fn find_on_path(cmd: &str) -> Option<PathBuf> {
    #[cfg(windows)]
    {
        fn ext_rank(p: &PathBuf) -> u8 {
            match p
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_ascii_lowercase())
            {
                Some(ref e) if e == "exe" => 0,
                Some(ref e) if e == "cmd" => 1,
                Some(ref e) if e == "bat" => 2,
                Some(ref e) if e == "ps1" => 3,
                _ => 10,
            }
        }

        fn search_dirs(cmd: &str, path_value: &str) -> Option<PathBuf> {
            const EXTS: [&str; 4] = ["exe", "cmd", "bat", "ps1"];

            for raw_dir in path_value.split(';') {
                let dir = raw_dir.trim().trim_matches('"');
                if dir.is_empty() {
                    continue;
                }
                let base = PathBuf::from(dir);
                for ext in EXTS {
                    let candidate = base.join(format!("{}.{}", cmd, ext));
                    if candidate.exists() {
                        return Some(candidate);
                    }
                }
            }
            None
        }

        fn registry_paths() -> Vec<String> {
            use winreg::enums::*;
            use winreg::RegKey;

            fn read_path(root: RegKey, subkey: &str) -> Option<String> {
                let key = root.open_subkey(subkey).ok()?;
                key.get_value::<String, _>("Path").ok()
            }

            let mut values = Vec::new();

            let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
            let hkcu = RegKey::predef(HKEY_CURRENT_USER);

            // Machine PATH
            if let Some(v) = read_path(
                hklm,
                r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment",
            ) {
                values.push(v);
            }
            // User PATH
            if let Some(v) = read_path(hkcu, r"Environment") {
                values.push(v);
            }

            values
        }

        // `where` is available on Windows. It returns one match per line.
        if let Ok(output) = Command::new("where").arg(cmd).output() {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let mut candidates: Vec<PathBuf> = stdout
                    .lines()
                    .map(|l| l.trim())
                    .filter(|l| !l.is_empty())
                    .map(PathBuf::from)
                    .collect();

                // Prefer executable shims on Windows.
                // npm typically installs CLIs as `*.cmd` and sometimes also `*.ps1`.
                candidates.sort_by_key(ext_rank);

                for candidate in candidates {
                    // Skip extensionless entries; they are often Unix shims that Windows can't execute.
                    if candidate.extension().is_none() {
                        continue;
                    }
                    return Some(candidate);
                }
            }
        }

        // Fallback: the process environment may not include the user PATH (e.g. if launched from MSI context).
        // Try searching the current PATH and then the registry PATH values.
        if let Ok(path) = env::var("PATH") {
            if let Some(found) = search_dirs(cmd, &path) {
                return Some(found);
            }
        }
        for path in registry_paths() {
            if let Some(found) = search_dirs(cmd, &path) {
                return Some(found);
            }
        }

        None
    }

    #[cfg(not(windows))]
    {
        // `which` is available on most Unix systems.
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
    let output = Command::new("npm").args(["prefix", "-g"]).output().ok()?;

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

#[cfg(windows)]
fn windows_user_profile_from_working_dir(working_dir: Option<&str>) -> Option<PathBuf> {
    let working_dir = working_dir?;
    let normalized = working_dir.replace('/', "\\");
    let parts: Vec<&str> = normalized.split('\\').filter(|p| !p.is_empty()).collect();
    if parts.len() >= 3 && parts[1].eq_ignore_ascii_case("users") {
        // e.g. ["C:", "Users", "nimbu", ...]
        return Some(PathBuf::from(format!("{}\\Users\\{}", parts[0], parts[2])));
    }
    if parts.len() >= 3 && parts[1].eq_ignore_ascii_case("documents and settings") {
        return Some(PathBuf::from(format!(
            "{}\\Documents and Settings\\{}",
            parts[0], parts[2]
        )));
    }
    None
}

#[cfg(windows)]
fn push_windows_user_profile_candidates(
    candidates: &mut Vec<PathBuf>,
    user_profile: &PathBuf,
    bin: &str,
) {
    let appdata = user_profile.join("AppData").join("Roaming");
    let localappdata = user_profile.join("AppData").join("Local");

    // npm (most common): %APPDATA%\npm\<bin>.cmd
    candidates.push(appdata.join("npm").join(format!("{}.cmd", bin)));
    candidates.push(appdata.join("npm").join(format!("{}.exe", bin)));

    // pnpm/yarn (best-effort)
    candidates.push(localappdata.join("pnpm").join(format!("{}.cmd", bin)));
    candidates.push(
        localappdata
            .join("Yarn")
            .join("bin")
            .join(format!("{}.cmd", bin)),
    );

    // bun (best-effort)
    candidates.push(
        user_profile
            .join(".bun")
            .join("bin")
            .join(format!("{}.exe", bin)),
    );
}

fn find_claude_cli(_working_dir_hint: Option<&str>) -> Result<PathBuf, String> {
    // First, try PATH lookup
    if let Some(path) = find_on_path("claude") {
        return Ok(path);
    }

    // Then try common install locations
    let mut candidates: Vec<PathBuf> = Vec::new();

    #[cfg(windows)]
    {
        // MSI custom actions can start the server with an environment that does not include the
        // interactive user's APPDATA/USERPROFILE. Use the agent working dir as a hint to find
        // per-user global npm installs (e.g. C:\Users\<user>\AppData\Roaming\npm\claude.cmd).
        if let Some(user_profile) = windows_user_profile_from_working_dir(_working_dir_hint) {
            push_windows_user_profile_candidates(&mut candidates, &user_profile, "claude");
        }

        if let Ok(appdata) = env::var("APPDATA") {
            let npm_bin = PathBuf::from(appdata).join("npm");
            candidates.push(npm_bin.join("claude.cmd"));
            candidates.push(npm_bin.join("claude.exe"));
        }
        if let Ok(local) = env::var("LOCALAPPDATA") {
            candidates.push(PathBuf::from(&local).join("pnpm").join("claude.cmd"));
            candidates.push(
                PathBuf::from(&local)
                    .join("Yarn")
                    .join("bin")
                    .join("claude.cmd"),
            );
        }
        if let Ok(user) = env::var("USERPROFILE") {
            candidates.push(
                PathBuf::from(user)
                    .join(".bun")
                    .join("bin")
                    .join("claude.exe"),
            );
        }
        candidates.push(
            PathBuf::from("node_modules")
                .join(".bin")
                .join("claude.cmd"),
        );
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

fn find_codex_cli(_working_dir_hint: Option<&str>) -> Result<PathBuf, String> {
    // First, try PATH lookup
    if let Some(path) = find_on_path("codex") {
        return Ok(path);
    }

    // Then try common install locations
    let mut candidates: Vec<PathBuf> = Vec::new();

    #[cfg(windows)]
    {
        if let Some(user_profile) = windows_user_profile_from_working_dir(_working_dir_hint) {
            push_windows_user_profile_candidates(&mut candidates, &user_profile, "codex");
        }

        if let Ok(appdata) = env::var("APPDATA") {
            let npm_bin = PathBuf::from(appdata).join("npm");
            candidates.push(npm_bin.join("codex.cmd"));
            candidates.push(npm_bin.join("codex.exe"));
        }
        if let Ok(local) = env::var("LOCALAPPDATA") {
            candidates.push(PathBuf::from(&local).join("pnpm").join("codex.cmd"));
            candidates.push(
                PathBuf::from(&local)
                    .join("Yarn")
                    .join("bin")
                    .join("codex.cmd"),
            );
        }
        if let Ok(user) = env::var("USERPROFILE") {
            candidates.push(
                PathBuf::from(user)
                    .join(".bun")
                    .join("bin")
                    .join("codex.exe"),
            );
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

fn find_cli(cli_type: &CliType, working_dir_hint: Option<&str>) -> Result<PathBuf, String> {
    match cli_type {
        CliType::Claude => find_claude_cli(working_dir_hint),
        CliType::Codex => find_codex_cli(working_dir_hint),
    }
}

pub struct AgentProcess {
    pub id: String,
    pub name: String,
    pub working_dir: String,
    pub model: String,
    pub thinking_enabled: bool,
    pub reasoning_effort: String, // For Codex: "low", "medium", "high"
    pub specialty: AgentSpecialty,
    pub mcp_servers: Vec<String>,
    pub cli_type: CliType,
    status: Arc<Mutex<AgentStatus>>,
    session_id: Arc<Mutex<Option<String>>>,
    current_child: Arc<Mutex<Option<Child>>>,
    images_sent_count: Arc<Mutex<u32>>,
    control_api_base_url: Option<String>,
    control_api_token: Option<String>,
    event_tx: mpsc::UnboundedSender<BroadcastMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentAutomation {
    pub id: String,
    pub task_description: String,
    pub prompt: String,
    pub interval_minutes: u32,
    pub enabled: bool,
    pub created_at_ms: u64,
    pub last_run_at_ms: Option<u64>,
    pub next_run_at_ms: u64,
}

fn default_persisted_reasoning_effort() -> String {
    "medium".to_string()
}

fn default_persisted_model() -> String {
    "sonnet".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedAgent {
    pub id: String,
    pub name: String,
    pub working_dir: String,
    #[serde(default = "default_persisted_model")]
    pub model: String,
    #[serde(default)]
    pub thinking_enabled: bool,
    #[serde(default = "default_persisted_reasoning_effort")]
    pub reasoning_effort: String,
    #[serde(default)]
    pub specialty: AgentSpecialty,
    #[serde(default)]
    pub mcp_servers: Vec<String>,
    #[serde(default)]
    pub cli_type: CliType,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub automations: Vec<AgentAutomation>,
}

#[derive(Debug, Clone)]
pub struct DueAutomationRun {
    pub agent_id: String,
    pub automation_id: String,
    pub task_description: String,
    pub prompt: String,
    pub scheduled_at_ms: u64,
}

impl AgentProcess {
    fn maybe_attach_control_plane_hint(&self, message: &str) -> String {
        if self.control_api_base_url.is_none() || self.control_api_token.is_none() {
            return message.to_string();
        }
        if message.contains("[SCHEDULED_TASK]") {
            return message.to_string();
        }

        let lower = message.to_ascii_lowercase();
        let wants_orchestration = [
            "create agent",
            "new agent",
            "spawn agent",
            "delegate",
            "schedule",
            "scheduled",
            "automation",
            "recurring",
            "project manager",
            "project management",
            "other agent",
            "telegram",
            "assign",
        ]
        .iter()
        .any(|needle| lower.contains(needle));

        if !wants_orchestration {
            return message.to_string();
        }

        format!(
            "{}\n\n[Virtual Agency Control Plane]\nUse bash + curl for orchestration:\n- List agents: GET $VA_CONTROL_BASE_URL/api/agent-tools/$VA_AGENT_ID/agents\n- Create agent: POST $VA_CONTROL_BASE_URL/api/agent-tools/$VA_AGENT_ID/create-agent\n- Delegate one task and wait for completion (default): POST $VA_CONTROL_BASE_URL/api/agent-tools/$VA_AGENT_ID/message-agent\n- Delegate to many agents (parallel supported): POST $VA_CONTROL_BASE_URL/api/agent-tools/$VA_AGENT_ID/delegate-many\n- Set Telegram on another agent: POST $VA_CONTROL_BASE_URL/api/agent-tools/$VA_AGENT_ID/set-telegram\n- Publish a local app port and get a share URL: POST $VA_CONTROL_BASE_URL/api/agent-tools/$VA_AGENT_ID/publish-app\n- List scheduled tasks: GET $VA_CONTROL_BASE_URL/api/agent-tools/$VA_AGENT_ID/scheduled-tasks?target_agent_id=<agent_id>\n- Create/update scheduled task: POST $VA_CONTROL_BASE_URL/api/agent-tools/$VA_AGENT_ID/set-scheduled-task\n- Delete scheduled task: POST $VA_CONTROL_BASE_URL/api/agent-tools/$VA_AGENT_ID/delete-scheduled-task\nInclude header: x-va-agent-token: $VA_CONTROL_TOKEN.\nFor create-agent, collect from user first: cli_type (claude/codex), name, and working_dir.\nFor publish-app, collect target_agent_id and local_port first.\nFor set-scheduled-task, collect target_agent_id, task_description, prompt, and interval_minutes first.\nBefore replying to the end user, wait for delegated tasks to complete and include what was done.\n",
            message
        )
    }

    pub fn new(
        id: String,
        name: String,
        working_dir: String,
        model: String,
        thinking_enabled: bool,
        reasoning_effort: String,
        specialty: AgentSpecialty,
        mcp_servers: Vec<String>,
        cli_type: CliType,
        control_api_base_url: Option<String>,
        control_api_token: Option<String>,
        event_tx: mpsc::UnboundedSender<BroadcastMessage>,
        initial_session_id: Option<String>,
    ) -> Result<Self, String> {
        find_cli(&cli_type, Some(&working_dir))?;

        Ok(Self {
            id,
            name,
            working_dir,
            model,
            thinking_enabled,
            reasoning_effort,
            specialty,
            mcp_servers,
            cli_type,
            status: Arc::new(Mutex::new(AgentStatus::Idle)),
            session_id: Arc::new(Mutex::new(initial_session_id)),
            current_child: Arc::new(Mutex::new(None)),
            images_sent_count: Arc::new(Mutex::new(0)),
            control_api_base_url,
            control_api_token,
            event_tx,
        })
    }

    fn emit_status(&self, status: AgentStatus) {
        if let Ok(mut guard) = self.status.lock() {
            *guard = status.clone();
        }
        let _ = self
            .event_tx
            .send(BroadcastMessage::AgentStatus(AgentStatusChange {
                agent_id: self.id.clone(),
                status,
            }));
    }

    pub fn get_status(&self) -> AgentStatus {
        self.status
            .lock()
            .map(|s| s.clone())
            .unwrap_or(AgentStatus::Error)
    }

    pub fn get_session_id(&self) -> Option<String> {
        self.session_id.lock().ok().and_then(|s| s.clone())
    }

    pub fn send_message(&self, message: &str, images: &[String]) -> Result<(), String> {
        let cli_path = find_cli(&self.cli_type, Some(&self.working_dir))?;
        let message_with_hint = self.maybe_attach_control_plane_hint(message);

        if !images.is_empty() {
            tracing::debug!(
                "[AgentProcess] Received {} image(s): {:?}",
                images.len(),
                images
            );
        }

        // Emit thinking status
        self.emit_status(AgentStatus::Thinking);

        // Build command args based on CLI type
        let (args, cli_name, prompt_for_stdin) = match self.cli_type {
            CliType::Claude => {
                // Build the prompt with embedded image paths and metadata for Claude
                let prompt = if images.is_empty() {
                    message_with_hint.clone()
                } else {
                    // Get current image count and update it
                    let (previous_count, new_total) = {
                        let mut count_guard =
                            self.images_sent_count.lock().map_err(|e| e.to_string())?;
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
                            message_with_hint
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
                            message_with_hint
                        )
                    }
                };

                // On Windows, passing large prompts (or system prompts) via argv can hit the
                // cmd.exe command-line length limit when the CLI is installed as a `.cmd` shim.
                // To avoid this, always send the prompt via stdin.
                let session_id_opt = self.session_id.lock().map_err(|e| e.to_string())?.clone();
                let prompt = if self.specialty == AgentSpecialty::RobloxBuilder
                    && session_id_opt.is_none()
                {
                    format!("{}\n\n---\n\n{}", ROBLOX_BUILDER_SYSTEM_PROMPT, prompt)
                } else {
                    prompt
                };
                let prompt_for_stdin = Some(prompt);

                // Build Claude CLI args
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
                            tracing::warn!(
                                "[AgentProcess] Unknown MCP server id ignored: {}",
                                server_id
                            );
                            continue;
                        };

                        let mut server_cfg = serde_json::Map::new();
                        server_cfg.insert(
                            "command".to_string(),
                            serde_json::Value::String("npx".to_string()),
                        );
                        server_cfg
                            .insert("args".to_string(), serde_json::json!(["-y", npm_package]));

                        // Optional env injection for known servers
                        if server_id == "brave-search" {
                            if let Ok(key) = env::var("BRAVE_API_KEY") {
                                server_cfg.insert(
                                    "env".to_string(),
                                    serde_json::json!({ "BRAVE_API_KEY": key }),
                                );
                            }
                        }

                        mcp_servers_obj
                            .insert(server_id.clone(), serde_json::Value::Object(server_cfg));
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

                        tracing::info!(
                            "[AgentProcess] MCP servers enabled: {:?}",
                            self.mcp_servers
                        );
                    }
                }

                (args, "claude", prompt_for_stdin)
            }
            CliType::Codex => {
                // Build Codex CLI args
                // Check if we have a session ID for continuation
                let session_id_opt = self.session_id.lock().map_err(|e| e.to_string())?.clone();
                let prompt = if session_id_opt.is_none()
                    && self.specialty == AgentSpecialty::RobloxBuilder
                {
                    format!(
                        "{}\n\n---\n\n{}",
                        ROBLOX_BUILDER_SYSTEM_PROMPT, message_with_hint
                    )
                } else {
                    message_with_hint
                };
                let prompt_for_stdin = Some(prompt);

                // Codex CLI structure: codex exec [OPTIONS] <PROMPT>
                // or: codex exec resume [OPTIONS] <SESSION_ID> <PROMPT>
                // Options must come AFTER exec/exec resume, not before
                let mut args = if let Some(ref sid) = session_id_opt {
                    // Codex resume: codex exec resume [OPTIONS] <session_id> <prompt>
                    vec![
                        "exec".to_string(),
                        "resume".to_string(),
                        "--dangerously-bypass-approvals-and-sandbox".to_string(),
                        "--skip-git-repo-check".to_string(),
                        "--json".to_string(),
                        "--model".to_string(),
                        self.model.clone(),
                        sid.clone(),
                        "-".to_string(),
                    ]
                } else {
                    // Codex new session: codex exec [OPTIONS] <prompt>
                    vec![
                        "exec".to_string(),
                        "--dangerously-bypass-approvals-and-sandbox".to_string(),
                        "--skip-git-repo-check".to_string(),
                        "--json".to_string(),
                        "--model".to_string(),
                        self.model.clone(),
                        "-".to_string(),
                    ]
                };

                // For options that need to come before the prompt, we need to insert them
                // before the last element (the prompt) and session_id if present

                // Add reasoning effort via config flag for models that support it
                // GPT-5.x models and o-series models all support reasoning effort
                let supports_reasoning = self.model.starts_with("gpt-5")
                    || self.model.starts_with("o3")
                    || self.model.starts_with("o4");
                if supports_reasoning && !self.reasoning_effort.is_empty() {
                    // Insert before prompt (last element) or before session_id+prompt (last 2 elements for resume)
                    let insert_pos = if session_id_opt.is_some() {
                        args.len() - 2 // Before session_id and prompt
                    } else {
                        args.len() - 1 // Before prompt
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
                    let insert_pos = if session_id_opt.is_some() {
                        args.len() - 2
                    } else {
                        args.len() - 1
                    };
                    let overrides = build_codex_mcp_overrides(&self.mcp_servers);
                    for kv in overrides.into_iter().rev() {
                        args.insert(insert_pos, kv);
                        args.insert(insert_pos, "-c".to_string());
                    }
                }

                // Add images via -i flag for Codex (before prompt)
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

        tracing::debug!(
            "[AgentProcess] Executing {} CLI: {} {:?}",
            cli_name,
            cli_path.display(),
            args
        );

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

        if let Some(base_url) = &self.control_api_base_url {
            cmd.env("VA_CONTROL_BASE_URL", base_url);
        }
        if let Some(token) = &self.control_api_token {
            cmd.env("VA_CONTROL_TOKEN", token);
        }
        cmd.env("VA_AGENT_ID", &self.id);

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

        let mut child = match cmd.spawn() {
            Ok(child) => child,
            Err(e) => {
                self.emit_status(AgentStatus::Error);
                return Err(format!("Failed to spawn {} process: {}", cli_name, e));
            }
        };

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        if let Some(prompt) = prompt_for_stdin {
            if let Some(mut stdin) = child.stdin.take() {
                use std::io::Write;
                let _ = stdin.write_all(prompt.as_bytes());
                let _ = stdin.write_all(b"\n");
            }
        }

        if let Ok(mut guard) = self.current_child.lock() {
            *guard = Some(child);
        }

        // Spawn stdout reader thread
        if let Some(stdout_handle) = stdout {
            let agent_id = self.id.clone();
            let tx = self.event_tx.clone();
            let session_id_arc = Arc::clone(&self.session_id);
            let status_arc = Arc::clone(&self.status);

            thread::spawn(move || {
                let reader = BufReader::new(stdout_handle);
                for line in reader.lines() {
                    match line {
                        Ok(data) => {
                            // Parse JSON to extract session/thread id and status
                            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&data) {
                                // Claude: `session_id`
                                // Codex: `thread_id` (used for `codex exec resume <id>`)
                                if let Some(sid) = json
                                    .get("session_id")
                                    .or_else(|| json.get("thread_id"))
                                    .and_then(|v| v.as_str())
                                {
                                    if let Ok(mut guard) = session_id_arc.lock() {
                                        if guard.is_none() {
                                            *guard = Some(sid.to_string());
                                        }
                                    }
                                }

                                if let Some(msg_type) = json.get("type").and_then(|v| v.as_str()) {
                                    let status = match msg_type {
                                        "assistant"
                                        | "content_block_delta"
                                        | "content_block_start" => Some(AgentStatus::Working),
                                        // Codex JSONL events
                                        "turn.started" | "item.started" | "item.completed" => {
                                            Some(AgentStatus::Working)
                                        }
                                        "turn.completed" => Some(AgentStatus::Idle),
                                        "turn.failed" => Some(AgentStatus::Error),
                                        "result" => {
                                            if let Some(sid) = json
                                                .get("session_id")
                                                .or_else(|| json.get("thread_id"))
                                                .and_then(|v| v.as_str())
                                            {
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
                                        if let Ok(mut guard) = status_arc.lock() {
                                            *guard = s.clone();
                                        }
                                        let _ = tx.send(BroadcastMessage::AgentStatus(
                                            AgentStatusChange {
                                                agent_id: agent_id.clone(),
                                                status: s,
                                            },
                                        ));
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

                if let Ok(mut guard) = status_arc.lock() {
                    *guard = AgentStatus::Idle;
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
            let tx = self.event_tx.clone();

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
                let pid = child.id();

                #[cfg(windows)]
                {
                    // If we spawned via `cmd.exe /C` (or any wrapper), killing only the parent process
                    // may leave the real CLI (node/codex) running. Use taskkill to terminate the tree.
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
                // Emit idle status after stopping
                self.emit_status(AgentStatus::Idle);
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
        if let Some(s) = mcp_servers {
            self.mcp_servers = s;
        }
    }

    pub fn get_settings(&self) -> (String, bool, Vec<String>) {
        (
            self.model.clone(),
            self.thinking_enabled,
            self.mcp_servers.clone(),
        )
    }
}

impl Drop for AgentProcess {
    fn drop(&mut self) {
        let _ = self.kill();
    }
}

pub struct AgentManager {
    agents: HashMap<String, AgentProcess>,
    automations: HashMap<String, Vec<AgentAutomation>>,
    control_api_base_url: Option<String>,
    control_api_token: Option<String>,
    event_tx: mpsc::UnboundedSender<BroadcastMessage>,
}

impl AgentManager {
    pub fn new(event_tx: mpsc::UnboundedSender<BroadcastMessage>) -> Self {
        Self {
            agents: HashMap::new(),
            automations: HashMap::new(),
            control_api_base_url: None,
            control_api_token: None,
            event_tx,
        }
    }

    pub fn configure_control_plane(&mut self, base_url: String, token: String) {
        self.control_api_base_url = Some(base_url);
        self.control_api_token = Some(token);
    }

    pub fn create_agent(
        &mut self,
        id: Option<&str>,
        name: &str,
        working_dir: &str,
        model: &str,
        thinking_enabled: bool,
        reasoning_effort: &str,
        specialty: AgentSpecialty,
        mcp_servers: Vec<String>,
        cli_type: CliType,
        session_id: Option<String>,
    ) -> Result<String, String> {
        // Use provided ID or generate a new one
        let id = id
            .map(|s| s.to_string())
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

        // Idempotency: if an agent with this ID already exists, do not replace it.
        // This prevents killing long-running agents when the UI reloads and rehydrates state.
        if self.agents.contains_key(&id) {
            tracing::info!(
                "[AgentManager] Agent {} already exists; skipping create",
                id
            );
            return Ok(id);
        }

        if session_id.is_some() {
            tracing::info!("[AgentManager] Creating agent {} with existing session ID for conversation resumption", id);
        }

        let agent = AgentProcess::new(
            id.clone(),
            name.to_string(),
            working_dir.to_string(),
            model.to_string(),
            thinking_enabled,
            reasoning_effort.to_string(),
            specialty,
            mcp_servers,
            cli_type,
            self.control_api_base_url.clone(),
            self.control_api_token.clone(),
            self.event_tx.clone(),
            session_id,
        )?;
        self.agents.insert(id.clone(), agent);
        Ok(id)
    }

    pub fn snapshot_persisted_agents(&self) -> Vec<PersistedAgent> {
        self.agents
            .iter()
            .map(|(id, agent)| PersistedAgent {
                id: id.clone(),
                name: agent.name.clone(),
                working_dir: agent.working_dir.clone(),
                model: agent.model.clone(),
                thinking_enabled: agent.thinking_enabled,
                reasoning_effort: agent.reasoning_effort.clone(),
                specialty: agent.specialty.clone(),
                mcp_servers: agent.mcp_servers.clone(),
                cli_type: agent.cli_type.clone(),
                session_id: agent.get_session_id(),
                automations: self.automations.get(id).cloned().unwrap_or_default(),
            })
            .collect()
    }

    pub fn restore_persisted_agents(
        &mut self,
        persisted: Vec<PersistedAgent>,
    ) -> (Vec<String>, Vec<String>) {
        let mut restored_ids = Vec::new();
        let mut errors = Vec::new();

        for item in persisted {
            let create_result = self.create_agent(
                Some(&item.id),
                &item.name,
                &item.working_dir,
                &item.model,
                item.thinking_enabled,
                &item.reasoning_effort,
                item.specialty.clone(),
                item.mcp_servers.clone(),
                item.cli_type.clone(),
                item.session_id.clone(),
            );

            match create_result {
                Ok(id) => {
                    if item.automations.is_empty() {
                        self.automations.remove(&id);
                    } else {
                        self.automations
                            .insert(id.clone(), item.automations.clone());
                    }
                    restored_ids.push(id);
                }
                Err(err) => {
                    errors.push(format!("{}: {}", item.id, err));
                }
            }
        }

        (restored_ids, errors)
    }

    pub fn kill_agent(&mut self, id: &str) -> Result<(), String> {
        if let Some(mut agent) = self.agents.remove(id) {
            self.automations.remove(id);
            agent.kill()
        } else {
            Err(format!("Agent not found: {}", id))
        }
    }

    pub fn send_message(
        &self,
        id: &str,
        message: &str,
        images: &[String],
        message_id: Option<&str>,
        source: Option<&str>,
    ) -> Result<(), String> {
        if let Some(agent) = self.agents.get(id) {
            agent.send_message(message, images)?;

            let _ = self
                .event_tx
                .send(BroadcastMessage::UserMessage(UserMessageEvent {
                    agent_id: id.to_string(),
                    message_id: message_id
                        .map(str::to_string)
                        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
                    content: message.to_string(),
                    images: images.to_vec(),
                    source: source.unwrap_or("api").to_string(),
                }));

            Ok(())
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

    pub fn list_agents(
        &self,
    ) -> Vec<(
        String,
        String,
        String,
        String,
        bool,
        Vec<String>,
        CliType,
        AgentSpecialty,
    )> {
        self.agents
            .iter()
            .map(|(id, agent)| {
                let (model, thinking_enabled, mcp_servers) = agent.get_settings();
                (
                    id.clone(),
                    agent.name.clone(),
                    agent.working_dir.clone(),
                    model,
                    thinking_enabled,
                    mcp_servers,
                    agent.cli_type.clone(),
                    agent.specialty.clone(),
                )
            })
            .collect()
    }

    pub fn list_agents_snapshot(
        &self,
    ) -> Vec<(
        String,
        String,
        String,
        String,
        bool,
        Vec<String>,
        CliType,
        AgentSpecialty,
        AgentStatus,
        Option<String>,
    )> {
        self.agents
            .iter()
            .map(|(id, agent)| {
                let (model, thinking_enabled, mcp_servers) = agent.get_settings();
                (
                    id.clone(),
                    agent.name.clone(),
                    agent.working_dir.clone(),
                    model,
                    thinking_enabled,
                    mcp_servers,
                    agent.cli_type.clone(),
                    agent.specialty.clone(),
                    agent.get_status(),
                    agent.get_session_id(),
                )
            })
            .collect()
    }

    pub fn get_agent_runtime(&self, id: &str) -> Option<(AgentStatus, Option<String>)> {
        self.agents
            .get(id)
            .map(|agent| (agent.get_status(), agent.get_session_id()))
    }

    pub fn update_agent_settings(
        &mut self,
        id: &str,
        model: Option<String>,
        thinking_enabled: Option<bool>,
        reasoning_effort: Option<String>,
        mcp_servers: Option<Vec<String>>,
    ) -> Result<(), String> {
        if let Some(agent) = self.agents.get_mut(id) {
            agent.update_settings(model, thinking_enabled, reasoning_effort, mcp_servers);
            Ok(())
        } else {
            Err(format!("Agent not found: {}", id))
        }
    }

    pub fn has_agent(&self, id: &str) -> bool {
        self.agents.contains_key(id)
    }

    pub fn list_agent_automations(&self, id: &str) -> Result<Vec<AgentAutomation>, String> {
        if !self.agents.contains_key(id) {
            return Err(format!("Agent not found: {}", id));
        }
        Ok(self.automations.get(id).cloned().unwrap_or_default())
    }

    pub fn upsert_agent_automation(
        &mut self,
        id: &str,
        automation: AgentAutomation,
    ) -> Result<AgentAutomation, String> {
        if !self.agents.contains_key(id) {
            return Err(format!("Agent not found: {}", id));
        }

        let entries = self.automations.entry(id.to_string()).or_default();
        if let Some(existing) = entries.iter_mut().find(|entry| entry.id == automation.id) {
            *existing = automation.clone();
        } else {
            entries.push(automation.clone());
        }
        Ok(automation)
    }

    pub fn delete_agent_automation(
        &mut self,
        id: &str,
        automation_id: &str,
    ) -> Result<bool, String> {
        if !self.agents.contains_key(id) {
            return Err(format!("Agent not found: {}", id));
        }

        let Some(entries) = self.automations.get_mut(id) else {
            return Ok(false);
        };
        let previous_len = entries.len();
        entries.retain(|entry| entry.id != automation_id);
        Ok(entries.len() != previous_len)
    }

    pub fn collect_due_automation_runs(&mut self, now_ms: u64) -> Vec<DueAutomationRun> {
        let mut due = Vec::new();
        let agent_ids: Vec<String> = self.automations.keys().cloned().collect();

        for agent_id in agent_ids {
            let is_idle = self
                .agents
                .get(&agent_id)
                .map(|agent| matches!(agent.get_status(), AgentStatus::Idle))
                .unwrap_or(false);
            if !is_idle {
                continue;
            }

            let Some(entries) = self.automations.get_mut(&agent_id) else {
                continue;
            };

            for automation in entries.iter_mut() {
                if !automation.enabled || automation.interval_minutes == 0 {
                    continue;
                }
                if automation.next_run_at_ms > now_ms {
                    continue;
                }

                let interval_ms = (automation.interval_minutes as u64)
                    .saturating_mul(60_000)
                    .max(60_000);
                automation.last_run_at_ms = Some(now_ms);
                automation.next_run_at_ms = now_ms.saturating_add(interval_ms);

                due.push(DueAutomationRun {
                    agent_id: agent_id.clone(),
                    automation_id: automation.id.clone(),
                    task_description: automation.task_description.clone(),
                    prompt: automation.prompt.clone(),
                    scheduled_at_ms: now_ms,
                });
            }
        }

        due
    }
}
