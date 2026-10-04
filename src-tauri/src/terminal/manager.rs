// ABOUTME: Owns terminal lifecycle: event delivery, persistence, and cleanup.
// ABOUTME: WebSocket commands are in ws_dispatch/. PTY spawn is in spawn.rs.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde_json::{json, Value};

use crate::platform::window_owner::OwnerId;
use crate::terminal::output::{TerminalLimits, TerminalOutputStore};
use crate::terminal::profiles::{ShellProbe, SystemShellProbe};
use crate::terminal::registry::{
    err_str, TerminalError, TerminalKey, TerminalRegistry, TerminalStatus,
};
use crate::terminal::state_store::{
    PersistedTabDescriptor, TerminalStateStore, WorkspaceTerminalMetadata,
};

/// Delivers a `terminal_event` frame to the current authenticated owner client.
/// In production this wraps `BrokerWs::send_owner_event`.
pub type EventSink = Arc<dyn Fn(&OwnerId, Value) + Send + Sync>;

fn normalized_root(path: &Path) -> String {
    path.to_string_lossy()
        .trim_end_matches(['\\', '/'])
        .to_lowercase()
}

#[derive(Clone)]
pub struct TerminalManager {
    pub(in crate::terminal) inner: Arc<ManagerInner>,
}

pub(in crate::terminal) struct ManagerInner {
    pub(in crate::terminal) registry: TerminalRegistry,
    pub(in crate::terminal) probe: Box<dyn ShellProbe>,
    pub(in crate::terminal) live: Mutex<HashMap<String, LiveTerminal>>,
    pub(in crate::terminal) outputs: Mutex<HashMap<String, TerminalOutputStore>>,
    pub(in crate::terminal) event_sink: Mutex<Option<EventSink>>,
    pub(in crate::terminal) state_store: TerminalStateStore,
}

pub(in crate::terminal) struct LiveTerminal {
    pub(in crate::terminal) owner: OwnerId,
    pub(in crate::terminal) workspace_root: PathBuf,
    pub(in crate::terminal) generation: u64,
    pub(in crate::terminal) profile_id: String,
    pub(in crate::terminal) master: Box<dyn portable_pty::MasterPty + Send>,
    pub(in crate::terminal) writer: Box<dyn std::io::Write + Send>,
    pub(in crate::terminal) child: Option<Box<dyn portable_pty::Child + Send + Sync>>,
    #[cfg(windows)]
    pub(in crate::terminal) job: Option<windows_job::JobHandle>,
}

impl TerminalManager {
    pub fn new(registry: TerminalRegistry, state_store: TerminalStateStore) -> Self {
        Self::with_probe(registry, state_store, Box::new(SystemShellProbe))
    }

    pub fn with_probe(
        registry: TerminalRegistry,
        state_store: TerminalStateStore,
        probe: Box<dyn ShellProbe>,
    ) -> Self {
        Self {
            inner: Arc::new(ManagerInner {
                registry,
                probe,
                live: Mutex::new(HashMap::new()),
                outputs: Mutex::new(HashMap::new()),
                event_sink: Mutex::new(None),
                state_store,
            }),
        }
    }

    /// Install the owner-scoped event forwarder. Called once from main.rs after
    /// the broker exists; the closure typically wraps `send_owner_event`.
    pub fn set_event_sink(&self, sink: EventSink) {
        *super::recover_lock(&self.inner.event_sink) = Some(sink);
    }

    /// Terminate live shells whose folder is this project, so a rename or close
    /// is not blocked by an open terminal.
    pub fn kill_workspace(&self, workspace_root: &Path) {
        let wanted = normalized_root(workspace_root);
        let matched: Vec<(String, LiveTerminal)> = {
            let mut live = super::recover_lock(&self.inner.live);
            let ids: Vec<String> = live
                .iter()
                .filter(|(_, terminal)| normalized_root(&terminal.workspace_root) == wanted)
                .map(|(id, _)| id.clone())
                .collect();
            ids.into_iter()
                .filter_map(|id| live.remove(&id).map(|terminal| (id, terminal)))
                .collect()
        };
        for (terminal_id, terminal) in matched {
            let key = self.key(&terminal.owner, &terminal.workspace_root);
            let generation = terminal.generation;
            super::spawn::kill_live_terminal(terminal);
            let _ = self
                .inner
                .registry
                .finish_close(&key, &terminal_id, generation);
        }
    }

    /// Terminate every live PTY owned by `owner` across all workspace roots.
    /// Called by the host when a native window is destroyed, before revoking
    /// the owner. Idempotent.
    pub fn kill_owner(&self, owner: &OwnerId) {
        let leases = self.inner.registry.cleanup_owner(owner);
        for (key, lease) in leases {
            self.terminate_and_finish(&key, &lease);
        }
    }

    /// Terminate every live PTY in every owner partition. Called on application
    /// exit. Idempotent.
    pub fn kill_all(&self) {
        let live: Vec<(String, LiveTerminal)> =
            super::recover_lock(&self.inner.live).drain().collect();
        for (terminal_id, lt) in live {
            let key = self.key(&lt.owner, &lt.workspace_root);
            let generation = lt.generation;
            super::spawn::kill_live_terminal(lt);
            let _ = self
                .inner
                .registry
                .finish_close(&key, &terminal_id, generation);
        }
    }

    pub(in crate::terminal) fn key(&self, owner: &OwnerId, workspace_root: &Path) -> TerminalKey {
        TerminalKey {
            owner: owner.clone(),
            workspace_root: workspace_root.to_path_buf(),
        }
    }

    /// Atomically verify that output belongs to the current PTY generation and
    /// append it to that generation's journal. Restart/close use the same
    /// live-then-output lock order, preventing an old reader from appending
    /// between validation and journal replacement.
    pub(in crate::terminal) fn append_output_if_current(
        &self,
        terminal_id: &str,
        generation: u64,
        chunk: &[u8],
    ) -> Option<u64> {
        let live = super::recover_lock(&self.inner.live);
        if live
            .get(terminal_id)
            .is_none_or(|terminal| terminal.generation != generation)
        {
            return None;
        }
        let mut outputs = super::recover_lock(&self.inner.outputs);
        let output = outputs
            .entry(terminal_id.to_string())
            .or_insert_with(|| TerminalOutputStore::new(TerminalLimits::default()));
        Some(output.append(chunk))
    }

    pub(in crate::terminal) fn emit_output(
        &self,
        owner: &OwnerId,
        terminal_id: &str,
        generation: u64,
        sequence: u64,
        bytes: &[u8],
    ) {
        self.emit(
            owner,
            json!({
                "type": "terminal_event",
                "payload": {
                    "type": "terminal_output",
                    "terminalId": terminal_id,
                    "generation": generation,
                    "firstSequence": sequence,
                    "lastSequence": sequence,
                    "dataBase64": BASE64.encode(bytes),
                }
            }),
        );
    }

    pub(in crate::terminal) fn persist(&self, owner: &OwnerId, workspace_root: &Path) {
        let active_index = self
            .inner
            .state_store
            .load_for_workspace(workspace_root)
            .ok()
            .flatten()
            .and_then(|metadata| metadata.active_index);
        self.persist_with_active_index(owner, workspace_root, active_index);
    }

    pub(in crate::terminal) fn persist_with_active_index(
        &self,
        owner: &OwnerId,
        workspace_root: &Path,
        active_index: Option<usize>,
    ) {
        let key = self.key(owner, workspace_root);
        let descriptors = self.inner.registry.descriptors(&key);
        let default_profile = descriptors
            .first()
            .map(|d| d.profile_id.clone())
            .unwrap_or_else(|| "default".to_string());
        let mut metadata = WorkspaceTerminalMetadata::new(&default_profile);
        metadata.tabs = descriptors
            .iter()
            .map(|d| PersistedTabDescriptor {
                label: d.label.clone(),
                profile_id: d.profile_id.clone(),
                running: d.status == TerminalStatus::Running,
            })
            .collect();
        let previous = self
            .inner
            .state_store
            .load_for_workspace(workspace_root)
            .ok()
            .flatten();
        metadata.panel_height_px = previous.as_ref().and_then(|value| value.panel_height_px);
        metadata.active_index = active_index.filter(|index| *index < metadata.tabs.len());
        if let Err(err) = self
            .inner
            .state_store
            .save_for_workspace(workspace_root, &metadata)
        {
            log::warn!("[spopi-host] failed to persist terminal state: {err:?}");
        }
    }

    pub(in crate::terminal) fn emit(&self, owner: &OwnerId, value: Value) {
        if let Some(sink) = super::recover_lock(&self.inner.event_sink).as_ref() {
            sink(owner, value);
        }
    }
}

pub(in crate::terminal) fn err_str_owned(err: TerminalError) -> String {
    err_str(err).to_string()
}

pub(in crate::terminal) fn label_for_profile(profile_id: &str) -> String {
    match profile_id {
        "git-bash" => "Git Bash".to_string(),
        "powershell" => "PowerShell".to_string(),
        "command-prompt" => "CMD".to_string(),
        "default" => "Default".to_string(),
        _ => "Terminal".to_string(),
    }
}

pub(in crate::terminal) fn default_preferred_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| String::new())
}

#[cfg(windows)]
pub(in crate::terminal) mod windows_job {
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, TerminateJobObject,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
    };

    /// Owned handle to a Win32 Job Object. Wraps the raw `HANDLE` (a
    /// `*mut c_void`, which is `!Send`) so a terminal's job handle can cross
    /// the thread boundary imposed by `tauri::State` and
    /// `tauri::async_runtime::spawn`.
    ///
    /// Soundness: a Job Object handle is an opaque, process-local identifier
    /// for a kernel object whose operations the kernel itself serializes.
    /// Sending or sharing the *handle value* between threads is therefore
    /// safe; only `create_and_assign` mints a `JobHandle` and only
    /// `terminate` consumes it (terminate-then-close, exactly once).
    pub struct JobHandle(HANDLE);

    // SAFETY: `HANDLE` is an integer identifying a kernel object. The kernel
    // synchronizes all Job Object operations, so the handle value can be
    // moved between threads and shared by reference. The wrapper never
    // mutates the handle after construction.
    unsafe impl Send for JobHandle {}
    unsafe impl Sync for JobHandle {}

    /// Create a Job Object and assign the freshly spawned child to it so the
    /// whole process tree dies with the terminal. Returns the job handle.
    pub fn create_and_assign(pid: u32) -> Option<JobHandle> {
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return None;
            }
            if pid != 0 {
                let proc = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
                if !proc.is_null() {
                    AssignProcessToJobObject(job, proc);
                    CloseHandle(proc);
                }
            }
            Some(JobHandle(job))
        }
    }

    /// Terminate every process in the job, then close the handle.
    pub fn terminate(job: JobHandle) {
        unsafe {
            TerminateJobObject(job.0, 1);
            CloseHandle(job.0);
        }
    }
}

#[cfg(test)]
#[path = "manager_tests.rs"]
mod tests;
