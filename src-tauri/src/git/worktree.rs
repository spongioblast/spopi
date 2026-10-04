// ABOUTME: Creates, merges, and removes a git worktree for the sidebar.
// ABOUTME: Git remains the list. The folder layout matches @pify/worktree.

use super::{git, git_command, run_git, GitService, GIT_WORKTREE_DEADLINE};
use std::ffi::OsString;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct WorktreeEntry {
    pub path: String,
    pub branch: Option<String>,
    pub primary: bool,
    pub locked: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct MergeOutcome {
    pub merged: bool,
    pub into: String,
    pub conflicts: Vec<String>,
}

/// `~/.worktrees/<repo>/<branch>`, with `-2`, `-3`, … when that folder exists.
pub(crate) fn worktree_path(home: &Path, primary: &Path, branch: &str) -> PathBuf {
    let repo = primary.file_name().unwrap_or_default();
    let dir = branch_dir_name(branch);
    let base = home.join(".worktrees").join(repo);
    let mut candidate = base.join(&dir);
    let mut suffix = 2u32;
    while candidate.exists() {
        candidate = base.join(format!("{dir}-{suffix}"));
        suffix += 1;
    }
    candidate
}

fn branch_dir_name(branch: &str) -> String {
    branch
        .chars()
        .map(|ch| match ch {
            '/' => '-',
            ch if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-') => ch,
            _ => '_',
        })
        .take(100)
        .collect()
}

pub(crate) fn parse_worktree_porcelain(bytes: &[u8]) -> Vec<WorktreeEntry> {
    let text = String::from_utf8_lossy(bytes);
    let mut entries = Vec::new();
    let mut path = String::new();
    let mut branch = None;
    let mut locked = false;
    let mut started = false;
    let push =
        |entries: &mut Vec<WorktreeEntry>, path: &str, branch: &Option<String>, locked: bool| {
            if path.is_empty() {
                return;
            }
            entries.push(WorktreeEntry {
                path: path.to_owned(),
                branch: branch.clone(),
                primary: false,
                locked,
            });
        };
    for line in text.lines() {
        if let Some(value) = line.strip_prefix("worktree ") {
            if started {
                push(&mut entries, &path, &branch, locked);
            }
            path = value.trim().to_owned();
            branch = None;
            locked = false;
            started = true;
        } else if let Some(value) = line.strip_prefix("branch ") {
            branch = Some(
                value
                    .trim()
                    .strip_prefix("refs/heads/")
                    .unwrap_or(value.trim())
                    .to_owned(),
            );
        } else if line == "locked" || line.starts_with("locked ") {
            locked = true;
        }
    }
    if started {
        push(&mut entries, &path, &branch, locked);
    }
    if let Some(first) = entries.first_mut() {
        first.primary = true;
    }
    entries
}

fn reject_branch_name(branch: &str) -> Result<(), String> {
    if branch.is_empty()
        || branch.starts_with('-')
        || branch.contains("..")
        || branch.chars().any(char::is_whitespace)
    {
        return Err("That branch name cannot be used".into());
    }
    Ok(())
}

impl GitService {
    pub(crate) fn worktree_list(&self, root: &Path) -> Result<Vec<WorktreeEntry>, String> {
        let bytes = git(root, &["worktree", "list", "--porcelain"])?;
        Ok(parse_worktree_porcelain(&bytes))
    }

    /// New branch from the primary checkout's current branch, in `~/.worktrees`.
    pub(crate) fn worktree_add(
        &self,
        primary: &Path,
        branch: &str,
        base: &str,
        home: &Path,
    ) -> Result<PathBuf, String> {
        let branch = branch.trim();
        reject_branch_name(branch)?;
        let (_out, stderr, ok) = run_git(
            git_command(
                primary,
                ["check-ref-format", "--branch", branch]
                    .into_iter()
                    .map(OsString::from),
            ),
            GIT_WORKTREE_DEADLINE,
        )?;
        if !ok {
            return Err(git_error(&stderr, "That branch name cannot be used"));
        }
        let path = worktree_path(home, primary, branch);
        let args = [
            OsString::from("worktree"),
            OsString::from("add"),
            OsString::from("-b"),
            OsString::from(branch),
            OsString::from("--"),
            path.as_os_str().to_os_string(),
            OsString::from(base),
        ];
        let (_out, stderr, ok) = run_git(git_command(primary, args), GIT_WORKTREE_DEADLINE)?;
        if !ok {
            return Err(git_error(&stderr, "Cannot create the worktree"));
        }
        Ok(path)
    }

    pub(crate) fn worktree_remove(
        &self,
        primary: &Path,
        path: &Path,
        force: bool,
    ) -> Result<(), String> {
        let mut args = vec![OsString::from("worktree"), OsString::from("remove")];
        if force {
            args.push(OsString::from("--force"));
        }
        args.push(path.as_os_str().to_os_string());
        let (_out, stderr, ok) = run_git(git_command(primary, args), GIT_WORKTREE_DEADLINE)?;
        if !ok {
            return Err(git_error(&stderr, "Cannot remove the worktree"));
        }
        let _ = run_git(
            git_command(
                primary,
                ["worktree", "prune"].into_iter().map(OsString::from),
            ),
            GIT_WORKTREE_DEADLINE,
        );
        Ok(())
    }

    /// No changed tracked files. With `untracked`, new files count too, as
    /// `git worktree remove` counts them.
    pub(crate) fn is_clean(&self, root: &Path, untracked: bool) -> Result<bool, String> {
        let mode = if untracked {
            "--untracked-files=normal"
        } else {
            "--untracked-files=no"
        };
        let output = git(root, &["status", "--porcelain", mode])?;
        Ok(String::from_utf8_lossy(&output).trim().is_empty())
    }

    pub(crate) fn current_branch(&self, root: &Path) -> Result<Option<String>, String> {
        let output = git(root, &["rev-parse", "--abbrev-ref", "HEAD"])?;
        let name = String::from_utf8_lossy(&output).trim().to_owned();
        if name.is_empty() || name == "HEAD" {
            Ok(None)
        } else {
            Ok(Some(name))
        }
    }

    /// Merge `branch` into the primary checkout. A conflict is aborted, so the
    /// primary stays clean. Any other failure is an error with git's message.
    pub(crate) fn merge_branch(
        &self,
        primary: &Path,
        branch: &str,
    ) -> Result<MergeOutcome, String> {
        if branch.is_empty() || branch.starts_with('-') {
            return Err(format!("\"{branch}\" is not a branch to merge"));
        }
        let into = self.current_branch(primary)?.unwrap_or_default();
        let args = ["merge", "--no-edit", branch]
            .into_iter()
            .map(OsString::from);
        let (_out, stderr, ok) = run_git(git_command(primary, args), GIT_WORKTREE_DEADLINE)?;
        if ok {
            return Ok(MergeOutcome {
                merged: true,
                into,
                conflicts: Vec::new(),
            });
        }
        let conflicts =
            git(primary, &["diff", "--name-only", "--diff-filter=U"]).unwrap_or_default();
        let names: Vec<String> = String::from_utf8_lossy(&conflicts)
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(str::to_owned)
            .collect();
        if names.is_empty() {
            return Err(git_error(&stderr, "Cannot merge the worktree"));
        }
        let _ = run_git(
            git_command(
                primary,
                ["merge", "--abort"].into_iter().map(OsString::from),
            ),
            GIT_WORKTREE_DEADLINE,
        );
        Ok(MergeOutcome {
            merged: false,
            into,
            conflicts: names,
        })
    }
}

fn git_error(stderr: &[u8], fallback: &str) -> String {
    let message = String::from_utf8_lossy(stderr).trim().to_owned();
    if message.is_empty() {
        fallback.to_owned()
    } else {
        message
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_worktree_porcelain, worktree_path};
    use std::fs;

    #[test]
    fn porcelain_marks_the_first_entry_primary_and_keeps_locked() {
        let text = "\
worktree /repo
HEAD aaa
branch refs/heads/main

worktree /repo-feature
HEAD bbb
branch refs/heads/feat/x
locked reason

";
        let entries = parse_worktree_porcelain(text.as_bytes());
        assert_eq!(entries.len(), 2);
        assert!(entries[0].primary);
        assert_eq!(entries[0].branch.as_deref(), Some("main"));
        assert!(!entries[0].locked);
        assert!(!entries[1].primary);
        assert_eq!(entries[1].branch.as_deref(), Some("feat/x"));
        assert!(entries[1].locked);
    }

    #[test]
    fn the_folder_uses_the_branch_name_and_a_suffix_when_taken() {
        let home = tempfile::tempdir().unwrap();
        let primary = home.path().join("repo");
        fs::create_dir_all(home.path().join(".worktrees").join("repo").join("feat-x")).unwrap();
        let path = worktree_path(home.path(), &primary, "feat/x");
        assert_eq!(
            path,
            home.path().join(".worktrees").join("repo").join("feat-x-2")
        );
    }
}
