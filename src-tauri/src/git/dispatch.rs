// ABOUTME: Dispatches git WebSocket commands to GitService.
// ABOUTME: It validates protocol arguments and does not own the git process.

use super::*;
use crate::data::HostDataPlane;
use crate::pi::launch::PiLaunchResolver;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use tokio::sync::broadcast;

/// History command arguments are validated at the protocol edge so the
/// service layer only ever sees clamped limits and decoded path bytes.
fn git_log_args(value: &Value) -> Result<(usize, Option<String>), String> {
    let limit = value
        .pointer("/command/limit")
        .and_then(Value::as_u64)
        .map(|limit| limit.clamp(1, super::MAX_LOG_LIMIT as u64) as usize)
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

pub(crate) async fn dispatch(
    service: &GitService,
    data: &HostDataPlane,
    _launch: &PiLaunchResolver,
    events: &broadcast::Sender<(String, Value)>,
    client_id: &str,
    request_id: &str,
    frame: &Value,
) -> Result<Value, (&'static str, String)> {
    let workspace_id = frame
        .get("workspaceId")
        .and_then(Value::as_str)
        .ok_or(("invalid_workspace", "workspaceId is required".into()))?;
    let root = data.workspace_root_path(workspace_id).map_err(|error| {
        (
            "workspace_not_found",
            format!("Cannot resolve workspace: {error:?}"),
        )
    })?;
    let generation = 0;
    let owner = client_id;
    let fail = |code: &'static str, message: String| Err((code, message));

    if frame.get("type").and_then(Value::as_str) == Some("git_ai_commit_message") {
        let snapshot = match service.prepare_ai_snapshot(owner, &root, generation) {
            Ok(snapshot) => snapshot,
            Err(error) if is_git_unavailable(&error) => {
                return Ok(json!({
                    "type": "git_ai_commit_message_failed",
                    "requestId": request_id,
                    "workspaceGeneration": generation,
                    "error": error,
                }));
            }
            Err(error) => return fail("git_command_failed", error),
        };
        return Ok(json!({
            "type": "git_ai_commit_message_started",
            "requestId": request_id,
            "workspaceGeneration": generation,
            "truncated": snapshot.staged_diff_truncated,
            "diff": snapshot.staged_diff,
            "snapshot": {
                "snapshotId": snapshot.snapshot_id,
                "headState": snapshot.head_state,
                "headOid": snapshot.head_oid,
                "indexTreeOid": snapshot.index_tree_oid,
            },
        }));
    }

    let command = frame
        .pointer("/command/type")
        .and_then(Value::as_str)
        .unwrap_or("status");
    match command {
        "status" => match service.status(owner, &root, generation) {
            Ok(snapshot) => Ok(json!({
                "type": "git_status",
                "requestId": request_id,
                "workspaceGeneration": generation,
                "snapshot": snapshot,
            })),
            Err(error) if is_git_unavailable(&error) => Ok(json!({
                "type": "git_status",
                "requestId": request_id,
                "workspaceGeneration": generation,
                "gitUnavailable": true,
                "snapshot": Value::Null,
            })),
            Err(error) => fail("git_command_failed", error),
        },
        "diff" => {
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
            let diff = service
                .diff(
                    snapshot_id,
                    owner,
                    &root,
                    generation,
                    group,
                    &path,
                    comparison,
                )
                .map_err(|error| ("git_command_failed", error))?;
            Ok(json!({
                "type": "git_diff",
                "requestId": request_id,
                "workspaceGeneration": generation,
                "diff": diff,
            }))
        }
        "file_at_head" => {
            let path = frame
                .pointer("/command/pathBytesBase64")
                .and_then(Value::as_str)
                .and_then(|value| STANDARD.decode(value).ok())
                .ok_or(("git_command_failed", "invalid file path".into()))?;
            let (content, exists, binary) = service
                .file_at_head(&root, &path)
                .map_err(|error| ("git_command_failed", error))?;
            Ok(json!({
                "type": "git_file_at_head",
                "requestId": request_id,
                "content": content,
                "exists": exists,
                "binary": binary,
            }))
        }
        "log" => {
            let (limit, before) =
                git_log_args(frame).map_err(|error| ("git_command_failed", error))?;
            let log = service
                .log(owner, &root, generation, limit, before.as_deref())
                .map_err(|error| ("git_command_failed", error))?;
            Ok(json!({
                "type": "git_log",
                "requestId": request_id,
                "workspaceGeneration": generation,
                "commits": log.commits,
                "hasMore": log.has_more,
            }))
        }
        "log_detail" => {
            let oid = git_log_detail_args(frame).map_err(|error| ("git_command_failed", error))?;
            let detail = service
                .log_detail(owner, &root, generation, &oid)
                .map_err(|error| ("git_command_failed", error))?;
            Ok(json!({
                "type": "git_log_detail",
                "requestId": request_id,
                "workspaceGeneration": generation,
                "commit": detail,
            }))
        }
        "commit_diff" => {
            let (oid, path) =
                git_commit_diff_args(frame).map_err(|error| ("git_command_failed", error))?;
            let diff = service
                .commit_diff(owner, &root, generation, &oid, &path)
                .map_err(|error| ("git_command_failed", error))?;
            Ok(json!({
                "type": "git_commit_diff",
                "requestId": request_id,
                "workspaceGeneration": generation,
                "diff": diff,
            }))
        }
        "stage" | "unstage" | "discard" => {
            let snapshot_id = frame
                .pointer("/command/snapshotId")
                .and_then(Value::as_str)
                .unwrap_or("");
            let items = frame
                .pointer("/command/entries")
                .and_then(Value::as_array)
                .ok_or(("git_command_failed", "invalid path batch".into()))?;
            if items.is_empty() || items.len() > MAX_STATUS_ENTRIES {
                return fail("git_command_failed", "invalid path batch".into());
            }
            let paths = items
                .iter()
                .map(|item| {
                    let group = item
                        .get("group")
                        .and_then(Value::as_str)
                        .filter(|value| {
                            matches!(*value, "staged" | "changes" | "untracked" | "conflicted")
                        })
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
                })
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| ("git_command_failed", error.to_owned()))?;
            service
                .write(snapshot_id, owner, &root, generation, &paths, command)
                .map_err(|error| ("git_command_failed", error))?;
            Ok(json!({
                "type": "git_command_ack",
                "requestId": request_id,
                "workspaceGeneration": generation,
            }))
        }
        "push" => {
            // Push crosses the network, so it runs on a blocking worker and
            // reports through an event instead of holding the dispatch future
            // open for as long as the remote takes to answer.
            let service = service.clone();
            let events = events.clone();
            let owner = owner.to_owned();
            let event_request_id = request_id.to_owned();
            tokio::task::spawn_blocking(move || {
                let frame = match service.push(&root) {
                    Ok(outcome) => json!({
                        "type": "git_push_result",
                        "requestId": event_request_id,
                        "workspaceGeneration": generation,
                        "status": "succeeded",
                        "remote": outcome.remote,
                        "branch": outcome.branch,
                        "setUpstream": outcome.set_upstream,
                        "output": outcome.output,
                    }),
                    Err(error) => json!({
                        "type": "git_push_result",
                        "requestId": event_request_id,
                        "workspaceGeneration": generation,
                        "status": "failed",
                        "error": error,
                    }),
                };
                let _ = events.send((owner, frame));
            });
            Ok(json!({
                "type": "git_push_started",
                "requestId": request_id,
                "workspaceGeneration": generation,
            }))
        }
        "commit" => {
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
            match service.prepare_commit(
                snapshot_id,
                owner,
                &root,
                generation,
                message,
                token,
                amend,
            ) {
                Ok(()) => {
                    let event_owner = owner.to_owned();
                    let event_request = request_id.to_owned();
                    let events = events.clone();
                    let notify: Box<dyn FnOnce(String) + Send> = Box::new(move |frame| {
                        if let Ok(value) = serde_json::from_str::<Value>(&frame) {
                            let _ = events.send((event_owner, value));
                        }
                    });
                    service.commit_detached(
                        snapshot_id.to_owned(),
                        owner.to_owned(),
                        root,
                        generation,
                        event_request,
                        message.to_owned(),
                        Some(notify),
                    );
                    Ok(json!({
                        "type": "git_commit_started",
                        "requestId": request_id,
                        "workspaceGeneration": generation,
                    }))
                }
                Err(error) if error.starts_with("confirmationRequired:") => Ok(json!({
                    "type": "git_commit_confirmation_required",
                    "requestId": request_id,
                    "workspaceGeneration": generation,
                    "snapshotId": snapshot_id,
                    "confirmationToken": error.trim_start_matches("confirmationRequired:"),
                })),
                Err(error) => fail("git_command_failed", error),
            }
        }
        "fetch" => {
            service
                .fetch(&root)
                .map_err(|error| ("git_command_failed", error))?;
            Ok(json!({
                "type": "git_command_ack",
                "requestId": request_id,
                "workspaceGeneration": generation,
            }))
        }
        "pull" => {
            service
                .pull(&root)
                .map_err(|error| ("git_command_failed", error))?;
            Ok(json!({
                "type": "git_command_ack",
                "requestId": request_id,
                "workspaceGeneration": generation,
            }))
        }
        "branches" => {
            let branches = service
                .branches(&root)
                .map_err(|error| ("git_command_failed", error))?;
            Ok(json!({
                "type": "git_branches",
                "requestId": request_id,
                "workspaceGeneration": generation,
                "branches": branches,
            }))
        }
        "init" => {
            service
                .init_repository(&root)
                .map_err(|error| ("git_command_failed", error))?;
            Ok(json!({
                "type": "git_command_ack",
                "requestId": request_id,
                "workspaceGeneration": generation,
            }))
        }
        "checkout" => {
            let name = frame
                .pointer("/command/name")
                .and_then(Value::as_str)
                .unwrap_or("");
            let create = frame
                .pointer("/command/create")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            service
                .checkout(&root, name, create)
                .map_err(|error| ("git_command_failed", error))?;
            Ok(json!({
                "type": "git_command_ack",
                "requestId": request_id,
                "workspaceGeneration": generation,
            }))
        }
        _ => fail("git_command_failed", "unsupported Git command".into()),
    }
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
