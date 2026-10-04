// ABOUTME: Handles terminal lifecycle commands: create, close, and restart a tab's shell.
// ABOUTME: It drives registry transitions around spawn.rs; process creation itself stays there.

use serde_json::{json, Value};
use std::path::Path;

use crate::platform::window_owner::OwnerId;
use crate::terminal::manager::{err_str_owned, label_for_profile, TerminalManager};
use crate::terminal::recover_lock;
use crate::terminal::registry::TerminalError;

const MAX_TAB_LABEL_CHARS: usize = 32;

impl TerminalManager {
    pub(super) fn create(
        &self,
        owner: &OwnerId,
        workspace_root: &Path,
        payload: &Value,
    ) -> Result<Value, String> {
        let profile_id = payload
            .get("profileId")
            .and_then(Value::as_str)
            .unwrap_or("default");
        let key = self.key(owner, workspace_root);
        let label = payload
            .get("label")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|label| !label.is_empty())
            .map(|label| label.chars().take(MAX_TAB_LABEL_CHARS).collect())
            .unwrap_or_else(|| label_for_profile(profile_id));
        let reservation = self
            .inner
            .registry
            .reserve_tab_with_profile(&key, profile_id, label)
            .map_err(err_str_owned)?;

        let shell = match self.resolve_shell(profile_id) {
            Ok(shell) => shell,
            Err(reason) => {
                let _ = self.inner.registry.mark_failed(
                    &key,
                    &reservation.terminal_id,
                    reservation.generation,
                    reason.clone(),
                );
                return Err(reason);
            }
        };

        let spawned = match self.spawn_pty_for_profile(profile_id, &shell, workspace_root) {
            Ok(s) => s,
            Err(reason) => {
                let _ = self.inner.registry.mark_failed(
                    &key,
                    &reservation.terminal_id,
                    reservation.generation,
                    reason.clone(),
                );
                return Err(reason);
            }
        };

        if let Err(err) = self.inner.registry.commit_running(
            &key,
            &reservation.terminal_id,
            reservation.generation,
        ) {
            let reason = err_str_owned(err);
            let _ = self.inner.registry.mark_failed(
                &key,
                &reservation.terminal_id,
                reservation.generation,
                reason.clone(),
            );
            // The spawned PTY must not leak when commit fails (e.g. global quota).
            self.detach_spawned(spawned);
            return Err(reason);
        }

        self.attach_spawned(
            owner.clone(),
            workspace_root.to_path_buf(),
            reservation.terminal_id.clone(),
            reservation.generation,
            profile_id.to_string(),
            spawned,
        );
        self.persist(owner, workspace_root);
        Ok(json!({
            "type": "terminal_created",
            "terminalId": reservation.terminal_id,
            "generation": reservation.generation,
        }))
    }

    pub(super) fn close(
        &self,
        owner: &OwnerId,
        workspace_root: &Path,
        payload: &Value,
    ) -> Result<Value, String> {
        let terminal_id = payload
            .get("terminalId")
            .and_then(Value::as_str)
            .ok_or_else(|| "terminalId is required".to_string())?
            .to_string();
        let generation = payload
            .get("generation")
            .and_then(Value::as_u64)
            .ok_or_else(|| "generation is required".to_string())?;
        let key = self.key(owner, workspace_root);
        let lease = self
            .inner
            .registry
            .begin_close(&key, &terminal_id, generation)
            .map_err(err_str_owned)?;
        self.terminate_and_finish(&key, &lease);
        self.persist(owner, workspace_root);
        Ok(json!({ "type": "terminal_closed", "terminalId": terminal_id }))
    }

    pub(super) fn restart(
        &self,
        owner: &OwnerId,
        workspace_root: &Path,
        payload: &Value,
    ) -> Result<Value, String> {
        let terminal_id = payload
            .get("terminalId")
            .and_then(Value::as_str)
            .ok_or_else(|| "terminalId is required".to_string())?
            .to_string();
        let generation = payload
            .get("generation")
            .and_then(Value::as_u64)
            .ok_or_else(|| "generation is required".to_string())?;
        let requested_profile = payload
            .get("profileId")
            .and_then(Value::as_str)
            .map(str::to_string);
        let key = self.key(owner, workspace_root);
        let previous_profile = recover_lock(&self.inner.live)
            .get(&terminal_id)
            .filter(|live| live.generation == generation)
            .map(|live| live.profile_id.clone());
        let profile_id = requested_profile
            .or(previous_profile)
            .unwrap_or_else(|| "default".to_string());
        // Validate the requested profile before transitioning the existing tab.
        let shell = self.resolve_shell(&profile_id)?;
        let handle = self
            .inner
            .registry
            .restart(
                &key,
                &terminal_id,
                generation,
                &profile_id,
                label_for_profile(&profile_id),
            )
            .map_err(err_str_owned)?;

        self.replace_generation(&terminal_id, generation);
        let spawned = self
            .spawn_pty_for_profile(&profile_id, &shell, workspace_root)
            .inspect_err(|reason| {
                let _ = self.inner.registry.mark_failed(
                    &key,
                    &terminal_id,
                    handle.generation,
                    reason.clone(),
                );
            })?;
        if let Err(error) =
            self.inner
                .registry
                .commit_running(&key, &terminal_id, handle.generation)
        {
            self.detach_spawned(spawned);
            let reason = err_str_owned(error.clone());
            if !matches!(error, TerminalError::NotCreating) {
                let _ = self.inner.registry.mark_failed(
                    &key,
                    &terminal_id,
                    handle.generation,
                    reason.clone(),
                );
            }
            return Err(reason);
        }
        self.attach_spawned(
            owner.clone(),
            workspace_root.to_path_buf(),
            terminal_id.clone(),
            handle.generation,
            profile_id,
            spawned,
        );
        self.persist(owner, workspace_root);
        Ok(json!({
            "type": "terminal_restarted",
            "terminalId": terminal_id,
            "generation": handle.generation,
        }))
    }
}
