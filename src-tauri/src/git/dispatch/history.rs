// ABOUTME: Handles git history commands: the commit log, one commit's detail, and a file diff in a commit.
// ABOUTME: It validates history arguments at the protocol edge; git/history.rs runs the git calls.

use super::{command_failed, DispatchResult, GitRequest};
use crate::git::MAX_LOG_LIMIT;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};

/// History command arguments are validated at the protocol edge so the
/// service layer only ever sees clamped limits and decoded path bytes.
fn git_log_args(value: &Value) -> Result<(usize, Option<String>), String> {
    let limit = value
        .pointer("/command/limit")
        .and_then(Value::as_u64)
        .map(|limit| limit.clamp(1, MAX_LOG_LIMIT as u64) as usize)
        .unwrap_or(50);
    let before = value
        .pointer("/command/before")
        .and_then(Value::as_str)
        .map(str::to_owned);
    Ok((limit, before))
}

fn git_log_detail_args(value: &Value) -> Result<String, String> {
    value
        .pointer("/command/oid")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| "invalid oid".into())
}

fn git_commit_diff_args(value: &Value) -> Result<(String, Vec<u8>), String> {
    let oid = value
        .pointer("/command/commitOid")
        .and_then(Value::as_str)
        .ok_or_else(|| "invalid commitOid".to_string())?;
    let path = value
        .pointer("/command/pathBytesBase64")
        .and_then(Value::as_str)
        .and_then(|encoded| STANDARD.decode(encoded).ok())
        .ok_or_else(|| "invalid diff path".to_string())?;
    Ok((oid.to_owned(), path))
}

pub(super) fn log(request: &GitRequest) -> DispatchResult {
    let (limit, before) = git_log_args(request.frame).map_err(command_failed)?;
    let log = request
        .service
        .log(
            request.owner,
            &request.root,
            request.generation,
            limit,
            before.as_deref(),
        )
        .map_err(command_failed)?;
    Ok(json!({
        "type": "git_log",
        "requestId": request.request_id,
        "workspaceGeneration": request.generation,
        "commits": log.commits,
        "hasMore": log.has_more,
    }))
}

pub(super) fn log_detail(request: &GitRequest) -> DispatchResult {
    let oid = git_log_detail_args(request.frame).map_err(command_failed)?;
    let detail = request
        .service
        .log_detail(request.owner, &request.root, request.generation, &oid)
        .map_err(command_failed)?;
    Ok(json!({
        "type": "git_log_detail",
        "requestId": request.request_id,
        "workspaceGeneration": request.generation,
        "commit": detail,
    }))
}

pub(super) fn commit_diff(request: &GitRequest) -> DispatchResult {
    let (oid, path) = git_commit_diff_args(request.frame).map_err(command_failed)?;
    let diff = request
        .service
        .commit_diff(
            request.owner,
            &request.root,
            request.generation,
            &oid,
            &path,
        )
        .map_err(command_failed)?;
    Ok(json!({
        "type": "git_commit_diff",
        "requestId": request.request_id,
        "workspaceGeneration": request.generation,
        "diff": diff,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn git_log_args_host_clamps_limit() {
        assert_eq!(
            git_log_args(&json!({ "command": { "type": "log", "limit": 100, "before": "abc" } })),
            Ok((100, Some("abc".into())))
        );
        assert_eq!(
            git_log_args(&json!({ "command": { "type": "log", "limit": 0 } })),
            Ok((1, None))
        );
        assert_eq!(
            git_log_args(&json!({ "command": { "type": "log", "limit": 999 } })),
            Ok((200, None))
        );
        assert_eq!(
            git_log_args(&json!({ "command": { "type": "log" } })),
            Ok((50, None))
        );
    }

    #[test]
    fn git_log_detail_args_requires_oid() {
        assert_eq!(
            git_log_detail_args(&json!({ "command": { "oid": "aabb" } })),
            Ok("aabb".into())
        );
        assert_eq!(
            git_log_detail_args(&json!({ "command": {} })),
            Err("invalid oid".into())
        );
    }

    #[test]
    fn git_commit_diff_args_decodes_path() {
        let encoded = STANDARD.encode(b"a.txt");
        let value = json!({ "command": { "commitOid": "abcd", "pathBytesBase64": encoded } });
        assert_eq!(
            git_commit_diff_args(&value).unwrap(),
            ("abcd".into(), b"a.txt".to_vec())
        );
        assert!(git_commit_diff_args(&json!({ "command": { "commitOid": "abcd" } })).is_err());
    }
}
