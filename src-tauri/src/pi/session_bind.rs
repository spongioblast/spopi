// ABOUTME: Binds a live pi instance to a session id and serves snapshots.
// ABOUTME: It also sends extension UI replies. Spawn stays in runtime.rs, reaping in idle.rs.

use super::runtime::{NativeRuntimeEvent, PiRuntime};
use crate::pi::coordinator::{RuntimeSnapshot, RuntimeStatus, RuntimeTarget};
use serde_json::Value;

impl PiRuntime {
    pub fn target_for_session(
        &self,
        workspace_id: &str,
        session_id: &str,
    ) -> Option<RuntimeTarget> {
        self.inner
            .runtimes
            .lock()
            .ok()?
            .values()
            .find(|runtime| {
                runtime.target.lock().is_ok_and(|target| {
                    target.workspace_id == workspace_id && target.session_id == session_id
                })
            })
            .and_then(|runtime| runtime.target.lock().ok().map(|target| target.clone()))
    }

    pub fn target_for_session_id(&self, session_id: &str) -> Option<RuntimeTarget> {
        self.inner
            .runtimes
            .lock()
            .ok()?
            .values()
            .find(|runtime| {
                runtime
                    .target
                    .lock()
                    .is_ok_and(|target| target.session_id == session_id)
            })
            .and_then(|runtime| runtime.target.lock().ok().map(|target| target.clone()))
    }

    pub fn bind_session_id(
        &self,
        temporary: &RuntimeTarget,
        session_id: &str,
    ) -> Result<RuntimeTarget, String> {
        if !temporary.session_id.starts_with("temporary-") {
            return Ok(temporary.clone());
        }
        self.rebind_session_id_with_event(temporary, session_id, "session_bound")
    }

    /// Re-point a *formal* (non-"temporary-") session id to another formal
    /// session id, for an instance whose live session changed identity out
    /// from under the registry — e.g. pi forking a new session file in place
    /// for the same running instance. Unlike `bind_session_id`, this has no
    /// "temporary-" guard: the caller (the fork RPC flow) is responsible for
    /// only calling this once it has confirmed via `get_session_stats` that
    /// the instance is actually on a different session now. Without this,
    /// the registry keeps reporting the old session id forever, which desyncs
    /// `target_for_session_id` lookups (used by snapshot requests) and the
    /// per-client event `subscriptions` set (keyed on the full target tuple),
    /// silently breaking event delivery for any client that adopts the new id
    /// locally without the backend ever learning about it.
    pub fn rebind_session_id(
        &self,
        current: &RuntimeTarget,
        session_id: &str,
    ) -> Result<RuntimeTarget, String> {
        self.rebind_session_id_with_event(current, session_id, "session_rebound")
    }

    fn rebind_session_id_with_event(
        &self,
        current: &RuntimeTarget,
        session_id: &str,
        event_type: &str,
    ) -> Result<RuntimeTarget, String> {
        let mut coordinator = self
            .inner
            .coordinator
            .lock()
            .map_err(|_| "Runtime coordinator lock poisoned".to_string())?;
        let binding_event = coordinator
            .emit_event(
                current,
                serde_json::json!({
                    "type": event_type,
                    "sessionId": session_id,
                }),
            )
            .map_err(|error| format!("Cannot sequence session binding: {error:?}"))?;
        let formal = coordinator
            .bind_session_id(current, session_id)
            .map_err(|error| format!("Cannot bind formal session: {error:?}"))?;
        drop(coordinator);
        let runtime = self
            .inner
            .runtimes
            .lock()
            .map_err(|_| "Native runtime registry lock poisoned".to_string())?;
        let managed = runtime
            .get(&current.instance_id)
            .ok_or_else(|| "Native runtime instance is not running".to_string())?;
        *managed
            .target
            .lock()
            .map_err(|_| "Native runtime target lock poisoned".to_string())? = formal.clone();
        drop(runtime);
        let _ = self.inner.events.send(NativeRuntimeEvent {
            target: binding_event.target,
            sequence: binding_event.sequence,
            event: binding_event.event,
        });
        Ok(formal)
    }

    pub fn snapshot(&self, target: &RuntimeTarget) -> Result<RuntimeSnapshot, String> {
        self.inner.touch(&target.instance_id);
        self.inner
            .coordinator
            .lock()
            .map_err(|_| "Runtime coordinator lock poisoned".to_string())?
            .snapshot(target)
            .map_err(|error| format!("Runtime snapshot rejected: {error:?}"))
    }

    pub fn statuses(&self) -> Result<Vec<RuntimeStatus>, String> {
        Ok(self
            .inner
            .coordinator
            .lock()
            .map_err(|_| "Runtime coordinator lock poisoned".to_string())?
            .statuses())
    }

    pub async fn respond_extension_ui(
        &self,
        target: &RuntimeTarget,
        response: Value,
    ) -> Result<(), String> {
        self.inner
            .coordinator
            .lock()
            .map_err(|_| "Runtime coordinator lock poisoned".to_string())?
            .validate(target)
            .map_err(|error| format!("Extension UI response rejected: {error:?}"))?;
        if response.get("type").and_then(Value::as_str) != Some("extension_ui_response") {
            return Err("Expected extension_ui_response".into());
        }
        let bridge = self
            .inner
            .runtimes
            .lock()
            .map_err(|_| "Native runtime registry lock poisoned".to_string())?
            .get(&target.instance_id)
            .map(|runtime| runtime.bridge.clone())
            .ok_or_else(|| "Native runtime instance is not running".to_string())?;
        let response_id = response
            .get("id")
            .and_then(Value::as_str)
            .map(str::to_owned);
        bridge
            .send_frame(response)
            .await
            .map_err(|error| format!("Cannot send extension UI response: {error:?}"))?;
        if let Some(response_id) = response_id {
            let mut pending = self
                .inner
                .pending_ui
                .lock()
                .map_err(|_| "Pending extension UI lock poisoned".to_string())?;
            if let Some(events) = pending.get_mut(&target.instance_id) {
                events.retain(|event| {
                    event.event.get("id").and_then(Value::as_str) != Some(response_id.as_str())
                });
            }
        }
        Ok(())
    }
}
