// ABOUTME: Host data facade: files, sessions, costs. Callers keep HostDataStore.
// ABOUTME: Implementation lives in files.rs / sessions.rs / costs.rs; this file re-exports.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex, RwLock};
use std::time::SystemTime;
pub(crate) mod app_paths;
pub(crate) mod atomic_json;
mod costs;
mod files;
pub(crate) mod metadata_store;
pub(crate) mod paths;
pub(crate) mod projects_folder;
mod search;
pub(crate) mod session_dirs;
mod session_format;
pub(crate) mod session_relocate;
pub(crate) mod session_ui_profile_store;
mod sessions;
pub(crate) mod settings_lock;
pub(crate) mod shadow_history;
mod summary;
pub(crate) mod workspace_search;
pub(crate) use search::*;
pub(crate) use session_format::*;
pub(crate) use summary::*;

use crate::editor::markitdown::{is_convertible_suffix, INPUT_BYTE_CAP};

#[derive(Debug, Clone)]
pub(crate) struct CachedSessionSummary {
    modified_at_ms: u128,
    len: u64,
    summary: Option<SessionSummary>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInfo {
    pub path: String,
    pub git_branch: Option<String>,
    /// Whether the workspace root is inside a git work tree.
    pub is_git: bool,
    /// Top-level directory name of the git repository (e.g. "spopi").
    pub repository: String,
    /// Current branch name (empty string in detached HEAD).
    pub branch: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub relative_path: String,
    pub kind: FileKind,
    /// Byte size of the file; `None` for directories or when metadata is unavailable.
    pub size: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMentionCandidate {
    pub value: String,
    pub label: String,
    pub description: String,
    pub is_directory: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMentionSearchResult {
    pub items: Vec<FileMentionCandidate>,
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    pub path: String,
    pub content: String,
    pub size: u64,
    pub mtime_ms: f64,
    pub mime_type: String,
    pub is_binary: bool,
    pub truncated: bool,
    pub editable: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawFileContent {
    pub bytes: Vec<u8>,
    pub mime_type: String,
    pub size: u64,
}

pub struct ConvertibleFile {
    pub path: String,
    pub bytes: Vec<u8>,
    pub suffix: String,
    pub size: u64,
    pub mtime_ms: f64,
    pub mime_type: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatResult {
    pub is_git_repository: bool,
    pub files_changed: u32,
    pub insertions: u32,
    pub deletions: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffResult {
    pub supported: bool,
    pub status: Option<String>,
    pub patch: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum WriteFileResult {
    Saved { size: u64, mtime_ms: f64 },
    Conflict,
    Invalid,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    pub timestamp: String,
    pub name: Option<String>,
    pub first_message: Option<String>,
    pub workspace_id: String,
    /// Absolute working directory the session was created in (its "project").
    pub project_path: String,
    /// Human-friendly project label (last path component of `project_path`).
    pub project_name: String,
    /// True when this session belongs to the workspace the sidebar is showing.
    pub is_current_workspace: bool,
    /// Absolute path to the persisted JSONL session file.
    pub file_path: String,
    pub file_name: String,
    /// Filesystem mtime for cache invalidation/debugging only. UI recency uses
    /// `activity_at_ms` so a read-only resume/touch does not reorder projects.
    pub modified_at_ms: u128,
    /// Last user-message timestamp when available; falls back to the session
    /// header timestamp, then filesystem mtime for legacy/incomplete files.
    pub activity_at_ms: u128,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FileKind {
    File,
    Directory,
}

/// Result of a best-effort batch delete: each requested session id lands in
/// exactly one of `deleted` / `errors` (ids that don't resolve to a session
/// file on disk count as errors too, mirroring "not found").
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DeleteSessionsResult {
    pub deleted: Vec<String>,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSearchMatch {
    pub role: String,
    pub snippet: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSearchResult {
    pub session_id: String,
    pub session_name: Option<String>,
    pub session_timestamp: String,
    pub first_message: Option<String>,
    pub file_name: String,
    pub matches: Vec<SessionSearchMatch>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CostDashboardSummary {
    pub total_cost: f64,
    pub total_tokens: u64,
    pub session_count: u64,
    pub user_message_count: u64,
    pub avg_cost_per_session: f64,
    pub avg_cost_per_user_message: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CostBreakdownEntry {
    pub name: String,
    pub cost: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CostSessionRow {
    pub id: String,
    pub title: String,
    pub model: String,
    pub time: String,
    pub total_cost: f64,
    pub total_tokens: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read: u64,
    pub cache_write: u64,
    pub tool_calls: u64,
    pub tool_cost_by_name: HashMap<String, f64>,
    pub user_messages: u64,
    pub project_path: String,
    pub project_name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CostDashboard {
    pub summary: CostDashboardSummary,
    pub by_model: Vec<CostBreakdownEntry>,
    pub by_tool: Vec<CostBreakdownEntry>,
    pub top_sessions: Vec<CostSessionRow>,
    pub sessions: Vec<CostSessionRow>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub(crate) struct SessionMetrics {
    id: String,
    title: String,
    cwd: Option<PathBuf>,
    model: String,
    timestamp: String,
    total_cost: f64,
    input_tokens: u64,
    output_tokens: u64,
    cache_read: u64,
    cache_write: u64,
    user_messages: u64,
    tool_calls: u64,
    tool_cost_by_name: HashMap<String, f64>,
}

/// Parsed-metrics cache entry for the cost dashboard scan. Session files
/// are append-only, so an unchanged `(mtime, len)` pair implies an unchanged
/// parse result.
#[derive(Debug, Clone)]
pub(crate) struct CachedMetrics {
    modified: SystemTime,
    len: u64,
    metrics: SessionMetrics,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostDataError {
    UnknownWorkspace,
    InvalidRelativePath,
    OutsideWorkspace,
    NotDirectory,
    NotFile,
    InvalidMentionQuery,
    Io(String),
}

#[derive(Clone, Default)]
pub struct HostDataPlane {
    pub(crate) workspace_roots: Arc<RwLock<HashMap<String, PathBuf>>>,
    pub(crate) session_root: Option<PathBuf>,
    pub(crate) session_summary_cache: Arc<RwLock<HashMap<PathBuf, CachedSessionSummary>>>,
    pub(crate) cost_metrics_cache: Arc<Mutex<HashMap<PathBuf, CachedMetrics>>>,
    // session_id -> file path. `resolve_session_path` is on the hot path for
    // every session switch (it backs the disk-history fast path and lazy
    // runtime resume), and used to walk every project directory + jsonl file
    // on every call. This index lets a repeat lookup for an already-seen
    // session id skip the walk entirely; it's populated opportunistically by
    // any full scan (resolve_session_path miss, list_sessions,
    // list_all_sessions, search_sessions) and self-heals when a cached path
    // goes stale (file moved/deleted) by falling back to a rescan.
    pub(crate) session_path_index: Arc<RwLock<HashMap<String, PathBuf>>>,
    pub(crate) meta_cache: Option<Arc<Mutex<crate::data::metadata_store::MetadataStore>>>,
}

pub(crate) fn message_with_entry_id(
    mut message: serde_json::Value,
    entry_id: &str,
) -> serde_json::Value {
    let role = message.get("role").and_then(serde_json::Value::as_str);
    if role != Some("user") && role != Some("assistant") {
        return message;
    }
    if let Some(object) = message.as_object_mut() {
        object.insert(
            "entryId".to_owned(),
            serde_json::Value::String(entry_id.to_owned()),
        );
    }
    message
}

/// Remove a session file trash-first: move it to the OS trash via the
/// `trash` CLI when available (matching Pi TUI's deleteSessionFile policy),
/// falling back to a permanent unlink otherwise. A missing `trash` binary
/// (e.g. Windows) simply fails the spawn and falls back to unlink.
pub(crate) fn remove_session_file_trash_first_with(
    path: &std::path::Path,
    spawn_trash: impl Fn(&std::path::Path) -> bool,
) -> std::io::Result<()> {
    // Trash reports success, or the file is already gone — both are success.
    if spawn_trash(path) || !path.exists() {
        return Ok(());
    }
    std::fs::remove_file(path)
}

pub(crate) fn remove_session_file_trash_first(path: &std::path::Path) -> std::io::Result<()> {
    remove_session_file_trash_first_with(path, |target| {
        let mut command = std::process::Command::new("trash");
        crate::platform::windows_child::hide_console(&mut command);
        command
            .arg(target)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    })
}

/// Parse a number from `git diff --shortstat` output for a given keyword.
/// e.g. `parse_shortstat_num("3 files changed, 10 insertions(+)", "insertion")` → 10
pub(crate) fn parse_shortstat_num(line: &str, keyword: &str) -> u32 {
    line.split(',')
        .find_map(|part| {
            let part = part.trim();
            if part.contains(keyword) {
                part.split_whitespace().next().and_then(|n| n.parse().ok())
            } else {
                None
            }
        })
        .unwrap_or(0)
}

/// Git is optional. Spawn failures (missing binary, stripped GUI PATH) must
/// not become host I/O errors — SPOPI should keep running without git.
pub(crate) fn git_output(mut command: Command) -> Option<std::process::Output> {
    command.output().ok()
}

pub(crate) fn git_command_at(root: &Path) -> Command {
    let mut command = Command::new("git");
    crate::platform::windows_child::hide_console(&mut command);
    command
        .current_dir(root)
        .env("LC_ALL", "C")
        .env("GIT_OPTIONAL_LOCKS", "0");
    command
}

pub(crate) fn git_at(root: &Path, args: &[&str]) -> Option<std::process::Output> {
    let mut command = git_command_at(root);
    command.args(args);
    git_output(command)
}

pub(crate) fn empty_git_stat() -> GitStatResult {
    GitStatResult {
        is_git_repository: false,
        files_changed: 0,
        insertions: 0,
        deletions: 0,
    }
}

pub(crate) fn empty_workspace_git(path: String) -> WorkspaceInfo {
    WorkspaceInfo {
        path,
        git_branch: None,
        is_git: false,
        repository: String::new(),
        branch: String::new(),
    }
}

impl HostDataPlane {
    pub fn new(workspace_roots: HashMap<String, PathBuf>) -> Result<Self, HostDataError> {
        let mut canonical = HashMap::new();
        for (workspace_id, root) in workspace_roots {
            let root = paths::canonical_path(&root)
                .map_err(|error| HostDataError::Io(error.to_string()))?;
            canonical.insert(workspace_id, root);
        }
        Ok(Self {
            workspace_roots: Arc::new(RwLock::new(canonical)),
            session_root: None,
            session_summary_cache: Arc::new(RwLock::new(HashMap::new())),
            cost_metrics_cache: Arc::new(Mutex::new(HashMap::new())),
            session_path_index: Arc::new(RwLock::new(HashMap::new())),
            meta_cache: None,
        })
    }

    pub fn attach_metadata(
        &mut self,
        store: Arc<Mutex<crate::data::metadata_store::MetadataStore>>,
    ) {
        self.prune_persisted_caches(&store);
        self.meta_cache = Some(store);
    }

    fn prune_persisted_caches(
        &self,
        store: &Arc<Mutex<crate::data::metadata_store::MetadataStore>>,
    ) {
        let Ok(guard) = store.lock() else {
            return;
        };
        for table in ["session_summary_cache", "cost_metrics_cache"] {
            let _ = guard.prune_cache(table, |path| Path::new(path).is_file());
        }
    }

    pub fn with_session_root(mut self, session_root: PathBuf) -> Self {
        self.session_root = Some(session_root);
        self
    }

    pub(crate) fn workspace_ids(&self) -> Vec<(String, PathBuf)> {
        self.workspace_roots
            .read()
            .map(|roots| {
                roots
                    .iter()
                    .map(|(id, path)| (id.clone(), path.clone()))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Register (or update) a workspace root at runtime. Used when the user
    /// opens a new folder as a workspace after startup.
    pub fn register_workspace(
        &self,
        workspace_id: &str,
        root: PathBuf,
    ) -> Result<(), HostDataError> {
        let root =
            paths::canonical_path(&root).map_err(|error| HostDataError::Io(error.to_string()))?;
        self.workspace_roots
            .write()
            .map_err(|_| HostDataError::Io("workspace registry poisoned".into()))?
            .insert(workspace_id.to_string(), root);
        Ok(())
    }

    pub(crate) fn workspace_root(&self, workspace_id: &str) -> Result<PathBuf, HostDataError> {
        self.workspace_roots
            .read()
            .map_err(|_| HostDataError::Io("workspace registry poisoned".into()))?
            .get(workspace_id)
            .cloned()
            .ok_or(HostDataError::UnknownWorkspace)
    }

    pub fn workspace_root_path(&self, workspace_id: &str) -> Result<PathBuf, HostDataError> {
        self.workspace_root(workspace_id)
    }

    pub fn is_registered_root(&self, path: &Path) -> bool {
        let Ok(canon) = paths::canonical_path(path) else {
            return false;
        };
        self.workspace_roots
            .read()
            .ok()
            .map(|map| map.values().any(|root| root == &canon))
            .unwrap_or(false)
    }

    /// Workspace-relative open targets only. Absolute paths must already be
    /// inside a registered workspace (or the workspace root itself).
    pub fn resolve_open_path(
        &self,
        workspace_id: Option<&str>,
        path: &str,
    ) -> Result<PathBuf, HostDataError> {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            return Err(HostDataError::InvalidRelativePath);
        }
        let candidate = Path::new(trimmed);
        if candidate.is_absolute() {
            let canon = paths::canonical_path(candidate)
                .map_err(|error| HostDataError::Io(error.to_string()))?;
            if let Some(id) = workspace_id.filter(|id| !id.is_empty()) {
                let root = self.workspace_root(id)?;
                if !canon.starts_with(&root) {
                    return Err(HostDataError::OutsideWorkspace);
                }
                return Ok(canon);
            }
            if self.is_registered_root(&canon) {
                return Ok(canon);
            }
            return Err(HostDataError::OutsideWorkspace);
        }
        let id = workspace_id
            .filter(|id| !id.is_empty())
            .ok_or(HostDataError::UnknownWorkspace)?;
        let root = self.workspace_root(id)?;
        safe_join(&root, trimmed)
    }

    /// Return the workspace path and its current git metadata (repository
    /// name + branch) for the sidebar hover quick-info card. The JSON shape
    /// (`{ isGit, repository, branch, path, gitBranch }`) matches the
    /// `/api/workspace-info` contract consumed by `WorkspaceQuickInfo`.
    pub fn workspace_info(&self, workspace_id: &str) -> Result<WorkspaceInfo, HostDataError> {
        let root = self.workspace_root(workspace_id)?;
        Self::workspace_info_from_root(&root)
    }

    /// Variant that accepts an on-disk workspace path directly (used by
    /// the sidebar which only knows the projectPath, not the internal
    /// workspace ID). The path is canonicalized before running git.
    pub fn workspace_info_by_path(
        &self,
        workspace_path: &str,
    ) -> Result<WorkspaceInfo, HostDataError> {
        let root = paths::canonical_path(Path::new(workspace_path))
            .map_err(|e| HostDataError::Io(e.to_string()))?;
        Self::workspace_info_from_root(&root)
    }

    fn workspace_info_from_root(root: &std::path::Path) -> Result<WorkspaceInfo, HostDataError> {
        let path = root.to_string_lossy().into_owned();
        let Some(check) = git_at(root, &["rev-parse", "--is-inside-work-tree"]) else {
            return Ok(empty_workspace_git(path));
        };
        if !check.status.success() {
            return Ok(empty_workspace_git(path));
        }
        // Repository name = top-level directory name of the worktree root.
        let Some(toplevel) = git_at(root, &["rev-parse", "--show-toplevel"]) else {
            return Ok(empty_workspace_git(path));
        };
        let repo_path = String::from_utf8_lossy(&toplevel.stdout).trim().to_string();
        let repository = std::path::Path::new(&repo_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        // Branch name (None in detached HEAD for git_branch, empty string for branch).
        let branch_out = git_at(root, &["rev-parse", "--abbrev-ref", "HEAD"])
            .filter(|o| o.status.success())
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_owned())
            .filter(|s| !s.is_empty() && s != "HEAD");
        let branch = branch_out.clone().unwrap_or_default();
        Ok(WorkspaceInfo {
            path,
            git_branch: branch_out,
            is_git: true,
            repository,
            branch,
        })
    }
}

#[cfg(test)]
mod tests;
