// ABOUTME: Stores workspace ids and ui preferences in spopi.sqlite3.
// ABOUTME: Opening the database creates or upgrades the schema to the current version.

use super::paths::{canonical_path, strip_verbatim_prefix};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use uuid::Uuid;

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

    pub fn workspace_id_for_path(&mut self, workspace: &Path) -> Result<String, String> {
        let canonical = canonical_path(workspace).map_err(|error| {
            format!("Cannot resolve workspace {}: {error}", workspace.display())
        })?;
        let canonical = canonical.to_string_lossy();
        if let Some(id) = self
            .connection
            .query_row(
                "SELECT workspace_id FROM workspaces WHERE canonical_path = ?1",
                [canonical.as_ref()],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| format!("Cannot query workspace metadata: {error}"))?
        {
            return Ok(id);
        }
        let id = Uuid::new_v4().to_string();
        self.connection
            .execute(
                "INSERT INTO workspaces (workspace_id, canonical_path) VALUES (?1, ?2)",
                params![id, canonical.as_ref()],
            )
            .map_err(|error| format!("Cannot store workspace metadata: {error}"))?;
        Ok(id)
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

    /// Read one JSON preference value. Corrupt stored JSON surfaces as an
    /// error instead of silently falling back to a default.
    pub fn preference_get(&self, key: &str) -> Result<Option<Value>, String> {
        let raw: Option<String> = self
            .connection
            .query_row(
                "SELECT value_json FROM preferences WHERE key = ?1",
                [key],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| format!("Cannot read preference: {error}"))?;
        raw.map(|raw| {
            serde_json::from_str(&raw)
                .map_err(|error| format!("Invalid stored preference: {error}"))
        })
        .transpose()
    }

    /// Upsert one JSON preference value.
    pub fn preference_set(&mut self, key: &str, value: &Value) -> Result<(), String> {
        let raw = serde_json::to_string(value)
            .map_err(|error| format!("Cannot encode preference: {error}"))?;
        self.connection
            .execute(
                "INSERT INTO preferences (key, value_json) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json",
                params![key, raw],
            )
            .map_err(|error| format!("Cannot save preference: {error}"))?;
        Ok(())
    }

    /// Remember a workspace the user removed from the sidebar.
    /// Stores `{ id, path }` under `ui.workspaces.hidden`. Does not delete Pi session files.
    pub fn remember_hidden_workspace(
        &mut self,
        workspace_id: &str,
        project_path: &str,
    ) -> Result<Value, String> {
        let id = workspace_id.trim();
        let path = project_path.trim();
        if id.is_empty() && path.is_empty() {
            return Err("workspaceId is required".into());
        }
        let current = self
            .preference_get("ui.workspaces.hidden")?
            .unwrap_or(Value::Array(Vec::new()));
        let mut rows = current.as_array().cloned().unwrap_or_default();
        let exists = rows.iter().any(|row| {
            let same_id = !id.is_empty() && row.get("id").and_then(Value::as_str) == Some(id);
            let same_path =
                !path.is_empty() && row.get("path").and_then(Value::as_str) == Some(path);
            same_id || same_path
        });
        if !exists {
            rows.push(json!({ "id": id, "path": path }));
        }
        let value = Value::Array(rows);
        self.preference_set("ui.workspaces.hidden", &value)?;
        Ok(value)
    }

    /// Point an existing workspace at its folder's new path after a rename.
    pub fn retarget_workspace(&mut self, workspace_id: &str, new_path: &str) -> Result<(), String> {
        let old_path: String = self
            .connection
            .query_row(
                "SELECT canonical_path FROM workspaces WHERE workspace_id = ?1",
                [workspace_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| format!("Cannot read workspace path: {error}"))?
            .ok_or_else(|| format!("No workspace {workspace_id}"))?;
        self.connection
            .execute(
                "UPDATE workspaces SET canonical_path = ?1 WHERE workspace_id = ?2",
                params![new_path, workspace_id],
            )
            .map_err(|error| format!("Cannot update workspace path: {error}"))?;
        for key in ["ui.sessions.pinnedItems", "ui.workspaces.hidden"] {
            let Some(mut value) = self.preference_get(key)? else {
                continue;
            };
            if replace_path_in_json(&mut value, &old_path, new_path) {
                self.preference_set(key, &value)?;
            }
        }
        Ok(())
    }

    /// The workspace stored under exactly this path, without touching the
    /// filesystem, so it works for a folder that no longer exists.
    pub fn workspace_id_for_stored_path(&self, path: &str) -> Result<Option<String>, String> {
        let wanted = comparable_path(path);
        let mut statement = self
            .connection
            .prepare("SELECT workspace_id, canonical_path FROM workspaces")
            .map_err(|error| format!("Cannot query workspace metadata: {error}"))?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|error| format!("Cannot query workspace metadata: {error}"))?;
        for row in rows.flatten() {
            if comparable_path(&row.1) == wanted {
                return Ok(Some(row.0));
            }
        }
        Ok(None)
    }

    /// A folder the user opened again is no longer closed.
    pub fn unhide_workspace(&mut self, project_path: &str) -> Result<(), String> {
        let path = project_path.trim();
        if path.is_empty() {
            return Ok(());
        }
        let Some(current) = self.preference_get("ui.workspaces.hidden")? else {
            return Ok(());
        };
        let Some(rows) = current.as_array() else {
            return Ok(());
        };
        let wanted = comparable_path(path);
        let id = self.workspace_id_for_stored_path(path)?;
        let kept: Vec<Value> = rows
            .iter()
            .filter(|row| {
                let same_path = row
                    .get("path")
                    .and_then(Value::as_str)
                    .is_some_and(|stored| comparable_path(stored) == wanted);
                let same_id = id.as_deref().is_some_and(|id| {
                    !id.is_empty() && row.get("id").and_then(Value::as_str) == Some(id)
                });
                !(same_path || same_id)
            })
            .cloned()
            .collect();
        if kept.len() != rows.len() {
            self.preference_set("ui.workspaces.hidden", &Value::Array(kept))?;
        }
        Ok(())
    }

    /// Keys whose name starts with `prefix`, in order.
    pub fn preference_list(&self, prefix: &str) -> Result<Vec<(String, Value)>, String> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT key, value_json FROM preferences
                 WHERE substr(key, 1, length(?1)) = ?1
                 ORDER BY key",
            )
            .map_err(|error| format!("Cannot list preferences: {error}"))?;
        let rows = statement
            .query_map([prefix], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|error| format!("Cannot list preferences: {error}"))?;
        let mut out = Vec::new();
        for row in rows {
            let (key, raw): (String, String) =
                row.map_err(|error| format!("Cannot list preferences: {error}"))?;
            let value = serde_json::from_str(&raw)
                .map_err(|error| format!("Invalid stored preference: {error}"))?;
            out.push((key, value));
        }
        Ok(out)
    }

    pub fn preference_remove(&mut self, key: &str) -> Result<bool, String> {
        let removed = self
            .connection
            .execute("DELETE FROM preferences WHERE key = ?1", [key])
            .map_err(|error| format!("Cannot remove preference: {error}"))?;
        Ok(removed > 0)
    }

    pub fn find_device_by_token_hash(&self, hash: &str) -> Result<Option<DeviceRecord>, String> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT id, name, tier, last_seen_at, revoked_at FROM devices WHERE token_hash = ?1",
            )
            .map_err(|error| format!("Cannot look up a device: {error}"))?;
        let mut rows = statement
            .query([hash])
            .map_err(|error| format!("Cannot look up a device: {error}"))?;
        let Some(row) = rows
            .next()
            .map_err(|error| format!("Cannot look up a device: {error}"))?
        else {
            return Ok(None);
        };
        let revoked_at: Option<i64> = row
            .get(4)
            .map_err(|error| format!("Cannot read a device: {error}"))?;
        Ok(Some(DeviceRecord {
            id: row
                .get(0)
                .map_err(|error| format!("Cannot read a device: {error}"))?,
            name: row
                .get(1)
                .map_err(|error| format!("Cannot read a device: {error}"))?,
            tier: row
                .get(2)
                .map_err(|error| format!("Cannot read a device: {error}"))?,
            last_seen_at: row
                .get(3)
                .map_err(|error| format!("Cannot read a device: {error}"))?,
            revoked: revoked_at.is_some(),
        }))
    }

    pub fn touch_device(&self, id: &str, seen: i64) -> Result<(), String> {
        self.connection
            .execute(
                "UPDATE devices SET last_seen_at = ?1 WHERE id = ?2",
                params![seen, id],
            )
            .map_err(|error| format!("Cannot update device last_seen: {error}"))?;
        Ok(())
    }

    pub(crate) fn read_cache(
        &self,
        table: &str,
        path: &str,
    ) -> Result<Option<(i64, i64, String)>, String> {
        if table != "session_summary_cache" && table != "cost_metrics_cache" {
            return Err("unknown cache table".into());
        }
        let sql = format!("SELECT mtime, len, json FROM {table} WHERE path = ?1");
        self.connection
            .query_row(&sql, params![path], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })
            .optional()
            .map_err(|error| format!("Cannot read {table}: {error}"))
    }

    pub(crate) fn write_cache(
        &self,
        table: &str,
        path: &str,
        mtime: i64,
        len: i64,
        json: &str,
    ) -> Result<(), String> {
        if table != "session_summary_cache" && table != "cost_metrics_cache" {
            return Err("unknown cache table".into());
        }
        let sql = format!(
            "INSERT INTO {table} (path, mtime, len, json) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(path) DO UPDATE SET mtime = excluded.mtime, len = excluded.len, json = excluded.json"
        );
        self.connection
            .execute(&sql, params![path, mtime, len, json])
            .map_err(|error| format!("Cannot write {table}: {error}"))?;
        Ok(())
    }

    pub(crate) fn prune_cache<F>(&self, table: &str, mut exists: F) -> Result<(), String>
    where
        F: FnMut(&str) -> bool,
    {
        if table != "session_summary_cache" && table != "cost_metrics_cache" {
            return Err("unknown cache table".into());
        }
        let sql = format!("SELECT path FROM {table}");
        let paths = self
            .connection
            .prepare(&sql)
            .map_err(|error| format!("Cannot list {table}: {error}"))?
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|error| format!("Cannot list {table}: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("Cannot list {table}: {error}"))?;
        for path in paths {
            if !exists(&path) {
                let delete = format!("DELETE FROM {table} WHERE path = ?1");
                self.connection
                    .execute(&delete, params![path])
                    .map_err(|error| format!("Cannot prune {table}: {error}"))?;
            }
        }
        Ok(())
    }
}

pub struct DeviceRecord {
    pub id: String,
    pub name: String,
    pub tier: String,
    pub last_seen_at: Option<i64>,
    pub revoked: bool,
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

/// A path in the form two stored paths can be compared in: no `\\?\`, no
/// trailing separator, and no case on Windows.
fn comparable_path(path: &str) -> String {
    let stripped = strip_verbatim_prefix(path.trim());
    let trimmed = stripped.trim_end_matches(['/', '\\']).to_owned();
    if cfg!(windows) {
        trimmed.to_lowercase()
    } else {
        trimmed
    }
}

/// Replace one stored path with another anywhere in a preference value.
fn replace_path_in_json(value: &mut Value, from: &str, to: &str) -> bool {
    match value {
        Value::String(text) if text == from => {
            *text = to.to_owned();
            true
        }
        Value::Array(items) => items
            .iter_mut()
            .map(|item| replace_path_in_json(item, from, to))
            .fold(false, |changed, hit| changed | hit),
        Value::Object(map) => map
            .values_mut()
            .map(|item| replace_path_in_json(item, from, to))
            .fold(false, |changed, hit| changed | hit),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::MetadataStore;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir() -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("spopi-metadata-{nonce}"));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn assigns_stable_workspace_ids() {
        let temp = temp_dir();
        let database = temp.join("spopi.sqlite3");
        let workspace = temp.join("workspace");
        fs::create_dir(&workspace).unwrap();
        let mut store = MetadataStore::open(&database).unwrap();

        let first = store.workspace_id_for_path(&workspace).unwrap();
        let second = store.workspace_id_for_path(&workspace).unwrap();
        assert_eq!(first, second);
        assert_eq!(store.schema_version().unwrap(), 6);

        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn hidden_workspace_is_a_preference_and_does_not_touch_sessions() {
        let temp = temp_dir();
        let mut store = MetadataStore::open(&temp.join("spopi.sqlite3")).unwrap();
        let hidden = store.remember_hidden_workspace("ws-1", "D:\\gone").unwrap();
        assert_eq!(
            hidden,
            serde_json::json!([{ "id": "ws-1", "path": "D:\\gone" }])
        );
        let again = store.remember_hidden_workspace("ws-1", "D:\\gone").unwrap();
        assert_eq!(again.as_array().unwrap().len(), 1);
        assert!(store
            .preference_get("ui.workspaces.hidden")
            .unwrap()
            .is_some());
        let _ = fs::remove_dir_all(temp);
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
    fn retarget_keeps_the_workspace_id_and_rewrites_prefs() {
        let temp = temp_dir();
        let project = temp.join("alpha");
        fs::create_dir(&project).unwrap();
        let mut store = MetadataStore::open(&temp.join("spopi.sqlite3")).unwrap();
        let id = store.workspace_id_for_path(&project).unwrap();
        let stored: String = store
            .connection()
            .query_row(
                "SELECT canonical_path FROM workspaces WHERE workspace_id = ?1",
                [&id],
                |row| row.get(0),
            )
            .unwrap();
        store
            .preference_set(
                "ui.sessions.pinnedItems",
                &serde_json::json!({ "workspaces": [stored] }),
            )
            .unwrap();
        let next = temp.join("beta").to_string_lossy().into_owned();
        store.retarget_workspace(&id, &next).unwrap();
        let path: String = store
            .connection()
            .query_row(
                "SELECT canonical_path FROM workspaces WHERE workspace_id = ?1",
                [&id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(path, next);
        assert_eq!(
            store.preference_get("ui.sessions.pinnedItems").unwrap(),
            Some(serde_json::json!({ "workspaces": [next] }))
        );
        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn preferences_round_trip_json_and_delete() {
        let temp = temp_dir();
        let mut store = MetadataStore::open(&temp.join("spopi.sqlite3")).unwrap();

        assert_eq!(store.preference_get("ui.chatFontSize").unwrap(), None);
        store
            .preference_set("ui.chatFontSize", &serde_json::json!("large"))
            .unwrap();
        assert_eq!(
            store.preference_get("ui.chatFontSize").unwrap(),
            Some(serde_json::json!("large"))
        );
        // Upsert overwrites the same key.
        store
            .preference_set("ui.chatFontSize", &serde_json::json!({ "level": 3 }))
            .unwrap();
        assert_eq!(
            store.preference_get("ui.chatFontSize").unwrap(),
            Some(serde_json::json!({ "level": 3 }))
        );
        assert!(store.preference_remove("ui.chatFontSize").unwrap());
        assert_eq!(store.preference_get("ui.chatFontSize").unwrap(), None);
        assert!(!store.preference_remove("ui.chatFontSize").unwrap());

        store
            .preference_set("ui.a", &serde_json::json!(true))
            .unwrap();
        store
            .preference_set("ui.b", &serde_json::json!("x"))
            .unwrap();
        store
            .preference_set("other.a", &serde_json::json!(1))
            .unwrap();
        let listed = store.preference_list("ui.").unwrap();
        assert_eq!(
            listed,
            vec![
                ("ui.a".into(), serde_json::json!(true)),
                ("ui.b".into(), serde_json::json!("x")),
            ]
        );

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

    #[test]
    fn cache_rows_round_trip_and_prune_when_the_file_is_gone() {
        let temp = temp_dir();
        let store = MetadataStore::open(&temp.join("spopi.sqlite3")).unwrap();
        store
            .write_cache("session_summary_cache", "a.jsonl", 10, 20, "{\"id\":\"a\"}")
            .unwrap();
        store
            .write_cache("cost_metrics_cache", "a.jsonl", 10, 20, "{\"id\":\"a\"}")
            .unwrap();
        let row = store
            .read_cache("session_summary_cache", "a.jsonl")
            .unwrap()
            .unwrap();
        assert_eq!(row, (10, 20, "{\"id\":\"a\"}".into()));
        store
            .write_cache("session_summary_cache", "a.jsonl", 11, 21, "{\"id\":\"b\"}")
            .unwrap();
        assert_eq!(
            store
                .read_cache("session_summary_cache", "a.jsonl")
                .unwrap()
                .unwrap()
                .0,
            11
        );
        store
            .prune_cache("session_summary_cache", |_| false)
            .unwrap();
        assert!(store
            .read_cache("session_summary_cache", "a.jsonl")
            .unwrap()
            .is_none());
        assert!(store
            .read_cache("cost_metrics_cache", "a.jsonl")
            .unwrap()
            .is_some());
        let _ = fs::remove_dir_all(temp);
    }
}
