// ABOUTME: Checks branch names and remote git inputs before they reach the git binary.
// ABOUTME: A name with option-like characters is rejected.
// ABOUTME: Network, branch, and remote Git ops: init, fetch, pull --ff-only, checkout, remote add/set-url/remove.

use super::*;
use serde::Serialize;
use std::ffi::OsString;
use std::path::Path;
use std::sync::TryLockError;

pub const PULL_DIVERGED: &str = "Branch diverged; merge or rebase in a terminal";
pub const PULL_NO_UPSTREAM: &str = "pull_no_upstream";

const MAX_REMOTE_URL_CHARS: usize = 2048;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchInfo {
    pub name: String,
    pub current: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitRemoteInfo {
    pub name: String,
    pub url: String,
}

pub fn is_safe_remote_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() < 64
        && !name.starts_with(['-', '.'])
        && !name.ends_with(".lock")
        && !name.contains("..")
        && name
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
}

/// URLs with a known scheme, or `user@host:path`. Transport helpers such as
/// `ext::` run a command, so `::` is refused anywhere in the URL.
pub fn is_safe_remote_url(url: &str) -> bool {
    if url.is_empty()
        || url.chars().count() > MAX_REMOTE_URL_CHARS
        || url.starts_with('-')
        || url.contains("::")
        || url.chars().any(|ch| ch.is_whitespace() || ch.is_control())
    {
        return false;
    }
    let lower = url.to_ascii_lowercase();
    if ["https://", "http://", "ssh://", "git://", "file://"]
        .iter()
        .any(|scheme| lower.starts_with(scheme) && lower.len() > scheme.len())
    {
        return true;
    }
    // scp-like: user@host:path, with no scheme.
    let Some((user_host, path)) = url.split_once(':') else {
        return false;
    };
    let Some((user, host)) = user_host.split_once('@') else {
        return false;
    };
    !user.is_empty()
        && !host.is_empty()
        && !path.is_empty()
        && !path.starts_with("//")
        && user
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
        && host
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-'))
}

pub(crate) fn remote_names(root: &Path) -> Result<Vec<String>, String> {
    Ok(String::from_utf8_lossy(&git(root, &["remote"])?)
        .lines()
        .map(|line| line.trim().to_owned())
        .filter(|line| !line.is_empty())
        .collect())
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
        if text.contains("no tracking information") {
            return Err(PULL_NO_UPSTREAM.into());
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

    pub fn remotes(&self, root: &Path) -> Result<Vec<GitRemoteInfo>, String> {
        assert_workspace_root(root)?;
        remote_names(root)?
            .into_iter()
            .filter(|name| is_safe_remote_name(name))
            .map(|name| {
                let url = String::from_utf8_lossy(&git(root, &["remote", "get-url", &name])?)
                    .trim()
                    .to_owned();
                Ok(GitRemoteInfo { name, url })
            })
            .collect()
    }

    pub fn add_remote(&self, root: &Path, name: &str, url: &str) -> Result<(), String> {
        let url = url.trim();
        check_remote(name, url)?;
        self.with_write_slot(root, || {
            if remote_names(root)?.iter().any(|known| known == name) {
                return Err(format!("a remote named {name} already exists"));
            }
            git(root, &["remote", "add", name, url]).map(|_| ())
        })
    }

    pub fn set_remote_url(&self, root: &Path, name: &str, url: &str) -> Result<(), String> {
        let url = url.trim();
        check_remote(name, url)?;
        self.with_write_slot(root, || {
            require_remote(root, name)?;
            git(root, &["remote", "set-url", name, url]).map(|_| ())
        })
    }

    pub fn remove_remote(&self, root: &Path, name: &str) -> Result<(), String> {
        if !is_safe_remote_name(name) {
            return Err("invalid remote name".into());
        }
        self.with_write_slot(root, || {
            require_remote(root, name)?;
            git(root, &["remote", "remove", name]).map(|_| ())
        })
    }

    fn with_write_slot<T>(
        &self,
        root: &Path,
        run: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        assert_workspace_root(root)?;
        let write_slot = self.lock_for_write(root);
        let _slot = match write_slot.try_lock() {
            Ok(slot) => slot,
            Err(TryLockError::WouldBlock) => return Err("busy".into()),
            Err(TryLockError::Poisoned(_)) => return Err("write slot unavailable".into()),
        };
        run()
    }
}

fn check_remote(name: &str, url: &str) -> Result<(), String> {
    if !is_safe_remote_name(name) {
        return Err("invalid remote name".into());
    }
    if !is_safe_remote_url(url) {
        return Err("invalid remote URL".into());
    }
    Ok(())
}

fn require_remote(root: &Path, name: &str) -> Result<(), String> {
    if remote_names(root)?.iter().any(|known| known == name) {
        Ok(())
    } else {
        Err(format!("no remote named {name}"))
    }
}
