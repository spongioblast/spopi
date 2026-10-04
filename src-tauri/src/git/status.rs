// ABOUTME: Reads git status, validates snapshot paths, and serves path diffs.
// ABOUTME: Commits, history, and the WebSocket dispatcher live in sibling modules.

use super::*;

impl GitService {
    pub fn new() -> Self {
        Self {
            snapshots: Arc::new(Mutex::new(HashMap::new())),
            write_slots: Arc::new(Mutex::new(HashMap::new())),
        }
    }
    pub fn status(
        &self,
        owner: &str,
        root: &Path,
        generation: u64,
    ) -> Result<GitStatusSnapshot, String> {
        assert_workspace_root(root)?;
        let output = git(root, &["status", "--porcelain=v2", "-z", "--branch"])?;
        let parsed = parse_porcelain_v2_z(&output);
        let id = format!(
            "git-{}",
            NEXT_SNAPSHOT_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        );
        self.prune(owner);
        recover_lock(&self.snapshots).insert(
            id.clone(),
            SnapshotRecord {
                owner: owner.into(),
                root: root.to_path_buf(),
                generation,
                created: Instant::now(),
                entries: parsed.entries.clone(),
                head_state: parsed.head_state.clone(),
                head_oid: None,
                index_tree_oid: None,
                partial_stage_token: None,
                partial_stage_token_created: None,
                amend: false,
            },
        );
        self.enforce_limit(owner);
        let head_oid = git(root, &["rev-parse", "--verify", "HEAD"])
            .ok()
            .map(|bytes| display_path(&bytes).trim().to_string())
            .filter(|value| !value.is_empty());
        let index_tree_oid = git(root, &["write-tree"])
            .ok()
            .map(|bytes| display_path(&bytes).trim().to_string())
            .filter(|value| !value.is_empty());
        let stats = change_stats(root, &parsed.head_state, parsed.counts.untracked);
        let remotes = remote::remote_names(root).unwrap_or_default();
        if let Some(record) = recover_lock(&self.snapshots).get_mut(&id) {
            record.head_state = parsed.head_state.clone();
            record.head_oid = head_oid.clone();
            record.index_tree_oid = index_tree_oid.clone();
        }
        Ok(GitStatusSnapshot {
            snapshot_id: id,
            head_state: parsed.head_state,
            head_oid,
            index_tree_oid,
            branch: parsed.branch,
            upstream: parsed.upstream,
            remotes,
            ahead: parsed.ahead,
            behind: parsed.behind,
            change_stats: stats,
            counts: parsed.counts,
            returned_entry_count: parsed.entries.len(),
            total_entry_count: parsed.total_entry_count,
            truncated: parsed.truncated,
            entries: parsed.entries,
        })
    }
    pub(in crate::git) fn snapshot_for(
        &self,
        snapshot_id: &str,
        owner: &str,
        root: &Path,
        generation: u64,
    ) -> Result<SnapshotRecord, String> {
        let store = recover_lock(&self.snapshots);
        let record = store.get(snapshot_id).ok_or("stale snapshot")?;
        if record.owner != owner
            || record.root != root
            || record.generation != generation
            || record.created.elapsed() > SNAPSHOT_TTL
        {
            return Err("stale snapshot".into());
        }
        Ok(record.clone())
    }
    pub(crate) fn belongs_to_group(&self, entry: &GitStatusEntry, group: &str) -> bool {
        match group {
            "conflicted" => entry.entry_kind == "unmerged",
            "untracked" => entry.entry_kind == "untracked",
            "staged" => entry
                .xy
                .as_deref()
                .is_some_and(|xy| xy.as_bytes().first().is_some_and(|value| *value != b'.')),
            "changes" => entry
                .xy
                .as_deref()
                .is_some_and(|xy| xy.as_bytes().get(1).is_some_and(|value| *value != b'.')),
            _ => false,
        }
    }

    pub fn validate_path(
        &self,
        snapshot_id: &str,
        owner: &str,
        root: &Path,
        generation: u64,
        path_bytes: &[u8],
    ) -> Result<(), String> {
        let mut store = recover_lock(&self.snapshots);
        let record = store.get(snapshot_id).ok_or("stale snapshot")?;
        if record.owner != owner
            || record.root != root
            || record.generation != generation
            || record.created.elapsed() > SNAPSHOT_TTL
        {
            store.remove(snapshot_id);
            return Err("stale snapshot".into());
        }
        if path_bytes.starts_with(b":(")
            || !record.entries.iter().any(|entry| {
                BASE64.decode(&entry.path_bytes_base64).ok().as_deref() == Some(path_bytes)
            })
        {
            return Err("unauthorized path".into());
        }
        Ok(())
    }
    #[allow(clippy::too_many_arguments)]
    pub fn diff(
        &self,
        snapshot_id: &str,
        owner: &str,
        root: &Path,
        generation: u64,
        group: &str,
        path_bytes: &[u8],
        comparison: &str,
    ) -> Result<GitDiffResponse, String> {
        self.validate_path(snapshot_id, owner, root, generation, path_bytes)?;
        let snapshot = self.snapshot_for(snapshot_id, owner, root, generation)?;
        let entry = snapshot
            .entries
            .iter()
            .find(|item| BASE64.decode(&item.path_bytes_base64).ok().as_deref() == Some(path_bytes))
            .ok_or("stale path")?;
        let expected_comparison = match group {
            "staged" => "staged",
            "changes" => "changes",
            "untracked" => "untracked",
            _ => return Err("unsupported diff group".into()),
        };
        if !self.belongs_to_group(entry, group) || comparison != expected_comparison {
            return Err("unauthorized diff".into());
        }
        let path = path_arg(path_bytes);
        let args: Vec<OsString> = match comparison {
            "staged" => vec![
                "--literal-pathspecs".into(),
                "diff".into(),
                "--cached".into(),
                "--".into(),
                path,
            ],
            "changes" => vec![
                "--literal-pathspecs".into(),
                "diff".into(),
                "--".into(),
                path,
            ],
            "untracked" => vec![
                "--literal-pathspecs".into(),
                "diff".into(),
                "--no-index".into(),
                "/dev/null".into(),
                path,
            ],
            _ => return Err("unsupported comparison".into()),
        };
        let mut patch = git_os(root, &args)?;
        let truncated = patch.len() > MAX_DIFF_BYTES;
        patch.truncate(MAX_DIFF_BYTES);
        // Detect non-textual diff cases that must render as raw patch with an
        // explicit reason rather than a side-by-side alignment.
        let patch_str = String::from_utf8_lossy(&patch);
        let is_binary_marker = patch_str.contains("Binary files ")
            || patch_str.contains("GIT binary patch")
            || patch_str.contains("Binary files a/")
            || patch.contains(&0);
        let fallback_reason = if entry.submodule.is_some() {
            Some("submodule".to_string())
        } else if entry.entry_kind == "unmerged" {
            Some("conflict".to_string())
        } else if is_binary_marker {
            Some("binary".to_string())
        } else if entry.entry_kind == "rename" || entry.entry_kind == "copy" {
            // Rename/copy diffs are textual but may include a mode-only or
            // similarity block that cannot be aligned; fall back to raw patch.
            Some(entry.entry_kind.clone())
        } else {
            None
        };
        Ok(GitDiffResponse {
            snapshot_id: snapshot_id.into(),
            comparison: comparison.into(),
            path_bytes_base64: BASE64.encode(path_bytes),
            raw_patch: String::from_utf8_lossy(&patch).to_string(),
            truncated,
            fallback_reason,
        })
    }
    fn prune(&self, owner: &str) {
        recover_lock(&self.snapshots)
            .retain(|_, record| record.owner != owner || record.created.elapsed() <= SNAPSHOT_TTL);
    }
    fn enforce_limit(&self, owner: &str) {
        let mut store = recover_lock(&self.snapshots);
        while store
            .values()
            .filter(|record| record.owner == owner)
            .count()
            > MAX_SNAPSHOTS_PER_OWNER
        {
            if let Some(id) = store
                .iter()
                .filter(|(_, record)| record.owner == owner)
                .min_by_key(|(_, record)| record.created)
                .map(|(id, _)| id.clone())
            {
                store.remove(&id);
            }
        }
    }
}
