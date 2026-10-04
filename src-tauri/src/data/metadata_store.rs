// ABOUTME: Opens spopi.sqlite3 and creates or upgrades its schema to the current version.
// ABOUTME: Row access per concern lives in metadata_store/ (workspaces, preferences, devices, cache).

use super::paths::strip_verbatim_prefix;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use std::path::{Path, PathBuf};

mod cache;
mod devices;
mod preferences;
mod workspaces;

const SCHEMA_VERSION: i64 = 6;

pub struct MetadataStore {
    connection: Connection,
    path: PathBuf,
}

impl MetadataStore {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                format!(
                    "Cannot create SPOPI metadata directory {}: {error}",
                    parent.display()
                )
            })?;
        }
        let connection = Connection::open(path).map_err(|error| {
            format!(
                "Cannot open SPOPI metadata database {}: {error}",
                path.display()
            )
        })?;
        let mut store = Self {
            connection,
            path: path.to_path_buf(),
        };
        store.migrate()?;
        store.restrict_permissions()?;
        Ok(store)
    }

    fn migrate(&mut self) -> Result<(), String> {
        let current: i64 = self
            .connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(|error| format!("Cannot read SPOPI metadata schema version: {error}"))?;
        if current > SCHEMA_VERSION {
            return Err(format!(
                "SPOPI metadata schema {current} is newer than supported schema {SCHEMA_VERSION}"
            ));
        }
        if current == SCHEMA_VERSION {
            return Ok(());
        }
        let transaction = self
            .connection
            .transaction()
            .map_err(|error| format!("Cannot start SPOPI metadata migration: {error}"))?;
        let has_workspaces: bool = transaction
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type = 'table' AND name = 'workspaces'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .map(|count| count > 0)
            .unwrap_or(false);
        if has_workspaces {
            Self::normalize_stored_paths(&transaction)?;
        }
        transaction
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS workspaces (
                    workspace_id TEXT PRIMARY KEY,
                    canonical_path TEXT NOT NULL UNIQUE,
                    created_at INTEGER NOT NULL DEFAULT (unixepoch())
                );
                CREATE TABLE IF NOT EXISTS preferences (
                    key TEXT PRIMARY KEY,
                    value_json TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS devices (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    token_hash TEXT NOT NULL UNIQUE,
                    tier TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    last_seen_at INTEGER,
                    revoked_at INTEGER
                );
                CREATE TABLE IF NOT EXISTS session_summary_cache (
                    path TEXT PRIMARY KEY,
                    mtime INTEGER NOT NULL,
                    len INTEGER NOT NULL,
                    json TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS cost_metrics_cache (
                    path TEXT PRIMARY KEY,
                    mtime INTEGER NOT NULL,
                    len INTEGER NOT NULL,
                    json TEXT NOT NULL
                );
                PRAGMA user_version = 6;",
            )
            .map_err(|error| format!("Cannot migrate SPOPI metadata schema: {error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("Cannot commit SPOPI metadata migration: {error}"))
    }

    /// Paths stored before schema 6 carry the Windows `\\?\` prefix from
    /// `std::fs::canonicalize`. Drop it, and drop a workspace row that then
    /// duplicates an older one. Summaries are rebuilt on the next list.
    fn normalize_stored_paths(transaction: &rusqlite::Transaction) -> Result<(), String> {
        let rows: Vec<(String, String)> = {
            let mut statement = transaction
                .prepare("SELECT workspace_id, canonical_path FROM workspaces")
                .map_err(|error| format!("Cannot read workspaces: {error}"))?;
            let mapped = statement
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
                .map_err(|error| format!("Cannot read workspaces: {error}"))?;
            mapped
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| format!("Cannot read workspaces: {error}"))?
        };
        for (id, path) in rows {
            let stripped = strip_verbatim_prefix(&path);
            if stripped == path {
                continue;
            }
            let taken: Option<String> = transaction
                .query_row(
                    "SELECT workspace_id FROM workspaces WHERE canonical_path = ?1",
                    [&stripped],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|error| format!("Cannot query workspace metadata: {error}"))?;
            if taken.is_some() {
                transaction
                    .execute("DELETE FROM workspaces WHERE workspace_id = ?1", [&id])
                    .map_err(|error| format!("Cannot drop duplicate workspace: {error}"))?;
            } else {
                transaction
                    .execute(
                        "UPDATE workspaces SET canonical_path = ?1 WHERE workspace_id = ?2",
                        params![stripped, id],
                    )
                    .map_err(|error| format!("Cannot normalize workspace path: {error}"))?;
            }
        }
        for key in ["ui.sessions.pinnedItems", "ui.workspaces.hidden"] {
            let raw: Option<String> = transaction
                .query_row(
                    "SELECT value_json FROM preferences WHERE key = ?1",
                    [key],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|error| format!("Cannot read preference: {error}"))?;
            let Some(raw) = raw else { continue };
            let Ok(mut value) = serde_json::from_str::<Value>(&raw) else {
                continue;
            };
            if strip_paths_in_json(&mut value) {
                transaction
                    .execute(
                        "UPDATE preferences SET value_json = ?1 WHERE key = ?2",
                        params![value.to_string(), key],
                    )
                    .map_err(|error| format!("Cannot normalize preference paths: {error}"))?;
            }
        }
        transaction
            .execute("DELETE FROM session_summary_cache", [])
            .map_err(|error| format!("Cannot clear session summary cache: {error}"))?;
        Ok(())
    }

    #[cfg(unix)]
    fn restrict_permissions(&self) -> Result<(), String> {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&self.path, std::fs::Permissions::from_mode(0o600)).map_err(
            |error| {
                format!(
                    "Cannot restrict metadata permissions {}: {error}",
                    self.path.display()
                )
            },
        )
    }

    #[cfg(not(unix))]
    fn restrict_permissions(&self) -> Result<(), String> {
        let _ = &self.path;
        Ok(())
    }

    pub(crate) fn connection(&self) -> &Connection {
        &self.connection
    }

    #[cfg(test)]
    pub fn schema_version(&self) -> Result<i64, String> {
        self.connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(|error| format!("Cannot read SPOPI metadata schema version: {error}"))
    }

    #[cfg(test)]
    pub fn reset(&mut self) -> Result<(), String> {
        let transaction = self
            .connection
            .transaction()
            .map_err(|error| format!("Cannot start metadata reset: {error}"))?;
        transaction
            .execute_batch("DELETE FROM workspaces; DELETE FROM preferences;")
            .map_err(|error| format!("Cannot reset SPOPI metadata: {error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("Cannot commit SPOPI metadata reset: {error}"))
    }
}

/// Walk a stored preference and strip `\\?\` from every string that starts
/// with it. Returns true when anything changed.
fn strip_paths_in_json(value: &mut Value) -> bool {
    match value {
        Value::String(text) => {
            let stripped = strip_verbatim_prefix(text);
            if stripped == *text {
                return false;
            }
            *text = stripped;
            true
        }
        Value::Array(items) => items
            .iter_mut()
            .map(strip_paths_in_json)
            .fold(false, |changed, hit| changed | hit),
        Value::Object(map) => map
            .values_mut()
            .map(strip_paths_in_json)
            .fold(false, |changed, hit| changed | hit),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::MetadataStore;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    pub(super) fn temp_dir() -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("spopi-metadata-{nonce}"));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn migration_strips_verbatim_prefixes_and_drops_colliding_rows() {
        let temp = temp_dir();
        let database = temp.join("spopi.sqlite3");
        {
            let connection = rusqlite::Connection::open(&database).unwrap();
            connection
                .execute_batch(
                    "CREATE TABLE workspaces (
                        workspace_id TEXT PRIMARY KEY,
                        canonical_path TEXT NOT NULL UNIQUE,
                        created_at INTEGER NOT NULL DEFAULT (unixepoch())
                    );
                    CREATE TABLE preferences (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
                    CREATE TABLE session_summary_cache (
                        path TEXT PRIMARY KEY, mtime INTEGER NOT NULL,
                        len INTEGER NOT NULL, json TEXT NOT NULL
                    );
                    INSERT INTO workspaces (workspace_id, canonical_path, created_at)
                        VALUES ('older', 'C:\\Users\\me\\proj', 1);
                    INSERT INTO workspaces (workspace_id, canonical_path, created_at)
                        VALUES ('prefixed', '\\\\?\\C:\\Users\\me\\proj', 2);
                    INSERT INTO workspaces (workspace_id, canonical_path, created_at)
                        VALUES ('alone', '\\\\?\\C:\\Users\\me\\other', 3);
                    INSERT INTO preferences (key, value_json) VALUES
                        ('ui.workspaces.hidden',
                         '[{\"id\":\"w\",\"path\":\"\\\\\\\\?\\\\C:\\\\Users\\\\me\\\\proj\"}]'),
                        ('ui.sessions.pinnedItems',
                         '{\"workspaces\":[\"\\\\\\\\?\\\\D:\\\\keep\"]}'),
                        ('ui.chatFontSize', '\"large\"');
                    INSERT INTO session_summary_cache (path, mtime, len, json)
                        VALUES ('\\\\?\\C:\\s.jsonl', 1, 1, '{}');
                    PRAGMA user_version = 5;",
                )
                .unwrap();
        }

        let store = MetadataStore::open(&database).unwrap();
        assert_eq!(store.schema_version().unwrap(), 6);
        let paths: Vec<String> = store
            .connection()
            .prepare("SELECT canonical_path FROM workspaces ORDER BY canonical_path")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(paths, vec![r"C:\Users\me\other", r"C:\Users\me\proj"]);
        let kept: String = store
            .connection()
            .query_row(
                "SELECT workspace_id FROM workspaces WHERE canonical_path = ?1",
                [r"C:\Users\me\proj"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(kept, "older");
        assert_eq!(
            store.preference_get("ui.workspaces.hidden").unwrap(),
            Some(serde_json::json!([{ "id": "w", "path": r"C:\Users\me\proj" }]))
        );
        assert_eq!(
            store.preference_get("ui.sessions.pinnedItems").unwrap(),
            Some(serde_json::json!({ "workspaces": [r"D:\keep"] }))
        );
        assert_eq!(
            store.preference_get("ui.chatFontSize").unwrap(),
            Some(serde_json::json!("large"))
        );
        let cached: i64 = store
            .connection()
            .query_row("SELECT COUNT(*) FROM session_summary_cache", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(cached, 0);
        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn reset_cannot_modify_pi_sessions_or_workspace_files() {
        let temp = temp_dir();
        let database = temp.join("spopi.sqlite3");
        let workspace = temp.join("workspace");
        fs::create_dir(&workspace).unwrap();
        let session = workspace.join("session.jsonl");
        fs::write(&session, "{\"type\":\"session\"}\n").unwrap();
        let mut store = MetadataStore::open(&database).unwrap();
        store.workspace_id_for_path(&workspace).unwrap();

        store.reset().unwrap();

        assert_eq!(
            fs::read_to_string(session).unwrap(),
            "{\"type\":\"session\"}\n"
        );
        assert_eq!(store.schema_version().unwrap(), 6);
        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn opening_an_older_schema_upgrades_it_and_keeps_devices() {
        let temp = temp_dir();
        let database = temp.join("spopi.sqlite3");
        {
            let connection = rusqlite::Connection::open(&database).unwrap();
            connection
                .execute_batch(
                    "PRAGMA user_version = 3;
                     CREATE TABLE devices (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        token_hash TEXT NOT NULL UNIQUE,
                        tier TEXT NOT NULL,
                        created_at INTEGER NOT NULL,
                        last_seen_at INTEGER,
                        revoked_at INTEGER
                     );
                     INSERT INTO devices (id, name, token_hash, tier, created_at) VALUES ('d1', 'Pixel', 'hash', 'control', 1);",
                )
                .unwrap();
        }
        let store = MetadataStore::open(&database).unwrap();
        assert_eq!(store.schema_version().unwrap(), 6);
        let mut names = Vec::new();
        let mut statement = store
            .connection()
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
            .unwrap();
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap();
        for name in rows.flatten() {
            names.push(name);
        }
        assert!(names.iter().any(|name| name == "devices"));
        assert!(names.iter().any(|name| name == "preferences"));
        let devices: i64 = store
            .connection()
            .query_row("SELECT COUNT(*) FROM devices", [], |row| row.get(0))
            .unwrap();
        assert_eq!(devices, 1);
        let _ = fs::remove_dir_all(temp);
    }
}
