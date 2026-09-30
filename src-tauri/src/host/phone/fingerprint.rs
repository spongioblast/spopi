// ABOUTME: SHA-256 map of the effective UI, shipped files plus the overlay.
// ABOUTME: Phones stay on the accepted map until the desktop accepts a new one.

use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Change {
    pub path: String,
    pub kind: &'static str,
}

pub fn hash_file(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

pub fn hash_tree(dir: &Path) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    walk(dir, dir, &mut out);
    out
}

fn walk(root: &Path, dir: &Path, out: &mut BTreeMap<String, String>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk(root, &path, out);
            continue;
        }
        let Ok(rel) = path.strip_prefix(root) else {
            continue;
        };
        let key = rel.to_string_lossy().replace('\\', "/");
        // `overrides.json.tmp` exists only while the overlay book is being written.
        if key.starts_with(".base/")
            || key == "overrides.json"
            || key.ends_with(".tmp")
            || skip_dev_asset(&key)
        {
            continue;
        }
        if let Ok(bytes) = fs::read(&path) {
            out.insert(key, hash_file(&bytes));
        }
    }
}

fn skip_dev_asset(key: &str) -> bool {
    key.ends_with(".test.js") || key.split('/').any(|part| part == "fixtures")
}

/// Overlay bytes replace the shipped file. Keys only in `overlay` are additions.
pub fn effective(
    shipped: &BTreeMap<String, String>,
    overlay: &BTreeMap<String, String>,
) -> BTreeMap<String, String> {
    let mut out = shipped.clone();
    for (path, sha) in overlay {
        out.insert(path.clone(), sha.clone());
    }
    out
}

pub fn changes(
    current: &BTreeMap<String, String>,
    accepted: &BTreeMap<String, String>,
) -> Vec<Change> {
    let mut list = Vec::new();
    for (path, sha) in current {
        match accepted.get(path) {
            None => list.push(Change {
                path: path.clone(),
                kind: "added",
            }),
            Some(old) if old != sha => list.push(Change {
                path: path.clone(),
                kind: "modified",
            }),
            _ => {}
        }
    }
    for path in accepted.keys() {
        if !current.contains_key(path) {
            list.push(Change {
                path: path.clone(),
                kind: "removed",
            });
        }
    }
    list
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn fingerprint_reports_edit_add_and_remove() {
        let dir = std::env::temp_dir().join(format!("spopi-fp-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("app")).unwrap();
        fs::write(dir.join("app/a.js"), b"one").unwrap();
        fs::write(dir.join("app/b.js"), b"two").unwrap();
        let accepted = hash_tree(&dir);
        fs::write(dir.join("app/a.js"), b"ONE").unwrap();
        fs::write(dir.join("app/c.js"), b"three").unwrap();
        fs::remove_file(dir.join("app/b.js")).unwrap();
        let current = hash_tree(&dir);
        let diff = changes(&current, &accepted);
        assert!(diff
            .iter()
            .any(|c| c.path == "app/a.js" && c.kind == "modified"));
        assert!(diff
            .iter()
            .any(|c| c.path == "app/c.js" && c.kind == "added"));
        assert!(diff
            .iter()
            .any(|c| c.path == "app/b.js" && c.kind == "removed"));
        assert!(changes(&current, &current).is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn hash_tree_skips_tests_and_fixtures() {
        let dir = std::env::temp_dir().join(format!("spopi-fp-skip-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("fixtures")).unwrap();
        fs::write(dir.join("a.js"), b"one").unwrap();
        fs::write(dir.join("a.test.js"), b"test").unwrap();
        fs::write(dir.join("fixtures/x.json"), b"{}").unwrap();
        fs::write(dir.join("overrides.json.tmp"), b"{}").unwrap();
        let hashed = hash_tree(&dir);
        assert_eq!(hashed.keys().collect::<Vec<_>>(), vec!["a.js"]);
        let _ = fs::remove_dir_all(&dir);
    }
}
