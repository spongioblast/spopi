// ABOUTME: Keeps one warm pi per workspace and hands it to the next opened session.
// ABOUTME: Spawning and refilling are decided in host/server/idle_reaper.rs.

use super::runtime::PiRuntime;
use crate::pi::coordinator::RuntimeTarget;
use serde_json::Value;
use std::time::Duration;

impl PiRuntime {
    pub fn standby_for(&self, workspace_id: &str) -> Option<RuntimeTarget> {
        self.inner.standby.lock().ok()?.get(workspace_id).cloned()
    }

    /// Host-only. Client `switch_session` stays rejected by `validate_command`.
    pub async fn host_switch_session(
        &self,
        target: &RuntimeTarget,
        session_path: &str,
    ) -> Result<Value, String> {
        self.inner
            .coordinator
            .lock()
            .map_err(|_| "Runtime coordinator lock poisoned".to_string())?
            .validate(target)
            .map_err(|error| format!("Cannot switch a standby: {error:?}"))?;
        let bridge = self
            .inner
            .runtimes
            .lock()
            .map_err(|_| "Native runtime registry lock poisoned".to_string())?
            .get(&target.instance_id)
            .map(|runtime| runtime.bridge.clone())
            .ok_or_else(|| "Standby runtime is not running".to_string())?;
        bridge
            .request(
                serde_json::json!({ "type": "switch_session", "sessionPath": session_path }),
                Duration::from_secs(5),
            )
            .await
            .map_err(|error| format!("Pi RPC request failed: {error:?}"))
    }

    /// Session id Pi already assigned to a fresh standby. `None` when that
    /// field is missing, so the caller can keep a temporary id until a later
    /// snapshot binds the real one.
    pub async fn host_session_id(&self, target: &RuntimeTarget) -> Result<Option<String>, String> {
        let response = self
            .request(
                target,
                serde_json::json!({ "type": "get_state" }),
                None,
                Duration::from_secs(5),
            )
            .await?;
        Ok(response
            .pointer("/data/sessionId")
            .and_then(Value::as_str)
            .filter(|session_id| !session_id.is_empty())
            .map(str::to_owned))
    }

    pub fn park_standby(&self, target: &RuntimeTarget) -> Result<(), String> {
        let mut slots = self
            .inner
            .standby
            .lock()
            .map_err(|_| "standby lock poisoned".to_string())?;
        if slots.contains_key(&target.workspace_id) {
            return Err("standby already exists".into());
        }
        slots.insert(target.workspace_id.clone(), target.clone());
        Ok(())
    }

    pub fn adopt_standby(
        &self,
        workspace_id: &str,
        session_id: &str,
    ) -> Result<Option<RuntimeTarget>, String> {
        let parked = self
            .inner
            .standby
            .lock()
            .map_err(|_| "standby lock poisoned".to_string())?
            .remove(workspace_id);
        let Some(parked) = parked else {
            return Ok(None);
        };
        let updated = self
            .inner
            .coordinator
            .lock()
            .map_err(|_| "Runtime coordinator lock poisoned".to_string())?
            .rekey_session(&parked.instance_id, session_id)
            .map_err(|error| format!("Cannot adopt standby: {error:?}"))?;
        if let Some(runtime) = self
            .inner
            .runtimes
            .lock()
            .map_err(|_| "Native runtime registry lock poisoned".to_string())?
            .get(&parked.instance_id)
        {
            if let Ok(mut target) = runtime.target.lock() {
                *target = updated.clone();
            }
        }
        Ok(Some(updated))
    }

    pub fn stop_standby(&self, workspace_id: &str) -> Option<RuntimeTarget> {
        let parked = self.inner.standby.lock().ok()?.remove(workspace_id)?;
        let _ = self.stop(&parked);
        Some(parked)
    }
}

#[cfg(test)]
#[path = "standby_tests.rs"]
mod tests;
