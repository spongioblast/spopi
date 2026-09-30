// ABOUTME: Serves <app data>/ui over the shipped public tree and tracks overrides.
// ABOUTME: Stale, safe mode, and traversal stay here; the WebView only asks.

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

const SKIP: &[&str] = &[".base", "overrides.json"];
const USER_CSS: &str = "user.css";
/// The overlay's own entry point: a module the page loads whether or not it exists,
/// so adding behaviour needs no copy of a shipped file.
const USER_JS: &str = "user.js";

/// Overlay file -> (size, mtime ms) at the last poll.
type Snapshot = BTreeMap<String, (u64, u128)>;

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct Entry {
    path: String,
    app_version: String,
    base_sha256: String,
    status: String,
}

struct Book {
    entries: Vec<Entry>,
    failures: u8,
    /// The user turned safe mode on in Settings.
    safe: bool,
    /// Set after two starts that never reached /api/ui/ready, and only when
    /// overlay files exist. A later ready signal clears this and keeps `safe`.
    auto_safe: bool,
    disabled: Vec<String>,
}

pub struct UiOverlay {
    pub shipped: PathBuf,
    pub root: PathBuf,
    version: String,
    forced_safe: bool,
    safe: AtomicBool,
    book: Mutex<Book>,
    seen: Mutex<Option<Snapshot>>,
    events: tokio::sync::broadcast::Sender<String>,
}

pub struct Served {
    pub body: Vec<u8>,
    pub content_type: &'static str,
}

impl UiOverlay {
    pub fn open(shipped: PathBuf, root: PathBuf, version: &str, forced_safe: bool) -> Self {
        let _ = fs::create_dir_all(&root);
        let mut book = read_book(&root.join("overrides.json"));
        refresh_stale(&shipped, &root, version, &mut book.entries);
        if book.failures >= 2 && !book.entries.is_empty() {
            book.auto_safe = true;
        }
        book.failures = book.failures.saturating_add(1);
        write_book(&root.join("overrides.json"), &book);
        let safe = forced_safe || book.safe || book.auto_safe;
        let (events, _) = tokio::sync::broadcast::channel(16);
        let overlay = Self {
            shipped,
            root,
            version: version.to_string(),
            forced_safe,
            safe: AtomicBool::new(safe),
            book: Mutex::new(book),
            seen: Mutex::new(None),
            events,
        };
        overlay.scan_new();
        overlay
    }

    pub fn subscribe(&self) -> tokio::sync::broadcast::Receiver<String> {
        self.events.subscribe()
    }

    pub fn is_safe(&self) -> bool {
        self.safe.load(Ordering::Relaxed)
    }

    pub fn set_safe(&self, on: bool) {
        if self.forced_safe {
            return;
        }
        self.safe.store(on, Ordering::Relaxed);
        let mut book = self.book.lock().unwrap_or_else(|e| e.into_inner());
        book.safe = on;
        book.auto_safe = false;
        if !on {
            book.failures = 0;
        }
        write_book(&self.root.join("overrides.json"), &book);
    }

    pub fn set_disabled(&self, name: &str, on: bool) {
        if name == "spopi-bridge" || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
            return;
        }
        let mut book = self.book.lock().unwrap_or_else(|e| e.into_inner());
        book.disabled.retain(|item| item != name);
        if on {
            book.disabled.push(name.to_string());
        }
        write_book(&self.root.join("overrides.json"), &book);
    }

    pub fn note_ready(&self) {
        let mut book = self.book.lock().unwrap_or_else(|e| e.into_inner());
        book.failures = 0;
        book.auto_safe = false;
        if !book.safe && !self.forced_safe {
            self.safe.store(false, Ordering::Relaxed);
        }
        write_book(&self.root.join("overrides.json"), &book);
    }

    /// Overlay file when it should win. `user.css` and `user.js` are always
    /// answered: the page links both unconditionally, so a missing one is empty
    /// rather than a 404.
    pub fn try_serve(&self, url_path: &str) -> Option<Served> {
        let rel = relative_ui_path(url_path)?;
        if rel == USER_CSS || rel == USER_JS {
            let body = if self.is_safe() {
                Vec::new()
            } else {
                fs::read(self.root.join(&rel)).unwrap_or_default()
            };
            return Some(Served {
                body,
                content_type: content_type(&rel),
            });
        }
        if self.is_safe() || rel.starts_with("locales/") {
            return None;
        }
        let entry = {
            let book = self.book.lock().unwrap_or_else(|e| e.into_inner());
            book.entries.iter().find(|e| e.path == rel).cloned()
        };
        let entry = entry?;
        if entry.status == "stale" {
            return None;
        }
        let body = fs::read(self.root.join(&rel)).ok()?;
        Some(Served {
            body,
            content_type: content_type(&rel),
        })
    }

    pub fn list_json(&self) -> Value {
        let book = self.book.lock().unwrap_or_else(|e| e.into_inner());
        json!({
            "safe": self.is_safe(),
            "userSafe": book.safe,
            "autoSafe": book.auto_safe,
            "forcedSafe": self.forced_safe,
            "entries": book.entries,
            "unknownLocaleKeys": unknown_locale_keys(&self.shipped, &self.root),
            "disabled": book.disabled,
            "root": self.root.display().to_string(),
        })
    }

    pub fn locale_override(&self, lang: &str) -> Value {
        if self.is_safe() || !lang.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
            return json!({});
        }
        let path = self.root.join("locales").join(format!("{lang}.json"));
        fs::read(&path)
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or(json!({}))
    }

    pub fn three_way(&self, rel: &str) -> Option<Value> {
        let rel = relative_ui_path(rel)?;
        let read = |p: &Path| fs::read_to_string(p).unwrap_or_default();
        Some(json!({
            "path": rel,
            "base": read(&self.root.join(".base").join(&rel)),
            "shipped": read(&self.shipped.join(&rel)),
            "override": read(&self.root.join(&rel)),
        }))
    }

    pub fn revert(&self, rel: &str) -> bool {
        let Some(rel) = relative_ui_path(rel) else {
            return false;
        };
        let _ = fs::remove_file(self.root.join(&rel));
        let _ = fs::remove_file(self.root.join(".base").join(&rel));
        let mut book = self.book.lock().unwrap_or_else(|e| e.into_inner());
        book.entries.retain(|e| e.path != rel);
        write_book(&self.root.join("overrides.json"), &book);
        true
    }

    /// Saving a stale override is the merge: its new base is the shipped file
    /// of this version, and it is served again.
    fn accept_merged(&self, rel: &str) {
        let shipped = self.shipped.join(rel);
        let hash = fs::read(&shipped).map(|b| sha(&b)).unwrap_or_default();
        let mut book = self.book.lock().unwrap_or_else(|e| e.into_inner());
        let Some(entry) = book
            .entries
            .iter_mut()
            .find(|e| e.path == rel && e.status == "stale")
        else {
            return;
        };
        entry.base_sha256 = hash;
        entry.app_version = self.version.clone();
        entry.status = "ok".to_string();
        let base = self.root.join(".base").join(rel);
        if let Some(parent) = base.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if shipped.is_file() {
            let _ = fs::copy(&shipped, &base);
        }
        write_book(&self.root.join("overrides.json"), &book);
    }

    /// One directory walk. Returns `css` when only `user.css` changed (the
    /// page can swap that link in place) and `full` for anything else.
    pub fn poll(&self) -> Option<&'static str> {
        let next = snapshot(&self.root);
        let mut seen = self.seen.lock().unwrap_or_else(|e| e.into_inner());
        if seen.as_ref() == Some(&next) {
            return None;
        }
        let previous = seen.replace(next.clone());
        drop(seen);
        self.scan_new();
        let previous = previous?;
        for rel in next
            .keys()
            .filter(|rel| previous.get(*rel) != next.get(*rel))
        {
            self.accept_merged(rel);
        }
        let only_user_css = previous
            .keys()
            .chain(next.keys())
            .filter(|rel| previous.get(*rel) != next.get(*rel))
            .all(|rel| rel == USER_CSS);
        let kind = if only_user_css { "css" } else { "full" };
        let _ = self.events.send(kind.to_string());
        Some(kind)
    }

    fn scan_new(&self) {
        let mut found = Vec::new();
        walk_files(&self.root, &self.root, &mut found);
        let mut book = self.book.lock().unwrap_or_else(|e| e.into_inner());
        for rel in found {
            if book.entries.iter().any(|e| e.path == rel) {
                continue;
            }
            let shipped = self.shipped.join(&rel);
            let (base_sha256, status) = if shipped.is_file() {
                let bytes = fs::read(&shipped).unwrap_or_default();
                let base = self.root.join(".base").join(&rel);
                if let Some(parent) = base.parent() {
                    let _ = fs::create_dir_all(parent);
                }
                let _ = fs::copy(&shipped, &base);
                (sha(&bytes), "ok".to_string())
            } else {
                (String::new(), "added".to_string())
            };
            book.entries.push(Entry {
                path: rel,
                app_version: self.version.clone(),
                base_sha256,
                status,
            });
        }
        book.entries.retain(|e| self.root.join(&e.path).is_file());
        write_book(&self.root.join("overrides.json"), &book);
    }
}

pub fn relative_ui_path(url_path: &str) -> Option<String> {
    let path = url_path.split('?').next().unwrap_or("");
    let rest = path.trim_start_matches('/');
    let rest = if let Some(after) = rest.strip_prefix("v/") {
        after.split_once('/')?.1
    } else {
        rest
    };
    if rest.is_empty()
        || rest
            .split(['/', '\\'])
            .any(|p| p == ".." || p.is_empty() && rest.contains("//"))
    {
        return None;
    }
    if rest.contains('\\') || rest.contains(':') {
        return None;
    }
    Some(rest.to_string())
}

fn content_type(path: &str) -> &'static str {
    match Path::new(path).extension().and_then(|e| e.to_str()) {
        Some("js") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") => "application/json",
        Some("html") => "text/html; charset=utf-8",
        Some("svg") => "image/svg+xml",
        _ => "application/octet-stream",
    }
}

fn sha(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn read_book(path: &Path) -> Book {
    let value: Value = fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or(json!({}));
    let entries: Vec<Entry> = value
        .get("entries")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    let mut safe = value.get("safe").and_then(Value::as_bool).unwrap_or(false);
    // Older books stored the automatic latch in `safe`. An empty overlay means
    // the user had nothing to protect, so treat that flag as automatic.
    let auto_safe = if value.get("autoSafe").is_some() {
        value
            .get("autoSafe")
            .and_then(Value::as_bool)
            .unwrap_or(false)
    } else if safe && entries.is_empty() {
        safe = false;
        true
    } else {
        false
    };
    Book {
        entries,
        failures: value.get("failures").and_then(Value::as_u64).unwrap_or(0) as u8,
        safe,
        auto_safe,
        disabled: value
            .get("disabled")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default(),
    }
}

fn write_book(path: &Path, book: &Book) {
    let value = json!({ "entries": book.entries, "failures": book.failures, "safe": book.safe, "autoSafe": book.auto_safe, "disabled": book.disabled });
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let tmp = path.with_extension("json.tmp");
    if let Ok(mut file) = fs::File::create(&tmp) {
        let _ = file.write_all(
            serde_json::to_string_pretty(&value)
                .unwrap_or_default()
                .as_bytes(),
        );
        let _ = file.sync_all();
        let _ = fs::rename(&tmp, path);
    }
}

fn refresh_stale(shipped: &Path, root: &Path, version: &str, entries: &mut [Entry]) {
    for entry in entries {
        if entry.status == "added" || entry.base_sha256.is_empty() {
            continue;
        }
        if entry.app_version == version {
            continue;
        }
        let now = fs::read(shipped.join(&entry.path))
            .map(|b| sha(&b))
            .unwrap_or_default();
        if now != entry.base_sha256 {
            entry.status = "stale".into();
            let _ = root;
        }
    }
}

fn walk_files(dir: &Path, root: &Path, out: &mut Vec<String>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if SKIP.contains(&name.as_str()) || name.ends_with(".tmp") {
            continue;
        }
        if path.is_dir() {
            walk_files(&path, root, out);
        } else if let Ok(rel) = path.strip_prefix(root) {
            out.push(rel.to_string_lossy().replace('\\', "/"));
        }
    }
}

fn snapshot(root: &Path) -> Snapshot {
    let mut files = Vec::new();
    walk_files(root, root, &mut files);
    files
        .into_iter()
        .map(|rel| {
            let stamp = fs::metadata(root.join(&rel))
                .map(|meta| {
                    let modified = meta
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                        .map_or(0, |d| d.as_millis());
                    (meta.len(), modified)
                })
                .unwrap_or_default();
            (rel, stamp)
        })
        .collect()
}

fn unknown_locale_keys(shipped: &Path, root: &Path) -> Vec<String> {
    let mut unknown = Vec::new();
    let dir = root.join("locales");
    let Ok(entries) = fs::read_dir(&dir) else {
        return unknown;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let Some(lang) = name.strip_suffix(".json") else {
            continue;
        };
        let Ok(over) = fs::read(entry.path()) else {
            continue;
        };
        let Ok(base) = fs::read(shipped.join("locales").join(&name)) else {
            continue;
        };
        let Ok(over) = serde_json::from_slice::<Value>(&over) else {
            continue;
        };
        let Ok(base) = serde_json::from_slice::<Value>(&base) else {
            continue;
        };
        collect_unknown("", &over, &base, lang, &mut unknown);
    }
    unknown
}

fn collect_unknown(prefix: &str, over: &Value, base: &Value, lang: &str, out: &mut Vec<String>) {
    let Value::Object(map) = over else { return };
    for (key, value) in map {
        let path = if prefix.is_empty() {
            key.clone()
        } else {
            format!("{prefix}.{key}")
        };
        match (value, base.get(key)) {
            (Value::Object(_), Some(next)) => collect_unknown(&path, value, next, lang, out),
            (Value::String(_), Some(Value::String(_))) => {}
            _ => out.push(format!("{lang}:{path}")),
        }
    }
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
