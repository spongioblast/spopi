// ABOUTME: Handles terminal tab-strip commands: list, profiles, activate, reorder, and panel height.
// ABOUTME: It reads and persists tab metadata only; it never spawns, writes to, or kills a PTY.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde_json::{json, Value};
use std::path::Path;

use crate::platform::window_owner::OwnerId;
use crate::terminal::manager::{
    default_preferred_shell, err_str_owned, label_for_profile, TerminalManager,
};
use crate::terminal::profiles::list_shell_profiles;
use crate::terminal::recover_lock;
use crate::terminal::registry::{TerminalDescriptor, TerminalError, TerminalStatus};
use crate::terminal::state_store::{PersistedTabDescriptor, WorkspaceTerminalMetadata};

impl TerminalManager {
    pub(super) fn profiles(&self) -> Result<Value, String> {
        Ok(json!({
            "type": "terminal_profiles",
            "profiles": list_shell_profiles(self.inner.probe.as_ref(), &default_preferred_shell()),
        }))
    }

    pub(super) fn list(&self, owner: &OwnerId, workspace_root: &Path) -> Result<Value, String> {
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
        let outputs = recover_lock(&self.inner.outputs);
        descriptors
            .iter()
            .map(|d| {
                let output = outputs.get(&d.terminal_id);
                json!({
                    "terminalId": d.terminal_id,
                    "generation": d.generation,
                    "status": d.status,
                    "profileId": d.profile_id,
                    "label": d.label,
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

    pub(super) fn activate(
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

    pub(super) fn reorder(
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

    pub(super) fn set_panel_height(&self, owner: &OwnerId, workspace_root: &Path, height: u32) {
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
                    running: d.status == TerminalStatus::Running,
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
