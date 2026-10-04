// ABOUTME: Supervises one pi process per session and forwards RPC.
// ABOUTME: Session binding is in session_bind.rs, warm standby in standby.rs, reaping in idle.rs.

use super::launch::NativeLaunchSpec;
use crate::pi::coordinator::{MutationAcceptance, RuntimeCoordinator, RuntimeState, RuntimeTarget};
#[cfg(test)]
use crate::pi::rpc::InMemoryPiProcess;
use crate::pi::rpc::{BridgeFrame, PiRpcBridge, PiRpcProcess};
use serde_json::Value;
use std::collections::HashMap;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::broadcast;

/// Status, widget, and title updates describe current state, so a reconnecting client
/// only needs the newest one per key. Notices and editor text are one-off and are not kept.
const UI_STATE_METHODS: [&str; 3] = ["setStatus", "setWidget", "setTitle"];
const UI_ONE_OFF_METHODS: [&str; 2] = ["notify", "set_editor_text"];

fn ui_method(event: &Value) -> &str {
    event.get("method").and_then(Value::as_str).unwrap_or("")
}

/// A request that waits for the user's answer (select, confirm, input, editor, ...).
pub(in crate::pi) fn is_dialog(event: &Value) -> bool {
    let method = ui_method(event);
    !UI_STATE_METHODS.contains(&method) && !UI_ONE_OFF_METHODS.contains(&method)
}

fn ui_state_key(event: &Value) -> Option<(String, String)> {
    let method = ui_method(event);
    if !UI_STATE_METHODS.contains(&method) {
        return None;
    }
    let key = event
        .get("statusKey")
        .or_else(|| event.get("widgetKey"))
        .and_then(Value::as_str)
        .unwrap_or("");
    Some((method.to_string(), key.to_string()))
}

/// Keeps what a reconnecting client must see: open dialogs, and the latest state
/// per status or widget key. Without this the list grew with every status update.
fn remember_extension_ui(list: &mut Vec<NativeRuntimeEvent>, event: &NativeRuntimeEvent) {
    if UI_ONE_OFF_METHODS.contains(&ui_method(&event.event)) {
        return;
    }
    if let Some(key) = ui_state_key(&event.event) {
        list.retain(|old| ui_state_key(&old.event).as_ref() != Some(&key));
    }
    list.push(event.clone());
}

pub(in crate::pi) struct ManagedRuntime {
    pub(in crate::pi) target: Arc<Mutex<RuntimeTarget>>,
    pub(in crate::pi) bridge: PiRpcBridge,
    process: Option<PiRpcProcess>,
}

pub(in crate::pi) struct PiRuntimeInner {
    pub(in crate::pi) coordinator: Mutex<RuntimeCoordinator>,
    pub(in crate::pi) runtimes: Mutex<HashMap<String, ManagedRuntime>>,
    pub(in crate::pi) events: broadcast::Sender<NativeRuntimeEvent>,
    pub(in crate::pi) pending_ui: Mutex<HashMap<String, Vec<NativeRuntimeEvent>>>,
    /// instance id -> last request, snapshot, or finished turn. Feeds the idle reaper.
    pub(in crate::pi) last_used: Mutex<HashMap<String, Instant>>,
    /// client id -> the instance that client last subscribed to (its open chat).
    pub(in crate::pi) foreground: Mutex<HashMap<String, String>>,
    pub(in crate::pi) standby: Mutex<HashMap<String, RuntimeTarget>>,
}

impl PiRuntimeInner {
    pub(in crate::pi) fn touch(&self, instance_id: &str) {
        if let Ok(mut used) = self.last_used.lock() {
            used.insert(instance_id.to_owned(), Instant::now());
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeRuntimeEvent {
    pub target: RuntimeTarget,
    pub sequence: u64,
    pub event: Value,
}

#[derive(Clone)]
pub struct PiRuntime {
    pub(in crate::pi) inner: Arc<PiRuntimeInner>,
}

impl PiRuntime {
    pub fn new(idempotency_capacity: usize) -> Self {
        let (events, _) = broadcast::channel(1024);
        Self {
            inner: Arc::new(PiRuntimeInner {
                coordinator: Mutex::new(RuntimeCoordinator::new(idempotency_capacity)),
                runtimes: Mutex::new(HashMap::new()),
                events,
                pending_ui: Mutex::new(HashMap::new()),
                last_used: Mutex::new(HashMap::new()),
                foreground: Mutex::new(HashMap::new()),
                standby: Mutex::new(HashMap::new()),
            }),
        }
    }

    #[cfg(test)]
    pub(in crate::pi) fn in_memory(idempotency_capacity: usize) -> Self {
        Self::new(idempotency_capacity)
    }

    pub fn spawn(&self, target: RuntimeTarget, spec: NativeLaunchSpec) -> Result<(), String> {
        let launch = spec.command_description();
        let mut command = Command::new(&launch.program);
        crate::platform::windows_child::hide_console(&mut command);
        // Before any of our own env: an AppImage's AppRun points the dynamic
        // loader at the bundle, and `pi` is built against the host system.
        crate::platform::appimage_env::scrub(&mut command);
        command
            .args(&launch.args)
            .envs(&launch.environment)
            .current_dir(&spec.cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        crate::host::tls::apply_runtime_tls_env(&mut command);
        // Own the whole tree, and leave a record of it: `pi` outlives a SPOPI
        // that dies without running any teardown, and a wedged runtime will not
        // even notice the stdin EOF that normally stops it.
        crate::pi::child_supervision::make_group_leader(&mut command);
        let child = command
            .spawn()
            .map_err(|error| format!("Cannot start embedded Pi native RPC process: {error}"))?;
        crate::pi::child_supervision::record_runtime(child.id());
        let (bridge, mut process) = PiRpcBridge::attach(child, 16 * 1024 * 1024)?;
        // The process is up and waiting. Registering it as idle keeps
        // /health/runtime from staying on a state that never cleared.
        if let Err(error) = self
            .inner
            .coordinator
            .lock()
            .map_err(|_| "Runtime coordinator lock poisoned".to_string())?
            .register(target.clone(), RuntimeState::Idle)
        {
            let _ = process.kill();
            return Err(format!("Cannot register Pi runtime: {error:?}"));
        }
        self.inner
            .runtimes
            .lock()
            .map_err(|_| "Native runtime registry lock poisoned".to_string())?
            .insert(
                target.instance_id.clone(),
                ManagedRuntime {
                    target: Arc::new(Mutex::new(target.clone())),
                    bridge: bridge.clone(),
                    process: Some(process),
                },
            );
        self.inner.touch(&target.instance_id);
        self.start_event_pump(target, bridge);
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn register_in_memory(
        &self,
        target: RuntimeTarget,
    ) -> Result<InMemoryPiProcess, String> {
        let (bridge, process) = PiRpcBridge::in_memory(1024 * 1024);
        self.inner
            .coordinator
            .lock()
            .map_err(|_| "Runtime coordinator lock poisoned".to_string())?
            .register(target.clone(), RuntimeState::Idle)
            .map_err(|error| format!("Cannot register test runtime: {error:?}"))?;
        self.inner
            .runtimes
            .lock()
            .map_err(|_| "Native runtime registry lock poisoned".to_string())?
            .insert(
                target.instance_id.clone(),
                ManagedRuntime {
                    target: Arc::new(Mutex::new(target.clone())),
                    bridge: bridge.clone(),
                    process: None,
                },
            );
        self.inner.touch(&target.instance_id);
        self.start_event_pump(target, bridge);
        Ok(process)
    }

    fn start_event_pump(&self, target: RuntimeTarget, bridge: PiRpcBridge) {
        let inner = Arc::clone(&self.inner);
        // Started from the synchronous startup path (Tauri `setup` hook), which
        // has no entered Tokio runtime — use Tauri's global runtime handle so
        // this works off the main thread instead of panicking on `tokio::spawn`.
        tauri::async_runtime::spawn(async move {
            while let Some(frame) = bridge.next_frame().await {
                let target = inner.runtimes.lock().ok().and_then(|runtimes| {
                    runtimes
                        .get(&target.instance_id)?
                        .target
                        .lock()
                        .ok()
                        .map(|target| target.clone())
                });
                let Some(target) = target else {
                    return;
                };
                let event = match frame {
                    BridgeFrame::Event(event) | BridgeFrame::ExtensionUi(event) => event,
                    BridgeFrame::ProtocolError(message) => {
                        serde_json::json!({ "type": "protocol_error", "message": message })
                    }
                };
                let sequenced = {
                    let Ok(mut coordinator) = inner.coordinator.lock() else {
                        return;
                    };
                    match event.get("type").and_then(Value::as_str) {
                        Some("agent_start") => {
                            let _ = coordinator.set_state(&target, RuntimeState::Working);
                        }
                        Some("agent_settled") | Some("agent_end") => {
                            let _ = coordinator.set_state(&target, RuntimeState::Idle);
                            // A finished turn restarts the idle clock so a
                            // background run gets its full grace before reaping.
                            inner.touch(&target.instance_id);
                        }
                        _ => {}
                    }
                    coordinator.emit_event(&target, event)
                };
                let Ok(sequenced) = sequenced else {
                    return;
                };
                let runtime_event = NativeRuntimeEvent {
                    target: sequenced.target,
                    sequence: sequenced.sequence,
                    event: sequenced.event,
                };
                if runtime_event.event.get("type").and_then(Value::as_str)
                    == Some("extension_ui_request")
                {
                    if let Ok(mut pending) = inner.pending_ui.lock() {
                        remember_extension_ui(
                            pending
                                .entry(runtime_event.target.instance_id.clone())
                                .or_default(),
                            &runtime_event,
                        );
                    }
                }
                let _ = inner.events.send(runtime_event);
            }
            remove_closed_runtime(&inner, &target.instance_id);
        });
    }

    pub fn subscribe(&self) -> broadcast::Receiver<NativeRuntimeEvent> {
        self.inner.events.subscribe()
    }

    pub fn pending_extension_ui(
        &self,
        target: &RuntimeTarget,
    ) -> Result<Vec<NativeRuntimeEvent>, String> {
        self.inner
            .coordinator
            .lock()
            .map_err(|_| "Runtime coordinator lock poisoned".to_string())?
            .validate(target)
            .map_err(|error| format!("Extension UI lookup rejected: {error:?}"))?;
        Ok(self
            .inner
            .pending_ui
            .lock()
            .map_err(|_| "Pending extension UI lock poisoned".to_string())?
            .get(&target.instance_id)
            .cloned()
            .unwrap_or_default())
    }

    pub async fn request(
        &self,
        target: &RuntimeTarget,
        command: Value,
        idempotency_key: Option<&str>,
        timeout: Duration,
    ) -> Result<Value, String> {
        let mut mutation_key = None;
        {
            let mut coordinator = self
                .inner
                .coordinator
                .lock()
                .map_err(|_| "Runtime coordinator lock poisoned".to_string())?;
            coordinator
                .validate_command(target, &command)
                .map_err(|error| format!("Runtime request rejected: {error:?}"))?;
            if is_mutation(
                command
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
            ) {
                let key = idempotency_key
                    .ok_or_else(|| "Runtime mutation requires an idempotency key".to_string())?;
                let acceptance = coordinator
                    .accept_mutation(target, key)
                    .map_err(|error| format!("Runtime mutation rejected: {error:?}"))?;
                if acceptance == MutationAcceptance::Duplicate {
                    return coordinator
                        .mutation_result(target, key)
                        .map_err(|error| format!("Cannot read mutation result: {error:?}"))?
                        .ok_or_else(|| {
                            "Runtime mutation was accepted and is still pending".into()
                        });
                }
                mutation_key = Some(key.to_owned());
            }
        }
        self.inner.touch(&target.instance_id);
        let bridge = self
            .inner
            .runtimes
            .lock()
            .map_err(|_| "Native runtime registry lock poisoned".to_string())?
            .get(&target.instance_id)
            .map(|runtime| runtime.bridge.clone())
            .ok_or_else(|| "Native runtime instance is not running".to_string())?;
        let response = match bridge.request(command, timeout).await {
            Ok(response) => response,
            Err(error) => {
                let mut message = format!("Pi RPC request failed: {error:?}");
                if let Some(stderr) = self.drain_diagnostics(&target.instance_id) {
                    message.push_str(&format!("\nPi stderr:\n{stderr}"));
                }
                return Err(message);
            }
        };
        if let Some(key) = mutation_key {
            self.inner
                .coordinator
                .lock()
                .map_err(|_| "Runtime coordinator lock poisoned".to_string())?
                .complete_mutation(target, &key, response.clone())
                .map_err(|error| format!("Cannot cache mutation result: {error:?}"))?;
        }
        Ok(response)
    }

    /// Pull whatever `pi` wrote to stderr, so a dead runtime reports why it
    /// died instead of a bare transport error.
    fn drain_diagnostics(&self, instance_id: &str) -> Option<String> {
        self.inner
            .runtimes
            .lock()
            .ok()?
            .get(instance_id)?
            .process
            .as_ref()?
            .drain_diagnostics()
    }

    pub fn stop(&self, target: &RuntimeTarget) -> Result<(), String> {
        self.inner
            .coordinator
            .lock()
            .map_err(|_| "Runtime coordinator lock poisoned".to_string())?
            .validate(target)
            .map_err(|error| format!("Runtime stop rejected: {error:?}"))?;
        let mut runtime = self
            .inner
            .runtimes
            .lock()
            .map_err(|_| "Native runtime registry lock poisoned".to_string())?
            .remove(&target.instance_id)
            .ok_or_else(|| "Native runtime instance is not running".to_string())?;
        if let Some(process) = &mut runtime.process {
            process.kill()?;
        }
        self.inner
            .coordinator
            .lock()
            .map_err(|_| "Runtime coordinator lock poisoned".to_string())?
            .unregister(target)
            .map_err(|error| format!("Cannot unregister stopped runtime: {error:?}"))?;
        Ok(())
    }

    pub fn stop_workspace(&self, workspace_id: &str) {
        let targets = self
            .inner
            .runtimes
            .lock()
            .map(|runtimes| {
                runtimes
                    .values()
                    .filter_map(|runtime| runtime.target.lock().ok().map(|target| target.clone()))
                    .filter(|target| target.workspace_id == workspace_id)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        for target in targets {
            let _ = self.stop(&target);
        }
    }

    pub fn stop_all(&self) {
        let targets = self
            .inner
            .runtimes
            .lock()
            .map(|runtimes| {
                runtimes
                    .values()
                    .filter_map(|runtime| runtime.target.lock().ok().map(|target| target.clone()))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        for target in targets {
            let _ = self.stop(&target);
        }
    }

    /// Stop the runtime for `target` and spawn a fresh one that resumes the same
    /// session, returning the new instance id. Used to pick up extension/package
    /// changes without leaving the app. Falls back to a no-op returning the
    /// existing instance id when the target is not currently running.
    pub fn restart(
        &self,
        target: &RuntimeTarget,
        spec: NativeLaunchSpec,
    ) -> Result<String, String> {
        let existing = self
            .inner
            .runtimes
            .lock()
            .map_err(|_| "Native runtime registry lock poisoned".to_string())?
            .values()
            .find_map(|runtime| {
                runtime.target.lock().ok().map(|t| t.clone()).filter(|t| {
                    t.workspace_id == target.workspace_id && t.session_id == target.session_id
                })
            });

        let Some(existing) = existing else {
            // Not currently running — nothing to restart.
            return Ok(target.instance_id.clone());
        };

        self.stop(&existing)?;

        let new_instance = format!("instance-{}", uuid::Uuid::new_v4().simple());
        let fresh = RuntimeTarget::new(
            existing.workspace_id.clone(),
            existing.session_id.clone(),
            new_instance.clone(),
        );
        self.spawn(fresh, spec)?;
        Ok(new_instance)
    }
}

fn remove_closed_runtime(inner: &PiRuntimeInner, instance_id: &str) {
    let runtime = inner
        .runtimes
        .lock()
        .ok()
        .and_then(|mut runtimes| runtimes.remove(instance_id));
    let Some(mut runtime) = runtime else {
        return;
    };
    if let Some(process) = &mut runtime.process {
        let _ = process.kill();
    }
    let target = runtime.target.lock().ok().map(|target| target.clone());
    if let Some(target) = target {
        if let Ok(mut coordinator) = inner.coordinator.lock() {
            let _ = coordinator.unregister(&target);
        }
    }
    if let Ok(mut pending_ui) = inner.pending_ui.lock() {
        pending_ui.remove(instance_id);
    }
    if let Ok(mut used) = inner.last_used.lock() {
        used.remove(instance_id);
    }
}

fn is_mutation(command_type: &str) -> bool {
    matches!(
        command_type,
        "prompt"
            | "steer"
            | "follow_up"
            | "compact"
            | "bash"
            | "fork"
            | "clone"
            | "set_model"
            | "set_thinking_level"
            | "set_auto_compaction"
            | "set_auto_retry"
            | "set_steering_mode"
            | "set_follow_up_mode"
    )
}

#[cfg(test)]
#[path = "runtime_tests.rs"]
mod tests;
