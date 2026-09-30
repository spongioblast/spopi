// ABOUTME: Dispatches terminal WebSocket commands to the live PTY manager.
// ABOUTME: It does not open a PTY; spawn.rs owns process creation.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde_json::{json, Value};
use std::path::Path;

use crate::platform::window_owner::OwnerId;
use crate::terminal::manager::{
    default_preferred_shell, err_str_owned, label_for_profile, TerminalManager,
};
use crate::terminal::output::{TerminalLimits, TerminalOutputStore};
use crate::terminal::profiles::list_shell_profiles;
use crate::terminal::registry::{TerminalDescriptor, TerminalError};
use crate::terminal::state_store::{PersistedTabDescriptor, WorkspaceTerminalMetadata};
use portable_pty::PtySize;

pub(in crate::terminal) const INPUT_MAX_BYTES: usize = 64 * 1024;
pub(in crate::terminal) const CHECKPOINT_MAX_BYTES: usize = 2 * 1024 * 1024;

impl TerminalManager {
    pub fn dispatch(
        &self,
        owner: &OwnerId,
        workspace_root: &Path,
        payload: &Value,
    ) -> Result<Value, String> {
        let kind = payload.get("type").and_then(Value::as_str).unwrap_or("");
        match kind {
            "terminal_list" => self.list(owner, workspace_root),
            "terminal_profiles" => self.profiles(),
            "terminal_create" => self.create(owner, workspace_root, payload),
            "terminal_input" => self.create_input(owner, workspace_root, payload),
            "terminal_resize" => self.resize(owner, workspace_root, payload),
            "terminal_checkpoint" => self.checkpoint(owner, workspace_root, payload),
            "terminal_ack" => self.ack(owner, workspace_root, payload),
            "terminal_close" => self.close(owner, workspace_root, payload),
            "terminal_restart" => self.restart(owner, workspace_root, payload),
            "terminal_activate" => self.activate(owner, workspace_root, payload),
            "terminal_reorder" => self.reorder(owner, workspace_root, payload),
            "terminal_set_panel_height" => {
                let height = payload
                    .get("heightPx")
                    .and_then(Value::as_u64)
                    .ok_or_else(|| "heightPx is required".to_string())?;
                let height =
                    u32::try_from(height).map_err(|_| "heightPx is out of range".to_string())?;
                self.set_panel_height(owner, workspace_root, height);
                Ok(json!({ "type": "terminal_command_acked" }))
            }
            other => Err(format!("unknown terminal command: {other}")),
        }
    }

    fn profiles(&self) -> Result<Value, String> {
        Ok(json!({
            "type": "terminal_profiles",
            "profiles": list_shell_profiles(self.inner.probe.as_ref(), &default_preferred_shell()),
        }))
    }

    fn list(&self, owner: &OwnerId, workspace_root: &Path) -> Result<Value, String> {
        let key = self.key(owner, workspace_root);
        let descriptors = self.inner.registry.descriptors(&key);
        let persisted = self
            .inner
            .state_store
            .load_for_workspace(workspace_root)
            .ok()
            .flatten();
        let tabs: Vec<Value> = if descriptors.is_empty() {
            // Fresh owner/partition (new app run): surface persisted tab metadata
            // so the panel can re-create fresh shells. Live PTYs are never restored.
            // The file is shared per workspace, so while another client's shells
            // are alive it describes them, not a lost run.
            if self.inner.registry.live_under_other_owner(&key) {
                Vec::new()
            } else {
                self.restored_metadata(persisted.as_ref())
            }
        } else {
            self.live_tab_descriptors(&descriptors)
        };
        Ok(json!({
            "type": "terminal_listed",
            "tabs": tabs,
            "panelHeightPx": persisted.as_ref().and_then(|meta| meta.panel_height_px),
            "activeIndex": persisted.as_ref().and_then(|meta| meta.active_index),
        }))
    }

    /// Surface persisted tab metadata (label/profile) for a fresh app run so the
    /// panel can re-create fresh shells. Live PTYs/checkpoints are never restored.
    fn restored_metadata(&self, metadata: Option<&WorkspaceTerminalMetadata>) -> Vec<Value> {
        metadata
            .into_iter()
            .flat_map(|meta| meta.tabs.iter().enumerate())
            .map(|(index, t)| {
                json!({
                    "terminalId": format!("restored-{index}"),
                    "generation": 0,
                    "status": "restoredMetadata",
                    "profileId": t.profile_id,
                    "label": label_for_profile(&t.profile_id),
                    "running": t.running,
                })
            })
            .collect()
    }

    fn live_tab_descriptors(&self, descriptors: &[TerminalDescriptor]) -> Vec<Value> {
        let outputs = super::recover_lock(&self.inner.outputs);
        descriptors
            .iter()
            .map(|d| {
                let output = outputs.get(&d.terminal_id);
                json!({
                    "terminalId": d.terminal_id,
                    "generation": d.generation,
                    "status": d.status,
                    "profileId": d.profile_id,
                    "label": label_for_profile(&d.profile_id),
                    "exitCode": d.exit_code,
                    "failReason": d.fail_reason,
                    "checkpoint": output.and_then(|o| o.checkpoint()).map(|b| BASE64.encode(b)),
                    "checkpointWatermark": output.map(|o| o.checkpoint_watermark()).unwrap_or(0),
                    "historyGap": output.map(|o| o.history_gap()).unwrap_or(false),
                    "journal": output.and_then(|o| {
                        let wm = o.checkpoint_watermark();
                        o.journal_from(wm).map(|batch| json!({
                            "firstSequence": batch.first_sequence,
                            "lastSequence": batch.last_sequence,
                            "dataBase64": BASE64.encode(&batch.bytes),
                        }))
                    }),
                })
            })
            .collect()
    }

    fn create(
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
        let label = label_for_profile(profile_id);
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

    fn create_input(
        &self,
        owner: &OwnerId,
        workspace_root: &Path,
        payload: &Value,
    ) -> Result<Value, String> {
        let (terminal_id, generation, bytes) = decode_target_bytes(payload, INPUT_MAX_BYTES)?;
        let key = self.key(owner, workspace_root);
        self.inner
            .registry
            .require_running(&key, &terminal_id, generation)
            .map_err(err_str_owned)?;
        let mut live = super::recover_lock(&self.inner.live);
        let lt = live
            .get_mut(&terminal_id)
            .ok_or_else(|| "terminal is not running".to_string())?;
        if lt.generation != generation {
            return Err(err_str_owned(TerminalError::StaleGeneration));
        }
        lt.writer
            .write_all(&bytes)
            .map_err(|e| format!("terminal write failed: {e}"))?;
        lt.writer
            .flush()
            .map_err(|e| format!("terminal flush failed: {e}"))?;
        Ok(json!({ "type": "terminal_input_acked", "terminalId": terminal_id }))
    }

    fn resize(
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
        let cols_raw = payload
            .get("cols")
            .and_then(Value::as_u64)
            .ok_or_else(|| "cols is required".to_string())?;
        let rows_raw = payload
            .get("rows")
            .and_then(Value::as_u64)
            .ok_or_else(|| "rows is required".to_string())?;
        // Validate the full range before truncating to u16: `as u16` would
        // silently wrap oversized values (e.g. 65536 -> 0).
        if cols_raw == 0
            || rows_raw == 0
            || cols_raw > u16::MAX as u64
            || rows_raw > u16::MAX as u64
        {
            return Err("terminal dimensions out of range".to_string());
        }
        let cols = cols_raw as u16;
        let rows = rows_raw as u16;
        let key = self.key(owner, workspace_root);
        self.inner
            .registry
            .require_running(&key, &terminal_id, generation)
            .map_err(err_str_owned)?;
        let mut live = super::recover_lock(&self.inner.live);
        let lt = live
            .get_mut(&terminal_id)
            .ok_or_else(|| "terminal is not running".to_string())?;
        if lt.generation != generation {
            return Err(err_str_owned(TerminalError::StaleGeneration));
        }
        lt.master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("terminal resize failed: {e}"))?;
        Ok(json!({ "type": "terminal_resized", "terminalId": terminal_id }))
    }

    fn checkpoint(
        &self,
        owner: &OwnerId,
        workspace_root: &Path,
        payload: &Value,
    ) -> Result<Value, String> {
        let (terminal_id, generation, snapshot) =
            decode_target_bytes(payload, CHECKPOINT_MAX_BYTES)?;
        let watermark = payload
            .get("watermark")
            .and_then(Value::as_u64)
            .ok_or_else(|| "watermark is required".to_string())?;
        let key = self.key(owner, workspace_root);
        self.inner
            .registry
            .require_running(&key, &terminal_id, generation)
            .map_err(err_str_owned)?;
        let mut outputs = super::recover_lock(&self.inner.outputs);
        let output = outputs
            .entry(terminal_id.clone())
            .or_insert_with(|| TerminalOutputStore::new(TerminalLimits::default()));
        output
            .accept_checkpoint(watermark, snapshot)
            .map_err(|e| format!("checkpoint rejected: {e:?}"))?;
        Ok(json!({ "type": "terminal_checkpoint_acked", "terminalId": terminal_id }))
    }

    fn ack(
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
        let sequence = payload
            .get("sequence")
            .and_then(Value::as_u64)
            .ok_or_else(|| "sequence is required".to_string())?;
        let key = self.key(owner, workspace_root);
        self.inner
            .registry
            .require_running(&key, &terminal_id, generation)
            .map_err(err_str_owned)?;
        let mut outputs = super::recover_lock(&self.inner.outputs);
        if let Some(output) = outputs.get_mut(&terminal_id) {
            output.ack(sequence);
        }
        Ok(json!({ "type": "terminal_ack_acked", "terminalId": terminal_id }))
    }

    fn close(
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

    fn restart(
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
        let previous_profile = super::recover_lock(&self.inner.live)
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

    fn activate(
        &self,
        owner: &OwnerId,
        workspace_root: &Path,
        payload: &Value,
    ) -> Result<Value, String> {
        let terminal_id = payload
            .get("terminalId")
            .and_then(Value::as_str)
            .ok_or_else(|| "terminalId is required".to_string())?;
        let generation = payload
            .get("generation")
            .and_then(Value::as_u64)
            .ok_or_else(|| "generation is required".to_string())?;
        let descriptors = self
            .inner
            .registry
            .descriptors(&self.key(owner, workspace_root));
        let active_index = descriptors
            .iter()
            .position(|descriptor| {
                descriptor.terminal_id == terminal_id && descriptor.generation == generation
            })
            .ok_or_else(|| err_str_owned(TerminalError::UnknownTerminal))?;
        self.persist_with_active_index(owner, workspace_root, Some(active_index));
        Ok(json!({ "type": "terminal_command_acked" }))
    }

    fn reorder(
        &self,
        owner: &OwnerId,
        workspace_root: &Path,
        payload: &Value,
    ) -> Result<Value, String> {
        let ordered_terminal_ids = payload
            .get("orderedTerminalIds")
            .and_then(Value::as_array)
            .ok_or_else(|| "orderedTerminalIds is required".to_string())?
            .iter()
            .map(|value| {
                value
                    .as_str()
                    .map(str::to_string)
                    .ok_or_else(|| "orderedTerminalIds must contain strings".to_string())
            })
            .collect::<Result<Vec<_>, _>>()?;
        let key = self.key(owner, workspace_root);
        let before = self.inner.registry.descriptors(&key);
        let active_terminal_id = self
            .inner
            .state_store
            .load_for_workspace(workspace_root)
            .ok()
            .flatten()
            .and_then(|metadata| metadata.active_index)
            .and_then(|index| before.get(index))
            .map(|descriptor| descriptor.terminal_id.clone());
        self.inner
            .registry
            .reorder(&key, &ordered_terminal_ids)
            .map_err(err_str_owned)?;
        let active_index = active_terminal_id.and_then(|terminal_id| {
            self.inner
                .registry
                .descriptors(&key)
                .iter()
                .position(|descriptor| descriptor.terminal_id == terminal_id)
        });
        self.persist_with_active_index(owner, workspace_root, active_index);
        Ok(json!({ "type": "terminal_command_acked" }))
    }

    fn set_panel_height(&self, owner: &OwnerId, workspace_root: &Path, height: u32) {
        let key = self.key(owner, workspace_root);
        let descriptors = self.inner.registry.descriptors(&key);
        let mut metadata = self
            .inner
            .state_store
            .load_for_workspace(workspace_root)
            .ok()
            .flatten()
            .unwrap_or_else(|| WorkspaceTerminalMetadata::new("default"));
        if !descriptors.is_empty() {
            metadata.default_profile_id = descriptors
                .first()
                .map(|d| d.profile_id.clone())
                .unwrap_or_else(|| "default".to_string());
            metadata.tabs = descriptors
                .iter()
                .map(|d| PersistedTabDescriptor {
                    label: d.label.clone(),
                    profile_id: d.profile_id.clone(),
                    running: d.status == super::registry::TerminalStatus::Running,
                })
                .collect();
        }
        metadata.panel_height_px = Some(height);
        if let Err(err) = self
            .inner
            .state_store
            .save_for_workspace(workspace_root, &metadata)
        {
            log::warn!("[spopi-host] failed to persist panel height: {err:?}");
        }
    }
}

fn decode_target_bytes(
    payload: &Value,
    max_bytes: usize,
) -> Result<(String, u64, Vec<u8>), String> {
    let terminal_id = payload
        .get("terminalId")
        .and_then(Value::as_str)
        .ok_or_else(|| "terminalId is required".to_string())?
        .to_string();
    let generation = payload
        .get("generation")
        .and_then(Value::as_u64)
        .ok_or_else(|| "generation is required".to_string())?;
    let data_b64 = payload
        .get("dataBase64")
        .and_then(Value::as_str)
        .ok_or_else(|| "dataBase64 is required".to_string())?;
    let bytes = BASE64
        .decode(data_b64)
        .map_err(|e| format!("invalid base64: {e}"))?;
    if bytes.len() > max_bytes {
        return Err(format!("payload exceeds {max_bytes} bytes"));
    }
    Ok((terminal_id, generation, bytes))
}
