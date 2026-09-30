// ABOUTME: Persists per-workspace terminal tab metadata (order, labels, profile,
// ABOUTME: panel height) to terminal-state.json via temp-file then atomic rename.
// ABOUTME: Contains no output, checkpoints, process ids, environment, titles, or capability.

use std::fs;
use std::path::{Path, PathBuf};
#[cfg(test)]
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const STATE_FILENAME: &str = "terminal-state.json";
pub const SCHEMA_VERSION: u32 = 1;
#[cfg(test)]
static TEMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

/// One persisted terminal tab slot. The order of `WorkspaceTerminalMetadata::tabs`
/// is the tab order; `active_index` selects the visible tab. Neither field
/// carries a live terminal identity: a fresh app run creates new shells.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct PersistedTabDescriptor {
    pub label: String,
    pub profile_id: String,
    /// True when the tab was a live process at save time. Old files omit it.
    #[serde(default, skip_serializing_if = "is_false")]
    pub running: bool,
}

fn is_false(value: &bool) -> bool {
    !*value
}

/// Cross-restart terminal metadata for one canonical workspace root.
///
/// This is an inert metadata key, not a live-terminal ownership key: it never
/// revives an owner id, process, checkpoint, output journal, or workspace
/// generation. Concurrent same-path windows may last-write-win only this
/// metadata; their live registries remain owner-isolated.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct WorkspaceTerminalMetadata {
    pub schema_version: u32,
    pub tabs: Vec<PersistedTabDescriptor>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_index: Option<usize>,
    pub default_profile_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub panel_height_px: Option<u32>,
}

impl WorkspaceTerminalMetadata {
    pub fn new(default_profile_id: &str) -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            tabs: Vec::new(),
            active_index: None,
            default_profile_id: default_profile_id.to_string(),
            panel_height_px: None,
        }
    }
}

#[derive(Debug)]
pub enum StateStoreError {
    Io(String),
    Parse(String),
}

impl std::fmt::Display for StateStoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StateStoreError::Io(msg) => write!(f, "terminal state io error: {msg}"),
            StateStoreError::Parse(msg) => write!(f, "terminal state parse error: {msg}"),
        }
    }
}

/// Reads and writes `terminal-state.json` under a platform application
/// configuration directory supplied by the caller (dependency-injected so the
/// store is unit-testable without a Tauri app handle).
pub struct TerminalStateStore {
    config_dir: PathBuf,
}

impl TerminalStateStore {
    pub fn new(config_dir: PathBuf) -> Self {
        Self { config_dir }
    }

    #[cfg(test)]
    pub fn encode(metadata: &WorkspaceTerminalMetadata) -> Result<String, StateStoreError> {
        serde_json::to_string_pretty(metadata).map_err(|e| StateStoreError::Parse(e.to_string()))
    }

    /// Deserialize metadata, rejecting unsupported schema versions.
    pub fn decode(text: &str) -> Result<WorkspaceTerminalMetadata, StateStoreError> {
        let metadata: WorkspaceTerminalMetadata =
            serde_json::from_str(text).map_err(|e| StateStoreError::Parse(e.to_string()))?;
        if metadata.schema_version != SCHEMA_VERSION {
            return Err(StateStoreError::Parse(format!(
                "unsupported terminal-state schema version {}",
                metadata.schema_version
            )));
        }
        Ok(metadata)
    }

    /// Persist metadata in a workspace-specific file. A temporary sibling is
    /// renamed over the destination so a crash never leaves a partial document.
    /// The canonical workspace root is hashed into the filename.
    pub fn save_for_workspace(
        &self,
        workspace_root: &Path,
        metadata: &WorkspaceTerminalMetadata,
    ) -> Result<(), StateStoreError> {
        let path = self.workspace_state_path(workspace_root);
        self.save_at(&path, metadata)
    }

    /// Load metadata for one workspace root. A missing file yields `Ok(None)`.
    /// A corrupt or unsupported document is quarantined and yields `Ok(None)`.
    pub fn load_for_workspace(
        &self,
        workspace_root: &Path,
    ) -> Result<Option<WorkspaceTerminalMetadata>, StateStoreError> {
        self.load_at(
            &self.workspace_state_path(workspace_root),
            &self.workspace_quarantine_path(workspace_root),
        )
    }

    fn save_at(
        &self,
        final_path: &Path,
        metadata: &WorkspaceTerminalMetadata,
    ) -> Result<(), StateStoreError> {
        let value =
            serde_json::to_value(metadata).map_err(|e| StateStoreError::Parse(e.to_string()))?;
        crate::data::atomic_json::write_pretty_atomic(final_path, &value)
            .map_err(StateStoreError::Io)
    }

    fn load_at(
        &self,
        path: &Path,
        quarantine_path: &Path,
    ) -> Result<Option<WorkspaceTerminalMetadata>, StateStoreError> {
        let text = match fs::read_to_string(path) {
            Ok(text) => text,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(StateStoreError::Io(e.to_string())),
        };
        match Self::decode(&text) {
            Ok(metadata) => Ok(Some(metadata)),
            Err(err) => {
                log::warn!(
                    "[spopi-host] terminal state was corrupt and has been quarantined: {err}"
                );
                let _ = fs::rename(path, quarantine_path);
                Ok(None)
            }
        }
    }

    fn workspace_state_path(&self, workspace_root: &Path) -> PathBuf {
        self.config_dir.join(format!(
            "{STATE_FILENAME}.{}",
            workspace_key(workspace_root)
        ))
    }

    #[cfg(test)]
    fn workspace_temp_path(&self, workspace_root: &Path) -> PathBuf {
        self.unique_temp_path(&self.workspace_state_path(workspace_root))
    }

    #[cfg(test)]
    fn unique_temp_path(&self, final_path: &Path) -> PathBuf {
        let filename = final_path
            .file_name()
            .and_then(|value| value.to_str())
            .expect("terminal state path has a UTF-8 filename");
        let sequence = TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
        self.config_dir.join(format!(
            ".{filename}.{}.{}.tmp",
            std::process::id(),
            sequence
        ))
    }

    fn workspace_quarantine_path(&self, workspace_root: &Path) -> PathBuf {
        self.config_dir.join(format!(
            "{STATE_FILENAME}.{}.corrupt.{}",
            workspace_key(workspace_root),
            timestamp()
        ))
    }
}

fn workspace_key(workspace_root: &Path) -> String {
    let mut hasher = Sha256::new();
    hasher.update(workspace_root.to_string_lossy().as_bytes());
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn sample_metadata() -> WorkspaceTerminalMetadata {
        let mut meta = WorkspaceTerminalMetadata::new("default");
        meta.tabs.push(PersistedTabDescriptor {
            label: "zsh".to_string(),
            profile_id: "default".to_string(),
            running: false,
        });
        meta.active_index = Some(0);
        meta.panel_height_px = Some(320);
        meta
    }

    #[test]
    fn persisted_document_has_no_runtime_or_secret_fields() {
        let json = TerminalStateStore::encode(&sample_metadata()).unwrap();
        assert!(!json.contains("checkpoint"));
        assert!(!json.contains("pid"));
        assert!(!json.contains("capability"));
        assert!(!json.contains("output"));
        assert!(!json.contains("title"));
        assert!(!json.contains("cwd"));
        assert!(!json.contains("owner"));
        assert!(json.contains("schema_version"));
        assert!(json.contains("default_profile_id"));
    }

    #[test]
    fn save_and_load_round_trips_metadata() {
        let dir = tempdir().unwrap();
        let store = TerminalStateStore::new(dir.path().to_path_buf());
        let workspace = Path::new("/workspace");
        store
            .save_for_workspace(workspace, &sample_metadata())
            .unwrap();
        let loaded = store
            .load_for_workspace(workspace)
            .unwrap()
            .expect("metadata present");
        assert_eq!(loaded, sample_metadata());
    }

    #[test]
    fn missing_file_loads_none() {
        let dir = tempdir().unwrap();
        let store = TerminalStateStore::new(dir.path().to_path_buf());
        assert!(store
            .load_for_workspace(Path::new("/missing"))
            .unwrap()
            .is_none());
    }

    #[test]
    fn corrupt_file_is_quarantined_and_loads_none() {
        let dir = tempdir().unwrap();
        let store = TerminalStateStore::new(dir.path().to_path_buf());
        let workspace = Path::new("/workspace");
        let path = store.workspace_state_path(workspace);
        fs::write(&path, "{ not valid json").unwrap();
        assert!(store.load_for_workspace(workspace).unwrap().is_none());
        assert!(!path.exists());
        assert!(dir.path().read_dir().unwrap().count() >= 1);
    }

    #[test]
    fn unsupported_schema_version_is_rejected() {
        let dir = tempdir().unwrap();
        let store = TerminalStateStore::new(dir.path().to_path_buf());
        let foreign = r#"{"schema_version":999,"tabs":[],"default_profile_id":"default"}"#;
        let workspace = Path::new("/workspace");
        fs::write(store.workspace_state_path(workspace), foreign).unwrap();
        assert!(store.load_for_workspace(workspace).unwrap().is_none());
    }

    #[test]
    fn workspace_keys_keep_metadata_isolated() {
        let dir = tempdir().unwrap();
        let store = TerminalStateStore::new(dir.path().to_path_buf());
        let mut first = sample_metadata();
        first.tabs[0].label = "first".to_string();
        let mut second = sample_metadata();
        second.tabs[0].label = "second".to_string();
        store
            .save_for_workspace(Path::new("/workspace/first"), &first)
            .unwrap();
        store
            .save_for_workspace(Path::new("/workspace/second"), &second)
            .unwrap();
        assert_eq!(
            store
                .load_for_workspace(Path::new("/workspace/first"))
                .unwrap(),
            Some(first)
        );
        assert_eq!(
            store
                .load_for_workspace(Path::new("/workspace/second"))
                .unwrap(),
            Some(second)
        );
    }

    #[test]
    fn save_creates_config_dir_when_missing() {
        let dir = tempdir().unwrap();
        let nested = dir.path().join("nested/config");
        let store = TerminalStateStore::new(nested.clone());
        store
            .save_for_workspace(Path::new("/workspace"), &sample_metadata())
            .unwrap();
        assert!(nested.exists());
    }

    #[test]
    fn temporary_paths_are_unique_within_one_process() {
        let dir = tempdir().unwrap();
        let store = TerminalStateStore::new(dir.path().to_path_buf());
        assert_ne!(
            store.workspace_temp_path(Path::new("/workspace")),
            store.workspace_temp_path(Path::new("/workspace"))
        );
    }
}
