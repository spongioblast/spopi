// ABOUTME: Reads and writes workspace files inside the registered root.
// ABOUTME: Paths that escape the workspace are rejected.
// ABOUTME: Workspace file reads/writes and git-info helpers for the data plane.
use super::*;
use std::path::Path;

impl HostDataPlane {
    pub fn list_files(
        &self,
        workspace_id: &str,
        relative_path: &str,
        show_hidden: bool,
    ) -> Result<Vec<FileEntry>, HostDataError> {
        let root = self.workspace_root(workspace_id)?;
        let root = root.as_path();
        let requested = safe_join(root, relative_path)?;
        if !requested.is_dir() {
            return Err(HostDataError::NotDirectory);
        }
        let mut entries = std::fs::read_dir(&requested)
            .map_err(|error| HostDataError::Io(error.to_string()))?
            .filter_map(Result::ok)
            // Dotfiles stay hidden unless the caller explicitly opts in via
            // the File panel's show-hidden toggle (same default as Pi TUI).
            .filter(|entry| show_hidden || !entry.file_name().to_string_lossy().starts_with('.'))
            .filter_map(|entry| {
                let file_type = entry.file_type().ok()?;
                let kind = if file_type.is_dir() {
                    FileKind::Directory
                } else if file_type.is_file() {
                    FileKind::File
                } else {
                    return None;
                };
                // Read size cheaply via the already-open DirEntry metadata.
                let size = if kind == FileKind::File {
                    entry.metadata().ok().map(|m| m.len())
                } else {
                    None
                };
                let path = entry.path();
                let relative = path.strip_prefix(root).ok()?;
                Some(FileEntry {
                    name: entry.file_name().to_string_lossy().into_owned(),
                    relative_path: relative.to_string_lossy().replace('\\', "/"),
                    kind,
                    size,
                })
            })
            .collect::<Vec<_>>();
        entries.sort_by(|left, right| {
            let left_directory = left.kind == FileKind::Directory;
            let right_directory = right.kind == FileKind::Directory;
            right_directory
                .cmp(&left_directory)
                .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
        });
        Ok(entries)
    }

    pub fn search_file_mentions(
        &self,
        workspace_id: &str,
        query: &str,
    ) -> Result<FileMentionSearchResult, HostDataError> {
        let root = self.workspace_root(workspace_id)?;
        if !query.starts_with('@') || query.contains('\0') {
            return Err(HostDataError::InvalidMentionQuery);
        }
        let raw = query.strip_prefix('@').unwrap_or_default();
        let (is_quoted, body) = if let Some(rest) = raw.strip_prefix('"') {
            (true, rest.strip_suffix('"').unwrap_or(rest))
        } else {
            (false, raw)
        };
        let normalized = body.replace('\\', "/");
        if normalized.starts_with('/') || normalized.split('/').any(|part| part == "..") {
            return Err(HostDataError::InvalidMentionQuery);
        }
        let (display_base, fuzzy) = match normalized.rsplit_once('/') {
            Some((base, fuzzy)) => (format!("{base}/"), fuzzy.to_owned()),
            None => (String::new(), normalized.clone()),
        };
        if normalized
            .split('/')
            .filter(|part| !part.is_empty() && *part != ".")
            .any(is_ignored_mention_dir)
        {
            return Ok(FileMentionSearchResult {
                items: Vec::new(),
                truncated: false,
            });
        }
        let base_dir = match safe_join(&root, &display_base) {
            Ok(path) => path,
            Err(HostDataError::Io(_)) | Err(HostDataError::NotDirectory) => {
                return Ok(FileMentionSearchResult {
                    items: Vec::new(),
                    truncated: false,
                });
            }
            Err(error) => return Err(error),
        };
        let mut walk = FileMentionWalk::new(root.as_path(), fuzzy.to_lowercase(), is_quoted);
        walk.collect(&base_dir, &display_base)?;
        walk.collected.sort_by(|left, right| {
            right
                .0
                .cmp(&left.0)
                .then_with(|| left.1.description.cmp(&right.1.description))
        });
        Ok(FileMentionSearchResult {
            items: walk
                .collected
                .into_iter()
                .take(20)
                .map(|(_, item)| item)
                .collect(),
            truncated: walk.truncated,
        })
    }

    pub fn read_file_content(
        &self,
        workspace_id: &str,
        relative_path: &str,
    ) -> Result<FileContent, HostDataError> {
        let root = self.workspace_root(workspace_id)?;
        let path = safe_join(&root, relative_path)?;
        let metadata =
            std::fs::metadata(&path).map_err(|error| HostDataError::Io(error.to_string()))?;
        if !metadata.is_file() {
            return Err(HostDataError::NotFile);
        }

        let mut file =
            std::fs::File::open(&path).map_err(|error| HostDataError::Io(error.to_string()))?;
        let mut prefix = [0_u8; BINARY_PREFIX_BYTES];
        let prefix_len = file
            .read(&mut prefix)
            .map_err(|error| HostDataError::Io(error.to_string()))?;
        let classification = classify_preview_file(&path, &prefix[..prefix_len]);
        let mtime_ms = file_mtime_ms(&metadata)?;

        if matches!(
            classification.kind,
            PreviewFileKind::Image | PreviewFileKind::Pdf
        ) {
            return Ok(FileContent {
                path: relative_path.to_owned(),
                content: String::new(),
                size: metadata.len(),
                mtime_ms,
                mime_type: classification.mime_type.to_owned(),
                is_binary: false,
                truncated: false,
                editable: false,
            });
        }

        if classification.kind != PreviewFileKind::Text {
            return Ok(FileContent {
                path: relative_path.to_owned(),
                content: String::new(),
                size: metadata.len(),
                mtime_ms,
                mime_type: classification.mime_type.to_owned(),
                is_binary: true,
                truncated: false,
                editable: false,
            });
        }

        let read_len = metadata.len().min(TEXT_READ_LIMIT as u64) as usize;
        let mut file =
            std::fs::File::open(&path).map_err(|error| HostDataError::Io(error.to_string()))?;
        let mut buf = vec![0_u8; read_len];
        let bytes_read = file
            .read(&mut buf)
            .map_err(|error| HostDataError::Io(error.to_string()))?;
        buf.truncate(bytes_read);
        let is_binary = is_binary_by_prefix(&buf);
        Ok(FileContent {
            path: relative_path.to_owned(),
            content: String::from_utf8_lossy(&buf).into_owned(),
            size: metadata.len(),
            mtime_ms,
            mime_type: classification.mime_type.to_owned(),
            is_binary,
            truncated: metadata.len() > TEXT_READ_LIMIT as u64,
            editable: classification.editable
                && !is_binary
                && metadata.len() <= EDIT_SIZE_LIMIT as u64,
        })
    }

    pub fn read_convertible_file(
        &self,
        workspace_id: &str,
        relative_path: &str,
    ) -> Result<Option<ConvertibleFile>, HostDataError> {
        let suffix = preview_extension(Path::new(relative_path));
        if !is_convertible_suffix(&suffix) {
            return Ok(None);
        }
        let root = self.workspace_root(workspace_id)?;
        let path = safe_join(&root, relative_path)?;
        let metadata =
            std::fs::metadata(&path).map_err(|error| HostDataError::Io(error.to_string()))?;
        if !metadata.is_file() {
            return Err(HostDataError::NotFile);
        }
        if metadata.len() > INPUT_BYTE_CAP {
            return Ok(Some(ConvertibleFile {
                path: relative_path.to_owned(),
                bytes: Vec::new(),
                suffix,
                size: metadata.len(),
                mtime_ms: file_mtime_ms(&metadata)?,
                mime_type: "application/octet-stream".into(),
            }));
        }
        let file =
            std::fs::File::open(&path).map_err(|error| HostDataError::Io(error.to_string()))?;
        let mut bytes = Vec::with_capacity(metadata.len() as usize);
        file.take(INPUT_BYTE_CAP + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| HostDataError::Io(error.to_string()))?;
        Ok(Some(ConvertibleFile {
            path: relative_path.to_owned(),
            bytes,
            suffix,
            size: metadata.len(),
            mtime_ms: file_mtime_ms(&metadata)?,
            mime_type: "application/octet-stream".into(),
        }))
    }

    pub fn raw_file_content(
        &self,
        workspace_id: &str,
        relative_path: &str,
    ) -> Result<RawFileContent, HostDataError> {
        let root = self.workspace_root(workspace_id)?;
        let path = safe_join(&root, relative_path)?;
        let metadata =
            std::fs::metadata(&path).map_err(|error| HostDataError::Io(error.to_string()))?;
        if !metadata.is_file() {
            return Err(HostDataError::NotFile);
        }
        let mut file =
            std::fs::File::open(&path).map_err(|error| HostDataError::Io(error.to_string()))?;
        let mut prefix = [0_u8; BINARY_PREFIX_BYTES];
        let prefix_len = file
            .read(&mut prefix)
            .map_err(|error| HostDataError::Io(error.to_string()))?;
        let classification = classify_preview_file(&path, &prefix[..prefix_len]);
        if !matches!(
            classification.kind,
            PreviewFileKind::Image | PreviewFileKind::Pdf
        ) {
            return Err(HostDataError::NotFile);
        }
        let bytes = std::fs::read(&path).map_err(|error| HostDataError::Io(error.to_string()))?;
        Ok(RawFileContent {
            bytes,
            mime_type: classification.mime_type.to_owned(),
            size: metadata.len(),
        })
    }

    pub fn git_file_diff(
        &self,
        workspace_id: &str,
        relative_path: &str,
    ) -> Result<GitDiffResult, HostDataError> {
        let root = self.workspace_root(workspace_id)?;
        let _ = safe_join(&root, relative_path)?;
        let Some((status, original_path)) = changed_path(&root, relative_path) else {
            return Ok(GitDiffResult {
                supported: false,
                status: None,
                patch: None,
            });
        };
        let mut command = git_command_at(&root);
        if status == "untracked" {
            let absolute = safe_join(&root, relative_path)?;
            command
                .args([
                    "diff",
                    "--no-color",
                    "--no-ext-diff",
                    "--no-index",
                    "/dev/null",
                ])
                .arg(absolute);
        } else {
            command.args([
                "diff",
                "--no-color",
                "--no-ext-diff",
                "--unified=3",
                "HEAD",
                "--",
            ]);
            if let Some(original) = &original_path {
                command.arg(original);
            }
            command.arg(relative_path);
        }
        let Some(output) = git_output(command) else {
            return Ok(GitDiffResult {
                supported: false,
                status: None,
                patch: None,
            });
        };
        // git diff --no-index reports differences with exit status 1.
        if !output.status.success() && output.status.code() != Some(1) {
            return Ok(GitDiffResult {
                supported: false,
                status: None,
                patch: None,
            });
        }
        let patch = String::from_utf8_lossy(&output.stdout).into_owned();
        let supported = patch.contains("\n@@ ");
        Ok(GitDiffResult {
            supported,
            status: Some(status),
            patch: supported.then_some(patch),
        })
    }

    pub fn git_stat(&self, workspace_id: &str) -> Result<GitStatResult, HostDataError> {
        let root = self.workspace_root(workspace_id)?;
        // Check if this is a git repo first
        let Some(check) = git_at(&root, &["rev-parse", "--is-inside-work-tree"]) else {
            return Ok(empty_git_stat());
        };
        if !check.status.success() {
            return Ok(empty_git_stat());
        }
        // git diff --shortstat HEAD gives: " N files changed, X insertions(+), Y deletions(-)"
        // If HEAD doesn't exist (initial commit), fall back to diffing against empty tree
        let Some(output) = git_at(&root, &["diff", "--shortstat", "HEAD"]) else {
            return Ok(empty_git_stat());
        };
        let line = String::from_utf8_lossy(&output.stdout);
        let line = line.trim();
        // Parse: "3 files changed, 10 insertions(+), 2 deletions(-)"
        let files_changed = parse_shortstat_num(line, "file");
        let insertions = parse_shortstat_num(line, "insertion");
        let deletions = parse_shortstat_num(line, "deletion");
        Ok(GitStatResult {
            is_git_repository: true,
            files_changed,
            insertions,
            deletions,
        })
    }

    pub fn write_file_content(
        &self,
        workspace_id: &str,
        relative_path: &str,
        content: &str,
        expected_mtime_ms: f64,
        force: bool,
    ) -> Result<WriteFileResult, HostDataError> {
        if content.len() > EDIT_SIZE_LIMIT {
            return Ok(WriteFileResult::Invalid);
        }
        let root = self.workspace_root(workspace_id)?;
        let path = safe_join(&root, relative_path)?;
        let metadata =
            std::fs::metadata(&path).map_err(|error| HostDataError::Io(error.to_string()))?;
        if !metadata.is_file() || metadata.len() > EDIT_SIZE_LIMIT as u64 {
            return Ok(WriteFileResult::Invalid);
        }
        let mut file =
            std::fs::File::open(&path).map_err(|error| HostDataError::Io(error.to_string()))?;
        let mut prefix = [0_u8; BINARY_PREFIX_BYTES];
        let prefix_len = file
            .read(&mut prefix)
            .map_err(|error| HostDataError::Io(error.to_string()))?;
        if classify_preview_file(&path, &prefix[..prefix_len]).kind != PreviewFileKind::Text {
            return Ok(WriteFileResult::Invalid);
        }
        let current_mtime_ms = file_mtime_ms(&metadata)?;
        if !force && (current_mtime_ms - expected_mtime_ms).abs() > 1.0 {
            return Ok(WriteFileResult::Conflict);
        }
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .truncate(true)
            .open(&path)
            .map_err(|error| HostDataError::Io(error.to_string()))?;
        file.write_all(content.as_bytes())
            .map_err(|error| HostDataError::Io(error.to_string()))?;
        file.sync_all()
            .map_err(|error| HostDataError::Io(error.to_string()))?;
        let metadata = file
            .metadata()
            .map_err(|error| HostDataError::Io(error.to_string()))?;
        Ok(WriteFileResult::Saved {
            size: metadata.len(),
            mtime_ms: file_mtime_ms(&metadata)?,
        })
    }
}

fn changed_path(root: &Path, relative_path: &str) -> Option<(String, Option<String>)> {
    if let Some(output) = git_at(
        root,
        &[
            "ls-files",
            "--others",
            "--exclude-standard",
            "-z",
            "--",
            relative_path,
        ],
    ) {
        if output.status.success() && !output.stdout.is_empty() {
            return Some(("untracked".into(), None));
        }
    }
    let output = git_at(
        root,
        &["diff", "--name-status", "-z", "HEAD", "--", relative_path],
    )?;
    if output.stdout.is_empty() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let mut parts = text.split('\0').filter(|part| !part.is_empty());
    let token = parts.next()?;
    let kind = token.chars().next()?;
    let original = if matches!(kind, 'R' | 'C') {
        parts.next().map(str::to_owned)
    } else {
        None
    };
    let status = match kind {
        'A' => "added",
        'D' => "deleted",
        'R' => "renamed",
        'C' => "copied",
        'U' => "conflict",
        _ => "modified",
    };
    Some((status.into(), original))
}
