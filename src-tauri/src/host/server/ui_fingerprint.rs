// ABOUTME: SHA-256 map of a UI tree, used to version the static asset URLs.
// ABOUTME: Skips test files, fixtures, and the overlay's own bookkeeping.

use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

fn hash_file(bytes: &[u8]) -> String {
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

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
        assert!(hash_tree(&dir.join("absent")).is_empty());
        let _ = fs::remove_dir_all(&dir);
    }
}
