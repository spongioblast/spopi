// ABOUTME: Checks branch names and remote git inputs before they reach the git binary.
// ABOUTME: A name with option-like characters is rejected.
// ABOUTME: Network and branch Git ops: init, fetch, pull --ff-only, list, checkout.

use super::*;
use serde::Serialize;
use std::ffi::OsString;
use std::path::Path;
use std::sync::TryLockError;

pub const PULL_DIVERGED: &str = "Branch diverged; merge or rebase in a terminal";

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchInfo {
    pub name: String,
    pub current: bool,
}

pub fn is_safe_branch_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() < 128
        && !name.starts_with('-')
        && !name.starts_with('/')
        && !name.ends_with('/')
        && !name.contains("..")
        && !name.contains(char::is_whitespace)
        && name
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '/' | '-'))
}

impl GitService {
    /// Create a repository in `root` on branch `main`. A folder that is already
    /// its own repository is left as-is. A folder inside a parent repository is refused.
    pub fn init_repository(&self, root: &Path) -> Result<(), String> {
        match git(root, &["rev-parse", "--show-toplevel"]) {
            Ok(bytes) => {
                let toplevel = String::from_utf8_lossy(&bytes).trim().to_string();
                let host = std::fs::canonicalize(root)
                    .map_err(|error| format!("invalid workspace root: {error}"))?;
                let resolved = std::fs::canonicalize(&toplevel)
                    .map_err(|error| format!("invalid git toplevel: {error}"))?;
                if host == resolved {
                    return Ok(());
                }
                return Err("workspace root is nested inside another git repository".into());
            }
            Err(error) if error.to_lowercase().contains("not a git repository") => {}
            Err(error) => return Err(error),
        }
        let _write_slot = self.lock_for_write(root);
        let _slot = match _write_slot.try_lock() {
            Ok(slot) => slot,
            Err(TryLockError::WouldBlock) => return Err("busy".into()),
            Err(TryLockError::Poisoned(_)) => return Err("write slot unavailable".into()),
        };
        git(root, &["init", "-b", "main"]).map(|_| ())
    }

    pub fn fetch(&self, root: &Path) -> Result<(), String> {
        assert_workspace_root(root)?;
        let _write_slot = self.lock_for_write(root);
        let _slot = match _write_slot.try_lock() {
            Ok(slot) => slot,
            Err(TryLockError::WouldBlock) => return Err("busy".into()),
            Err(TryLockError::Poisoned(_)) => return Err("write slot unavailable".into()),
        };
        let mut command = git_command(root, [OsString::from("fetch"), OsString::from("--prune")]);
        apply_network_env(&mut command, root);
        let (_stdout, stderr, success) = run_git(command, PUSH_DEADLINE)?;
        if success {
            Ok(())
        } else {
            Err(bounded_push_output(&stderr))
        }
    }

    pub fn pull(&self, root: &Path) -> Result<(), String> {
        assert_workspace_root(root)?;
        let _write_slot = self.lock_for_write(root);
        let _slot = match _write_slot.try_lock() {
            Ok(slot) => slot,
            Err(TryLockError::WouldBlock) => return Err("busy".into()),
            Err(TryLockError::Poisoned(_)) => return Err("write slot unavailable".into()),
        };
        let mut command = git_command(root, [OsString::from("pull"), OsString::from("--ff-only")]);
        apply_network_env(&mut command, root);
        let (_stdout, stderr, success) = run_git(command, PUSH_DEADLINE)?;
        if success {
            return Ok(());
        }
        let text = String::from_utf8_lossy(&stderr);
        if text.contains("Not possible to fast-forward")
            || text.contains("diverged")
            || text.contains("refusing to merge")
        {
            return Err(PULL_DIVERGED.into());
        }
        Err(bounded_push_output(&stderr))
    }

    pub fn branches(&self, root: &Path) -> Result<Vec<GitBranchInfo>, String> {
        assert_workspace_root(root)?;
        let output = git(
            root,
            &[
                "for-each-ref",
                "--format=%(refname:short)%00%(HEAD)",
                "refs/heads",
            ],
        )?;
        let mut branches = Vec::new();
        for line in output.split(|byte| *byte == b'\n') {
            if line.is_empty() {
                continue;
            }
            let mut parts = line.split(|byte| *byte == 0);
            let name = String::from_utf8_lossy(parts.next().unwrap_or_default())
                .trim()
                .to_owned();
            let marker = String::from_utf8_lossy(parts.next().unwrap_or_default());
            if name.is_empty() || !is_safe_branch_name(&name) {
                continue;
            }
            branches.push(GitBranchInfo {
                name,
                current: marker.trim() == "*",
            });
        }
        Ok(branches)
    }

    pub fn checkout(&self, root: &Path, name: &str, create: bool) -> Result<(), String> {
        assert_workspace_root(root)?;
        if !is_safe_branch_name(name) {
            return Err("invalid branch name".into());
        }
        let _write_slot = self.lock_for_write(root);
        let _slot = match _write_slot.try_lock() {
            Ok(slot) => slot,
            Err(TryLockError::WouldBlock) => return Err("busy".into()),
            Err(TryLockError::Poisoned(_)) => return Err("write slot unavailable".into()),
        };
        let args = if create {
            vec!["checkout", "-b", name]
        } else {
            vec!["checkout", name]
        };
        git(root, &args).map(|_| ())
    }
}
