// ABOUTME: Searches session transcripts and scores file-mention candidates.
// ABOUTME: Session JSONL parsing and the cost dashboard live in sibling modules.

use super::*;

pub(crate) fn find_chars(haystack: &[char], needle: &[char]) -> Option<usize> {
    if needle.is_empty() || needle.len() > haystack.len() {
        return None;
    }
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

pub(crate) fn search_session_file(
    path: &Path,
    workspace: &Path,
    query: &str,
) -> Result<Option<SessionSearchResult>, HostDataError> {
    const MAX_MATCHES_PER_SESSION: usize = 3;
    let mut session_id = None;
    let mut session_timestamp = String::new();
    let mut session_name = None;
    let mut first_message = None;
    let mut cwd = None;
    let mut matches = Vec::new();
    for entry in read_jsonl_entries(path)? {
        match entry.get("type").and_then(serde_json::Value::as_str) {
            Some("session") => {
                session_id = entry
                    .get("id")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_owned);
                session_timestamp = entry
                    .get("timestamp")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default()
                    .to_owned();
                cwd = entry
                    .get("cwd")
                    .and_then(serde_json::Value::as_str)
                    .map(PathBuf::from);
            }
            Some("session_info") => {
                session_name = entry
                    .get("name")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_owned);
            }
            Some("message") => {
                let role = entry
                    .pointer("/message/role")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("unknown")
                    .to_owned();
                let Some(text) = message_text(entry.pointer("/message/content")) else {
                    continue;
                };
                if role == "user" && first_message.is_none() {
                    first_message = Some(text.chars().take(120).collect::<String>());
                }
                if matches.len() >= MAX_MATCHES_PER_SESSION {
                    continue;
                }
                let lower: Vec<char> = text.to_lowercase().chars().collect();
                let needle: Vec<char> = query.chars().collect();
                if let Some(index) = find_chars(&lower, &needle) {
                    let original: Vec<char> = text.chars().collect();
                    let start = index.saturating_sub(60);
                    let end = (index + needle.len() + 60).min(original.len());
                    let snippet: String = original[start..end].iter().collect();
                    let snippet = format!(
                        "{}{}{}",
                        if start > 0 { "…" } else { "" },
                        snippet.replace('\n', " "),
                        if end < original.len() { "…" } else { "" }
                    );
                    matches.push(SessionSearchMatch { role, snippet });
                }
            }
            _ => {}
        }
    }
    let Some(session_id) = session_id else {
        return Ok(None);
    };
    let Some(cwd) = cwd.and_then(|cwd| super::paths::canonical_path(&cwd).ok()) else {
        return Ok(None);
    };
    if cwd != workspace || matches.is_empty() {
        return Ok(None);
    }
    Ok(Some(SessionSearchResult {
        session_id,
        session_name,
        session_timestamp,
        first_message,
        file_name: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        matches,
    }))
}

const IGNORED_MENTION_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "dist",
    "build",
    "target",
    ".next",
    ".nuxt",
    ".cache",
    "coverage",
    ".venv",
    "venv",
    "__pycache__",
];

pub(crate) fn is_ignored_mention_dir(name: &str) -> bool {
    IGNORED_MENTION_DIRS.contains(&name)
}

pub(crate) struct FileMentionWalk<'a> {
    root: &'a Path,
    fuzzy: String,
    is_quoted: bool,
    visited: usize,
    pub(crate) collected: Vec<(u16, FileMentionCandidate)>,
    pub(crate) truncated: bool,
}

impl<'a> FileMentionWalk<'a> {
    pub(crate) fn new(root: &'a Path, fuzzy: String, is_quoted: bool) -> Self {
        Self {
            root,
            fuzzy,
            is_quoted,
            visited: 0,
            collected: Vec::new(),
            truncated: false,
        }
    }

    pub(crate) fn collect(&mut self, dir: &Path, display_base: &str) -> Result<(), HostDataError> {
        if self.visited >= 10_000 || self.collected.len() >= 200 {
            self.truncated = true;
            return Ok(());
        }
        let entries =
            std::fs::read_dir(dir).map_err(|error| HostDataError::Io(error.to_string()))?;
        for entry in entries.filter_map(Result::ok) {
            if self.visited >= 10_000 || self.collected.len() >= 200 {
                self.truncated = true;
                return Ok(());
            }
            self.visited += 1;
            let name = entry.file_name().to_string_lossy().into_owned();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            let is_directory = file_type.is_dir();
            if !is_directory && !file_type.is_file() {
                continue;
            }
            if is_directory && is_ignored_mention_dir(&name) {
                continue;
            }
            let display_path = format!("{display_base}{name}");
            let score = score_mention(&display_path, &name, &self.fuzzy, is_directory);
            if score > 0 {
                self.collected.push((
                    score,
                    build_file_mention_candidate(
                        &display_path,
                        is_directory,
                        is_quoted_display(self.is_quoted, &display_path),
                    ),
                ));
            }
            if is_directory {
                let path = entry.path();
                if path.starts_with(self.root) {
                    self.collect(&path, &format!("{display_path}/"))?;
                }
            }
        }
        Ok(())
    }
}

pub(crate) fn score_mention(
    display_path: &str,
    name: &str,
    fuzzy: &str,
    is_directory: bool,
) -> u16 {
    let base = if fuzzy.is_empty() {
        if is_directory {
            11
        } else {
            1
        }
    } else {
        let name = name.to_lowercase();
        if name == fuzzy {
            100
        } else if name.starts_with(fuzzy) {
            80
        } else if name.contains(fuzzy) {
            50
        } else if display_path.to_lowercase().contains(fuzzy) {
            30
        } else {
            0
        }
    };
    if base > 0 && is_directory {
        base + 10
    } else {
        base
    }
}

pub(crate) fn is_quoted_display(was_quoted: bool, display_path: &str) -> bool {
    was_quoted || display_path.contains(' ')
}

pub(crate) fn build_file_mention_candidate(
    display_path: &str,
    is_directory: bool,
    needs_quotes: bool,
) -> FileMentionCandidate {
    let value_path = if is_directory {
        format!("{display_path}/")
    } else {
        display_path.to_owned()
    };
    let value = if needs_quotes {
        format!("@\"{value_path}\"")
    } else {
        format!("@{value_path}")
    };
    let label = Path::new(display_path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(display_path);
    FileMentionCandidate {
        value,
        label: format!("{label}{}", if is_directory { "/" } else { "" }),
        description: display_path.to_owned(),
        is_directory,
    }
}
