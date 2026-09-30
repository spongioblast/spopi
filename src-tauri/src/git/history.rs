// ABOUTME: Serves git log, commit detail, and a single commit file diff.
// ABOUTME: It does not stage, commit, or read the working-tree status snapshot.

use super::*;

impl GitService {
    pub fn log(
        &self,
        _owner: &str,
        root: &Path,
        _generation: u64,
        limit: usize,
        before: Option<&str>,
    ) -> Result<GitLogResponse, String> {
        assert_workspace_root(root)?;
        let limit = limit.clamp(1, MAX_LOG_LIMIT);
        if let Some(before) = before {
            validate_oid(before)?;
        }
        if git(root, &["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]).is_err() {
            return Ok(GitLogResponse {
                commits: Vec::new(),
                has_more: false,
            });
        }
        let mut args: Vec<OsString> = vec![
            "--no-pager".into(),
            "log".into(),
            "--first-parent".into(),
            format!("--max-count={limit}").into(),
            format!("--format={LOG_LIST_FMT}").into(),
            "-z".into(),
        ];
        if let Some(before) = before {
            let verify = format!("{before}^{{commit}}");
            if git(root, &["rev-parse", "--verify", "--quiet", &verify]).is_err() {
                return Err("unknown commit".into());
            }
            let parent = format!("{before}~1^{{commit}}");
            if git(root, &["rev-parse", "--verify", "--quiet", &parent]).is_err() {
                return Ok(GitLogResponse {
                    commits: Vec::new(),
                    has_more: false,
                });
            }
            args.push(format!("{before}~1").into());
        }
        let output = git_os(root, &args).map_err(|_| "log failed".to_string())?;
        let fields = output.split(|byte| *byte == 0).collect::<Vec<_>>();
        let mut commits = Vec::new();
        for group in fields.as_chunks::<5>().0 {
            commits.push(GitLogEntry {
                oid: String::from_utf8_lossy(group[0]).into_owned(),
                subject: String::from_utf8_lossy(group[2]).into_owned(),
                author_name: String::from_utf8_lossy(group[3]).into_owned(),
                author_time: String::from_utf8_lossy(group[4]).parse().unwrap_or(0),
            });
        }
        Ok(GitLogResponse {
            has_more: commits.len() == limit,
            commits,
        })
    }

    pub fn log_detail(
        &self,
        _owner: &str,
        root: &Path,
        _generation: u64,
        oid: &str,
    ) -> Result<GitLogDetailResponse, String> {
        assert_workspace_root(root)?;
        validate_oid(oid)?;
        let kind = commit_kind(root, oid)?;
        let args = vec![
            OsString::from("--no-pager"),
            OsString::from("log"),
            OsString::from("-1"),
            OsString::from(format!("--format={LOG_DETAIL_FMT}")),
            OsString::from("-z"),
            OsString::from(oid),
        ];
        let output = git_os(root, &args).map_err(|_| "log detail failed".to_string())?;
        let fields = output.split(|byte| *byte == 0).collect::<Vec<_>>();
        if fields.len() < 4 {
            return Err("malformed log detail".into());
        }
        let mut full_message = String::from_utf8_lossy(fields[3]).into_owned();
        while full_message.ends_with(['\r', '\n']) {
            full_message.pop();
        }
        let mut message_truncated = false;
        if full_message.len() > MAX_LOG_MESSAGE_BYTES {
            message_truncated = true;
            let mut end = MAX_LOG_MESSAGE_BYTES;
            while end > 0 && !full_message.is_char_boundary(end) {
                end -= 1;
            }
            full_message.truncate(end);
            full_message.push('…');
        }
        let mut files = Vec::new();
        let mut files_truncated = false;
        let mut files_bytes = 0;
        for file in name_status(root, &kind, oid)? {
            let encoded_path = BASE64.encode(&file.path_bytes);
            let file_bytes = file.status.len()
                + file.path.len()
                + encoded_path.len()
                + file.original_path.as_deref().map_or(0, str::len);
            if files.len() >= MAX_LOG_FILES || files_bytes + file_bytes > MAX_LOG_FILES_BYTES {
                files_truncated = true;
                break;
            }
            files_bytes += file_bytes;
            files.push(GitLogDetailFile {
                status: file.status,
                path: file.path,
                path_bytes_base64: encoded_path,
                original_path: file.original_path,
            });
        }
        Ok(GitLogDetailResponse {
            oid: String::from_utf8_lossy(fields[0]).into_owned(),
            author_name: String::from_utf8_lossy(fields[1]).into_owned(),
            author_time: String::from_utf8_lossy(fields[2]).parse().unwrap_or(0),
            full_message,
            message_truncated,
            files_truncated,
            files,
        })
    }

    pub fn commit_diff(
        &self,
        _owner: &str,
        root: &Path,
        _generation: u64,
        oid: &str,
        path_bytes: &[u8],
    ) -> Result<GitCommitDiffResponse, String> {
        assert_workspace_root(root)?;
        validate_oid(oid)?;
        let kind = commit_kind(root, oid)?;
        let file = name_status(root, &kind, oid)?
            .into_iter()
            .find(|file| file.path_bytes == path_bytes)
            .ok_or("unauthorized commit path")?;
        let path = path_arg(path_bytes);
        let args = match kind {
            CommitKind::Root => vec![
                "--literal-pathspecs".into(),
                "--no-pager".into(),
                "diff-tree".into(),
                "-p".into(),
                "--root".into(),
                oid.into(),
                "--".into(),
                path,
            ],
            CommitKind::Linear => vec![
                "--literal-pathspecs".into(),
                "--no-pager".into(),
                "diff-tree".into(),
                "-p".into(),
                oid.into(),
                "--".into(),
                path,
            ],
            CommitKind::Merge => {
                let parent = format!("{oid}^1");
                vec![
                    "--literal-pathspecs".into(),
                    "--no-pager".into(),
                    "diff".into(),
                    parent.into(),
                    oid.into(),
                    "--".into(),
                    path,
                ]
            }
        };
        let mut patch = git_os(root, &args)?;
        let truncated = patch.len() > MAX_DIFF_BYTES;
        patch.truncate(MAX_DIFF_BYTES);
        let patch_text = String::from_utf8_lossy(&patch);
        let fallback_reason = if patch_text.contains("Binary files ")
            || patch_text.contains("GIT binary patch")
            || patch.contains(&0)
        {
            Some("binary".to_string())
        } else if file.status.starts_with('R') {
            Some("rename".to_string())
        } else if file.status.starts_with('C') {
            Some("copy".to_string())
        } else {
            None
        };
        Ok(GitCommitDiffResponse {
            comparison: "commit".into(),
            path_bytes_base64: BASE64.encode(path_bytes),
            raw_patch: String::from_utf8_lossy(&patch).into_owned(),
            truncated,
            fallback_reason,
        })
    }

    /// Working tree file at HEAD. A missing blob is empty and `exists` is false.
    pub fn file_at_head(
        &self,
        root: &Path,
        path_bytes: &[u8],
    ) -> Result<(String, bool, bool), String> {
        assert_workspace_root(root)?;
        if path_bytes.is_empty()
            || path_bytes.contains(&0)
            || path_bytes.windows(2).any(|pair| pair == b"..")
        {
            return Err("unauthorized path".into());
        }
        let path =
            String::from_utf8(path_bytes.to_vec()).map_err(|_| "invalid path".to_string())?;
        let spec = format!("HEAD:{path}");
        let command = git_command(
            root,
            ["show", spec.as_str()].into_iter().map(OsString::from),
        );
        let (stdout, _stderr, success) = run_git(command, GIT_READ_DEADLINE)?;
        if !success {
            return Ok((String::new(), false, false));
        }
        let binary = stdout.iter().take(8000).any(|byte| *byte == 0)
            || std::str::from_utf8(&stdout).is_err();
        if binary {
            return Ok((String::new(), true, true));
        }
        Ok((String::from_utf8(stdout).unwrap_or_default(), true, false))
    }
}
