// ABOUTME: Reads pi-workspace-history's shadow git for one workspace.
// ABOUTME: A session counts only when meta.json names the workspace and repo.git has HEAD.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShadowHistoryFile {
    pub path: String,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShadowHistoryRecord {
    pub empty: bool,
    pub has_head: bool,
    pub meta: Option<ShadowHistoryMeta>,
    pub files: Vec<ShadowHistoryFile>,
    pub turn: Option<ShadowTurn>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShadowTurn {
    pub user_entry_id: String,
    pub index: u32,
    /// Pi's `/undo` rolls back only the newest turn.
    pub latest: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShadowPair {
    pub before: String,
    pub after: String,
    pub before_exists: bool,
    pub after_exists: bool,
    pub binary: bool,
    pub too_large: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShadowHistoryMeta {
    pub realpath: String,
    pub cwd: String,
}

pub fn shadow_history_files(
    workspace: &Path,
    session_id: &str,
) -> Result<ShadowHistoryRecord, String> {
    shadow_history_files_scoped(workspace, session_id, "turn")
}

pub fn shadow_history_files_scoped(
    workspace: &Path,
    session_id: &str,
    scope: &str,
) -> Result<ShadowHistoryRecord, String> {
    let Some(agent) = crate::pi::binary::pi_agent_dir() else {
        return Ok(empty_record());
    };
    shadow_history_files_at(
        &agent.join("state").join("workspace-history"),
        workspace,
        session_id,
        scope,
    )
}

pub fn shadow_history_file_pair(
    workspace: &Path,
    session_id: &str,
    path: &str,
    scope: &str,
) -> Result<ShadowPair, String> {
    let Some(agent) = crate::pi::binary::pi_agent_dir() else {
        return Ok(empty_pair());
    };
    let git_dir = matched_git(
        &agent.join("state").join("workspace-history"),
        workspace,
        session_id,
    )?;
    let Some(git_dir) = git_dir else {
        return Ok(empty_pair());
    };
    let Some((before_rev, after_rev)) = scope_range(&git_dir, scope) else {
        return Ok(empty_pair());
    };
    Ok(pair_from_blobs(
        show_blob_bytes(&git_dir, &format!("{before_rev}:{path}")),
        show_blob_bytes(&git_dir, &format!("{after_rev}:{path}")),
    ))
}

/// A turn with no record has no range: the package prunes old sessions, and
/// guessing `HEAD~1` would show another step's changes under that turn.
fn scope_range(git_dir: &Path, scope: &str) -> Option<(String, String)> {
    if scope == "session" {
        return Some((
            root_commit(git_dir).unwrap_or_else(|| "HEAD".into()),
            "HEAD".to_string(),
        ));
    }
    turn_range(git_dir, scope)
}

/// Before and after commits of one prompt from `turn-snapshots.json`, which sits
/// next to `repo.git`. The package commits after every model step, so `HEAD~1`
/// only covers the last step. `turn` is the latest prompt; `turn:<userEntryId>`
/// names one.
fn turn_range(git_dir: &Path, scope: &str) -> Option<(String, String)> {
    let want = scope.strip_prefix("turn:").unwrap_or("");
    let text = fs::read_to_string(git_dir.parent()?.join("turn-snapshots.json")).ok()?;
    let value: Value = serde_json::from_str(&text).ok()?;
    let turns = value.get("turns")?.as_array()?;
    let turn = if want.is_empty() {
        turns.last()?
    } else {
        turns
            .iter()
            .rev()
            .find(|turn| turn.get("userEntryId").and_then(Value::as_str) == Some(want))?
    };
    let commit = |key: &str| {
        turn.get(key)
            .and_then(Value::as_str)
            .filter(|sha| !sha.is_empty() && sha.chars().all(|c| c.is_ascii_hexdigit()))
            .map(str::to_string)
    };
    Some((commit("beforeCommit")?, commit("afterCommit")?))
}

pub fn shadow_history_files_at(
    storage: &Path,
    workspace: &Path,
    session_id: &str,
    scope: &str,
) -> Result<ShadowHistoryRecord, String> {
    let workspaces = storage.join("workspaces");
    if !workspaces.is_dir() {
        return Ok(empty_record());
    }
    let mut saw_match = false;
    let mut matched_git: Option<PathBuf> = None;
    let mut matched_meta: Option<ShadowHistoryMeta> = None;
    for entry in fs::read_dir(&workspaces).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        if !entry.file_type().is_ok_and(|kind| kind.is_dir()) {
            continue;
        }
        let meta = read_meta(&entry.path().join("meta.json"));
        let Some(meta) = meta else {
            continue;
        };
        if !same_dir(&meta, workspace) {
            continue;
        }
        saw_match = true;
        matched_meta = Some(meta);
        matched_git = find_git_dir(&entry.path().join("sessions"), session_id);
        break;
    }
    if !saw_match {
        return Ok(empty_record());
    }
    let Some(git_dir) = matched_git else {
        return Ok(ShadowHistoryRecord {
            meta: matched_meta,
            ..empty_record()
        });
    };
    if !git_dir.join("HEAD").is_file() {
        return Err("workspace-history repo.git has no HEAD".into());
    }
    Ok(ShadowHistoryRecord {
        empty: false,
        has_head: true,
        meta: matched_meta,
        files: diff_names(&git_dir, scope),
        turn: resolved_turn(&git_dir, scope),
    })
}

fn matched_git(
    storage: &Path,
    workspace: &Path,
    session_id: &str,
) -> Result<Option<PathBuf>, String> {
    let workspaces = storage.join("workspaces");
    if !workspaces.is_dir() {
        return Ok(None);
    }
    for entry in fs::read_dir(&workspaces).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        if !entry.file_type().is_ok_and(|kind| kind.is_dir()) {
            continue;
        }
        let Some(meta) = read_meta(&entry.path().join("meta.json")) else {
            continue;
        };
        if !same_dir(&meta, workspace) {
            continue;
        }
        return Ok(find_git_dir(&entry.path().join("sessions"), session_id));
    }
    Ok(None)
}

fn empty_record() -> ShadowHistoryRecord {
    ShadowHistoryRecord {
        empty: true,
        has_head: false,
        meta: None,
        files: Vec::new(),
        turn: None,
    }
}

fn empty_pair() -> ShadowPair {
    ShadowPair {
        before: String::new(),
        after: String::new(),
        before_exists: false,
        after_exists: false,
        binary: false,
        too_large: false,
    }
}

fn read_meta(path: &Path) -> Option<ShadowHistoryMeta> {
    let text = fs::read_to_string(path).ok()?;
    let value: Value = serde_json::from_str(&text).ok()?;
    let object = value.as_object()?;
    let realpath = object
        .get("realpath")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    let cwd = object
        .get("cwd")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    if realpath.is_empty() && cwd.is_empty() {
        return None;
    }
    Some(ShadowHistoryMeta { realpath, cwd })
}

fn same_dir(meta: &ShadowHistoryMeta, workspace: &Path) -> bool {
    let want = normalize_existing(workspace);
    [&meta.realpath, &meta.cwd].iter().any(|folder| {
        if folder.is_empty() {
            return false;
        }
        normalize_existing(Path::new(folder)) == want
    })
}

fn normalize_existing(path: &Path) -> String {
    let resolved = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    resolved
        .to_string_lossy()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_string()
}

/// Only the chat's own repo counts. A chat that has not edited anything yet has
/// none, and another session's repo would show its changes under this chat.
/// The id is a folder name, so `..`, separators, and anything else outside the
/// session id alphabet would reach another chat's repo.
fn find_git_dir(sessions: &Path, session_id: &str) -> Option<PathBuf> {
    let safe = !session_id.is_empty()
        && session_id.len() <= 128
        && session_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_');
    if !safe {
        return None;
    }
    let git_dir = sessions.join(session_id).join("repo.git");
    git_dir.is_dir().then_some(git_dir)
}

fn root_commit(git_dir: &Path) -> Option<String> {
    let text = git_output(git_dir, &["rev-list", "--max-parents=0", "HEAD"])?;
    text.lines()
        .next()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
}

fn show_blob_bytes(git_dir: &Path, spec: &str) -> Option<Vec<u8>> {
    git_stdout(git_dir, &["show", spec])
}

fn git_stdout(git_dir: &Path, args: &[&str]) -> Option<Vec<u8>> {
    let mut command = Command::new("git");
    crate::platform::windows_child::hide_console(&mut command);
    let git = git_dir.to_string_lossy().to_string();
    let mut full = vec!["--git-dir", git.as_str()];
    full.extend(args);
    let output = command.args(full).output().ok()?;
    if !output.status.success() {
        return None;
    }
    Some(output.stdout)
}

fn blob_side(bytes: Option<Vec<u8>>) -> (String, bool, bool, bool) {
    let Some(bytes) = bytes else {
        return (String::new(), false, false, false);
    };
    let too_large = bytes.len() > crate::data::summary::EDIT_SIZE_LIMIT;
    let binary =
        bytes.iter().take(8000).any(|byte| *byte == 0) || std::str::from_utf8(&bytes).is_err();
    if binary || too_large {
        return (String::new(), true, binary, too_large);
    }
    let text = String::from_utf8(bytes).unwrap_or_default();
    (text, true, false, false)
}

fn pair_from_blobs(before: Option<Vec<u8>>, after: Option<Vec<u8>>) -> ShadowPair {
    let (before_text, before_exists, before_binary, before_large) = blob_side(before);
    let (after_text, after_exists, after_binary, after_large) = blob_side(after);
    let binary = before_binary || after_binary;
    let too_large = before_large || after_large;
    ShadowPair {
        before: if binary || too_large {
            String::new()
        } else {
            before_text
        },
        after: if binary || too_large {
            String::new()
        } else {
            after_text
        },
        before_exists,
        after_exists,
        binary,
        too_large,
    }
}

fn resolved_turn(git_dir: &Path, scope: &str) -> Option<ShadowTurn> {
    if !scope.starts_with("turn") {
        return None;
    }
    let want = scope.strip_prefix("turn:").unwrap_or("");
    let text = fs::read_to_string(git_dir.parent()?.join("turn-snapshots.json")).ok()?;
    let value: Value = serde_json::from_str(&text).ok()?;
    let turns = value.get("turns")?.as_array()?;
    let (position, turn) = if want.is_empty() {
        let last = turns.len().checked_sub(1)?;
        (last, turns.get(last)?)
    } else {
        turns
            .iter()
            .enumerate()
            .rev()
            .find(|(_, turn)| turn.get("userEntryId").and_then(Value::as_str) == Some(want))?
    };
    let user_entry_id = turn.get("userEntryId")?.as_str()?.to_string();
    // `/undo` resets the shadow HEAD to the turn's before-commit, so an undone
    // turn stays last in the file but is no longer what `/undo` would roll back.
    let after = turn
        .get("afterCommit")
        .and_then(Value::as_str)
        .unwrap_or("");
    let head = git_output(git_dir, &["rev-parse", "HEAD"]);
    let after_full = git_output(git_dir, &["rev-parse", after]);
    Some(ShadowTurn {
        user_entry_id,
        index: u32::try_from(position).ok()? + 1,
        latest: position + 1 == turns.len() && head.is_some() && head == after_full,
    })
}

fn git_output(git_dir: &Path, args: &[&str]) -> Option<String> {
    let mut command = Command::new("git");
    crate::platform::windows_child::hide_console(&mut command);
    let git = git_dir.to_string_lossy().to_string();
    let mut full = vec!["--git-dir", git.as_str()];
    full.extend(args);
    let output = command.args(full).output().ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn diff_names(git_dir: &Path, scope: &str) -> Vec<ShadowHistoryFile> {
    let mut command = Command::new("git");
    crate::platform::windows_child::hide_console(&mut command);
    let git = git_dir.to_string_lossy().to_string();
    let Some((before, after)) = scope_range(git_dir, scope) else {
        return Vec::new();
    };
    let args = [
        "--git-dir",
        git.as_str(),
        "diff",
        "--name-status",
        &before,
        &after,
    ];
    let Some(output) = command.args(args).output().ok() else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let status = parts.next()?.chars().next()?.to_string();
            let path = parts.next()?.to_string();
            Some(ShadowHistoryFile { path, status })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(label: &str) -> PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|time| time.as_nanos())
            .unwrap_or(0);
        let path = std::env::temp_dir().join(format!("spopi-shadow-{label}-{nonce}"));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn missing_storage_is_empty() {
        let root = temp("missing");
        let workspace = root.join("project");
        fs::create_dir_all(&workspace).unwrap();
        let record =
            shadow_history_files_at(&root.join("storage"), &workspace, "sess", "turn").unwrap();
        assert!(record.empty);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn a_matched_repo_without_head_is_a_format_error() {
        let root = temp("no-head");
        let workspace = root.join("project");
        fs::create_dir_all(&workspace).unwrap();
        let hash = root
            .join("storage")
            .join("workspaces")
            .join("abc")
            .join("sessions")
            .join("sess")
            .join("repo.git");
        fs::create_dir_all(&hash).unwrap();
        let real = workspace.canonicalize().unwrap();
        let meta = serde_json::json!({ "realpath": real, "cwd": real });
        fs::write(
            root.join("storage")
                .join("workspaces")
                .join("abc")
                .join("meta.json"),
            serde_json::to_string(&meta).unwrap(),
        )
        .unwrap();
        let error =
            shadow_history_files_at(&root.join("storage"), &workspace, "sess", "turn").unwrap_err();
        assert!(error.contains("no HEAD"));
        let _ = fs::remove_dir_all(root);
    }

    fn git(git_dir: &Path, work: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .arg("--git-dir")
            .arg(git_dir)
            .arg("--work-tree")
            .arg(work)
            .args(["-c", "user.name=t", "-c", "user.email=t@t"])
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    #[test]
    fn turn_scope_spans_every_step_of_the_prompt() {
        let root = temp("turn");
        let workspace = root.join("project");
        let work = root.join("work");
        fs::create_dir_all(&workspace).unwrap();
        fs::create_dir_all(&work).unwrap();
        let ws_dir = root.join("storage").join("workspaces").join("abc");
        let session = ws_dir.join("sessions").join("sess");
        let repo = session.join("repo.git");
        fs::create_dir_all(&session).unwrap();
        let real = workspace.canonicalize().unwrap();
        let meta = serde_json::json!({ "realpath": real, "cwd": real });
        fs::write(
            ws_dir.join("meta.json"),
            serde_json::to_string(&meta).unwrap(),
        )
        .unwrap();
        git(&repo, &work, &["init", "-q"]);
        let commit = |label: &str| {
            git(&repo, &work, &["add", "-A"]);
            git(
                &repo,
                &work,
                &["commit", "-q", "--allow-empty", "-m", label],
            );
            git(&repo, &work, &["rev-parse", "HEAD"])
        };
        fs::write(work.join("a.txt"), "one\n").unwrap();
        let before = commit("before");
        fs::write(work.join("a.txt"), "two\n").unwrap();
        fs::write(work.join("b.txt"), "new\n").unwrap();
        commit("after step 1");
        fs::write(work.join("b.txt"), "newer\n").unwrap();
        let after = commit("after step 2");
        let turns = serde_json::json!({ "version": 1, "turns": [
            { "userEntryId": "u1", "beforeCommit": before, "afterCommit": after },
        ] });
        fs::write(session.join("turn-snapshots.json"), turns.to_string()).unwrap();

        let storage = root.join("storage");
        for scope in ["turn", "turn:u1"] {
            let record = shadow_history_files_at(&storage, &workspace, "sess", scope).unwrap();
            let mut paths: Vec<_> = record.files.iter().map(|f| f.path.clone()).collect();
            paths.sort();
            assert_eq!(paths, ["a.txt", "b.txt"], "scope {scope}");
        }
        let git_dir = find_git_dir(&ws_dir.join("sessions"), "sess").unwrap();
        let nested = ws_dir.join("sessions").join("sess").join("x");
        fs::create_dir_all(nested.join("repo.git")).unwrap();
        for escape in ["../sessions/sess", "sess/x", "sess\\x", "..", "."] {
            assert!(
                find_git_dir(&ws_dir.join("sessions"), escape).is_none(),
                "{escape}"
            );
        }
        assert_eq!(
            turn_range(&git_dir, "turn:u1"),
            Some((before.clone(), after.clone()))
        );
        assert_eq!(turn_range(&git_dir, "turn:missing"), None);
        let gone = shadow_history_files_at(&storage, &workspace, "sess", "turn:missing").unwrap();
        assert!(gone.files.is_empty() && gone.turn.is_none());
        git(&repo, &work, &["reset", "-q", "--mixed", &before]);
        let undone = shadow_history_files_at(&storage, &workspace, "sess", "turn").unwrap();
        assert_eq!(undone.turn.map(|turn| turn.latest), Some(false));
        git(&repo, &work, &["reset", "-q", "--mixed", &after]);
        assert_eq!(
            blob_side(show_blob_bytes(&git_dir, &format!("{before}:a.txt"))).0,
            "one\n"
        );
        let record = shadow_history_files_at(&storage, &workspace, "sess", "turn").unwrap();
        assert_eq!(
            record.turn,
            Some(ShadowTurn {
                user_entry_id: "u1".into(),
                index: 1,
                latest: true,
            })
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn a_chat_without_its_own_repo_never_reads_another_sessions() {
        let root = temp("other");
        let workspace = root.join("project");
        let work = root.join("work");
        fs::create_dir_all(&workspace).unwrap();
        fs::create_dir_all(&work).unwrap();
        let ws_dir = root.join("storage").join("workspaces").join("abc");
        let other = ws_dir.join("sessions").join("other").join("repo.git");
        fs::create_dir_all(other.parent().unwrap()).unwrap();
        let real = workspace.canonicalize().unwrap();
        let meta = serde_json::json!({ "realpath": real, "cwd": real });
        fs::write(
            ws_dir.join("meta.json"),
            serde_json::to_string(&meta).unwrap(),
        )
        .unwrap();
        git(&other, &work, &["init", "-q"]);
        fs::write(work.join("a.txt"), "one\n").unwrap();
        git(&other, &work, &["add", "-A"]);
        git(&other, &work, &["commit", "-q", "-m", "other"]);

        let storage = root.join("storage");
        for session in ["new", ""] {
            for scope in ["turn", "session"] {
                let record = shadow_history_files_at(&storage, &workspace, session, scope).unwrap();
                assert!(
                    record.empty && record.files.is_empty(),
                    "{session:?} {scope}"
                );
                assert!(record.meta.is_some(), "{session:?} {scope}");
            }
            let pair = matched_git(&storage, &workspace, session).unwrap();
            assert!(pair.is_none(), "{session:?}");
        }
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn blob_side_keeps_exact_text_and_flags_binary_or_huge() {
        let (text, exists, binary, too_large) = blob_side(Some(b"  hi\n".to_vec()));
        assert_eq!(text, "  hi\n");
        assert!(exists && !binary && !too_large);
        let missing = blob_side(None);
        assert!(!missing.1);
        let binary_blob = blob_side(Some(b"a\0b".to_vec()));
        assert!(binary_blob.2 && binary_blob.0.is_empty());
        let huge = vec![b'a'; crate::data::summary::EDIT_SIZE_LIMIT + 1];
        let large = blob_side(Some(huge));
        assert!(large.3 && large.0.is_empty());
    }

    #[test]
    fn meta_without_a_path_is_not_a_workspace() {
        let root = temp("meta");
        let workspace = root.join("project");
        fs::create_dir_all(&workspace).unwrap();
        let dir = root.join("storage").join("workspaces").join("abc");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("meta.json"), r#"{"version":1}"#).unwrap();
        let record =
            shadow_history_files_at(&root.join("storage"), &workspace, "", "turn").unwrap();
        assert!(record.empty);
        let _ = fs::remove_dir_all(root);
    }
}
