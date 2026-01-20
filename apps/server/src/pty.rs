use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;
use tokio::sync::{broadcast, mpsc, Mutex};

/// Output from a terminal session
#[derive(Clone, Serialize, Debug)]
pub struct TerminalOutput {
    pub terminal_id: String,
    pub data: String,
}

/// Terminal session that wraps a PTY
pub struct TerminalSession {
    pub id: String,
    pub working_dir: String,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    child: Arc<std::sync::Mutex<Box<dyn Child + Send>>>,
    _reader_handle: tokio::task::JoinHandle<()>,
    shutdown_tx: mpsc::Sender<()>,
}

impl TerminalSession {
    pub async fn write(&self, data: &[u8]) -> Result<(), String> {
        let mut writer = self.writer.lock().await;
        writer
            .write_all(data)
            .map_err(|e| format!("Failed to write to PTY: {}", e))?;
        writer
            .flush()
            .map_err(|e| format!("Failed to flush PTY: {}", e))?;
        Ok(())
    }

    pub async fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        let master = self.master.lock().await;
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to resize PTY: {}", e))?;
        tracing::debug!(
            "Resized terminal {} to {}x{}",
            self.id,
            cols,
            rows
        );
        Ok(())
    }
}

impl Drop for TerminalSession {
    fn drop(&mut self) {
        // Ensure child process is killed when session is dropped
        if let Ok(mut child) = self.child.lock() {
            if let Err(e) = child.kill() {
                tracing::debug!("Failed to kill child process on drop for terminal {}: {}", self.id, e);
            }
        }
    }
}

/// Manages multiple terminal sessions
pub struct TerminalManager {
    terminals: HashMap<String, TerminalSession>,
    broadcast_tx: broadcast::Sender<TerminalOutput>,
}

impl TerminalManager {
    pub fn new(broadcast_tx: broadcast::Sender<TerminalOutput>) -> Self {
        Self {
            terminals: HashMap::new(),
            broadcast_tx,
        }
    }

    pub fn create_terminal(
        &mut self,
        id: Option<&str>,
        working_dir: &str,
        cols: u16,
        rows: u16,
    ) -> Result<String, String> {
        let terminal_id = id
            .map(|s| s.to_string())
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

        tracing::info!(
            "Creating terminal {} in {} ({}x{})",
            terminal_id,
            working_dir,
            cols,
            rows
        );

        // Create PTY system
        let pty_system = native_pty_system();

        // Create PTY pair with specified size
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open PTY: {}", e))?;

        // Get the default shell
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());

        // Build command
        let mut cmd = CommandBuilder::new(&shell);
        cmd.cwd(working_dir);

        // Set environment variables for better terminal experience
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");

        // Spawn the shell in the PTY
        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn shell: {}", e))?;

        // Get reader and writer from master PTY
        let master = pair.master;
        let reader = master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone reader: {}", e))?;
        let writer = master
            .take_writer()
            .map_err(|e| format!("Failed to take writer: {}", e))?;

        // Create shutdown channel
        let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);

        // Clone for reader thread
        let broadcast_tx = self.broadcast_tx.clone();
        let tid = terminal_id.clone();

        // Spawn reader thread
        // Note: The reader.read() call is blocking. When the terminal is killed,
        // the PTY master will be dropped which causes the read to return EOF or error.
        // The shutdown_rx is a backup mechanism checked between reads.
        let reader_handle = tokio::task::spawn_blocking(move || {
            let mut reader = reader;
            let mut buf = [0u8; 4096];

            loop {
                match reader.read(&mut buf) {
                    Ok(0) => {
                        // EOF - terminal closed (shell exited or PTY closed)
                        tracing::info!("Terminal {} EOF", tid);
                        break;
                    }
                    Ok(n) => {
                        // Check for shutdown between reads
                        if shutdown_rx.try_recv().is_ok() {
                            tracing::info!("Terminal {} shutdown requested", tid);
                            break;
                        }

                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        let output = TerminalOutput {
                            terminal_id: tid.clone(),
                            data,
                        };
                        // Ignore send errors - means no subscribers
                        let _ = broadcast_tx.send(output);
                    }
                    Err(e) => {
                        // EAGAIN/EWOULDBLOCK means no data available (shouldn't happen with blocking read)
                        // EIO typically means the PTY was closed
                        if e.kind() == std::io::ErrorKind::WouldBlock {
                            // Brief sleep to prevent busy loop
                            std::thread::sleep(std::time::Duration::from_millis(10));
                            continue;
                        }
                        // Other errors mean the terminal is likely closed
                        tracing::debug!("Terminal {} read ended: {}", tid, e);
                        break;
                    }
                }
            }
        });

        let session = TerminalSession {
            id: terminal_id.clone(),
            working_dir: working_dir.to_string(),
            writer: Arc::new(Mutex::new(writer)),
            master: Arc::new(Mutex::new(master)),
            child: Arc::new(std::sync::Mutex::new(child)),
            _reader_handle: reader_handle,
            shutdown_tx,
        };

        self.terminals.insert(terminal_id.clone(), session);
        Ok(terminal_id)
    }

    pub fn kill_terminal(&mut self, id: &str) -> Result<(), String> {
        if let Some(session) = self.terminals.remove(id) {
            // Signal shutdown to reader thread
            let _ = session.shutdown_tx.try_send(());

            // Kill the child process
            if let Ok(mut child) = session.child.lock() {
                if let Err(e) = child.kill() {
                    tracing::warn!("Failed to kill child process for terminal {}: {}", id, e);
                } else {
                    tracing::info!("Child process for terminal {} killed", id);
                }
            }

            tracing::info!("Terminal {} killed", id);
            Ok(())
        } else {
            Err(format!("Terminal {} not found", id))
        }
    }

    pub fn get_terminal(&self, id: &str) -> Option<&TerminalSession> {
        self.terminals.get(id)
    }

    pub fn list_terminals(&self) -> Vec<(String, String)> {
        self.terminals
            .iter()
            .map(|(id, session)| (id.clone(), session.working_dir.clone()))
            .collect()
    }
}
