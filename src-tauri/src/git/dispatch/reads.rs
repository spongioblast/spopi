// ABOUTME: Handles git working-tree reads: status, file diffs, HEAD content, and the AI commit snapshot.
// ABOUTME: It never mutates the index or refs; writes.rs and remotes.rs do.

use super::{command_failed, DispatchResult, GitRequest};
use crate::git::is_git_unavailable;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};

pub(super) fn ai_commit_message(request: &GitRequest) -> DispatchResult {
    let snapshot =
        match request
            .service
            .prepare_ai_snapshot(request.owner, &request.root, request.generation)
        {
            Ok(snapshot) => snapshot,
            Err(error) if is_git_unavailable(&error) => {
                return Ok(json!({
                    "type": "git_ai_commit_message_failed",
                    "requestId": request.request_id,
                    "workspaceGeneration": request.generation,
                    "error": error,
                }));
            }
            Err(error) => return Err(command_failed(error)),
        };
    Ok(json!({
        "type": "git_ai_commit_message_started",
        "requestId": request.request_id,
        "workspaceGeneration": request.generation,
        "truncated": snapshot.staged_diff_truncated,
        "diff": snapshot.staged_diff,
        "snapshot": {
            "snapshotId": snapshot.snapshot_id,
            "headState": snapshot.head_state,
            "headOid": snapshot.head_oid,
            "indexTreeOid": snapshot.index_tree_oid,
        },
    }))
}

pub(super) fn status(request: &GitRequest) -> DispatchResult {
    match request
        .service
        .status(request.owner, &request.root, request.generation)
    {
        Ok(snapshot) => Ok(json!({
            "type": "git_status",
            "requestId": request.request_id,
            "workspaceGeneration": request.generation,
            "snapshot": snapshot,
        })),
        Err(error) if is_git_unavailable(&error) => Ok(json!({
            "type": "git_status",
            "requestId": request.request_id,
            "workspaceGeneration": request.generation,
            "gitUnavailable": true,
            "snapshot": Value::Null,
        })),
        Err(error) => Err(command_failed(error)),
    }
}

pub(super) fn diff(request: &GitRequest) -> DispatchResult {
    let frame = request.frame;
    let snapshot_id = frame
        .pointer("/command/snapshotId")
        .and_then(Value::as_str)
        .unwrap_or("");
    let group = frame
        .pointer("/command/group")
        .and_then(Value::as_str)
        .ok_or(("git_command_failed", "invalid diff group".into()))?;
    let path = frame
        .pointer("/command/pathBytesBase64")
        .and_then(Value::as_str)
        .and_then(|value| STANDARD.decode(value).ok())
        .ok_or(("git_command_failed", "invalid diff path".into()))?;
    let comparison = frame
        .pointer("/command/comparison")
        .and_then(Value::as_str)
        .ok_or(("git_command_failed", "invalid diff comparison".into()))?;
    let diff = request
        .service
        .diff(
            snapshot_id,
            request.owner,
            &request.root,
            request.generation,
            group,
            &path,
            comparison,
        )
        .map_err(command_failed)?;
    Ok(json!({
        "type": "git_diff",
        "requestId": request.request_id,
        "workspaceGeneration": request.generation,
        "diff": diff,
    }))
}

pub(super) fn file_at_head(request: &GitRequest) -> DispatchResult {
    let path = request
        .frame
        .pointer("/command/pathBytesBase64")
        .and_then(Value::as_str)
        .and_then(|value| STANDARD.decode(value).ok())
        .ok_or(("git_command_failed", "invalid file path".into()))?;
    let (content, exists, binary) = request
        .service
        .file_at_head(&request.root, &path)
        .map_err(command_failed)?;
    Ok(json!({
        "type": "git_file_at_head",
        "requestId": request.request_id,
        "content": content,
        "exists": exists,
        "binary": binary,
    }))
}
