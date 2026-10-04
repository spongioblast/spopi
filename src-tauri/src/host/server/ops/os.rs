// ABOUTME: Opens paths and URLs with the desktop, and lists this machine's addresses.
// ABOUTME: The operation names stay in dispatch.rs so the host-op check can see them.

use super::super::{host_data_error, HostState, OpError};
use crate::platform::open::{open_external, open_path, reveal_path};
use serde_json::{json, Value};

pub(crate) async fn dispatch(
    state: &HostState,
    request_id: &str,
    operation: &str,
    frame: &Value,
) -> Result<Value, OpError> {
    match operation {
        "list_local_addresses" => Ok(json!({
            "type": "host_response",
            "requestId": request_id,
            "operation": "list_local_addresses",
            "addresses": crate::host::phone::addresses::local_addresses(),
        })),
        "open_path" => {
            let path = frame
                .get("path")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .ok_or(("invalid_path", "path is required".into()))?;
            let workspace_id = frame.get("workspaceId").and_then(Value::as_str);
            let path = state
                .data
                .resolve_open_path(workspace_id, &path)
                .map_err(host_data_error)?
                .to_string_lossy()
                .into_owned();
            tokio::task::spawn_blocking(move || open_path(&path))
                .await
                .map_err(|error| ("host_operation_failed", error.to_string()))?
                .map_err(|message| ("open_path_failed", message))?;
            Ok(json!({
                "type": "host_response",
                "requestId": request_id,
                "operation": "open_path",
                "ok": true,
            }))
        }
        "reveal_path" => {
            let path = frame
                .get("path")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .ok_or(("invalid_path", "path is required".into()))?;
            let workspace_id = frame.get("workspaceId").and_then(Value::as_str);
            let path = state
                .data
                .resolve_open_path(workspace_id, &path)
                .map_err(host_data_error)?
                .to_string_lossy()
                .into_owned();
            tokio::task::spawn_blocking(move || reveal_path(&path))
                .await
                .map_err(|error| ("host_operation_failed", error.to_string()))?
                .map_err(|message| ("reveal_path_failed", message))?;
            Ok(json!({
                "type": "host_response",
                "requestId": request_id,
                "operation": "reveal_path",
                "ok": true,
            }))
        }
        "open_external" => {
            let url = frame
                .get("url")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .ok_or(("invalid_url", "url is required".into()))?;
            tokio::task::spawn_blocking(move || open_external(&url))
                .await
                .map_err(|error| ("host_operation_failed", error.to_string()))?
                .map_err(|message| ("open_external_failed", message))?;
            Ok(json!({
                "type": "host_response",
                "requestId": request_id,
                "operation": "open_external",
                "ok": true,
            }))
        }
        "shadow_history_files" => {
            let workspace_id = frame
                .get("workspaceId")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let session_id = frame
                .get("sessionId")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let workspace = state
                .data
                .workspace_root_path(&workspace_id)
                .map_err(host_data_error)?;
            let scope = frame
                .get("scope")
                .and_then(Value::as_str)
                .unwrap_or("turn")
                .to_string();
            let record = tokio::task::spawn_blocking(move || {
                if scope == "turn" {
                    crate::data::shadow_history::shadow_history_files(&workspace, &session_id)
                } else {
                    crate::data::shadow_history::shadow_history_files_scoped(
                        &workspace,
                        &session_id,
                        &scope,
                    )
                }
            })
            .await
            .map_err(|error| ("host_operation_failed", error.to_string()))?
            .map_err(|message| ("shadow_history_format", message))?;
            Ok(json!({
                "type": "host_response",
                "requestId": request_id,
                "operation": "shadow_history_files",
                "empty": record.empty,
                "hasHead": record.has_head,
                "meta": record.meta,
                "files": record.files,
                "turn": record.turn,
            }))
        }
        "shadow_history_file_pair" => {
            let workspace_id = frame
                .get("workspaceId")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let session_id = frame
                .get("sessionId")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let path = frame
                .get("path")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let scope = frame
                .get("scope")
                .and_then(Value::as_str)
                .unwrap_or("turn")
                .to_string();
            let workspace = state
                .data
                .workspace_root_path(&workspace_id)
                .map_err(host_data_error)?;
            let pair = tokio::task::spawn_blocking(move || {
                crate::data::shadow_history::shadow_history_file_pair(
                    &workspace,
                    &session_id,
                    &path,
                    &scope,
                )
            })
            .await
            .map_err(|error| ("host_operation_failed", error.to_string()))?
            .map_err(|message| ("shadow_history_format", message))?;
            Ok(json!({
                "type": "host_response",
                "requestId": request_id,
                "operation": "shadow_history_file_pair",
                "before": pair.before,
                "after": pair.after,
                "beforeExists": pair.before_exists,
                "afterExists": pair.after_exists,
                "binary": pair.binary,
                "tooLarge": pair.too_large,
            }))
        }
        _ => Err(OpError::new(
            "host_operation_unimplemented",
            "Host operation is not implemented on protocol v2",
        )),
    }
}
