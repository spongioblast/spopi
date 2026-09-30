// ABOUTME: One JSON object reader and one atomic pretty writer.
// ABOUTME: Callers keep their own locks; this module only moves bytes.

use serde_json::{Map, Value};
use std::fs;
use std::io::Write;
use std::path::Path;

pub(crate) fn read_object(path: &Path) -> Result<Map<String, Value>, String> {
    if !path.exists() {
        return Ok(Map::new());
    }
    let bytes =
        fs::read(path).map_err(|error| format!("Cannot read JSON {}: {error}", path.display()))?;
    serde_json::from_slice::<Value>(&bytes)
        .map_err(|error| format!("Invalid JSON {}: {error}", path.display()))?
        .as_object()
        .cloned()
        .ok_or_else(|| format!("JSON must be an object: {}", path.display()))
}

pub(crate) fn write_pretty_atomic(path: &Path, value: &Value) -> Result<(), String> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(|| format!("JSON path has no parent: {}", path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Cannot create JSON directory {}: {error}", parent.display()))?;
    let temporary = parent.join(format!(".spopi-json-{}.tmp", uuid::Uuid::new_v4().simple()));
    let encoded =
        serde_json::to_vec_pretty(value).map_err(|error| format!("Cannot encode JSON: {error}"))?;
    let write_result = (|| {
        let mut file = fs::File::create(&temporary)
            .map_err(|error| format!("Cannot create temporary JSON file: {error}"))?;
        file.write_all(&encoded)
            .map_err(|error| format!("Cannot write temporary JSON file: {error}"))?;
        file.write_all(b"\n")
            .map_err(|error| format!("Cannot finish temporary JSON file: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("Cannot sync temporary JSON file: {error}"))?;
        fs::rename(&temporary, path)
            .map_err(|error| format!("Cannot atomically replace JSON {}: {error}", path.display()))
    })();
    if write_result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    write_result
}

#[cfg(test)]
mod tests {
    use super::{read_object, write_pretty_atomic};
    use serde_json::json;
    use std::fs;

    #[test]
    fn missing_file_is_an_empty_object_and_writes_round_trip() {
        let root = std::env::temp_dir().join(format!(
            "spopi-atomic-json-{}",
            uuid::Uuid::new_v4().simple()
        ));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("settings.json");
        assert!(read_object(&path).unwrap().is_empty());
        write_pretty_atomic(&path, &json!({ "thinkingLevel": "high" })).unwrap();
        assert_eq!(
            read_object(&path).unwrap().get("thinkingLevel").unwrap(),
            &json!("high")
        );
        let _ = fs::remove_dir_all(root);
    }
}
