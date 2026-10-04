// ABOUTME: JSON preference rows in spopi.sqlite3: get, set, list by prefix, remove.
// ABOUTME: Values are opaque JSON here; which keys exist and what they mean is decided by callers.

use super::MetadataStore;
use rusqlite::{params, OptionalExtension};
use serde_json::Value;

impl MetadataStore {
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
}

#[cfg(test)]
mod tests {
    use super::super::tests::temp_dir;
    use super::MetadataStore;
    use std::fs;

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
}
