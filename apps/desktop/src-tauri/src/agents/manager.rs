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
    ) -> Result<(), String> {
        if self.agents.contains_key(&id) {
            return Err("Agent with this ID already exists".to_string());
        }

        let agent = AgentProcess::new(id.clone(), working_dir, app_handle)?;
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
}
