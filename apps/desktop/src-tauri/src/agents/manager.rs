use super::AgentProcess;
use std::collections::HashMap;
use tauri::AppHandle;

pub struct AgentManager {
    agents: HashMap<String, AgentProcess>,
}

impl AgentManager {
    pub fn new() -> Self {
        Self {
            agents: HashMap::new(),
        }
    }

    pub fn create_agent(
        &mut self,
        id: String,
        working_dir: String,
        app_handle: AppHandle,
        model: String,
        thinking_enabled: bool,
        session_id: Option<String>,
    ) -> Result<(), String> {
        if self.agents.contains_key(&id) {
            return Err("Agent with this ID already exists".to_string());
        }

        let agent = AgentProcess::new(id.clone(), working_dir, app_handle, model, thinking_enabled, session_id)?;
        self.agents.insert(id, agent);
        Ok(())
    }

    pub fn kill_agent(&mut self, id: &str) -> Result<(), String> {
        match self.agents.remove(id) {
            Some(mut agent) => {
                agent.kill()?;
                Ok(())
            }
            None => Err("Agent not found".to_string()),
        }
    }

    pub fn send_message(&self, id: &str, message: &str, images: &[String]) -> Result<(), String> {
        match self.agents.get(id) {
            Some(agent) => agent.send_message(message, images),
            None => Err("Agent not found".to_string()),
        }
    }

    pub fn list_agents(&self) -> Vec<String> {
        self.agents.keys().cloned().collect()
    }

    pub fn update_agent_settings(
        &mut self,
        id: &str,
        model: Option<String>,
        thinking_enabled: Option<bool>,
    ) -> Result<(), String> {
        match self.agents.get_mut(id) {
            Some(agent) => {
                agent.update_settings(model, thinking_enabled);
                Ok(())
            }
            None => Err("Agent not found".to_string()),
        }
    }

    pub fn get_agent_settings(&self, id: &str) -> Result<(String, bool), String> {
        match self.agents.get(id) {
            Some(agent) => Ok(agent.get_settings()),
            None => Err("Agent not found".to_string()),
        }
    }
}
