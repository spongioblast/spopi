// ABOUTME: Executes owner-scoped Git status and diff reads against host-derived workspaces.
// ABOUTME: Snapshot records bind raw paths to a generation so browser data cannot authorize Git access.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
mod ai_snapshot;
mod commit;
mod dispatch;
mod history;
pub(crate) mod identity;
mod parse;
mod remote;
mod status;
mod worktree;
pub(crate) mod worktree_link;

pub(crate) use dispatch::dispatch;
pub(crate) use parse::*;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::ffi::OsString;
use std::fs;
#[cfg(unix)]
use std::os::unix::ffi::OsStringExt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, TryLockError};
use std::thread;
use std::time::{Duration, Instant};
use uuid::Uuid;

/// A poisoned lock still holds the last value written. Keep serving it.
fn recover_lock<T>(lock: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub const MAX_STATUS_ENTRIES: usize = 1_200;
pub const GIT_NOT_FOUND: &str = "git_not_found";
static NEXT_SNAPSHOT_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
const SNAPSHOT_TTL: Duration = Duration::from_secs(300);
const MAX_SNAPSHOTS_PER_OWNER: usize = 8;
const MAX_DIFF_BYTES: usize = 2 * 1024 * 1024;
const COMMIT_DEADLINE: Duration = Duration::from_secs(300);
// Push crosses the network, so it needs far more headroom than the 30s write
// deadline — but still a hard ceiling, because a credential prompt this
// process cannot answer would otherwise stall the write slot forever.
const PUSH_DEADLINE: Duration = Duration::from_secs(120);
const MAX_PUSH_OUTPUT_BYTES: usize = 4 * 1024;
pub const PUSH_DETACHED_HEAD: &str = "push_detached_head";
pub const PUSH_NO_REMOTE: &str = "push_no_remote";
const MAX_STDOUT_BYTES: usize = 4 * 1024 * 1024;
const MAX_STDERR_BYTES: usize = 64 * 1024;
const GIT_READ_DEADLINE: Duration = Duration::from_secs(10);
const GIT_WRITE_DEADLINE: Duration = Duration::from_secs(30);
/// `worktree add` checks out a full tree, so it cannot share the 30s write cap.
const GIT_WORKTREE_DEADLINE: Duration = Duration::from_secs(600);

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusSnapshot {
    pub snapshot_id: String,
    pub head_state: String,
    pub head_oid: Option<String>,
    pub index_tree_oid: Option<String>,
    pub branch: Option<String>,
    pub upstream: Option<String>,
    /// Remote names only; the toolbar offers Add remote or Publish from these.
    pub remotes: Vec<String>,
    pub ahead: Option<u64>,
    pub behind: Option<u64>,
    pub change_stats: GitChangeStats,
    pub counts: GitCounts,
    pub entries: Vec<GitStatusEntry>,
    pub returned_entry_count: usize,
    pub total_entry_count: usize,
    pub truncated: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct GitCounts {
    pub staged: usize,
    pub changes: usize,
    pub untracked: usize,
    pub conflicted: usize,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitChangeStats {
    pub basis: String,
    pub additions: u64,
    pub deletions: u64,
    pub untracked_excluded_count: usize,
    pub binary_file_count: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusEntry {
    pub record_type: String,
    pub xy: Option<String>,
    pub entry_kind: String,
    pub display_path: String,
    pub path_bytes_base64: String,
    pub original_display_path: Option<String>,
    pub original_path_bytes_base64: Option<String>,
    pub submodule: Option<String>,
    /// Stage 1/2/3 modes for an unmerged porcelain-v2 `u` record.
    pub unmerged_modes: Option<Vec<String>>,
    /// Stage 1/2/3 object IDs for an unmerged porcelain-v2 `u` record.
    pub unmerged_object_ids: Option<Vec<String>>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffResponse {
    pub snapshot_id: String,
    pub comparison: String,
    pub path_bytes_base64: String,
    pub raw_patch: String,
    pub truncated: bool,
    pub fallback_reason: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitPushOutcome {
    pub remote: String,
    pub branch: String,
    pub set_upstream: bool,
    /// Bounded stderr transcript; git push writes its human-readable result
    /// there even on success.
    pub output: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitAiSnapshot {
    pub snapshot_id: String,
    pub head_state: String,
    pub head_oid: Option<String>,
    pub index_tree_oid: Option<String>,
    pub staged_diff: String,
    pub staged_diff_truncated: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParsedStatus {
    pub entries: Vec<GitStatusEntry>,
    pub counts: GitCounts,
    pub total_entry_count: usize,
    pub truncated: bool,
    pub head_state: String,
    pub branch: Option<String>,
    pub upstream: Option<String>,
    pub ahead: Option<u64>,
    pub behind: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GitPathIdentity {
    pub group: String,
    pub path_bytes: Vec<u8>,
    pub original_path_bytes: Option<Vec<u8>>,
}

#[derive(Clone, Debug)]
pub(crate) struct SnapshotRecord {
    owner: String,
    root: PathBuf,
    generation: u64,
    created: Instant,
    entries: Vec<GitStatusEntry>,
    head_state: String,
    head_oid: Option<String>,
    index_tree_oid: Option<String>,
    partial_stage_token: Option<String>,
    partial_stage_token_created: Option<Instant>,
    amend: bool,
}

#[derive(Clone, Default)]
pub struct GitService {
    pub(crate) snapshots: Arc<Mutex<HashMap<String, SnapshotRecord>>>,
    /// Per-canonical-root write locks. Each canonical workspace gets its own
    /// lock so writes to different workspaces run in parallel; writes to the
    /// same workspace are serialized. Idle slots are pruned when no snapshot,
    /// outcome, or running commit references the root.
    pub(crate) write_slots: Arc<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>>,
}

impl GitService {
    /// Acquire the write lock for a canonical root. Returns the `Arc` to the
    /// per-root mutex; the caller must `lock()` it and hold both the `Arc` and
    /// the guard in the same scope. The registry is bounded: when it exceeds
    /// MAX_WRITE_SLOTS the entry whose `Arc` has the fewest strong references
    /// (i.e. no active write holds it) is evicted.
    pub(crate) fn lock_for_write(&self, root: &Path) -> Arc<Mutex<()>> {
        const MAX_WRITE_SLOTS: usize = 64;
        let mut slots = recover_lock(&self.write_slots);
        if slots.len() > MAX_WRITE_SLOTS {
            // Evict the idle slot with the fewest strong references. A slot
            // with >1 strong ref is currently held by a running write/commit
            // and must not be evicted.
            if let Some(victim) = slots
                .iter()
                .filter(|(_, arc)| Arc::strong_count(arc) <= 1)
                .min_by_key(|(path, _)| path.to_string_lossy().len())
                .map(|(path, _)| path.clone())
            {
                slots.remove(&victim);
            }
        }
        slots
            .entry(root.to_path_buf())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }
}

fn record_value<'a>(record: &'a [u8], prefix: &[u8]) -> Option<&'a [u8]> {
    record.strip_prefix(prefix)
}
fn display_path(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).to_string()
}
fn path_field(record: &[u8]) -> &[u8] {
    record.rsplit(|b| *b == b' ').next().unwrap_or_default()
}
fn header_fields(record: &[u8]) -> Vec<&[u8]> {
    record.splitn(10, |b| *b == b' ').collect()
}
fn unmerged_fields(record: &[u8]) -> Vec<&[u8]> {
    // `u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>`.
    // Keep the path separate from h3; `header_fields` deliberately leaves the
    // final path attached for ordinary and rename records.
    record.splitn(11, |b| *b == b' ').collect()
}
fn submodule_field(record: &[u8]) -> Option<String> {
    // In porcelain v2, a modified submodule (gitlink) has `S` as the
    // normalized mode field (field index 2) instead of `N`.
    header_fields(record)
        .get(2)
        .filter(|value| value.starts_with(b"S"))
        .map(|value| display_path(value))
}
fn rename_kind(record: &[u8]) -> &'static str {
    match header_fields(record).get(8).and_then(|value| value.first()) {
        Some(b'C') => "copy",
        _ => "rename",
    }
}
fn xy(record: &[u8]) -> Option<String> {
    record
        .get(2..4)
        .map(|v| String::from_utf8_lossy(v).to_string())
}

/// Resolve the canonical git top-level for `root` and verify it matches the
/// host-derived workspace root. Git's repository discovery walks up from the
/// current directory, so when the workspace is a subdirectory of a parent repo
/// (`repo/sub`), every git subprocess would otherwise operate on the parent —
/// surfacing the parent's staged files and even committing them on behalf of a
/// workspace that never authorized that scope. Canonicalize both sides before
/// comparing so a trailing slash or symlink difference cannot mask a mismatch.
pub(crate) fn assert_workspace_root(root: &Path) -> Result<(), String> {
    let output = git(root, &["rev-parse", "--show-toplevel"])?;
    let toplevel_str = String::from_utf8_lossy(&output).trim().to_string();
    if toplevel_str.is_empty() {
        return Err("not a git repository".into());
    }
    let host = fs::canonicalize(root).map_err(|e| format!("invalid workspace root: {e}"))?;
    let resolved =
        fs::canonicalize(&toplevel_str).map_err(|e| format!("invalid git toplevel: {e}"))?;
    if host != resolved {
        return Err(format!(
            "workspace root is nested inside another git repository ({} != {})",
            host.display(),
            resolved.display()
        ));
    }
    Ok(())
}
fn changed(value: Option<&String>, index: usize) -> bool {
    value
        .and_then(|v| v.as_bytes().get(index))
        .is_some_and(|b| *b != b'.')
}
fn numstat(bytes: &[u8]) -> (u64, u64, usize) {
    let mut additions = 0;
    let mut deletions = 0;
    let mut binary = 0;
    for line in bytes.split(|b| *b == b'\n') {
        let fields = line.splitn(3, |b| *b == b'\t').collect::<Vec<_>>();
        if fields.len() < 3 {
            continue;
        }
        if fields[0] == b"-" || fields[1] == b"-" {
            binary += 1;
            continue;
        }
        additions += std::str::from_utf8(fields[0])
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(0);
        deletions += std::str::from_utf8(fields[1])
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(0);
    }
    (additions, deletions, binary)
}
fn bounded_ai_diff(bytes: &[u8]) -> (String, bool) {
    const MAX_CHARS: usize = 24_000;
    const MAX_FILES: usize = 80;
    const MAX_LINES_PER_FILE: usize = 80;
    let source = String::from_utf8_lossy(bytes);
    let mut output = String::new();
    let mut files = 0;
    let mut lines_in_file = 0;
    let mut truncated = false;
    for line in source.split_inclusive('\n') {
        if line.starts_with("diff --git ") {
            files += 1;
            lines_in_file = 0;
        }
        if files > MAX_FILES || lines_in_file >= MAX_LINES_PER_FILE {
            truncated = true;
            continue;
        }
        if output.chars().count() + line.chars().count() > MAX_CHARS {
            truncated = true;
            break;
        }
        output.push_str(line);
        lines_in_file += 1;
    }
    (output, truncated)
}
fn change_stats(root: &Path, head_state: &str, untracked: usize) -> GitChangeStats {
    let args = if head_state == "unborn" {
        vec!["--literal-pathspecs", "diff", "--cached", "--numstat", "--"]
    } else {
        vec!["--literal-pathspecs", "diff", "HEAD", "--numstat", "--"]
    };
    let (additions, deletions, binary_file_count) = git(root, &args)
        .map(|output| numstat(&output))
        .unwrap_or_default();
    GitChangeStats {
        basis: if head_state == "unborn" {
            "empty-tree-to-worktree"
        } else {
            "head-to-worktree"
        }
        .into(),
        additions,
        deletions,
        untracked_excluded_count: untracked,
        binary_file_count,
    }
}

/// Parses `git status --porcelain=v2 -z`; NUL, not whitespace or newline, delimits records.
pub fn parse_porcelain_v2_z(bytes: &[u8]) -> ParsedStatus {
    let records: Vec<&[u8]> = bytes.split(|b| *b == 0).filter(|r| !r.is_empty()).collect();
    let mut entries = Vec::new();
    let mut counts = GitCounts::default();
    let mut total_entry_count = 0;
    let mut index = 0;
    let mut head_state = "unborn".to_string();
    let mut branch = None;
    let mut upstream = None;
    let mut ahead = None;
    let mut behind = None;
    while index < records.len() {
        if let Some(value) = record_value(records[index], b"# branch.oid ") {
            head_state = if value == b"(initial)" {
                "unborn"
            } else {
                "attached"
            }
            .into();
            index += 1;
            continue;
        }
        if let Some(value) = record_value(records[index], b"# branch.head ") {
            if value == b"(detached)" {
                head_state = "detached".into();
            } else if !value.is_empty() {
                branch = Some(display_path(value));
            }
            index += 1;
            continue;
        }
        if let Some(value) = record_value(records[index], b"# branch.upstream ") {
            upstream = Some(display_path(value));
            index += 1;
            continue;
        }
        if let Some(value) = record_value(records[index], b"# branch.ab ") {
            let fields = value.split(|b| *b == b' ').collect::<Vec<_>>();
            ahead = fields
                .first()
                .and_then(|v| v.strip_prefix(b"+"))
                .and_then(|v| std::str::from_utf8(v).ok())
                .and_then(|v| v.parse().ok());
            behind = fields
                .get(1)
                .and_then(|v| v.strip_prefix(b"-"))
                .and_then(|v| std::str::from_utf8(v).ok())
                .and_then(|v| v.parse().ok());
            index += 1;
            continue;
        }
        let record = records[index];
        let kind = record.first().copied().unwrap_or_default();
        let (entry, staged, worktree) = match kind {
            b'?' | b'!' => {
                let path = record.get(2..).unwrap_or_default();
                (
                    GitStatusEntry {
                        record_type: (kind as char).to_string(),
                        xy: None,
                        entry_kind: if kind == b'?' { "untracked" } else { "ignored" }.into(),
                        display_path: display_path(path),
                        path_bytes_base64: BASE64.encode(path),
                        original_display_path: None,
                        original_path_bytes_base64: None,
                        submodule: None,
                        unmerged_modes: None,
                        unmerged_object_ids: None,
                    },
                    false,
                    false,
                )
            }
            b'1' => {
                let state = xy(record);
                let path = path_field(record);
                (
                    GitStatusEntry {
                        record_type: "1".into(),
                        xy: state.clone(),
                        entry_kind: "ordinary".into(),
                        display_path: display_path(path),
                        path_bytes_base64: BASE64.encode(path),
                        original_display_path: None,
                        original_path_bytes_base64: None,
                        submodule: submodule_field(record),
                        unmerged_modes: None,
                        unmerged_object_ids: None,
                    },
                    changed(state.as_ref(), 0),
                    changed(state.as_ref(), 1),
                )
            }
            b'2' => {
                let state = xy(record);
                let path = path_field(record);
                let original = records.get(index + 1).copied().unwrap_or_default();
                index += 1;
                (
                    GitStatusEntry {
                        record_type: "2".into(),
                        xy: state,
                        entry_kind: rename_kind(record).into(),
                        display_path: display_path(path),
                        path_bytes_base64: BASE64.encode(path),
                        original_display_path: Some(display_path(original)),
                        original_path_bytes_base64: Some(BASE64.encode(original)),
                        submodule: submodule_field(record),
                        unmerged_modes: None,
                        unmerged_object_ids: None,
                    },
                    true,
                    true,
                )
            }
            b'u' => {
                let fields = unmerged_fields(record);
                let path = fields.get(10).copied().unwrap_or_default();
                (
                    GitStatusEntry {
                        record_type: "u".into(),
                        xy: xy(record),
                        entry_kind: "unmerged".into(),
                        display_path: display_path(path),
                        path_bytes_base64: BASE64.encode(path),
                        original_display_path: None,
                        original_path_bytes_base64: None,
                        submodule: submodule_field(record),
                        unmerged_modes: Some(
                            fields
                                .iter()
                                .skip(3)
                                .take(3)
                                .map(|value| display_path(value))
                                .collect(),
                        ),
                        unmerged_object_ids: Some(
                            fields
                                .iter()
                                .skip(7)
                                .take(3)
                                .map(|value| display_path(value))
                                .collect(),
                        ),
                    },
                    false,
                    false,
                )
            }
            _ => {
                index += 1;
                continue;
            }
        };
        total_entry_count += 1;
        counts.staged += staged as usize;
        counts.changes += worktree as usize;
        counts.untracked += (kind == b'?') as usize;
        counts.conflicted += (kind == b'u') as usize;
        if entries.len() < MAX_STATUS_ENTRIES {
            entries.push(entry);
        }
        index += 1;
    }
    ParsedStatus {
        total_entry_count,
        truncated: total_entry_count > MAX_STATUS_ENTRIES,
        entries,
        counts,
        head_state,
        branch,
        upstream,
        ahead,
        behind,
    }
}

#[cfg(test)]
mod tests;
