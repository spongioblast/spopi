// ABOUTME: Handles git index and commit writes: stage, unstage, discard, and commit.
// ABOUTME: It decodes the path batch and confirmation flow; GitService holds the write slot.

use super::{command_failed, DispatchResult, GitRequest};
use crate::git::{GitPathIdentity, MAX_STATUS_ENTRIES};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};

pub(super) fn write_paths(request: &GitRequest, operation: &str) -> DispatchResult {
    let frame = request.frame;
    let snapshot_id = frame
        .pointer("/command/snapshotId")
        .and_then(Value::as_str)
        .unwrap_or("");
    let items = frame
        .pointer("/command/entries")
        .and_then(Value::as_array)
        .ok_or(("git_command_failed", "invalid path batch".into()))?;
    if items.is_empty() || items.len() > MAX_STATUS_ENTRIES {
        return Err(command_failed("invalid path batch".into()));
    }
    let paths = items
        .iter()
        .map(path_identity)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| ("git_command_failed", error.to_owned()))?;
    request
        .service
        .write(
            snapshot_id,
            request.owner,
            &request.root,
            request.generation,
            &paths,
            operation,
        )
        .map_err(command_failed)?;
    Ok(request.ack())
}

fn path_identity(item: &Value) -> Result<GitPathIdentity, &'static str> {
    let group = item
        .get("group")
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "staged" | "changes" | "untracked" | "conflicted"))
        .ok_or("invalid entry group")?
        .to_owned();
    let path_bytes = item
        .get("pathBytesBase64")
        .and_then(Value::as_str)
        .and_then(|value| STANDARD.decode(value).ok())
        .filter(|value| !value.is_empty())
        .ok_or("invalid entry path")?;
    let original_path_bytes = match item.get("originalPathBytesBase64") {
        Some(Value::String(value)) => Some(
            STANDARD
                .decode(value)
                .ok()
                .filter(|path| !path.is_empty())
                .ok_or("invalid original path")?,
        ),
        Some(Value::Null) | None => None,
        _ => return Err("invalid original path"),
    };
    Ok(GitPathIdentity {
        group,
        path_bytes,
        original_path_bytes,
    })
}

pub(super) fn commit(request: GitRequest) -> DispatchResult {
    let frame = request.frame;
    let snapshot_id = frame
        .pointer("/command/snapshotId")
        .and_then(Value::as_str)
        .unwrap_or("");
    let message = frame
        .pointer("/command/message")
        .and_then(Value::as_str)
        .unwrap_or("");
    let token = frame
        .pointer("/command/confirmationToken")
        .and_then(Value::as_str);
    let amend = frame
        .pointer("/command/amend")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    match request.service.prepare_commit(
        snapshot_id,
        request.owner,
        &request.root,
        request.generation,
        message,
        token,
        amend,
    ) {
        Ok(()) => {
            let event_owner = request.owner.to_owned();
            let events = request.events.clone();
            let notify: Box<dyn FnOnce(String) + Send> = Box::new(move |frame| {
                if let Ok(value) = serde_json::from_str::<Value>(&frame) {
                    let _ = events.send((event_owner, value));
                }
            });
            request.service.commit_detached(
                snapshot_id.to_owned(),
                request.owner.to_owned(),
                request.root,
                request.generation,
                request.request_id.to_owned(),
                message.to_owned(),
                Some(notify),
            );
            Ok(json!({
                "type": "git_commit_started",
                "requestId": request.request_id,
                "workspaceGeneration": request.generation,
            }))
        }
        Err(error) if error.starts_with("confirmationRequired:") => Ok(json!({
            "type": "git_commit_confirmation_required",
            "requestId": request.request_id,
            "workspaceGeneration": request.generation,
            "snapshotId": snapshot_id,
            "confirmationToken": error.trim_start_matches("confirmationRequired:"),
        })),
        Err(error) => Err(command_failed(error)),
    }
}
