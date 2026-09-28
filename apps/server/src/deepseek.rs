//! DeepSeek uses Claude Code's Anthropic-compatible transport, with a separate
//! credential and session directory. Credentials never enter agent/workspace JSON.
use std::{env, fs, io::Write, path::PathBuf, process::Command};

pub const DEFAULT_MODEL: &str = "deepseek-flash[1m]";
pub const MODELS: &[&str] = &[DEFAULT_MODEL, "deepseek-v4-pro[1m]"];
pub const EFFORTS: &[&str] = &["low", "high", "max"];

pub fn directory() -> PathBuf {
    env::var_os("VA_DEEPSEEK_CONFIG_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            dirs::home_dir()
                .unwrap_or_default()
                .join(".virtual-agency/providers/deepseek")
        })
}

fn private_directory(path: &std::path::Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|_| "Could not create DeepSeek configuration directory")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|_| "Could not protect DeepSeek configuration directory")?;
    }
    Ok(())
}

pub fn key() -> Result<String, String> {
    let value = env::var("DEEPSEEK_API_KEY")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| fs::read_to_string(directory().join("api-key")).ok())
        .unwrap_or_default();
    let value = value.trim();
    if value.is_empty() {
        return Err("Add your DeepSeek API key in Settings → DeepSeek on this server.".into());
    }
    Ok(value.into())
}

pub fn externally_managed() -> bool {
    env::var("DEEPSEEK_API_KEY").is_ok_and(|s| !s.trim().is_empty())
}

pub fn save_key(value: &str) -> Result<(), String> {
    if externally_managed() {
        return Err("This server's key is managed by DEEPSEEK_API_KEY. Remove that environment setting to manage the key here.".into());
    }
    let value = value.trim();
    if value.len() < 10 || value.len() > 512 || value.chars().any(char::is_whitespace) {
        return Err("Enter a valid DeepSeek API key.".into());
    }
    let dir = directory();
    private_directory(&dir)?;
    let temp = dir.join(format!(".key-{}", uuid::Uuid::new_v4()));
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let result = (|| {
        let mut file = options
            .open(&temp)
            .map_err(|_| "Could not save DeepSeek key")?;
        file.write_all(value.as_bytes())
            .map_err(|_| "Could not save DeepSeek key")?;
        file.sync_all().map_err(|_| "Could not save DeepSeek key")?;
        fs::rename(&temp, dir.join("api-key")).map_err(|_| "Could not replace DeepSeek key")
    })();
    let _ = fs::remove_file(temp);
    result.map_err(String::from)
}

pub fn remove_key() -> Result<(), String> {
    if externally_managed() {
        return Err("Remove DEEPSEEK_API_KEY from this server's environment to disconnect.".into());
    }
    match fs::remove_file(directory().join("api-key")) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("Could not remove DeepSeek key".into()),
    }
}

pub fn validate(model: &str, effort: &str) -> Result<(), String> {
    if !MODELS.contains(&model) {
        return Err("Choose DeepSeek 4.1 Flash or DeepSeek V4 Pro.".into());
    }
    if !EFFORTS.contains(&effort) {
        return Err("DeepSeek reasoning supports low, high, or max.".into());
    }
    Ok(())
}

pub fn configure(
    command: &mut Command,
    model: &str,
    effort: &str,
    thinking: bool,
    control_url: &str,
    control_token: &str,
    agent_id: &str,
) -> Result<(), String> {
    validate(model, effort)?;
    key()?;
    let profile = directory().join("claude");
    private_directory(&profile)?;
    for name in [
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_AUTH_TOKEN",
        "CLAUDE_CODE_OAUTH_TOKEN",
        "CLAUDE_CODE_USE_BEDROCK",
        "CLAUDE_CODE_USE_VERTEX",
        "CLAUDE_CODE_USE_FOUNDRY",
        "DEEPSEEK_API_KEY",
        "MAX_THINKING_TOKENS",
    ] {
        command.env_remove(name);
    }
    command
        .env(
            "ANTHROPIC_BASE_URL",
            format!(
                "{}/api/agent-tools/{}/deepseek",
                control_url.trim_end_matches('/'),
                agent_id
            ),
        )
        .env("ANTHROPIC_AUTH_TOKEN", control_token)
        .env(
            "ANTHROPIC_CUSTOM_HEADERS",
            format!(
                "x-va-agent-token: {}\nx-va-thinking-enabled: {}\nx-va-reasoning-effort: {}",
                control_token, thinking, effort
            ),
        )
        .env("CLAUDE_CONFIG_DIR", profile)
        .env("ANTHROPIC_MODEL", model)
        .env("ANTHROPIC_DEFAULT_OPUS_MODEL", model)
        .env("ANTHROPIC_DEFAULT_SONNET_MODEL", model)
        .env("ANTHROPIC_DEFAULT_HAIKU_MODEL", "deepseek-flash")
        .env("CLAUDE_CODE_SUBAGENT_MODEL", model)
        .env("CLAUDE_CODE_EFFORT_LEVEL", effort)
        .env("CLAUDE_CODE_AUTO_COMPACT_WINDOW", "786432");
    if !thinking {
        command.env("MAX_THINKING_TOKENS", "0");
    }
    Ok(())
}

// Claude omits `thinking` when disabled; DeepSeek defaults an omitted field to
// enabled. Normalize both controls at the server boundary, including subagents.
pub fn apply_reasoning(
    body: &mut serde_json::Value,
    thinking: bool,
    effort: &str,
) -> Result<(), String> {
    if !EFFORTS.contains(&effort) || !body.is_object() {
        return Err("Invalid DeepSeek request settings".into());
    }
    body["thinking"] = if thinking {
        serde_json::json!({"type": "enabled", "budget_tokens": 32000})
    } else {
        serde_json::json!({"type": "disabled"})
    };
    if !body.get("output_config").is_some_and(|v| v.is_object()) {
        body["output_config"] = serde_json::json!({});
    }
    body["output_config"]["effort"] = effort.into();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn model_and_effort_are_provider_specific() {
        assert!(validate(DEFAULT_MODEL, "max").is_ok());
        assert!(validate("sonnet", "max").is_err());
        assert!(validate(DEFAULT_MODEL, "ultra").is_err());
    }

    #[test]
    fn omitted_thinking_is_explicitly_disabled_without_losing_output_options() {
        let mut body = serde_json::json!({"model":"deepseek-flash", "output_config":{"format":{"type":"json_schema"}}});
        apply_reasoning(&mut body, false, "high").unwrap();
        assert_eq!(body["thinking"]["type"], "disabled");
        assert_eq!(body["output_config"]["effort"], "high");
        assert_eq!(body["output_config"]["format"]["type"], "json_schema");
        apply_reasoning(&mut body, true, "max").unwrap();
        assert_eq!(body["thinking"]["type"], "enabled");
        assert_eq!(body["output_config"]["effort"], "max");
    }
}
