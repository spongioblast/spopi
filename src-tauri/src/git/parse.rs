// ABOUTME: Parses git porcelain and builds the commit-result frame.
// ABOUTME: The frame is what the panel shows when a detached commit finishes.
// ABOUTME: Git porcelain parsers and process helpers.
use super::*;
use std::ffi::OsString;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::time::Duration;

pub(crate) fn record_outcome(
    request_id: &str,
    generation: u64,
    status: &str,
    commit_oid: Option<String>,
    hook_changed_tree: bool,
    error: Option<String>,
) -> String {
    let frame = serde_json::json!({
        "type": "git_commit_result",
        "requestId": request_id,
        "workspaceGeneration": generation,
        "status": status,
        "commitOid": commit_oid,
        "hookChangedTree": hook_changed_tree,
        "error": error
    });
    serde_json::to_string(&frame)
        .unwrap_or_else(|_| "{\"type\":\"git_commit_result\",\"status\":\"outcomeUnknown\"}".into())
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitDiffResponse {
    pub comparison: String,
    pub path_bytes_base64: String,
    pub raw_patch: String,
    pub truncated: bool,
    pub fallback_reason: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct GitNameStatusFile {
    pub status: String,
    pub path: String,
    pub path_bytes: Vec<u8>,
    pub original_path: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitLogEntry {
    pub oid: String,
    pub subject: String,
    pub author_name: String,
    pub author_time: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitLogResponse {
    pub commits: Vec<GitLogEntry>,
    pub has_more: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitLogDetailFile {
    pub status: String,
    pub path: String,
    pub path_bytes_base64: String,
    pub original_path: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitLogDetailResponse {
    pub oid: String,
    pub author_name: String,
    pub author_time: i64,
    pub full_message: String,
    pub message_truncated: bool,
    pub files_truncated: bool,
    pub files: Vec<GitLogDetailFile>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CommitKind {
    Root,
    Linear,
    Merge,
}

pub const MAX_LOG_LIMIT: usize = 200;
pub const MAX_LOG_FILES: usize = 2_000;
pub const MAX_LOG_MESSAGE_BYTES: usize = 32 * 1024;
pub const MAX_LOG_FILES_BYTES: usize = 256 * 1024;
pub(crate) const LOG_LIST_FMT: &str = "%H%x00%h%x00%s%x00%an%x00%at";
pub(crate) const LOG_DETAIL_FMT: &str = "%H%x00%an%x00%at%x00%B";

/// Parses `git diff-tree --name-status -r -z` and `git diff --name-status -r -z`.
/// Empty NUL fields are separators between records; path bytes remain opaque.
pub fn parse_diff_tree_name_status_z(bytes: &[u8]) -> Vec<GitNameStatusFile> {
    let tokens: Vec<&[u8]> = bytes
        .split(|b| *b == 0)
        .filter(|token| !token.is_empty())
        .collect();
    let mut files = Vec::new();
    let mut index = 0;
    while index < tokens.len() {
        let token = tokens[index];
        let is_status = matches!(token, b"M" | b"A" | b"D" | b"T" | b"U" | b"X" | b"B")
            || matches!(token.first(), Some(b'R' | b'C'))
                && token.len() > 1
                && token[1..].iter().all(u8::is_ascii_digit);
        if !is_status {
            index += 1;
            continue;
        }
        let is_rename_or_copy = matches!(token.first(), Some(b'R' | b'C'));
        let path_count = if is_rename_or_copy { 2 } else { 1 };
        if index + path_count >= tokens.len() {
            index += 1;
            continue;
        }
        let original = if is_rename_or_copy {
            Some(tokens[index + 1].to_vec())
        } else {
            None
        };
        let path = tokens[index + path_count].to_vec();
        files.push(GitNameStatusFile {
            status: String::from_utf8_lossy(token).into_owned(),
            path: String::from_utf8_lossy(&path).into_owned(),
            path_bytes: path,
            original_path: original
                .as_deref()
                .map(|value| String::from_utf8_lossy(value).into_owned()),
        });
        index += path_count + 1;
    }
    files
}

pub fn validate_oid(oid: &str) -> Result<(), String> {
    if (oid.len() != 40 && oid.len() != 64) || !oid.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("invalid oid".into());
    }
    Ok(())
}

pub fn commit_kind(root: &Path, oid: &str) -> Result<CommitKind, String> {
    validate_oid(oid)?;
    let verify = format!("{oid}^{{commit}}");
    if git(root, &["rev-parse", "--verify", "--quiet", &verify]).is_err() {
        return Err("unknown commit".into());
    }
    let parents = git(root, &["log", "-1", "--format=%P", oid])?;
    Ok(
        match String::from_utf8_lossy(&parents).split_whitespace().count() {
            0 => CommitKind::Root,
            1 => CommitKind::Linear,
            _ => CommitKind::Merge,
        },
    )
}

pub(crate) fn name_status(
    root: &Path,
    kind: &CommitKind,
    oid: &str,
) -> Result<Vec<GitNameStatusFile>, String> {
    let output = match kind {
        CommitKind::Root => git_os(
            root,
            &[
                "--literal-pathspecs".into(),
                "--no-pager".into(),
                "diff-tree".into(),
                "--no-commit-id".into(),
                "--name-status".into(),
                "-M".into(),
                "-C".into(),
                "-r".into(),
                "-z".into(),
                "--root".into(),
                oid.into(),
            ],
        )?,
        CommitKind::Linear => git_os(
            root,
            &[
                "--literal-pathspecs".into(),
                "--no-pager".into(),
                "diff-tree".into(),
                "--no-commit-id".into(),
                "--name-status".into(),
                "-M".into(),
                "-C".into(),
                "-r".into(),
                "-z".into(),
                oid.into(),
            ],
        )?,
        CommitKind::Merge => {
            let parent = format!("{oid}^1");
            git_os(
                root,
                &[
                    "--literal-pathspecs".into(),
                    "--no-pager".into(),
                    "diff".into(),
                    "--name-status".into(),
                    "-M".into(),
                    "-C".into(),
                    "-r".into(),
                    "-z".into(),
                    parent.into(),
                    oid.into(),
                ],
            )?
        }
    };
    Ok(parse_diff_tree_name_status_z(&output))
}

pub(crate) fn path_arg(bytes: &[u8]) -> OsString {
    #[cfg(unix)]
    {
        OsString::from_vec(bytes.to_vec())
    }
    #[cfg(windows)]
    {
        OsString::from(String::from_utf8_lossy(bytes).into_owned())
    }
}

/// Trim git push stderr to a size the UI can render, keeping the tail where
/// git puts the rejection reason and its hints.
pub(crate) fn bounded_push_output(stderr: &[u8]) -> String {
    let text = String::from_utf8_lossy(stderr).trim().to_string();
    if text.len() <= MAX_PUSH_OUTPUT_BYTES {
        return text;
    }
    // Keep the last MAX_PUSH_OUTPUT_BYTES, snapped forward to a char boundary
    // so the slice never splits a multi-byte character.
    let cut = text.len() - MAX_PUSH_OUTPUT_BYTES;
    let start = (cut..text.len())
        .find(|index| text.is_char_boundary(*index))
        .unwrap_or(text.len());
    format!("...{}", &text[start..])
}

pub fn is_git_unavailable(error: &str) -> bool {
    let message = error.trim();
    message == GIT_NOT_FOUND || message.eq_ignore_ascii_case("program not found")
}

pub(crate) fn map_git_spawn_error(error: std::io::Error) -> String {
    if error.kind() == std::io::ErrorKind::NotFound {
        GIT_NOT_FOUND.to_string()
    } else {
        error.to_string()
    }
}

pub(crate) fn run_git(
    mut command: Command,
    deadline: Duration,
) -> Result<(Vec<u8>, Vec<u8>, bool), String> {
    let mut child = command.spawn().map_err(map_git_spawn_error)?;
    let stdout = child.stdout.take().ok_or("git stdout unavailable")?;
    let stderr = child.stderr.take().ok_or("git stderr unavailable")?;
    let out_thread = thread::spawn(move || read_limited(stdout, MAX_STDOUT_BYTES));
    let err_thread = thread::spawn(move || read_limited(stderr, MAX_STDERR_BYTES));
    let deadline_at = Instant::now() + deadline;
    loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            let (out, out_overflow) = out_thread
                .join()
                .map_err(|_| "git stdout reader failed".to_string())??;
            let (err, _err_overflow) = err_thread
                .join()
                .map_err(|_| "git stderr reader failed".to_string())??;
            if out_overflow {
                // Truncated status output is unsafe to parse as porcelain.
                terminate_git(&mut child);
                return Err("Git output exceeded limit".into());
            }
            return Ok((out, err, status.success()));
        }
        if Instant::now() >= deadline_at {
            terminate_git(&mut child);
            let _ = out_thread.join();
            let _ = err_thread.join();
            return Err("Git command timed out".into());
        }
        thread::sleep(Duration::from_millis(10));
    }
}
pub(crate) fn read_limited<R: std::io::Read>(
    mut reader: R,
    cap: usize,
) -> Result<(Vec<u8>, bool), String> {
    let mut result = Vec::new();
    let mut buffer = [0u8; 8192];
    let mut overflow = false;
    loop {
        let count = reader.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        if result.len() >= cap {
            // Continue draining so the child does not block on a full pipe,
            // but stop accumulating and flag overflow so the caller can reject
            // the truncated output.
            overflow = true;
            continue;
        }
        let allowed = count.min(cap - result.len());
        result.extend_from_slice(&buffer[..allowed]);
        if result.len() >= cap {
            overflow = true;
        }
    }
    Ok((result, overflow))
}
pub(crate) fn terminate_git(child: &mut Child) {
    #[cfg(unix)]
    unsafe {
        let _ = libc::kill(-(child.id() as i32), libc::SIGKILL);
    }
    let _ = child.kill();
    let _ = child.wait();
}
pub(crate) fn apply_network_env(command: &mut Command, root: &Path) {
    command.env("GIT_ASKPASS", "").env("SSH_ASKPASS", "");
    let user_ssh_command = std::env::var_os("GIT_SSH_COMMAND").is_some()
        || std::env::var_os("GIT_SSH").is_some()
        || git(root, &["config", "--get", "core.sshCommand"]).is_ok();
    if !user_ssh_command {
        command.env("GIT_SSH_COMMAND", "ssh -o BatchMode=yes");
    }
}

pub(crate) fn git_command(root: &Path, args: impl IntoIterator<Item = OsString>) -> Command {
    let mut command = Command::new("git");
    command
        .current_dir(root)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // Defense in depth against parent-repo discovery: cap repository
    // discovery at the workspace root so a stray git invocation whose cwd
    // is deeper than the authorized top-level cannot walk up into a parent
    // repository even if some other guard is bypassed. `--show-toplevel`
    // enforcement in `assert_workspace_root` is the authoritative check.
    if let Ok(canonical) = fs::canonicalize(root) {
        if let Some(path) = canonical.parent() {
            command.env("GIT_CEILING_DIRECTORIES", path);
        }
    }
    // Make git a process-group leader so hook descendants can be killed as a
    // tree. Without this, killpg(-pid) is a no-op because git is not its own
    // process-group leader.
    #[cfg(unix)]
    unsafe {
        use std::os::unix::process::CommandExt;
        command.pre_exec(|| {
            if libc::setpgid(0, 0) != 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    // CREATE_NO_WINDOW: keep console-less GUI children from flashing a window.
    crate::platform::windows_child::hide_console(&mut command);
    command
}
pub(crate) fn git_os(root: &Path, args: &[OsString]) -> Result<Vec<u8>, String> {
    let (stdout, stderr, success) =
        run_git(git_command(root, args.iter().cloned()), GIT_WRITE_DEADLINE)?;
    if success || args.iter().any(|arg| arg == "diff") && args.iter().any(|arg| arg == "--no-index")
    {
        Ok(stdout)
    } else {
        Err(String::from_utf8_lossy(&stderr).to_string())
    }
}
pub(crate) fn git(root: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
    let owned = args.iter().map(OsString::from).collect::<Vec<_>>();
    let (stdout, stderr, success) = run_git(git_command(root, owned), GIT_READ_DEADLINE)?;
    if success || args.contains(&"diff") && args.contains(&"--no-index") {
        Ok(stdout)
    } else {
        Err(String::from_utf8_lossy(&stderr).to_string())
    }
}
