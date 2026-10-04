// ABOUTME: Lists and reads Pi session files for the sidebar and search.
// ABOUTME: Session JSONL stays owned by Pi under the agent directory.
// ABOUTME: Session list/read/delete/search for the data plane.
use super::*;
use std::collections::HashMap;

impl HostDataPlane {
    pub fn resolve_session_path(
        &self,
        workspace_id: &str,
        session_id: &str,
    ) -> Result<Option<PathBuf>, HostDataError> {
        let workspace = self.workspace_root(workspace_id)?;
        let workspace = workspace.as_path();
        // Fast path: a session id we've already seen (from an earlier scan or
        // lookup) resolves straight to its file, no directory walk needed.
        // Still re-verified against the live summary (cheap: a single stat +
        // cache hit in the common case) since a session file can be deleted
        // or moved between calls. Any mismatch (wrong workspace, mismatched
        // id) *or* read failure (file gone/moved) is treated as a stale
        // entry: it's evicted and control falls through to the full rescan
        // below, which repairs the index rather than surfacing a spurious
        // error for what is a normal, expected cache-miss condition.
        if let Some(cached_path) = self.indexed_session_path(session_id)? {
            let hit = matches!(
                self.cached_session_summary(&cached_path),
                Ok(Some(summary))
                    if summary.id == session_id
                        && same_dir(workspace, Path::new(&summary.project_path))
            );
            if hit {
                return Ok(Some(cached_path));
            }
            self.forget_indexed_session_path(session_id);
        }

        for path in self.session_files() {
            // The sidebar normally populated this cache immediately before
            // a session is selected. Reusing it avoids reparsing every
            // JSONL file in every project on each session switch.
            let Some(summary) = self.cached_session_summary(&path)? else {
                continue;
            };
            // Populate the index for every session seen during this scan
            // (not just the one being resolved) so a follow-up switch to
            // a *different* session also hits the fast path above
            // instead of triggering another full walk.
            self.remember_indexed_session_path(summary.id.clone(), path.clone());
            if summary.id == session_id && same_dir(workspace, Path::new(&summary.project_path)) {
                return Ok(Some(path));
            }
        }
        Ok(None)
    }

    /// Read session messages directly from the on-disk JSONL file, bypassing
    /// the Pi runtime process. Returns messages in the same format that Pi's
    /// `get_messages` command returns. This is a fast path for session switching:
    /// the UI can render historical messages immediately while the Pi process
    /// warms up in the background.
    ///
    /// For sessions with branched history (forks), this traces back from the
    /// last message in the file (the tip of the current branch) to reconstruct
    /// the correct message chain.
    // Reads Pi's session JSONL directly: no runtime is alive for closed sessions and no RPC lists them.
    pub fn read_session_messages(
        &self,
        workspace_id: &str,
        session_id: &str,
    ) -> Result<Vec<serde_json::Value>, HostDataError> {
        let path = self
            .resolve_session_path(workspace_id, session_id)?
            .ok_or_else(|| HostDataError::Io(format!("session {session_id} not found")))?;

        // Collect all JSONL entries: (id, parentId, message_value_if_type_message)
        let mut all_entries: Vec<(String, Option<String>, Option<serde_json::Value>)> = Vec::new();
        let mut context_edits: Vec<serde_json::Value> = Vec::new();
        for entry in read_jsonl_entries(&path)? {
            let Some(id) = entry
                .get("id")
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned)
            else {
                continue;
            };
            let parent_id = entry
                .get("parentId")
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned);
            let message_value =
                if entry.get("type").and_then(serde_json::Value::as_str) == Some("message") {
                    entry
                        .get("message")
                        .cloned()
                        .map(|message| message_with_entry_id(message, &id))
                } else {
                    None
                };
            if entry.get("type").and_then(serde_json::Value::as_str) == Some("context_edit") {
                context_edits.push(entry.clone());
            }
            all_entries.push((id, parent_id, message_value));
        }

        if all_entries.is_empty() {
            return Ok(vec![]);
        }

        // Build id -> index map for parentId traversal
        let id_to_idx: HashMap<&str, usize> = all_entries
            .iter()
            .enumerate()
            .map(|(i, (id, _, _))| (id.as_str(), i))
            .collect();

        // Find the last message entry — the tip of the current branch
        let Some(tip_idx) = all_entries
            .iter()
            .enumerate()
            .rev()
            .find(|(_, (_, _, msg))| msg.is_some())
            .map(|(i, _)| i)
        else {
            return Ok(vec![]);
        };

        // Walk back from the tip through parentId links, collecting message entries.
        // Non-message entries (model_change, thinking_level_change, etc.) are
        // traversed but not collected.
        let mut chain: Vec<serde_json::Value> = Vec::new();
        let mut current = tip_idx;
        let mut visited = std::collections::HashSet::new();
        loop {
            if !visited.insert(current) {
                break; // cycle guard
            }
            if let Some(msg) = &all_entries[current].2 {
                chain.push(msg.clone());
            }
            match all_entries[current].1.as_deref() {
                None => break,
                Some(pid) => match id_to_idx.get(pid) {
                    Some(&idx) => current = idx,
                    None => break,
                },
            }
        }
        chain.reverse();
        let mut visible_ids = std::collections::HashSet::new();
        for message in &chain {
            if let Some(id) = message.get("entryId").and_then(serde_json::Value::as_str) {
                visible_ids.insert(id.to_owned());
            }
        }
        for edit in context_edits {
            let Some(target) = edit.get("targetId").and_then(serde_json::Value::as_str) else {
                continue;
            };
            if visible_ids.contains(target) {
                chain.push(edit);
            }
        }
        Ok(chain)
    }

    // Reads Pi's session JSONL directly: no runtime is alive for closed sessions and no RPC lists them.
    pub fn list_sessions(&self, workspace_id: &str) -> Result<Vec<SessionSummary>, HostDataError> {
        let workspace = self.workspace_root(workspace_id)?;
        let mut sessions = self.collect_sessions(Some(workspace.as_path()))?;
        for session in &mut sessions {
            session.workspace_id = workspace_id.to_owned();
            session.is_current_workspace = true;
        }
        sessions.sort_by_key(|session| std::cmp::Reverse(session.activity_at_ms));
        Ok(sessions)
    }

    /// List saved sessions across *all* projects, not just the current
    /// workspace, so the sidebar can group them by project. Sessions that
    /// belong to `workspace_id` are tagged `is_current_workspace = true` and
    /// carry the live workspace id so the UI can open them in-window; all other
    /// sessions carry an empty workspace id and are opened by project path.
    pub fn list_all_sessions(
        &self,
        workspace_id: &str,
    ) -> Result<Vec<SessionSummary>, HostDataError> {
        let current = self
            .workspace_root(workspace_id)
            .ok()
            .map(|root| (workspace_id, root));
        self.list_all_sessions_with_current(current)
    }

    /// List saved sessions for the targetless `/app` launcher. No workspace is
    /// marked current, so selecting any result follows the existing
    /// cross-project resolution flow before navigating to its canonical route.
    pub fn list_launcher_sessions(&self) -> Result<Vec<SessionSummary>, HostDataError> {
        self.list_all_sessions_with_current(None)
    }

    fn list_all_sessions_with_current(
        &self,
        current: Option<(&str, PathBuf)>,
    ) -> Result<Vec<SessionSummary>, HostDataError> {
        let mut sessions = self.collect_sessions(None)?;
        let mut mains = HashMap::<String, Option<String>>::new();
        for session in &mut sessions {
            let main = mains
                .entry(session.project_path.clone())
                .or_insert_with(|| {
                    crate::git::worktree_link::main_checkout_of(Path::new(&session.project_path))
                        .map(|path| path.to_string_lossy().into_owned())
                })
                .clone();
            session.worktree_of = main;
        }
        if let Some((workspace_id, root)) = current {
            for session in &mut sessions {
                if same_dir(&root, Path::new(&session.project_path)) {
                    session.workspace_id = workspace_id.to_owned();
                    session.is_current_workspace = true;
                }
            }
        }
        sessions.sort_by_key(|session| std::cmp::Reverse(session.activity_at_ms));
        Ok(sessions)
    }

    /// Permanently delete the on-disk `.jsonl` files for the given session
    /// ids, searching across every project (not just the current workspace) —
    /// archived sessions in the sidebar can belong to any project. Best
    /// effort: each id lands in `deleted` or `errors`, a failure on one id
    /// never aborts the rest.
    pub fn delete_sessions(
        &self,
        session_ids: &[String],
    ) -> Result<DeleteSessionsResult, HostDataError> {
        let mut result = DeleteSessionsResult::default();
        if session_ids.is_empty() {
            return Ok(result);
        }
        let requested: HashSet<&str> = session_ids.iter().map(String::as_str).collect();
        let mut deleted = HashSet::new();
        let mut failed = HashSet::new();
        for path in self.session_files() {
            let Some(session_id) = parse_session_id(&path)? else {
                continue;
            };
            if !requested.contains(session_id.as_str()) {
                continue;
            }
            match remove_session_file_trash_first(&path) {
                Ok(()) => {
                    self.forget_indexed_session_path(&session_id);
                    deleted.insert(session_id);
                }
                Err(_) => {
                    failed.insert(session_id);
                }
            }
        }
        for id in session_ids {
            if deleted.contains(id) && !failed.contains(id) {
                result.deleted.push(id.clone());
            } else {
                result.errors.push(id.clone());
            }
        }
        Ok(result)
    }

    /// Walk the session store and parse every `.jsonl` session file. When
    /// `workspace_filter` is `Some`, only sessions whose project directory
    /// matches are returned.
    fn collect_sessions(
        &self,
        workspace_filter: Option<&Path>,
    ) -> Result<Vec<SessionSummary>, HostDataError> {
        let mut sessions = Vec::new();
        let mut seen = HashSet::new();
        for path in self.session_files() {
            if !seen.insert(path.clone()) {
                continue;
            }
            let Ok(Some(summary)) = self.cached_session_summary(&path) else {
                continue;
            };
            // Opportunistically warm the resolve_session_path index from
            // this scan too (sidebar list loads run far more often than
            // cold resolves, so this keeps the fast path hot in practice).
            self.remember_indexed_session_path(summary.id.clone(), path.clone());
            if let Some(filter) = workspace_filter {
                if !same_dir(filter, Path::new(&summary.project_path)) {
                    continue;
                }
            }
            sessions.push(summary);
        }
        Ok(sessions)
    }
}

impl HostDataPlane {
    /// Every chat file SPOPI knows about: Pi's agent session tree plus the
    /// session dir of each registered project when it lives elsewhere.
    pub(crate) fn session_files(&self) -> Vec<PathBuf> {
        let mut roots = Vec::new();
        if let Some(root) = &self.session_root {
            roots.push(root.clone());
        }
        if let Some(agent_dir) = self
            .session_root
            .as_ref()
            .and_then(|root| root.parent())
            .map(Path::to_path_buf)
        {
            for (_, project) in self.workspace_ids() {
                let dir = super::session_dirs::session_dir_for(&project, &agent_dir);
                if !roots.iter().any(|known| dir.starts_with(known)) {
                    roots.push(dir);
                }
            }
        }
        roots
            .iter()
            .flat_map(|root| session_files_under(root))
            .collect()
    }
}

/// `.jsonl` files one level down (Pi's layout) and directly in the dir
/// (a project `sessionDir`). Child agent chats sit next to their parent.
fn session_files_under(root: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let Ok(entries) = std::fs::read_dir(root) else {
        return files;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) == Some("jsonl") {
            files.push(path);
            continue;
        }
        if !path.is_dir() {
            continue;
        }
        let Ok(inner) = std::fs::read_dir(&path) else {
            continue;
        };
        for child in inner.flatten() {
            let child_path = child.path();
            if child_path.extension().and_then(|value| value.to_str()) == Some("jsonl") {
                files.push(child_path);
            }
        }
    }
    files
}

impl HostDataPlane {
    /// Look up a previously-indexed path for `session_id` without touching
    /// the filesystem. Returns `None` when the id has never been seen by a
    /// scan (e.g. right after startup, before any resolve/list has run).
    fn indexed_session_path(&self, session_id: &str) -> Result<Option<PathBuf>, HostDataError> {
        Ok(self
            .session_path_index
            .read()
            .map_err(|_| HostDataError::Io("session path index poisoned".into()))?
            .get(session_id)
            .cloned())
    }

    fn remember_indexed_session_path(&self, session_id: String, path: PathBuf) {
        if let Ok(mut index) = self.session_path_index.write() {
            index.insert(session_id, path);
        }
    }

    fn forget_indexed_session_path(&self, session_id: &str) {
        if let Ok(mut index) = self.session_path_index.write() {
            index.remove(session_id);
        }
    }

    pub(crate) fn cached_session_summary(
        &self,
        path: &Path,
    ) -> Result<Option<SessionSummary>, HostDataError> {
        let metadata =
            std::fs::metadata(path).map_err(|error| HostDataError::Io(error.to_string()))?;
        let modified_at_ms = metadata_modified_at_ms(&metadata);
        let len = metadata.len();
        if let Some(cached) = self
            .session_summary_cache
            .read()
            .map_err(|_| HostDataError::Io("session summary cache poisoned".into()))?
            .get(path)
            .filter(|cached| cached.modified_at_ms == modified_at_ms && cached.len == len)
            .cloned()
        {
            return Ok(cached.summary);
        }

        if let Some(store) = &self.meta_cache {
            if let Ok(guard) = store.lock() {
                if let Ok(Some((mtime, cached_len, json))) =
                    guard.read_cache("session_summary_cache", &path.to_string_lossy())
                {
                    if mtime == modified_at_ms as i64 && cached_len == len as i64 {
                        if let Ok(summary) = serde_json::from_str::<Option<SessionSummary>>(&json) {
                            self.session_summary_cache
                                .write()
                                .map_err(|_| {
                                    HostDataError::Io("session summary cache poisoned".into())
                                })?
                                .insert(
                                    path.to_path_buf(),
                                    CachedSessionSummary {
                                        modified_at_ms,
                                        len,
                                        summary: summary.clone(),
                                    },
                                );
                            return Ok(summary);
                        }
                    }
                }
            }
        }

        let summary = parse_session_summary_with_metadata(path, modified_at_ms)?;
        if let Some(store) = &self.meta_cache {
            if let Ok(guard) = store.lock() {
                if let Ok(json) = serde_json::to_string(&summary) {
                    let _ = guard.write_cache(
                        "session_summary_cache",
                        &path.to_string_lossy(),
                        modified_at_ms as i64,
                        len as i64,
                        &json,
                    );
                }
            }
        }
        self.session_summary_cache
            .write()
            .map_err(|_| HostDataError::Io("session summary cache poisoned".into()))?
            .insert(
                path.to_path_buf(),
                CachedSessionSummary {
                    modified_at_ms,
                    len,
                    summary: summary.clone(),
                },
            );
        Ok(summary)
    }

    // Reads Pi's session JSONL directly: no runtime is alive for closed sessions and no RPC lists them.
    pub fn search_sessions(
        &self,
        workspace_id: &str,
        query: &str,
    ) -> Result<Vec<SessionSearchResult>, HostDataError> {
        const MAX_RESULTS: usize = 30;
        let workspace = self.workspace_root(workspace_id)?;
        let workspace = workspace.as_path();
        let query = query.trim().to_lowercase();
        if query.len() < 2 {
            return Ok(Vec::new());
        }
        let mut results = Vec::new();
        for path in self.session_files() {
            if results.len() >= MAX_RESULTS {
                return Ok(results);
            }
            if let Some(result) = search_session_file(&path, workspace, &query)? {
                results.push(result);
            }
        }
        Ok(results)
    }
}
