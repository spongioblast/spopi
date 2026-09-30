// ABOUTME: Ripgrep-backed workspace search for the Search rail panel.
// ABOUTME: Falls back to a walk of text files when `rg` is not on PATH.

use serde::Serialize;
use std::fs;
use std::path::Path;
use std::process::Command;
use std::time::Instant;

const MAX_HITS: usize = 200;
const MAX_FILE_BYTES: u64 = 512 * 1024;
const SEARCH_DEADLINE_MS: u128 = 4000;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub path: String,
    pub line: u32,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub query: String,
    pub hits: Vec<SearchHit>,
    pub backend: String,
    pub truncated: bool,
}

pub fn search_workspace(root: &Path, query: &str) -> Result<SearchResult, String> {
    let query = query.trim();
    if query.is_empty() {
        return Err("query is required".into());
    }
    if query.len() > 200 {
        return Err("query is too long".into());
    }
    if let Some(result) = search_with_ripgrep(root, query) {
        return Ok(result);
    }
    search_by_walk(root, query)
}

fn search_with_ripgrep(root: &Path, query: &str) -> Option<SearchResult> {
    let mut command = Command::new("rg");
    crate::platform::windows_child::hide_console(&mut command);
    let output = command
        .current_dir(root)
        .args([
            "--json",
            "--max-count",
            "20",
            "--max-filesize",
            "512K",
            "-n",
            "--no-heading",
            query,
        ])
        .output()
        .ok()?;
    if !output.status.success() && output.stdout.is_empty() {
        return None;
    }
    let mut hits = Vec::new();
    let mut truncated = false;
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        if value.get("type").and_then(|v| v.as_str()) != Some("match") {
            continue;
        }
        let data = value.get("data")?;
        let path = data
            .pointer("/path/text")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .replace('\\', "/");
        let line_no = data
            .pointer("/line_number")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u32;
        let text = data
            .pointer("/lines/text")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim_end()
            .to_string();
        if path.is_empty() {
            continue;
        }
        hits.push(SearchHit {
            path,
            line: line_no,
            text,
        });
        if hits.len() >= MAX_HITS {
            truncated = true;
            break;
        }
    }
    Some(SearchResult {
        query: query.to_string(),
        hits,
        backend: "rg".into(),
        truncated,
    })
}

fn search_by_walk(root: &Path, query: &str) -> Result<SearchResult, String> {
    let needle = query.to_ascii_lowercase();
    let mut hits = Vec::new();
    let mut truncated = false;
    let started = Instant::now();
    walk(root, root, &needle, &mut hits, &mut truncated, started)?;
    Ok(SearchResult {
        query: query.to_string(),
        hits,
        backend: "walk".into(),
        truncated,
    })
}

fn walk(
    root: &Path,
    dir: &Path,
    needle: &str,
    hits: &mut Vec<SearchHit>,
    truncated: &mut bool,
    started: Instant,
) -> Result<(), String> {
    if *truncated || hits.len() >= MAX_HITS {
        *truncated = true;
        return Ok(());
    }
    if started.elapsed().as_millis() > SEARCH_DEADLINE_MS {
        *truncated = true;
        return Ok(());
    }
    let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.')
            || name == "node_modules"
            || name == "target"
            || name == "dist"
            || name == "cargo-target"
        {
            continue;
        }
        if path.is_dir() {
            walk(root, &path, needle, hits, truncated, started)?;
            continue;
        }
        search_file(root, &path, needle, hits, truncated);
    }
    Ok(())
}

fn search_file(
    root: &Path,
    path: &Path,
    needle: &str,
    hits: &mut Vec<SearchHit>,
    truncated: &mut bool,
) {
    if hits.len() >= MAX_HITS {
        *truncated = true;
        return;
    }
    let Ok(meta) = fs::metadata(path) else {
        return;
    };
    if meta.len() == 0 || meta.len() > MAX_FILE_BYTES {
        return;
    }
    let Ok(text) = fs::read_to_string(path) else {
        return;
    };
    let relative = path
        .strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/");
    for (index, line) in text.lines().enumerate() {
        if line.to_ascii_lowercase().contains(needle) {
            hits.push(SearchHit {
                path: relative.clone(),
                line: (index + 1) as u32,
                text: line.trim_end().to_string(),
            });
            if hits.len() >= MAX_HITS {
                *truncated = true;
                return;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn walk_finds_a_line_in_a_temp_workspace() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("alpha.rs"), "fn hello_world() {}\n").unwrap();
        fs::create_dir(root.path().join("src")).unwrap();
        fs::write(
            root.path().join("src").join("lib.rs"),
            "pub fn unused() {}\n",
        )
        .unwrap();
        let result = search_by_walk(root.path(), "hello_world").unwrap();
        assert_eq!(result.backend, "walk");
        assert_eq!(result.hits.len(), 1);
        assert_eq!(result.hits[0].path, "alpha.rs");
        assert_eq!(result.hits[0].line, 1);
    }

    #[test]
    fn empty_query_is_rejected() {
        let root = tempfile::tempdir().unwrap();
        assert!(search_workspace(root.path(), "   ").is_err());
    }
}
