use crate::agents::AgentManager;
use std::sync::Mutex;

pub struct AppState {
    pub agent_manager: Mutex<AgentManager>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            agent_manager: Mutex::new(AgentManager::new()),
        }
    }
}
