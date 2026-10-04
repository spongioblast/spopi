// ABOUTME: Adds live status to session lists and rebuilds branch messages from Pi entries.
// ABOUTME: Shared by the HTTP and WebSocket routes; it reads Pi responses and never calls Pi.

use crate::pi::coordinator::RuntimeStatus;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

pub(super) fn annotate_live_sessions(sessions: &mut Value, statuses: Vec<RuntimeStatus>) {
    let Some(items) = sessions.as_array_mut() else {
        return;
    };
    for session in items {
        let Some(session_id) = session.get("id").and_then(Value::as_str) else {
            continue;
        };
        let Some(status) = statuses
            .iter()
            .find(|status| status.target.session_id == session_id)
        else {
            continue;
        };
        session["target"] = json!(status.target);
        session["status"] = json!(status.state);
    }
}

pub(super) fn messages_from_entries_response(response: &Value) -> Value {
    let Some(entries) = response.pointer("/data/entries").and_then(Value::as_array) else {
        return json!([]);
    };
    let leaf_id = response.pointer("/data/leafId").and_then(Value::as_str);
    let mut id_to_index = HashMap::new();
    for (index, entry) in entries.iter().enumerate() {
        if let Some(id) = entry.get("id").and_then(Value::as_str) {
            id_to_index.insert(id, index);
        }
    }

    let mut branch = Vec::new();
    let mut current = leaf_id.and_then(|id| id_to_index.get(id).copied());
    let mut visited = HashSet::new();
    while let Some(index) = current {
        if !visited.insert(index) {
            break;
        }
        let entry = &entries[index];
        if entry.get("type").and_then(Value::as_str) == Some("message") {
            if let Some(message) = entry.get("message") {
                branch.push(message_with_entry_id(
                    message.clone(),
                    entry.get("id").and_then(Value::as_str),
                ));
            }
        }
        current = entry
            .get("parentId")
            .and_then(Value::as_str)
            .and_then(|parent_id| id_to_index.get(parent_id).copied());
    }

    branch.reverse();
    Value::Array(branch)
}

fn message_with_entry_id(mut message: Value, entry_id: Option<&str>) -> Value {
    let role = message.get("role").and_then(Value::as_str);
    if role != Some("user") && role != Some("assistant") {
        return message;
    }
    let Some(entry_id) = entry_id else {
        return message;
    };
    if let Some(object) = message.as_object_mut() {
        object.insert("entryId".to_owned(), Value::String(entry_id.to_owned()));
    }
    message
}
