// ABOUTME: Persists review comment drafts, one list per project folder.
// ABOUTME: The host only checks the list's size. The frontend owns each draft.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const SCHEMA_VERSION: u32 = 1;
const MAX_DRAFTS: usize = 100;
const MAX_BYTES: usize = 256 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Document {
    schema_version: u32,
    #[serde(default)]
    projects: BTreeMap<String, Value>,
}

pub struct ReviewDraftStore {
    path: PathBuf,
    document: Mutex<Document>,
}

impl ReviewDraftStore {
    pub fn open(path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                format!(
                    "Cannot create review draft directory {}: {error}",
                    parent.display()
                )
            })?;
        }
        let document = match fs::read_to_string(&path) {
            Ok(contents) => decode_document(&contents)?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Document {
                schema_version: SCHEMA_VERSION,
                projects: BTreeMap::new(),
            },
            Err(error) => {
                return Err(format!(
                    "Cannot read review drafts {}: {error}",
                    path.display()
                ));
            }
        };
        restrict_permissions(&path)?;
        Ok(Self {
            path,
            document: Mutex::new(document),
        })
    }

    /// The project's draft list, or an empty array when it has none.
    pub fn load(&self, project: &Path) -> Result<Value, String> {
        let key = project_key(project)?;
        let document = self.document.lock().map_err(lock_error)?;
        Ok(document
            .projects
            .get(&key)
            .cloned()
            .unwrap_or_else(|| Value::Array(Vec::new())))
    }

    /// Replace the project's drafts. An empty array removes the entry.
    pub fn save(&self, project: &Path, drafts: Value) -> Result<Value, String> {
        let key = project_key(project)?;
        let drafts = checked_drafts(drafts)?;
        let mut document = self.document.lock().map_err(lock_error)?;
        if drafts.as_array().is_some_and(Vec::is_empty) {
            document.projects.remove(&key);
        } else {
            document.projects.insert(key, drafts.clone());
        }
        self.write_locked(&document)?;
        Ok(drafts)
    }

    fn write_locked(&self, document: &Document) -> Result<(), String> {
        let value = serde_json::to_value(document)
            .map_err(|error| format!("Cannot encode review drafts: {error}"))?;
        crate::data::atomic_json::write_pretty_atomic(&self.path, &value)?;
        restrict_permissions(&self.path)
    }
}

fn decode_document(contents: &str) -> Result<Document, String> {
    let document: Document = serde_json::from_str(contents)
        .map_err(|error| format!("Invalid review draft JSON: {error}"))?;
    if document.schema_version != SCHEMA_VERSION {
        return Err(format!(
            "Unsupported review draft schema version {}",
            document.schema_version
        ));
    }
    Ok(document)
}

fn project_key(project: &Path) -> Result<String, String> {
    let key = project.to_string_lossy().trim().to_string();
    if key.is_empty() {
        return Err("Review drafts need a project folder".to_string());
    }
    Ok(key)
}

fn checked_drafts(drafts: Value) -> Result<Value, String> {
    let list = drafts
        .as_array()
        .ok_or_else(|| "Review drafts must be a list".to_string())?;
    if list.len() > MAX_DRAFTS {
        return Err(format!(
            "A project can keep at most {MAX_DRAFTS} review drafts"
        ));
    }
    let bytes = serde_json::to_vec(&drafts)
        .map_err(|error| format!("Cannot measure review drafts: {error}"))?;
    if bytes.len() > MAX_BYTES {
        return Err("Review drafts are too large".to_string());
    }
    Ok(drafts)
}

fn lock_error<T>(_: std::sync::PoisonError<T>) -> String {
    "Review draft store lock poisoned".to_string()
}

#[cfg(unix)]
fn restrict_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    if !path.exists() {
        return Ok(());
    }
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|error| format!("Cannot restrict review draft permissions: {error}"))
}

#[cfg(not(unix))]
fn restrict_permissions(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{ReviewDraftStore, MAX_BYTES, MAX_DRAFTS, SCHEMA_VERSION};
    use serde_json::json;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn saves_and_loads_a_projects_drafts() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("review-drafts.json");
        let store = ReviewDraftStore::open(path.clone()).unwrap();
        let project = dir.path().join("proj");
        let saved = store
            .save(&project, json!([{ "id": "a", "note": "Keep it" }]))
            .unwrap();
        assert_eq!(store.load(&project).unwrap(), saved);
        let document: serde_json::Value = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
        assert_eq!(document["schema_version"], SCHEMA_VERSION);
    }

    #[test]
    fn an_empty_list_removes_the_project() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("review-drafts.json");
        let store = ReviewDraftStore::open(path.clone()).unwrap();
        let project = dir.path().join("proj");
        store.save(&project, json!([{ "id": "a" }])).unwrap();
        store.save(&project, json!([])).unwrap();
        assert_eq!(store.load(&project).unwrap(), json!([]));
        let document: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(document["projects"], json!({}));
    }

    #[test]
    fn rejects_a_list_that_is_too_big_and_keeps_the_file() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("review-drafts.json");
        let store = ReviewDraftStore::open(path.clone()).unwrap();
        let project = dir.path().join("proj");
        store.save(&project, json!([{ "id": "kept" }])).unwrap();
        let too_many = json!(vec![json!({"id": "x"}); MAX_DRAFTS + 1]);
        assert!(store.save(&project, too_many).is_err());
        let huge = json!([{ "note": "n".repeat(MAX_BYTES) }]);
        assert!(store.save(&project, huge).is_err());
        assert!(store.save(&project, json!({"id": "nope"})).is_err());
        assert_eq!(store.load(&project).unwrap(), json!([{ "id": "kept" }]));
    }

    #[test]
    fn rejects_a_newer_schema() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("review-drafts.json");
        fs::write(
            &path,
            serde_json::to_vec(&json!({"schema_version": SCHEMA_VERSION + 1, "projects": {}}))
                .unwrap(),
        )
        .unwrap();
        assert!(ReviewDraftStore::open(path).is_err());
    }
}
