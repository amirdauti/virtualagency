//! Persistent Codex app-server transport. The protocol is the installed 0.154
//! JSON-RPC schema; no model requests are made by the protocol tests below.
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Condvar, Mutex};
use std::thread;
use std::time::Duration;

#[derive(Clone, Debug, PartialEq)]
pub enum Status {
    Thinking,
    Working,
    Idle,
    Error,
}

#[derive(Clone, Debug)]
pub enum Event {
    Status(Status),
    Session(String),
    Output(Value),
    Stderr(String),
}

pub struct Settings<'a> {
    pub model: &'a str,
    pub effort: &'a str,
    pub cwd: &'a str,
    pub sandbox: &'a str,
}

#[derive(Debug)]
enum RpcError {
    Rejected(String),
    Transport(String),
}
impl std::fmt::Display for RpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Rejected(s) | Self::Transport(s) => f.write_str(s),
        }
    }
}

#[derive(Default)]
struct State {
    thread: Option<String>,
    active_turn: Option<String>,
    completed: HashSet<String>,
    items: HashMap<String, Value>,
    initialized: bool,
    active_effort: Option<String>,
}

struct Inner {
    stdin: Mutex<ChildStdin>,
    child: Mutex<Child>,
    pending: Mutex<HashMap<u64, mpsc::Sender<Result<Value, RpcError>>>>,
    state: Mutex<State>,
    turn_change: Condvar,
    next_id: AtomicU64,
    alive: AtomicBool,
    shutting_down: AtomicBool,
    emit: Arc<dyn Fn(Event) + Send + Sync>,
}

pub struct CodexTransport {
    inner: Arc<Inner>,
    // A start and a concurrent follow-up cannot both observe an idle thread.
    delivery: Mutex<()>,
}

/// Preserve executable-wrapper handling for Windows npm installations.
pub fn command(path: &Path) -> Command {
    #[cfg(windows)]
    {
        let ext = path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if ext == "cmd" || ext == "bat" {
            let mut command =
                Command::new(std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into()));
            command.arg("/C").arg(path);
            return command;
        }
        if ext == "ps1" {
            let mut command = Command::new("powershell.exe");
            command
                .args([
                    "-NoLogo",
                    "-NoProfile",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-File",
                ])
                .arg(path);
            return command;
        }
    }
    Command::new(path)
}

/// Wait without holding the child lock, so an explicit Stop can still kill it.
/// A replaced/removed child must never publish status over its successor.
pub fn wait_for_process_exit(child: &Mutex<Option<Child>>, pid: u32) -> Option<bool> {
    loop {
        {
            let mut child = child.lock().ok()?;
            let child = child.as_mut()?;
            if child.id() != pid {
                return None;
            }
            match child.try_wait() {
                Ok(Some(status)) => return Some(status.success()),
                Err(_) => return Some(false),
                Ok(None) => {}
            }
        }
        thread::sleep(Duration::from_millis(10));
    }
}

impl CodexTransport {
    pub fn spawn(
        mut command: Command,
        emit: Arc<dyn Fn(Event) + Send + Sync>,
    ) -> Result<Self, String> {
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            unsafe {
                command.pre_exec(|| {
                    if libc::setpgid(0, 0) == 0 {
                        Ok(())
                    } else {
                        Err(std::io::Error::last_os_error())
                    }
                });
            }
        }
        let mut child = command
            .spawn()
            .map_err(|e| format!("Cannot start Codex app-server: {e}"))?;
        let stdin = child.stdin.take().ok_or("Codex stdin unavailable")?;
        let stdout = child.stdout.take().ok_or("Codex stdout unavailable")?;
        let stderr = child.stderr.take().ok_or("Codex stderr unavailable")?;
        let inner = Arc::new(Inner {
            stdin: Mutex::new(stdin),
            child: Mutex::new(child),
            pending: Mutex::new(HashMap::new()),
            state: Mutex::new(State::default()),
            turn_change: Condvar::new(),
            next_id: AtomicU64::new(1),
            alive: AtomicBool::new(true),
            shutting_down: AtomicBool::new(false),
            emit,
        });
        let reader = inner.clone();
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                match line {
                    Ok(line) => match serde_json::from_str::<Value>(&line) {
                        Ok(value) => reader.receive(value),
                        Err(_) => (reader.emit)(Event::Stderr(line)),
                    },
                    Err(_) => break,
                }
            }
            reader.disconnected();
        });
        let reader = inner.clone();
        thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                (reader.emit)(Event::Stderr(line));
            }
        });
        Ok(Self {
            inner,
            delivery: Mutex::new(()),
        })
    }

    pub fn is_alive(&self) -> bool {
        self.inner.alive.load(Ordering::Acquire)
    }

    pub fn is_active(&self) -> bool {
        self.inner
            .state
            .lock()
            .map(|state| state.active_turn.is_some())
            .unwrap_or(true)
    }

    pub fn active_uses_ultra(&self) -> bool {
        self.inner
            .state
            .lock()
            .map(|state| {
                state.active_turn.is_some() && state.active_effort.as_deref() == Some("ultra")
            })
            .unwrap_or(false)
    }

    pub fn send(
        &self,
        settings: Settings<'_>,
        session: Option<&str>,
        message: &str,
        images: &[String],
    ) -> Result<(), String> {
        let _delivery = self.delivery.lock().map_err(|e| e.to_string())?;
        if let Err(error) = self.ensure_thread(&settings, session) {
            (self.inner.emit)(Event::Status(Status::Error));
            return Err(error);
        }
        let input = user_input(message, images);
        for _ in 0..2 {
            let (thread, active) = {
                let state = self.inner.state.lock().map_err(|e| e.to_string())?;
                (
                    state.thread.clone().ok_or("Codex thread unavailable")?,
                    state.active_turn.clone(),
                )
            };
            if let Some(turn) = active {
                let result = self.inner.request(
                    "turn/steer",
                    json!({"threadId":thread,"expectedTurnId":turn,"input":input}),
                );
                match result {
                    Ok(_) => return Ok(()),
                    Err(RpcError::Rejected(error)) => {
                        // Only an explicit rejection can be retried. An ACK lost
                        // in transit must never replay a possibly accepted input.
                        let state = self.inner.state.lock().map_err(|e| e.to_string())?;
                        if state.active_turn.as_deref() == Some(&turn)
                            || !state.completed.contains(&turn)
                        {
                            return Err(error);
                        }
                    }
                    Err(error) => return Err(error.to_string()),
                }
            } else {
                (self.inner.emit)(Event::Status(Status::Thinking));
                self.inner
                    .state
                    .lock()
                    .map_err(|e| e.to_string())?
                    .active_effort = Some(settings.effort.to_string());
                let response = match self.inner.request("turn/start", json!({
                    "threadId":thread,"input":input,"model":settings.model,"effort":settings.effort,
                    "cwd":settings.cwd,"approvalPolicy":"never"
                })) {
                    Ok(response) => response,
                    Err(error) => {
                        (self.inner.emit)(Event::Status(Status::Error));
                        return Err(error.to_string());
                    }
                };
                // A fast completion notification may precede the RPC response.
                self.inner.observe_turn(&response["turn"], true);
                return Ok(());
            }
        }
        Err("The Codex turn changed while delivering the message; please retry.".into())
    }

    fn ensure_thread(&self, settings: &Settings<'_>, session: Option<&str>) -> Result<(), String> {
        let initialized = self
            .inner
            .state
            .lock()
            .map_err(|e| e.to_string())?
            .initialized;
        if !initialized {
            self.inner.request("initialize", json!({
                "clientInfo":{"name":"virtual_agency","title":"Virtual Agency","version":"1.13.0"},
                "capabilities":{"experimentalApi":true}
            })).map_err(|e| e.to_string())?;
            self.inner
                .write(json!({"method":"initialized","params":{}}))
                .map_err(|e| e.to_string())?;
            self.inner
                .state
                .lock()
                .map_err(|e| e.to_string())?
                .initialized = true;
        }
        if self
            .inner
            .state
            .lock()
            .map_err(|e| e.to_string())?
            .thread
            .is_some()
        {
            return Ok(());
        }
        let mut params = json!({
            "model":settings.model,"cwd":settings.cwd,"approvalPolicy":"never","sandbox":settings.sandbox,
            "config":{"model_reasoning_effort":settings.effort},
        });
        let method = if let Some(session) = session {
            params["threadId"] = json!(session);
            "thread/resume"
        } else {
            params["allowProviderModelFallback"] = json!(false);
            "thread/start"
        };
        let response = self
            .inner
            .request(method, params)
            .map_err(|e| e.to_string())?;
        let thread = response["thread"]["id"]
            .as_str()
            .ok_or("Codex did not return a thread ID")?
            .to_string();
        self.inner.state.lock().map_err(|e| e.to_string())?.thread = Some(thread.clone());
        (self.inner.emit)(Event::Session(thread.clone()));
        (self.inner.emit)(Event::Output(
            json!({"type":"thread.started","thread_id":thread}),
        ));
        if let Some(turns) = response["thread"]["turns"].as_array() {
            for turn in turns {
                self.inner.observe_turn(turn, false);
            }
        }
        Ok(())
    }

    pub fn interrupt(&self) -> Result<(), String> {
        let _delivery = self.delivery.lock().map_err(|e| e.to_string())?;
        let (thread, turn) = {
            let state = self.inner.state.lock().map_err(|e| e.to_string())?;
            (state.thread.clone(), state.active_turn.clone())
        };
        if let (Some(thread), Some(turn)) = (thread, turn) {
            self.inner
                .request("turn/interrupt", json!({"threadId":thread,"turnId":turn}))
                .map_err(|e| e.to_string())?;
            let state = self.inner.state.lock().map_err(|e| e.to_string())?;
            let (state, _) = self
                .inner
                .turn_change
                .wait_timeout_while(state, Duration::from_secs(15), |state| {
                    state.active_turn.as_deref() == Some(&turn) && self.is_alive()
                })
                .map_err(|e| e.to_string())?;
            if state.active_turn.as_deref() == Some(&turn) {
                return Err("Codex has not confirmed that the interrupted turn stopped; no new input was dispatched".into());
            }
        }
        Ok(())
    }

    pub fn shutdown(&self) {
        self.inner.shutting_down.store(true, Ordering::Release);
        self.inner.kill();
    }
}

impl Drop for CodexTransport {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn user_input(message: &str, images: &[String]) -> Vec<Value> {
    let mut input = vec![json!({"type":"text","text":message,"text_elements":[]})];
    input.extend(
        images
            .iter()
            .map(|path| json!({"type":"localImage","path":path})),
    );
    input
}

impl Inner {
    fn write(&self, value: Value) -> Result<(), RpcError> {
        let mut stdin = self
            .stdin
            .lock()
            .map_err(|e| RpcError::Transport(e.to_string()))?;
        writeln!(stdin, "{value}")
            .and_then(|_| stdin.flush())
            .map_err(|e| RpcError::Transport(format!("Codex transport write failed: {e}")))
    }

    fn request(&self, method: &str, params: Value) -> Result<Value, RpcError> {
        if !self.alive.load(Ordering::Acquire) {
            return Err(RpcError::Transport("Codex app-server disconnected".into()));
        }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (send, receive) = mpsc::channel();
        self.pending.lock().unwrap().insert(id, send);
        if let Err(error) = self.write(json!({"id":id,"method":method,"params":params})) {
            self.pending.lock().unwrap().remove(&id);
            self.kill();
            return Err(error);
        }
        match receive.recv_timeout(Duration::from_secs(15)) {
            Ok(result) => result,
            Err(_) => {
                self.pending.lock().unwrap().remove(&id);
                // Do not leave an unknown accepted turn/steer running while the
                // caller retries it through another transport.
                self.kill();
                Err(RpcError::Transport(format!("Codex {method} acknowledgement was lost; transport stopped without replaying the message")))
            }
        }
    }

    fn kill(&self) {
        self.alive.store(false, Ordering::Release);
        if let Ok(mut child) = self.child.lock() {
            #[cfg(unix)]
            unsafe {
                libc::kill(-(child.id() as i32), libc::SIGKILL);
            }
            #[cfg(windows)]
            {
                let _ = Command::new("taskkill")
                    .args(["/PID", &child.id().to_string(), "/T", "/F"])
                    .output();
            }
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    fn disconnected(&self) {
        self.alive.store(false, Ordering::Release);
        self.turn_change.notify_all();
        for (_, pending) in self.pending.lock().unwrap().drain() {
            let _ = pending.send(Err(RpcError::Transport(
                "Codex app-server disconnected before acknowledging the request".into(),
            )));
        }
        if !self.shutting_down.load(Ordering::Acquire) {
            (self.emit)(Event::Output(
                json!({"type":"turn.failed","error":{"message":"Codex app-server disconnected"}}),
            ));
            (self.emit)(Event::Status(Status::Error));
        }
        self.kill();
    }

    fn observe_turn(&self, turn: &Value, publish: bool) {
        let Some(id) = turn["id"].as_str() else {
            return;
        };
        let status = turn["status"].as_str().unwrap_or("inProgress");
        let terminal = matches!(status, "completed" | "failed" | "interrupted");
        let mut state = self.state.lock().unwrap();
        let should_publish = {
            if terminal {
                state.completed.insert(id.to_string());
                if state.active_turn.as_deref() == Some(id) {
                    state.active_turn = None;
                }
                publish && state.active_turn.is_none()
            } else if !state.completed.contains(id) {
                let changed = state.active_turn.as_deref() != Some(id);
                state.active_turn = Some(id.to_string());
                publish && changed
            } else {
                false
            }
        };
        if should_publish {
            let (kind, state) = if status == "failed" {
                ("turn.failed", Status::Error)
            } else if terminal {
                ("turn.completed", Status::Idle)
            } else {
                ("turn.started", Status::Working)
            };
            (self.emit)(Event::Output(
                json!({"type":kind,"turn_id":id,"error":turn["error"]}),
            ));
            (self.emit)(Event::Status(state));
        }
        self.turn_change.notify_all();
    }

    fn receive(&self, message: Value) {
        if let Some(method) = message["method"].as_str() {
            if let Some(id) = message.get("id") {
                // We never silently grant new capabilities through a request
                // this integration cannot present. Policy is already `never`.
                let _ = self.write(json!({"id":id,"error":{"code":-32601,"message":format!("Virtual Agency does not support interactive request {method}")}}));
                (self.emit)(Event::Stderr(format!(
                    "Codex requested unsupported interaction: {method}"
                )));
                return;
            }
            let params = &message["params"];
            let our_thread = self.state.lock().unwrap().thread.clone();
            if let Some(incoming) = params["threadId"].as_str() {
                if our_thread.as_deref() != Some(incoming) {
                    return;
                }
            }
            match method {
                "turn/started" | "turn/completed" => self.observe_turn(&params["turn"], true),
                "item/started" | "item/completed" => {
                    let item = normalize_item(params["item"].clone());
                    if let Some(id) = item["id"].as_str() {
                        let mut state = self.state.lock().unwrap();
                        if method == "item/completed" {
                            state.items.remove(id);
                        } else {
                            state.items.insert(id.to_string(), item.clone());
                        }
                    }
                    (self.emit)(Event::Output(
                        json!({"type":if method=="item/started" {"item.started"} else {"item.completed"},"item":item}),
                    ));
                }
                "item/agentMessage/delta"
                | "item/reasoning/summaryTextDelta"
                | "item/commandExecution/outputDelta" => {
                    let Some(id) = params["itemId"].as_str() else {
                        return;
                    };
                    let mut state = self.state.lock().unwrap();
                    let item = state.items.entry(id.to_string()).or_insert_with(|| json!({"id":id,"type":if method.contains("agentMessage") {"agent_message"} else if method.contains("reasoning") {"reasoning"} else {"command_execution"}}));
                    let key = if method.contains("commandExecution") {
                        "aggregated_output"
                    } else {
                        "text"
                    };
                    let mut text = item[key].as_str().unwrap_or("").to_string();
                    text.push_str(params["delta"].as_str().unwrap_or(""));
                    item[key] = json!(text);
                    let item = item.clone();
                    drop(state);
                    (self.emit)(Event::Output(json!({"type":"item.updated","item":item})));
                }
                "turn/plan/updated" => {
                    let items = params["plan"].as_array().map(|plan| plan.iter().map(|step| json!({"text":step["step"],"completed":step["status"]=="completed"})).collect::<Vec<_>>()).unwrap_or_default();
                    (self.emit)(Event::Output(
                        json!({"type":"item.updated","item":{"type":"todo_list","id":format!("plan-{}",params["turnId"].as_str().unwrap_or("")),"items":items}}),
                    ));
                }
                "error" => {
                    // Retriable provider errors are progress, not terminal turns.
                    if params["willRetry"].as_bool() != Some(true) {
                        (self.emit)(Event::Output(
                            json!({"type":"turn.failed","error":params["error"]}),
                        ));
                        (self.emit)(Event::Status(Status::Error));
                    }
                }
                _ => {}
            }
        } else if let Some(id) = message["id"].as_u64() {
            if let Some(pending) = self.pending.lock().unwrap().remove(&id) {
                let result = if let Some(error) = message.get("error") {
                    Err(RpcError::Rejected(format!(
                        "Codex rejected request: {error}"
                    )))
                } else {
                    Ok(message["result"].clone())
                };
                let _ = pending.send(result);
            }
        }
    }
}

fn normalize_item(mut item: Value) -> Value {
    let kind = match item["type"].as_str().unwrap_or("") {
        "agentMessage" => "agent_message",
        "userMessage" => "user_message",
        "commandExecution" => "command_execution",
        "fileChange" => "file_change",
        "mcpToolCall" => "mcp_tool_call",
        "webSearch" => "web_search",
        "collabAgentToolCall" => "collab_agent_tool_call",
        "subAgentActivity" => "sub_agent_activity",
        other => other,
    }
    .to_string();
    item["type"] = json!(kind);
    for (from, to) in [
        ("aggregatedOutput", "aggregated_output"),
        ("exitCode", "exit_code"),
        ("receiverThreadIds", "receiver_thread_ids"),
        ("senderThreadId", "sender_thread_id"),
        ("agentsStates", "agents_states"),
        ("agentPath", "agent_path"),
        ("agentThreadId", "agent_thread_id"),
    ] {
        if let Some(value) = item.get(from).cloned() {
            item[to] = value;
        }
    }
    if kind == "reasoning" {
        let text = item["summary"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>()
            .join("\n");
        item["text"] = json!(text);
    }
    if kind == "file_change" {
        if let Some(changes) = item["changes"].as_array_mut() {
            for change in changes {
                if let Some(kind) = change["kind"]["type"].as_str().map(str::to_string) {
                    change["kind"] = json!(kind);
                }
            }
        }
    }
    item
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::time::Instant;

    // A local stdio process implementing only the protocol under test. It never
    // loads Codex configuration, authenticates, or contacts a model/provider.
    const MOCK: &str = r#"
import json, sys, time
mode=sys.argv[1]
thread='saved-thread' if mode=='resume' else 'thread-1'
turn=0
def emit(value): print(json.dumps(value),flush=True)
def result(req,value): emit({'id':req['id'],'result':value})
def event(method,params): emit({'method':method,'params':dict({'threadId':thread},**params)})
def turn_event(status): event('turn/'+('started' if status=='inProgress' else 'completed'),{'turn':{'id':'turn-'+str(turn),'status':status,'error':{'message':'synthetic failure'} if status=='failed' else None}})
for line in sys.stdin:
    req=json.loads(line)
    method=req['method']; p=req.get('params',{})
    print('trace:'+json.dumps(req),file=sys.stderr,flush=True)
    if method=='initialize':
        assert p['capabilities']['experimentalApi'] is True
        result(req,{'userAgent':'mock'})
    elif method=='initialized': pass
    elif method in ('thread/start','thread/resume'):
        assert p['approvalPolicy']=='never'
        assert p['model']=='gpt-6-astra' and p['config']['model_reasoning_effort']=='ultra'
        if mode=='resume': assert method=='thread/resume' and p['threadId']=='saved-thread'
        else: assert method=='thread/start' and p['allowProviderModelFallback'] is False
        result(req,{'thread':{'id':thread,'turns':[]},'reasoningEffort':'ultra'})
    elif method=='turn/start':
        assert p['threadId']==thread
        if mode=='reject':
            emit({'id':req['id'],'error':{'code':-32600,'message':'synthetic rejected model'}});continue
        turn+=1
        if mode=='disconnect': sys.exit(3)
        turn_event('inProgress')
        if mode=='fast': turn_event('completed')
        result(req,{'turn':{'id':'turn-'+str(turn),'status':'inProgress'}})
        if mode=='failed':
            turn_event('failed');sys.exit(4)
    elif method=='turn/steer':
        assert p['expectedTurnId']=='turn-'+str(turn)
        if mode=='race':
            turn_event('completed')
            emit({'id':req['id'],'error':{'code':-32600,'message':'no active turn'}});continue
        result(req,{'turnId':'turn-'+str(turn)})
        event('item/started',{'turnId':'turn-'+str(turn),'item':{'id':'reply','type':'agentMessage','phase':'commentary','text':''}})
        event('item/agentMessage/delta',{'turnId':'turn-'+str(turn),'itemId':'reply','delta':'Still working; here is the answer.'})
        event('item/completed',{'turnId':'turn-'+str(turn),'item':{'id':'reply','type':'agentMessage','phase':'commentary','text':'Still working; here is the answer.'}})
    elif method=='turn/interrupt':
        assert p['turnId']=='turn-'+str(turn)
        result(req,{})
        time.sleep(.08)
        turn_event('interrupted')
    else:
        raise AssertionError('unexpected method '+method)
"#;

    struct Fixture {
        transport: CodexTransport,
        events: Arc<Mutex<Vec<Event>>>,
    }
    impl Fixture {
        fn new(mode: &str) -> Self {
            let mut command = Command::new("python3");
            command.args(["-u", "-c", MOCK, mode]);
            let events = Arc::new(Mutex::new(Vec::new()));
            let emitted = events.clone();
            let transport = CodexTransport::spawn(
                command,
                Arc::new(move |event| emitted.lock().unwrap().push(event)),
            )
            .unwrap();
            Self { transport, events }
        }
        fn send(&self, text: &str) -> Result<(), String> {
            self.transport.send(settings(), None, text, &[])
        }
        fn wait(&self, predicate: impl Fn(&[Event]) -> bool) {
            let deadline = Instant::now() + Duration::from_secs(3);
            while !predicate(&self.events.lock().unwrap()) {
                assert!(
                    Instant::now() < deadline,
                    "mock protocol event did not arrive"
                );
                thread::sleep(Duration::from_millis(5));
            }
        }
        fn requests(&self) -> Vec<Value> {
            self.events
                .lock()
                .unwrap()
                .iter()
                .filter_map(|event| match event {
                    Event::Stderr(text) => text
                        .strip_prefix("trace:")
                        .and_then(|text| serde_json::from_str(text).ok()),
                    _ => None,
                })
                .collect()
        }
    }
    fn settings() -> Settings<'static> {
        Settings {
            model: "gpt-6-astra",
            effort: "ultra",
            cwd: "/tmp",
            sandbox: "workspace-write",
        }
    }

    #[test]
    fn active_turn_steers_images_and_streams_a_reply_without_finishing_work() {
        let f = Fixture::new("normal");
        f.send("Do the original task").unwrap();
        f.transport
            .send(
                settings(),
                None,
                "A question while you work",
                &["/tmp/synthetic.png".into()],
            )
            .unwrap();
        f.wait(|events| {
            events
                .iter()
                .any(|event| matches!(event,Event::Output(v) if v["type"]=="item.completed"))
        });
        assert!(f.transport.active_uses_ultra());
        let requests = f.requests();
        assert_eq!(
            requests
                .iter()
                .filter(|v| v["method"] == "turn/start")
                .count(),
            1
        );
        let steer = requests
            .iter()
            .find(|v| v["method"] == "turn/steer")
            .unwrap();
        assert_eq!(steer["params"]["expectedTurnId"], "turn-1");
        assert_eq!(
            steer["params"]["input"][1],
            json!({"type":"localImage","path":"/tmp/synthetic.png"})
        );
        let events = f.events.lock().unwrap();
        assert!(events.iter().any(|event|matches!(event,Event::Output(v) if v["type"]=="item.updated" && v["item"]["type"]=="agent_message" && v["item"]["phase"]=="commentary")));
        assert!(!events
            .iter()
            .any(|event| matches!(event, Event::Status(Status::Idle))));
    }

    #[test]
    fn resume_keeps_thread_and_interrupt_ack_waits_for_completion_before_new_turn() {
        let f = Fixture::new("resume");
        f.transport
            .send(settings(), Some("saved-thread"), "Continue", &[])
            .unwrap();
        let started = Instant::now();
        f.transport.interrupt().unwrap();
        assert!(
            started.elapsed() >= Duration::from_millis(70),
            "an interrupt acknowledgement alone does not mean stopped"
        );
        f.transport
            .send(
                Settings {
                    model: "gpt-5.6-sol",
                    effort: "high",
                    ..settings()
                },
                Some("saved-thread"),
                "Next task",
                &[],
            )
            .unwrap();
        f.wait(|events| {
            events
                .iter()
                .filter(|event| matches!(event,Event::Stderr(text) if text.contains("turn/start")))
                .count()
                == 2
        });
        let requests = f.requests();
        assert_eq!(
            requests
                .iter()
                .filter(|v| v["method"] == "thread/resume")
                .count(),
            1
        );
        assert!(!requests.iter().any(|v| v["method"] == "turn/steer"));
        let next = requests
            .iter()
            .filter(|v| v["method"] == "turn/start")
            .last()
            .unwrap();
        assert_eq!(next["params"]["model"], "gpt-5.6-sol");
        assert_eq!(next["params"]["effort"], "high");
    }

    #[test]
    fn rejected_steer_after_confirmed_completion_starts_once_without_replaying_original_task() {
        let f = Fixture::new("race");
        f.send("Original").unwrap();
        f.send("Follow-up").unwrap();
        f.wait(|events| {
            events
                .iter()
                .filter(|event| matches!(event,Event::Stderr(text) if text.contains("turn/start")))
                .count()
                == 2
        });
        let requests = f.requests();
        let starts = requests
            .iter()
            .filter(|v| v["method"] == "turn/start")
            .collect::<Vec<_>>();
        assert_eq!(starts.len(), 2);
        assert_eq!(starts[1]["params"]["input"][0]["text"], "Follow-up");
        assert_eq!(
            requests
                .iter()
                .filter(|v| v["method"] == "turn/steer")
                .count(),
            1
        );
    }

    #[test]
    fn completion_before_start_ack_cannot_resurrect_turn() {
        let f = Fixture::new("fast");
        f.send("First").unwrap();
        assert!(f
            .transport
            .inner
            .state
            .lock()
            .unwrap()
            .active_turn
            .is_none());
        f.send("Second").unwrap();
        assert!(f
            .transport
            .inner
            .state
            .lock()
            .unwrap()
            .active_turn
            .is_none());
        assert!(!f.transport.active_uses_ultra());
    }

    #[test]
    fn failed_turn_and_eof_preserve_error() {
        let f = Fixture::new("failed");
        let _ = f.send("Fail synthetically");
        f.wait(|events|events.iter().any(|event|matches!(event,Event::Output(v) if v["type"]=="turn.failed" && v["error"]["message"]=="Codex app-server disconnected")));
        let events = f.events.lock().unwrap();
        let statuses = events
            .iter()
            .filter_map(|event| {
                if let Event::Status(status) = event {
                    Some(status)
                } else {
                    None
                }
            })
            .collect::<Vec<_>>();
        assert_eq!(statuses.last(), Some(&&Status::Error));
        assert!(!statuses.contains(&&Status::Idle));
    }

    #[test]
    fn rejected_start_leaves_error_instead_of_thinking_forever() {
        let f = Fixture::new("reject");
        assert!(f
            .send("Start")
            .unwrap_err()
            .contains("synthetic rejected model"));
        let events = f.events.lock().unwrap();
        assert!(matches!(events.last(), Some(Event::Status(Status::Error))));
        assert!(f
            .transport
            .inner
            .state
            .lock()
            .unwrap()
            .active_turn
            .is_none());
    }

    #[test]
    fn lost_ack_is_not_retried_or_misreported_as_accepted() {
        let f = Fixture::new("disconnect");
        assert!(f.send("Do not duplicate this input").is_err());
        assert!(!f.transport.is_alive());
        f.wait(|events| {
            events
                .iter()
                .any(|event| matches!(event, Event::Status(Status::Error)))
        });
        assert_eq!(
            f.requests()
                .iter()
                .filter(|v| v["method"] == "turn/start")
                .count(),
            1
        );
    }

    #[test]
    fn maps_native_subagents_reasoning_and_file_changes_without_hiding_them() {
        let collab = normalize_item(
            json!({"id":"collab-1","type":"collabAgentToolCall","tool":"spawnAgent","receiverThreadIds":["child-1"],"agentsStates":{"child-1":{"status":"running"}}}),
        );
        assert_eq!(collab["type"], "collab_agent_tool_call");
        assert_eq!(collab["receiver_thread_ids"], json!(["child-1"]));
        assert_eq!(
            normalize_item(json!({"type":"reasoning","summary":["One","Two"]}))["text"],
            "One\nTwo"
        );
        assert_eq!(
            normalize_item(
                json!({"type":"fileChange","changes":[{"path":"x","kind":{"type":"update"},"diff":"test"}]})
            )["changes"][0]["kind"],
            "update"
        );
    }

    #[test]
    fn legacy_exit_wait_reports_nonzero_and_does_not_touch_a_replaced_child() {
        let child = Command::new("sh").args(["-c", "exit 7"]).spawn().unwrap();
        let pid = child.id();
        let slot = Mutex::new(Some(child));
        assert_eq!(wait_for_process_exit(&slot, pid + 1), None);
        assert_eq!(wait_for_process_exit(&slot, pid), Some(false));
    }
}
