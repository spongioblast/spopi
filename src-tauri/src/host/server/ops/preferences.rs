// ABOUTME: Host operations that get, set, remove, and list `ui.*` display preferences.
// ABOUTME: Storage is MetadataStore; keys outside `ui.` are rejected here.

use super::super::{HostState, OpError};
use serde_json::Value;

fn preference_key(frame: &Value) -> Result<String, OpError> {
    let key = frame
        .get("key")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or(("invalid_preference", "key is required".into()))?;
    if !key.starts_with("ui.") {
        return Err(OpError::new(
            "invalid_preference",
            "Only ui.* preference keys are supported",
        ));
    }
    Ok(key.to_owned())
}

pub(super) fn dispatch(
    state: &HostState,
    request_id: &str,
    operation: &str,
    frame: &Value,
) -> Result<Value, OpError> {
    let store = state.metadata.as_ref().ok_or((
        "host_operation_failed",
        "Preference store is not available".into(),
    ))?;
    let response = |operation: &str, fields: &[(&str, Value)]| {
        let mut object = serde_json::Map::new();
        object.insert("type".into(), Value::from("host_response"));
        object.insert("requestId".into(), Value::from(request_id));
        object.insert("operation".into(), Value::from(operation));
        for (name, value) in fields {
            object.insert((*name).into(), value.clone());
        }
        Value::Object(object)
    };
    if operation == "list_preferences" {
        let prefix = frame
            .get("prefix")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or(("invalid_preference", "prefix is required".into()))?;
        if !prefix.starts_with("ui.") {
            return Err(OpError::new(
                "invalid_preference",
                "Only ui.* preference keys are supported",
            ));
        }
        let rows = store
            .lock()
            .map_err(|_| {
                (
                    "host_operation_failed",
                    "Preference store is poisoned".into(),
                )
            })?
            .preference_list(prefix)
            .map_err(|message| ("host_operation_failed", message))?;
        let mut entries = serde_json::Map::new();
        for (key, value) in rows {
            entries.insert(key, value);
        }
        return Ok(response(operation, &[("entries", Value::Object(entries))]));
    }
    let key = preference_key(frame)?;
    match operation {
        "get_preference" => {
            let value = store
                .lock()
                .map_err(|_| {
                    (
                        "host_operation_failed",
                        "Preference store is poisoned".into(),
                    )
                })?
                .preference_get(&key)
                .map_err(|message| ("host_operation_failed", message))?;
            Ok(response(
                operation,
                &[
                    ("key", Value::from(key)),
                    ("value", value.unwrap_or(Value::Null)),
                ],
            ))
        }
        "set_preference" => {
            let value = frame
                .get("value")
                .cloned()
                .filter(|value| !value.is_null())
                .ok_or(("invalid_preference", "value is required".into()))?;
            store
                .lock()
                .map_err(|_| {
                    (
                        "host_operation_failed",
                        "Preference store is poisoned".into(),
                    )
                })?
                .preference_set(&key, &value)
                .map_err(|message| ("host_operation_failed", message))?;
            Ok(response(
                operation,
                &[("key", Value::from(key)), ("value", value)],
            ))
        }
        "remove_preference" => {
            let removed = store
                .lock()
                .map_err(|_| {
                    (
                        "host_operation_failed",
                        "Preference store is poisoned".into(),
                    )
                })?
                .preference_remove(&key)
                .map_err(|message| ("host_operation_failed", message))?;
            Ok(response(
                operation,
                &[("key", Value::from(key)), ("removed", Value::from(removed))],
            ))
        }
        _ => unreachable!("preferences::dispatch called with unknown operation"),
    }
}
