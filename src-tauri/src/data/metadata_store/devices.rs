// ABOUTME: Paired phone devices in spopi.sqlite3: token lookup and last-seen updates.
// ABOUTME: Pairing, listing, and revoking live in host/server/http/phone.rs; this file only reads and touches rows.

use super::MetadataStore;
use rusqlite::params;

pub struct DeviceRecord {
    pub id: String,
    pub name: String,
    pub tier: String,
    pub last_seen_at: Option<i64>,
    pub revoked: bool,
}

impl MetadataStore {
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
}
