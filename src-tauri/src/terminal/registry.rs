// ABOUTME: Owner-scoped terminal ownership: workspace tab quota, global live-PTY
// ABOUTME: quota, generation-checked state transitions, and redacted descriptors.
// ABOUTME: The partition key is (owner, canonical workspace root), never workspace generation.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use rand::rngs::OsRng;
use rand::RngCore;
use serde::Serialize;

use crate::platform::hex::hex_encode;
use crate::platform::window_owner::OwnerId;

/// Fixed workspace tab quota. Every non-closing tab record — including failed
/// and exited tabs — consumes one of these slots until it is explicitly closed.
pub const WORKSPACE_TAB_QUOTA: usize = 5;

const TERMINAL_ID_BYTES: usize = 12;

/// Live-terminal partition key. Two native windows on the same canonical path
/// never share live terminals, output, or quotas because their owner ids differ.
/// `workspaceGeneration` is intentionally absent: it authorizes the *current*
/// attachment, not the retained partition, so a background workspace can
/// reattach its terminals when it returns.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct TerminalKey {
    pub owner: OwnerId,
    pub workspace_root: PathBuf,
}

/// Identifies one terminal tab plus its current PTY generation. Required for
/// every mutation of an existing tab so a stale page cannot control a
/// replacement process.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct TerminalHandle {
    pub terminal_id: String,
    pub generation: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TerminalStatus {
    Creating,
    Running,
    Exited,
    Failed,
    Closing,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalDescriptor {
    pub terminal_id: String,
    pub generation: u64,
    pub status: TerminalStatus,
    pub profile_id: String,
    pub label: String,
    /// Exit code when available, only meaningful for `Exited`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    /// Sanitized failure reason, only meaningful for `Failed`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fail_reason: Option<String>,
}

/// Reservation returned by `reserve_tab`. The caller spawns the PTY and then
/// either commits it running or marks it failed.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TerminalReservation {
    pub terminal_id: String,
    pub generation: u64,
    pub profile_id: String,
}

/// Lease returned when a tab begins closing. The manager terminates the PTY
/// process tree and then calls `finish_close`.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CloseLease {
    pub terminal_id: String,
    pub generation: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TerminalError {
    WorkspaceTabQuota,
    GlobalProcessQuota,
    UnknownTerminal,
    StaleGeneration,
    NotCreating,
    NotRunning,
    AlreadyClosing,
    InvalidTabOrder,
}

/// Human-readable message for a terminal error, safe to return to the client.
pub fn err_str(err: TerminalError) -> &'static str {
    match err {
        TerminalError::WorkspaceTabQuota => "workspace terminal tab quota reached",
        TerminalError::GlobalProcessQuota => "global live terminal quota reached",
        TerminalError::UnknownTerminal => "unknown terminal",
        TerminalError::StaleGeneration => "stale terminal generation",
        TerminalError::NotCreating => "terminal is not creating",
        TerminalError::NotRunning => "terminal is not running",
        TerminalError::AlreadyClosing => "terminal is already closing",
        TerminalError::InvalidTabOrder => "terminal tab order is invalid",
    }
}

#[derive(Clone, Default)]
pub struct TerminalRegistry {
    inner: Arc<Mutex<RegistryState>>,
    global_process_quota: usize,
}

#[derive(Default)]
struct RegistryState {
    partitions: HashMap<TerminalKey, Partition>,
}

#[derive(Default)]
struct Partition {
    records: Vec<Record>,
    next_generation: u64,
}

impl Partition {
    fn allocate_generation(&mut self) -> u64 {
        self.next_generation += 1;
        self.next_generation
    }

    fn find_mut(&mut self, terminal_id: &str, generation: u64) -> Option<&mut Record> {
        self.records
            .iter_mut()
            .find(|r| r.terminal_id == terminal_id && r.generation == generation)
    }

    fn non_closing_count(&self) -> usize {
        self.records
            .iter()
            .filter(|r| r.status != TerminalStatus::Closing)
            .count()
    }
}

struct Record {
    terminal_id: String,
    generation: u64,
    status: TerminalStatus,
    profile_id: String,
    label: String,
    exit_code: Option<i32>,
    fail_reason: Option<String>,
}

impl Record {
    fn descriptor(&self) -> TerminalDescriptor {
        TerminalDescriptor {
            terminal_id: self.terminal_id.clone(),
            generation: self.generation,
            status: self.status,
            profile_id: self.profile_id.clone(),
            label: self.label.clone(),
            exit_code: self.exit_code,
            fail_reason: self.fail_reason.clone(),
        }
    }
}

impl TerminalRegistry {
    /// Create a registry with a fixed global live-PTY quota. The workspace
    /// tab quota is fixed at `WORKSPACE_TAB_QUOTA`.
    pub fn new(global_process_quota: usize) -> Self {
        Self {
            inner: Arc::new(Mutex::new(RegistryState::default())),
            global_process_quota,
        }
    }

    /// Reserve a workspace tab slot and a global live/reserved PTY slot, and
    /// allocate a terminal id + generation. Reserve-before-spawn is atomic: a
    /// full workspace or global quota is rejected before any PTY is created.
    pub fn reserve_tab_with_profile(
        &self,
        key: &TerminalKey,
        profile_id: &str,
        label: String,
    ) -> Result<TerminalReservation, TerminalError> {
        let mut state = super::recover_lock(&self.inner);
        if self.live_reservations_locked(&state) >= self.global_process_quota {
            return Err(TerminalError::GlobalProcessQuota);
        }
        let partition = state.partitions.entry(key.clone()).or_default();
        if partition.non_closing_count() >= WORKSPACE_TAB_QUOTA {
            return Err(TerminalError::WorkspaceTabQuota);
        }
        let terminal_id = fresh_terminal_id();
        let generation = partition.allocate_generation();
        partition.records.push(Record {
            terminal_id: terminal_id.clone(),
            generation,
            status: TerminalStatus::Creating,
            profile_id: profile_id.to_string(),
            label,
            exit_code: None,
            fail_reason: None,
        });
        Ok(TerminalReservation {
            terminal_id,
            generation,
            profile_id: profile_id.to_string(),
        })
    }

    /// Promote a `Creating` reservation to `Running`. The global live slot was
    /// already reserved by `reserve_tab`, so this does not re-check the quota;
    /// it only validates the reservation identity and state.
    pub fn commit_running(
        &self,
        key: &TerminalKey,
        terminal_id: &str,
        generation: u64,
    ) -> Result<TerminalHandle, TerminalError> {
        let mut state = super::recover_lock(&self.inner);
        let partition = state
            .partitions
            .get_mut(key)
            .ok_or(TerminalError::UnknownTerminal)?;
        let record = partition
            .find_mut(terminal_id, generation)
            .ok_or(TerminalError::UnknownTerminal)?;
        if record.status != TerminalStatus::Creating {
            return Err(TerminalError::NotCreating);
        }
        record.status = TerminalStatus::Running;
        Ok(TerminalHandle {
            terminal_id: terminal_id.to_string(),
            generation,
        })
    }

    /// Mark a `Creating` reservation failed without spawning. The record stays
    /// visible in its workspace slot (consuming tab quota) so it can be retried
    /// or closed; it releases its global live/reserved slot because `Failed`
    /// no longer counts as live.
    pub fn mark_failed(
        &self,
        key: &TerminalKey,
        terminal_id: &str,
        generation: u64,
        reason: String,
    ) -> Result<(), TerminalError> {
        let mut state = super::recover_lock(&self.inner);
        let partition = state
            .partitions
            .get_mut(key)
            .ok_or(TerminalError::UnknownTerminal)?;
        let record = partition
            .find_mut(terminal_id, generation)
            .ok_or(TerminalError::UnknownTerminal)?;
        record.status = TerminalStatus::Failed;
        record.fail_reason = Some(reason);
        Ok(())
    }

    /// Record a natural PTY exit. Transitions `Running` to `Exited`, releasing
    /// the live-PTY slot. Output and exit code remain available for Restart/Close.
    pub fn mark_exited(
        &self,
        key: &TerminalKey,
        terminal_id: &str,
        generation: u64,
        exit_code: Option<i32>,
    ) -> Result<(), TerminalError> {
        let mut state = super::recover_lock(&self.inner);
        let partition = state
            .partitions
            .get_mut(key)
            .ok_or(TerminalError::UnknownTerminal)?;
        let record = partition
            .find_mut(terminal_id, generation)
            .ok_or(TerminalError::UnknownTerminal)?;
        if record.status != TerminalStatus::Running {
            return Err(TerminalError::NotRunning);
        }
        record.status = TerminalStatus::Exited;
        record.exit_code = exit_code;
        Ok(())
    }

    /// Restart a tab: allocate a fresh generation and return to `Creating` so a
    /// new PTY can be spawned. Old-generation input/resize/checkpoint events
    /// are rejected as stale. The previous PTY must be terminated by the caller.
    pub fn restart(
        &self,
        key: &TerminalKey,
        terminal_id: &str,
        generation: u64,
        profile_id: &str,
        label: String,
    ) -> Result<TerminalHandle, TerminalError> {
        let mut state = super::recover_lock(&self.inner);
        let old_status = state
            .partitions
            .get(key)
            .and_then(|partition| {
                partition
                    .records
                    .iter()
                    .find(|record| {
                        record.terminal_id == terminal_id && record.generation == generation
                    })
                    .map(|record| record.status)
            })
            .ok_or(TerminalError::UnknownTerminal)?;
        if old_status == TerminalStatus::Closing {
            return Err(TerminalError::AlreadyClosing);
        }
        if !matches!(
            old_status,
            TerminalStatus::Creating | TerminalStatus::Running
        ) && self.live_reservations_locked(&state) >= self.global_process_quota
        {
            return Err(TerminalError::GlobalProcessQuota);
        }

        let partition = state
            .partitions
            .get_mut(key)
            .ok_or(TerminalError::UnknownTerminal)?;
        let idx = partition
            .records
            .iter()
            .position(|record| record.terminal_id == terminal_id && record.generation == generation)
            .ok_or(TerminalError::UnknownTerminal)?;
        let new_generation = partition.allocate_generation();
        let record = &mut partition.records[idx];
        record.generation = new_generation;
        record.status = TerminalStatus::Creating;
        record.profile_id = profile_id.to_string();
        record.label = label;
        record.exit_code = None;
        record.fail_reason = None;
        Ok(TerminalHandle {
            terminal_id: terminal_id.to_string(),
            generation: new_generation,
        })
    }

    /// Apply a complete tab ordering for one owner/workspace partition.
    /// Each current terminal id must appear exactly once; no terminal is added
    /// or removed by this UI metadata operation.
    pub fn reorder(
        &self,
        key: &TerminalKey,
        ordered_terminal_ids: &[String],
    ) -> Result<(), TerminalError> {
        let mut state = super::recover_lock(&self.inner);
        let partition = state
            .partitions
            .get_mut(key)
            .ok_or(TerminalError::UnknownTerminal)?;
        if ordered_terminal_ids.len() != partition.records.len()
            || ordered_terminal_ids.iter().enumerate().any(|(index, id)| {
                ordered_terminal_ids[..index].contains(id)
                    || !partition
                        .records
                        .iter()
                        .any(|record| record.terminal_id == *id)
            })
        {
            return Err(TerminalError::InvalidTabOrder);
        }
        let mut records = std::mem::take(&mut partition.records);
        let mut ordered = Vec::with_capacity(records.len());
        for terminal_id in ordered_terminal_ids {
            let Some(index) = records
                .iter()
                .position(|record| record.terminal_id == *terminal_id)
            else {
                return Err(TerminalError::InvalidTabOrder);
            };
            ordered.push(records.remove(index));
        }
        partition.records = ordered;
        Ok(())
    }

    /// Validate that `(terminal_id, generation)` refers to the currently
    /// running PTY before writing input or resizing. A stale generation is
    /// rejected without affecting the replacement process.
    pub fn require_running(
        &self,
        key: &TerminalKey,
        terminal_id: &str,
        generation: u64,
    ) -> Result<TerminalHandle, TerminalError> {
        let mut state = super::recover_lock(&self.inner);
        let partition = state
            .partitions
            .get_mut(key)
            .ok_or(TerminalError::UnknownTerminal)?;
        let record = partition
            .records
            .iter()
            .find(|r| r.terminal_id == terminal_id)
            .ok_or(TerminalError::UnknownTerminal)?;
        if record.generation != generation {
            return Err(TerminalError::StaleGeneration);
        }
        if record.status != TerminalStatus::Running {
            return Err(TerminalError::NotRunning);
        }
        Ok(TerminalHandle {
            terminal_id: terminal_id.to_string(),
            generation,
        })
    }

    /// Begin closing a tab. `Running`/`Creating` tabs move to `Closing`; an
    /// already-closing tab yields `AlreadyClosing`. The returned lease is
    /// completed by `finish_close` after the process tree is terminated.
    pub fn begin_close(
        &self,
        key: &TerminalKey,
        terminal_id: &str,
        generation: u64,
    ) -> Result<CloseLease, TerminalError> {
        let mut state = super::recover_lock(&self.inner);
        let partition = state
            .partitions
            .get_mut(key)
            .ok_or(TerminalError::UnknownTerminal)?;
        let record = partition
            .find_mut(terminal_id, generation)
            .ok_or(TerminalError::UnknownTerminal)?;
        if record.status == TerminalStatus::Closing {
            return Err(TerminalError::AlreadyClosing);
        }
        record.status = TerminalStatus::Closing;
        Ok(CloseLease {
            terminal_id: terminal_id.to_string(),
            generation,
        })
    }

    /// Remove a closing tab, releasing its workspace slot and (if held) its
    /// live-PTY reservation. Idempotent: a missing record is a no-op.
    pub fn finish_close(
        &self,
        key: &TerminalKey,
        terminal_id: &str,
        generation: u64,
    ) -> Result<(), TerminalError> {
        let mut state = super::recover_lock(&self.inner);
        let Some(partition) = state.partitions.get_mut(key) else {
            return Ok(());
        };
        if let Some(idx) = partition
            .records
            .iter()
            .position(|r| r.terminal_id == terminal_id && r.generation == generation)
        {
            partition.records.remove(idx);
        }
        Ok(())
    }

    /// Redacted descriptors for one partition. Exposes no cwd, pid, port, or
    /// capability: the WebView receives only terminal identity, generation,
    /// status, profile, and a stable display label.
    pub fn descriptors(&self, key: &TerminalKey) -> Vec<TerminalDescriptor> {
        let state = super::recover_lock(&self.inner);
        let Some(partition) = state.partitions.get(key) else {
            return Vec::new();
        };
        partition.records.iter().map(|r| r.descriptor()).collect()
    }

    /// True when another owner (a second window or client) still has a creating
    /// or running terminal in the same workspace root.
    pub fn live_under_other_owner(&self, key: &TerminalKey) -> bool {
        let state = super::recover_lock(&self.inner);
        state.partitions.iter().any(|(other, partition)| {
            other.owner != key.owner
                && other.workspace_root == key.workspace_root
                && partition.records.iter().any(|record| {
                    matches!(
                        record.status,
                        TerminalStatus::Creating | TerminalStatus::Running
                    )
                })
        })
    }

    /// Terminate every live PTY owned by `owner` across all workspace roots.
    /// Used by the host when a native window is destroyed. Returns the leases
    /// the manager must settle; each becomes `Closing`.
    pub fn cleanup_owner(&self, owner: &OwnerId) -> Vec<(TerminalKey, CloseLease)> {
        let mut state = super::recover_lock(&self.inner);
        let mut leases = Vec::new();
        for (key, partition) in state.partitions.iter_mut() {
            if &key.owner != owner {
                continue;
            }
            for record in partition.records.iter_mut() {
                if record.status == TerminalStatus::Closing {
                    continue;
                }
                record.status = TerminalStatus::Closing;
                leases.push((
                    key.clone(),
                    CloseLease {
                        terminal_id: record.terminal_id.clone(),
                        generation: record.generation,
                    },
                ));
            }
        }
        leases
    }

    fn live_reservations_locked(&self, state: &RegistryState) -> usize {
        state
            .partitions
            .values()
            .flat_map(|p| p.records.iter())
            .filter(|r| {
                matches!(
                    r.status,
                    TerminalStatus::Creating | TerminalStatus::Running | TerminalStatus::Closing
                )
            })
            .count()
    }
}

fn fresh_terminal_id() -> String {
    let mut bytes = [0u8; TERMINAL_ID_BYTES];
    OsRng.fill_bytes(&mut bytes);
    hex_encode(&bytes)
}

#[cfg(test)]
#[path = "registry_tests.rs"]
mod tests;
