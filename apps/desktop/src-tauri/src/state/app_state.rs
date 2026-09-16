use crate::agents::AgentManager;
use std::sync::{Arc, Mutex};

pub struct AppState {
    pub agent_manager: Arc<Mutex<AgentManager>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            agent_manager: Arc::new(Mutex::new(AgentManager::new())),
        }
    }
}
