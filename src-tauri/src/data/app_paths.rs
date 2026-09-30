// ABOUTME: Resolves the SPOPI config and cache directories, and where spopi.sqlite3 lives.
// ABOUTME: `SPOPI_APP_DATA_DIR` replaces the config directory for a scratch profile.

use std::fs;
use std::path::{Path, PathBuf};

pub const DATABASE_FILE: &str = "spopi.sqlite3";

/// Before 0.7 the database sat in Tauri's app data folder (`%APPDATA%\app.spopi.desktop`)
/// while everything else used `config_dir()`. Moves it, with its WAL and shared-memory
/// files, when the new folder has none yet. Returns true when it moved.
pub fn move_legacy_database(old_dir: &Path, new_dir: &Path) -> bool {
    let old = old_dir.join(DATABASE_FILE);
    if old_dir == new_dir || !old.is_file() || new_dir.join(DATABASE_FILE).exists() {
        return false;
    }
    if fs::create_dir_all(new_dir).is_err() {
        return false;
    }
    let mut moved = true;
    for suffix in ["", "-wal", "-shm"] {
        let name = format!("{DATABASE_FILE}{suffix}");
        let from = old_dir.join(&name);
        if !from.is_file() {
            continue;
        }
        let to = new_dir.join(&name);
        let done = fs::rename(&from, &to).is_ok()
            || (fs::copy(&from, &to).is_ok() && fs::remove_file(&from).is_ok());
        moved &= done;
    }
    // Only removes the old folder when nothing else is left in it.
    let _ = fs::remove_dir(old_dir);
    moved
}

/// Empty or whitespace overrides fall back to `default_dir`.
pub(crate) fn resolve_app_data_dir(override_dir: Option<String>, default_dir: PathBuf) -> PathBuf {
    override_dir
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or(default_dir)
}

/// `%APPDATA%\spopi` (or equivalent). `SPOPI_APP_DATA_DIR` replaces that folder.
pub fn config_dir() -> PathBuf {
    let parent = dirs::config_dir().unwrap_or_else(std::env::temp_dir);
    let dest = resolve_app_data_dir(
        std::env::var("SPOPI_APP_DATA_DIR").ok(),
        parent.join("spopi"),
    );
    let _ = fs::create_dir_all(&dest);
    dest
}

/// Cache for extra TLS CAs (`spopi/tls`).
#[cfg(target_os = "macos")]
pub fn cache_tls_dir() -> PathBuf {
    let parent = dirs::cache_dir().unwrap_or_else(std::env::temp_dir);
    let dest = parent.join("spopi").join("tls");
    let _ = fs::create_dir_all(&dest);
    dest
}

#[cfg(test)]
mod tests {
    use super::{move_legacy_database, resolve_app_data_dir, DATABASE_FILE};
    use std::fs;
    use std::path::PathBuf;

    #[test]
    fn the_legacy_database_moves_once_with_its_wal() {
        let root = tempfile::tempdir().unwrap();
        let old = root.path().join("app.spopi.desktop");
        let new = root.path().join("spopi");
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join(DATABASE_FILE), b"db").unwrap();
        fs::write(old.join(format!("{DATABASE_FILE}-wal")), b"wal").unwrap();

        assert!(move_legacy_database(&old, &new));
        assert_eq!(fs::read(new.join(DATABASE_FILE)).unwrap(), b"db");
        assert_eq!(
            fs::read(new.join(format!("{DATABASE_FILE}-wal"))).unwrap(),
            b"wal"
        );
        assert!(!old.exists(), "the emptied old folder is removed");

        fs::create_dir_all(&old).unwrap();
        fs::write(old.join(DATABASE_FILE), b"older").unwrap();
        assert!(
            !move_legacy_database(&old, &new),
            "an existing database is never replaced"
        );
        assert_eq!(fs::read(new.join(DATABASE_FILE)).unwrap(), b"db");
    }

    #[test]
    fn app_data_dir_prefers_a_trimmed_override() {
        let default_dir = PathBuf::from("default-data");
        assert_eq!(resolve_app_data_dir(None, default_dir.clone()), default_dir);
        assert_eq!(
            resolve_app_data_dir(Some("  ".into()), default_dir.clone()),
            default_dir
        );
        assert_eq!(
            resolve_app_data_dir(Some(" D:/scratch ".into()), default_dir),
            PathBuf::from("D:/scratch")
        );
    }
}
