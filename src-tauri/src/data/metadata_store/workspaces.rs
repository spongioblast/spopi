// ABOUTME: Workspace ids by folder path in spopi.sqlite3, plus the hidden-workspace list and folder renames.
// ABOUTME: Never touches Pi session files or the folders themselves; only rows and path-bearing preferences.

use super::MetadataStore;
use crate::data::paths::{canonical_path, strip_verbatim_prefix};
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use std::path::Path;
use uuid::Uuid;

impl MetadataStore {
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
    use super::super::tests::temp_dir;
    use super::MetadataStore;
    use std::fs;

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
}
