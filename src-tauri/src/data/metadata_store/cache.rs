// ABOUTME: Session-summary and cost-metrics cache rows in spopi.sqlite3, keyed by file path, mtime, and length.
// ABOUTME: Only the two known cache tables are accepted; what goes into the JSON is the caller's business.

use super::MetadataStore;
use rusqlite::{params, OptionalExtension};

impl MetadataStore {
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

#[cfg(test)]
mod tests {
    use super::super::tests::temp_dir;
    use super::MetadataStore;
    use std::fs;

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
