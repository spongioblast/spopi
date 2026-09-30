// ABOUTME: Stages, commits, and pushes through the per-workspace write lock.
// ABOUTME: Status snapshots and history reads stay in their own modules.

use super::*;

impl GitService {
    pub fn write(
        &self,
        snapshot_id: &str,
        owner: &str,
        root: &Path,
        generation: u64,
        entries: &[GitPathIdentity],
        operation: &str,
    ) -> Result<(), String> {
        if entries.is_empty() || entries.len() > MAX_STATUS_ENTRIES {
            return Err("invalid path batch".into());
        }
        assert_workspace_root(root)?;
        // Per-canonical-root single-writer: hold both the Arc (to keep the
        // slot alive) and the try-lock guard for the duration of the write.
        let _write_slot = self.lock_for_write(root);
        let _slot = match _write_slot.try_lock() {
            Ok(slot) => slot,
            Err(TryLockError::WouldBlock) => return Err("busy".into()),
            Err(TryLockError::Poisoned(_)) => return Err("write slot unavailable".into()),
        };
        let snapshot = self.snapshot_for(snapshot_id, owner, root, generation)?;
        let fresh = parse_porcelain_v2_z(&git(root, &["status", "--porcelain=v2", "-z"])?).entries;
        for entry in entries {
            let old = snapshot
                .entries
                .iter()
                .find(|item| {
                    BASE64.decode(&item.path_bytes_base64).ok().as_deref()
                        == Some(entry.path_bytes.as_slice())
                })
                .ok_or("stale path")?;
            let current = fresh
                .iter()
                .find(|item| {
                    BASE64.decode(&item.path_bytes_base64).ok().as_deref()
                        == Some(entry.path_bytes.as_slice())
                })
                .ok_or("stale path")?;
            let allowed = matches!(
                (operation, entry.group.as_str()),
                ("stage", "changes" | "untracked" | "conflicted")
                    | ("unstage", "staged")
                    | ("discard", "changes" | "untracked")
            );
            let conflict_resolution_stage = operation == "stage"
                && entry.group == "conflicted"
                && self.belongs_to_group(old, "conflicted")
                // Editing a conflicted file can turn the live porcelain record
                // into an ordinary modified record before the user clicks
                // Stage. Accept that transition, but never accept an
                // untracked/ignored replacement for the old conflicted path.
                && matches!(current.entry_kind.as_str(), "unmerged" | "ordinary")
                && !matches!(current.entry_kind.as_str(), "untracked" | "ignored");
            if !allowed
                || !self.belongs_to_group(old, &entry.group)
                || (!conflict_resolution_stage && !self.belongs_to_group(current, &entry.group))
                || (!conflict_resolution_stage && old.xy != current.xy)
                || (!conflict_resolution_stage && old.entry_kind != current.entry_kind)
                || (!conflict_resolution_stage && old.submodule != current.submodule)
                || old
                    .original_path_bytes_base64
                    .as_deref()
                    .and_then(|v| BASE64.decode(v).ok())
                    != entry.original_path_bytes
                || current
                    .original_path_bytes_base64
                    .as_deref()
                    .and_then(|v| BASE64.decode(v).ok())
                    != entry.original_path_bytes
            {
                return Err("stale path".into());
            }
        }
        if operation == "discard" {
            let tracked: Vec<&GitPathIdentity> = entries
                .iter()
                .filter(|entry| entry.group != "untracked")
                .collect();
            if !tracked.is_empty() {
                let mut args = vec![
                    OsString::from("--literal-pathspecs"),
                    OsString::from("checkout"),
                    OsString::from("--"),
                ];
                for entry in &tracked {
                    args.push(path_arg(&entry.path_bytes));
                    if let Some(original) = &entry.original_path_bytes {
                        args.push(path_arg(original));
                    }
                }
                let _ = git_os(root, &args)?;
            }
            for entry in entries.iter().filter(|entry| entry.group == "untracked") {
                let old = snapshot
                    .entries
                    .iter()
                    .find(|item| {
                        BASE64.decode(&item.path_bytes_base64).ok().as_deref()
                            == Some(entry.path_bytes.as_slice())
                    })
                    .ok_or("stale path")?;
                let is_dir = old.display_path.ends_with('/') || entry.path_bytes.ends_with(b"/");
                let mut args = vec![
                    OsString::from("--literal-pathspecs"),
                    OsString::from("clean"),
                    OsString::from("-f"),
                ];
                if is_dir {
                    args.push(OsString::from("-d"));
                }
                args.push(OsString::from("--"));
                args.push(path_arg(&entry.path_bytes));
                let _ = git_os(root, &args)?;
            }
            return Ok(());
        }
        let paths = entries
            .iter()
            .flat_map(|entry| {
                std::iter::once(entry.path_bytes.clone()).chain(entry.original_path_bytes.clone())
            })
            .collect::<Vec<_>>();
        let mut args = vec![OsString::from("--literal-pathspecs")];
        match operation {
            "stage" => args.extend([OsString::from("add"), OsString::from("-A")]),
            "unstage" => args.push(OsString::from("reset")),
            _ => return Err("unsupported Git write".into()),
        }
        args.push(OsString::from("--"));
        args.extend(paths.iter().map(|path| path_arg(path)));
        let _ = git_os(root, &args)?;
        Ok(())
    }

    /// Push the current branch to its upstream, or to the default remote with
    /// `--set-upstream` when no upstream is configured yet.
    ///
    /// Authentication is strictly non-interactive: the Tauri child has no TTY,
    /// so any credential or passphrase prompt would hang until PUSH_DEADLINE
    /// kills the process group. `git_command` already sets
    /// GIT_TERMINAL_PROMPT=0 and a null stdin; this adds askpass suppression
    /// and SSH BatchMode so a missing credential fails immediately with a
    /// message the user can act on instead of stalling the panel.
    pub fn push(&self, root: &Path) -> Result<GitPushOutcome, String> {
        assert_workspace_root(root)?;
        // Share the per-root write slot with stage/unstage/discard/commit so a
        // push never races an index mutation on the same workspace.
        let _write_slot = self.lock_for_write(root);
        let _slot = match _write_slot.try_lock() {
            Ok(slot) => slot,
            Err(TryLockError::WouldBlock) => return Err("busy".into()),
            Err(TryLockError::Poisoned(_)) => return Err("write slot unavailable".into()),
        };
        let status =
            parse_porcelain_v2_z(&git(root, &["status", "--porcelain=v2", "-z", "--branch"])?);
        let branch = match (status.head_state.as_str(), status.branch.clone()) {
            ("attached", Some(branch)) if !branch.is_empty() => branch,
            _ => return Err(PUSH_DETACHED_HEAD.into()),
        };
        let remotes = String::from_utf8_lossy(&git(root, &["remote"])?)
            .lines()
            .map(|line| line.trim().to_owned())
            .filter(|line| !line.is_empty())
            .collect::<Vec<_>>();
        if remotes.is_empty() {
            return Err(PUSH_NO_REMOTE.into());
        }
        // With an upstream configured, push with no refspec so git uses the
        // branch's own upstream. Without one, publish HEAD to the default
        // remote: `HEAD` keeps the untrusted branch name out of argv, and git
        // derives the remote branch name from it.
        let (remote, args, set_upstream) = match status.upstream.as_deref() {
            Some(upstream) if !upstream.is_empty() => {
                let remote = upstream
                    .split_once('/')
                    .map(|(head, _)| head.to_owned())
                    .filter(|candidate| remotes.iter().any(|known| known == candidate))
                    .unwrap_or_else(|| remotes[0].clone());
                (remote, vec![OsString::from("push")], false)
            }
            _ => {
                let remote = if remotes.iter().any(|known| known == "origin") {
                    "origin".to_owned()
                } else {
                    remotes[0].clone()
                };
                (
                    remote.clone(),
                    vec![
                        OsString::from("push"),
                        OsString::from("--set-upstream"),
                        OsString::from(remote),
                        OsString::from("HEAD"),
                    ],
                    true,
                )
            }
        };
        let mut command = git_command(root, args);
        apply_network_env(&mut command, root);
        let (_stdout, stderr, success) = run_git(command, PUSH_DEADLINE)?;
        // git push reports progress and result on stderr even when it succeeds.
        let output = bounded_push_output(&stderr);
        if success {
            Ok(GitPushOutcome {
                remote,
                branch,
                set_upstream,
                output,
            })
        } else if output.is_empty() {
            Err("push failed".into())
        } else {
            Err(output)
        }
    }
    /// Synchronous pre-commit validation. Returns `confirmationRequired:<token>`
    /// when a partial-stage file needs explicit user confirmation; otherwise
    /// returns `Ok(())` and the caller may spawn the detached commit.
    // Snapshot identity, message, and confirmation stay positional until git/ is regrouped.
    #[allow(clippy::too_many_arguments)]
    pub fn prepare_commit(
        &self,
        snapshot_id: &str,
        owner: &str,
        root: &Path,
        generation: u64,
        message: &str,
        confirmation_token: Option<&str>,
        amend: bool,
    ) -> Result<(), String> {
        if message.trim().is_empty() || message.len() > 64 * 1024 {
            return Err("invalid commit message".into());
        }
        assert_workspace_root(root)?;
        let snapshot = self.snapshot_for(snapshot_id, owner, root, generation)?;
        let current_head = git(root, &["rev-parse", "--verify", "HEAD"])
            .ok()
            .map(|v| display_path(&v).trim().to_owned());
        let current_tree = git(root, &["write-tree"])
            .ok()
            .map(|v| display_path(&v).trim().to_owned());
        if current_head != snapshot.head_oid || current_tree != snapshot.index_tree_oid {
            return Err("stale snapshot".into());
        }
        let partial = snapshot.entries.iter().any(|entry| {
            entry
                .xy
                .as_deref()
                .is_some_and(|xy| xy.as_bytes().first().is_some_and(|v| *v != b'.'))
                && entry
                    .xy
                    .as_deref()
                    .is_some_and(|xy| xy.as_bytes().get(1).is_some_and(|v| *v != b'.'))
        });
        if partial {
            let mut store = recover_lock(&self.snapshots);
            let record = store.get_mut(snapshot_id).ok_or("stale snapshot")?;
            record.amend = amend;
            if confirmation_token.is_none() {
                let token = Uuid::new_v4().simple().to_string();
                record.partial_stage_token = Some(token.clone());
                record.partial_stage_token_created = Some(Instant::now());
                return Err(format!("confirmationRequired:{token}"));
            }
            if record.partial_stage_token.as_deref() != confirmation_token
                || record
                    .partial_stage_token_created
                    .is_none_or(|created| created.elapsed() > Duration::from_secs(60))
            {
                return Err("invalid confirmation token".into());
            }
            record.partial_stage_token = None;
            record.partial_stage_token_created = None;
        }
        {
            let mut store = recover_lock(&self.snapshots);
            if let Some(record) = store.get_mut(snapshot_id) {
                record.amend = amend;
            }
        }
        Ok(())
    }

    /// Spawn a detached, host-owned commit. Once spawned the commit is not
    /// cancelled by client disconnect or workspace transition: the host runs
    /// it to completion under a 5-minute hard deadline, records initial HEAD
    /// for reconciliation, and notifies the caller with the result frame.
    #[allow(clippy::too_many_arguments)]
    pub fn commit_detached(
        &self,
        snapshot_id: String,
        owner: String,
        root: PathBuf,
        generation: u64,
        request_id: String,
        message: String,
        notify: Option<Box<dyn FnOnce(String) + Send>>,
    ) {
        // Capture the authorized snapshot before the detached task can wait
        // for the per-workspace write slot. A workspace transition is allowed
        // to clear interactive snapshots after spawn, but must not turn this
        // host-owned commit into a stale request while it is queued.
        let captured_snapshot = self
            .snapshot_for(&snapshot_id, &owner, &root, generation)
            .ok();
        let snapshots = self.snapshots.clone();
        let write_slot = self.lock_for_write(&root);
        thread::spawn(move || {
            let _slot = recover_lock(&write_slot);
            // Re-validate HEAD/index against the snapshot captured at spawn
            // while holding the write slot. A concurrent index mutation is
            // rejected, but transition cleanup cannot revoke this job's
            // already-authorized snapshot.
            let snapshot = match captured_snapshot {
                Some(record) => record,
                None => {
                    let frame = record_outcome(
                        &request_id,
                        generation,
                        "failed",
                        None,
                        false,
                        Some("stale snapshot".into()),
                    );
                    if let Some(notify) = notify {
                        notify(frame);
                    }
                    return;
                }
            };
            let current_head = git(&root, &["rev-parse", "--verify", "HEAD"])
                .ok()
                .map(|v| display_path(&v).trim().to_owned());
            let current_tree = git(&root, &["write-tree"])
                .ok()
                .map(|v| display_path(&v).trim().to_owned());
            if current_head != snapshot.head_oid || current_tree != snapshot.index_tree_oid {
                let frame = record_outcome(
                    &request_id,
                    generation,
                    "failed",
                    None,
                    false,
                    Some("stale snapshot".into()),
                );
                if let Some(notify) = notify {
                    notify(frame);
                }
                recover_lock(&snapshots).remove(&snapshot_id);
                return;
            }
            // Copy the expected tree into the detached job before executing
            // Git. Workspace transition cleanup may remove authorization
            // snapshots while this host-owned commit is still running.
            let expected_tree = snapshot.index_tree_oid.clone();
            let initial_head = current_head;
            let temp = match tempfile::Builder::new()
                .prefix("spopi-git-message-")
                .tempfile()
            {
                Ok(temp) => temp,
                Err(error) => {
                    let frame = record_outcome(
                        &request_id,
                        generation,
                        "failed",
                        None,
                        false,
                        Some(error.to_string()),
                    );
                    if let Some(notify) = notify {
                        notify(frame);
                    }
                    recover_lock(&snapshots).remove(&snapshot_id);
                    return;
                }
            };
            if let Err(error) = fs::write(temp.path(), message.as_bytes()) {
                let frame = record_outcome(
                    &request_id,
                    generation,
                    "failed",
                    None,
                    false,
                    Some(error.to_string()),
                );
                if let Some(notify) = notify {
                    notify(frame);
                }
                recover_lock(&snapshots).remove(&snapshot_id);
                return;
            }
            let args = if snapshot.amend {
                vec![
                    OsString::from("commit"),
                    OsString::from("--amend"),
                    OsString::from("-F"),
                    temp.path().as_os_str().to_owned(),
                ]
            } else {
                vec![
                    OsString::from("commit"),
                    OsString::from("-F"),
                    temp.path().as_os_str().to_owned(),
                ]
            };
            let started = Instant::now();
            // Commit uses a dedicated 5-minute deadline, not the 30s write
            // deadline, because pre-commit hooks may legitimately run long.
            // run_commit also puts git in its own process group so hook
            // descendants are killed as a tree on timeout.
            let commit_result = run_git(git_command(&root, args.iter().cloned()), COMMIT_DEADLINE);
            let _elapsed = started.elapsed();
            // run_git returns (stdout, stderr, success) or Err on timeout/overflow.
            let (commit_ok, stderr_text) = match commit_result {
                Ok((_stdout, stderr, success)) => {
                    (success, String::from_utf8_lossy(&stderr).to_string())
                }
                Err(error) => {
                    // timeout or output overflow — no stderr available.
                    (false, error)
                }
            };
            let timed_out = stderr_text.contains("timed out");
            // Reconciliation: compare initial and current HEAD to classify
            // succeeded / failed / outcomeUnknown. Unborn repos go from
            // None -> Some(oid) on first commit.
            let current_head = git(&root, &["rev-parse", "--verify", "HEAD"])
                .ok()
                .map(|v| display_path(&v).trim().to_owned());
            let actual_tree = git(&root, &["rev-parse", "HEAD^{tree}"])
                .ok()
                .map(|v| display_path(&v).trim().to_owned());
            let hook_changed_tree = actual_tree.is_some() && actual_tree != expected_tree;
            // Success means HEAD changed (including None -> Some for unborn).
            // Failure means HEAD stayed the same. outcomeUnknown covers timeout
            // or ambiguous HEAD state. Preserve bounded stderr so the user can
            // see why a hook rejected the commit.
            let (status, commit_oid, error) =
                if commit_ok && current_head.is_some() && current_head != initial_head {
                    ("succeeded", current_head.clone(), None)
                } else if !commit_ok && !timed_out && current_head == initial_head {
                    // Hook rejection or commit failure — include stderr so the
                    // user can diagnose and retry.
                    let trimmed = stderr_text.trim();
                    (
                        "failed",
                        None,
                        if trimmed.is_empty() {
                            None
                        } else {
                            Some(trimmed.to_string())
                        },
                    )
                } else {
                    // timeout or ambiguous HEAD state
                    (
                        "outcomeUnknown",
                        None,
                        if stderr_text.trim().is_empty() {
                            None
                        } else {
                            Some(stderr_text.trim().to_string())
                        },
                    )
                };
            let frame = record_outcome(
                &request_id,
                generation,
                status,
                commit_oid,
                hook_changed_tree,
                error,
            );
            if let Some(notify) = notify {
                notify(frame);
            }
            recover_lock(&snapshots).remove(&snapshot_id);
        });
    }
}
