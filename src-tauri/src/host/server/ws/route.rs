// ABOUTME: Routes a decoded Host frame to runtime, data, git, and host ops.
// ABOUTME: Composition only. Operation bodies live in ops/ and http/.

use super::super::ops;
use super::super::{
    annotate_live_sessions, host_data_error, messages_from_entries_response, HostState,
};
use super::runtime_request_timeout;
use crate::git::dispatch as git_dispatch;
use crate::host::router::{RoutedAction, PROTOCOL_VERSION};
use crate::pi::coordinator::RuntimeTarget;
use crate::platform::window_owner::OwnerId;
use serde_json::{json, Value};
use std::time::Duration;

/// The first snapshot of a fresh runtime waits for Pi to finish loading its
/// extensions; with a full package set that alone can pass ten seconds.
const SNAPSHOT_TIMEOUT: Duration = super::RUNTIME_REQUEST_TIMEOUT;

pub(crate) async fn dispatch(
    action: RoutedAction,
    state: &HostState,
) -> Result<Value, (&'static str, String)> {
    match action {
        RoutedAction::Runtime {
            client_id,
            request_id,
            frame,
        } => {
            if frame.get("type").and_then(Value::as_str) == Some("runtime_snapshot_request") {
                let session_id = frame
                    .get("sessionId")
                    .and_then(Value::as_str)
                    .ok_or(("invalid_session", "sessionId is required".into()))?;
                let mut target = state
                    .runtimes
                    .target_for_session_id(session_id)
                    .ok_or(("runtime_not_found", "Runtime session is not running".into()))?;
                let state_response = state
                    .runtimes
                    .request(
                        &target,
                        json!({ "type": "get_state" }),
                        None,
                        SNAPSHOT_TIMEOUT,
                    )
                    .await
                    .map_err(|message| ("snapshot_failed", message))?;
                if target.session_id.starts_with("temporary-") {
                    if let Some(formal_session_id) = state_response
                        .pointer("/data/sessionId")
                        .and_then(Value::as_str)
                        .filter(|session_id| !session_id.is_empty())
                    {
                        target = state
                            .runtimes
                            .bind_session_id(&target, formal_session_id)
                            .map_err(|message| ("session_binding_failed", message))?;
                    }
                }
                let entries_response = state
                    .runtimes
                    .request(
                        &target,
                        json!({ "type": "get_entries" }),
                        None,
                        SNAPSHOT_TIMEOUT,
                    )
                    .await
                    .map_err(|message| ("snapshot_failed", message))?;
                let messages = messages_from_entries_response(&entries_response);
                let host_snapshot = state
                    .runtimes
                    .snapshot(&target)
                    .map_err(|message| ("snapshot_failed", message))?;
                return Ok(json!({
                    "type": "runtime_snapshot",
                    "requestId": request_id,
                    "target": target,
                    "sequence": host_snapshot.sequence,
                    "state": {
                        "lifecycle": host_snapshot.state,
                        "pi": state_response.get("data").cloned().unwrap_or(Value::Null),
                        "messages": messages,
                    }
                }));
            }
            if frame.get("type").and_then(Value::as_str) == Some("runtime_capabilities_request") {
                return Ok(json!({
                    "type": "runtime_capabilities",
                    "requestId": request_id,
                    "protocolVersion": PROTOCOL_VERSION,
                    "nativeRpc": true,
                    "extensionUi": true,
                    "sessionTree": true,
                    "oauth": false,
                    "hostDataPlane": true,
                    "sourcePreservingFork": false,
                }));
            }
            if frame.get("type").and_then(Value::as_str) == Some("runtime_rebind_session_request") {
                let target: RuntimeTarget = serde_json::from_value(
                    frame
                        .get("target")
                        .cloned()
                        .ok_or(("invalid_target", "Runtime target is required".into()))?,
                )
                .map_err(|_| ("invalid_target", "Runtime target is invalid".into()))?;
                let new_session_id = frame
                    .get("newSessionId")
                    .and_then(Value::as_str)
                    .ok_or(("invalid_session_id", "newSessionId is required".into()))?;
                let rebound = state
                    .runtimes
                    .rebind_session_id(&target, new_session_id)
                    .map_err(|message| ("session_rebind_failed", message))?;
                return Ok(json!({
                    "type": "runtime_response",
                    "requestId": request_id,
                    "acceptance": "completed",
                    "response": { "success": true, "data": { "target": rebound } },
                }));
            }
            if frame.get("type").and_then(Value::as_str) != Some("runtime_request") {
                return Err((
                    "unsupported_runtime_request",
                    "Unsupported runtime request".into(),
                ));
            }
            let target: RuntimeTarget = serde_json::from_value(
                frame
                    .get("target")
                    .cloned()
                    .ok_or(("invalid_target", "Runtime target is required".into()))?,
            )
            .map_err(|_| ("invalid_target", "Runtime target is invalid".into()))?;
            let command = frame
                .get("command")
                .cloned()
                .ok_or(("invalid_command", "Runtime command is required".into()))?;
            if command.get("type").and_then(Value::as_str) == Some("extension_ui_response") {
                let request_key = command
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let by = state
                    .router
                    .lock()
                    .ok()
                    .and_then(|router| router.client_kind(&client_id))
                    .map(|kind| match kind {
                        crate::host::router::ClientKind::Remote { name, .. } => name,
                        crate::host::router::ClientKind::Desktop => "desktop".into(),
                    })
                    .unwrap_or_else(|| "desktop".into());
                if !state.phone.claim_answer(&request_key) {
                    state.phone.release_answer(&request_key);
                    let _ = state.fanout.send(json!({
                        "type": "extension_ui_resolved",
                        "id": request_key,
                        "by": by,
                    }));
                    return Ok(json!({
                        "type": "runtime_response",
                        "requestId": request_id,
                        "acceptance": "completed",
                        "response": { "success": false, "resolved": true },
                    }));
                }
                state
                    .runtimes
                    .respond_extension_ui(&target, command)
                    .await
                    .map_err(|message| ("dialog_response_failed", message))?;
                state.phone.release_answer(&request_key);
                let _ = state.fanout.send(json!({
                    "type": "extension_ui_resolved",
                    "id": request_key,
                    "by": by,
                }));
                return Ok(json!({
                    "type": "runtime_response",
                    "requestId": request_id,
                    "acceptance": "completed",
                    "response": { "success": true },
                }));
            }
            let idempotency_key = frame.get("idempotencyKey").and_then(Value::as_str);
            if let Ok(mut owners) = state.session_owners.lock() {
                owners.insert(target.clone(), client_id);
            }
            let response = state
                .runtimes
                .request(
                    &target,
                    command.clone(),
                    idempotency_key,
                    runtime_request_timeout(&command),
                )
                .await
                .map_err(|message| ("runtime_request_failed", message))?;
            Ok(json!({
                "type": "runtime_response",
                "requestId": request_id,
                "acceptance": "accepted",
                "response": response,
            }))
        }
        RoutedAction::Git {
            client_id,
            request_id,
            frame,
        } => {
            git_dispatch(
                &state.git_service,
                &state.data,
                &state.pi_launch,
                &state.git_events,
                &client_id,
                &request_id,
                &frame,
            )
            .await
        }
        RoutedAction::Terminal {
            client_id,
            request_id,
            frame,
        } => {
            let workspace_id = frame
                .get("workspaceId")
                .and_then(Value::as_str)
                .ok_or(("invalid_workspace", "workspaceId is required".into()))?;
            let workspace_root = state
                .data
                .workspace_root_path(workspace_id)
                .map_err(host_data_error)?;
            let payload = frame
                .get("payload")
                .ok_or(("invalid_terminal_command", "payload is required".into()))?;
            let owner = OwnerId::from_client_id(&client_id);
            let mut response = state
                .terminal_manager
                .dispatch(&owner, &workspace_root, payload)
                .map_err(|message| ("terminal_command_failed", message))?;
            if let Some(object) = response.as_object_mut() {
                object.insert("requestId".into(), Value::String(request_id));
            }
            Ok(response)
        }
        RoutedAction::Host {
            client_id,
            request_id,
            operation,
            frame,
            ..
        } => {
            ops::dispatch::dispatch_host_operation(
                state,
                &client_id,
                &request_id,
                &operation,
                &frame,
            )
            .await
        }
        RoutedAction::Data {
            request_id, frame, ..
        } => match frame.get("operation").and_then(Value::as_str) {
            Some("list_files") => {
                let workspace_id = owned_workspace_id(&frame)?;
                let relative_path = frame
                    .get("path")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                let show_hidden = frame
                    .get("showHidden")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                let data = state.data.clone();
                let entries = blocking_data(move || {
                    data.list_files(&workspace_id, &relative_path, show_hidden)
                })
                .await?;
                Ok(json!({
                    "type": "data_response",
                    "requestId": request_id,
                    "operation": "list_files",
                    "entries": entries,
                }))
            }
            Some("list_sessions") => {
                let workspace_id = owned_workspace_id(&frame)?;
                let data = state.data.clone();
                let sessions = blocking_data(move || data.list_sessions(&workspace_id)).await?;
                Ok(json!({
                    "type": "data_response",
                    "requestId": request_id,
                    "operation": "list_sessions",
                    "sessions": sessions,
                }))
            }
            Some("list_all_sessions") => {
                let workspace_id = owned_workspace_id(&frame)?;
                let data = state.data.clone();
                let sessions = blocking_data(move || data.list_all_sessions(&workspace_id)).await?;
                let mut sessions = serde_json::to_value(sessions)
                    .map_err(|error| ("serialization_failed", error.to_string()))?;
                if let Ok(statuses) = state.runtimes.statuses() {
                    annotate_live_sessions(&mut sessions, statuses);
                }
                Ok(json!({
                    "type": "data_response",
                    "requestId": request_id,
                    "operation": "list_all_sessions",
                    "sessions": sessions,
                }))
            }
            Some("list_launcher_sessions") => {
                let data = state.data.clone();
                let sessions = blocking_data(move || data.list_launcher_sessions()).await?;
                let mut sessions = serde_json::to_value(sessions)
                    .map_err(|error| ("serialization_failed", error.to_string()))?;
                if let Ok(statuses) = state.runtimes.statuses() {
                    annotate_live_sessions(&mut sessions, statuses);
                }
                Ok(json!({
                    "type": "data_response",
                    "requestId": request_id,
                    "operation": "list_launcher_sessions",
                    "sessions": sessions,
                }))
            }
            Some("search_sessions") => {
                let workspace_id = owned_workspace_id(&frame)?;
                let query = frame
                    .get("query")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let data = state.data.clone();
                let results =
                    blocking_data(move || data.search_sessions(&workspace_id, &query)).await?;
                Ok(json!({
                    "type": "data_response",
                    "requestId": request_id,
                    "operation": "search_sessions",
                    "results": results,
                }))
            }
            Some("cost_dashboard") => {
                let workspace_id = owned_workspace_id(&frame)?;
                let data = state.data.clone();
                let dashboard = blocking_data(move || data.cost_dashboard(&workspace_id)).await?;
                Ok(json!({
                    "type": "data_response",
                    "requestId": request_id,
                    "operation": "cost_dashboard",
                    "dashboard": dashboard,
                }))
            }
            Some("read_session_messages") => {
                let workspace_id = owned_workspace_id(&frame)?;
                let session_id = owned_session_id(&frame)?;
                let data = state.data.clone();
                let messages =
                    blocking_data(move || data.read_session_messages(&workspace_id, &session_id))
                        .await?;
                Ok(json!({
                    "type": "data_response",
                    "requestId": request_id,
                    "operation": "read_session_messages",
                    "messages": messages,
                }))
            }
            Some("workspace_info") => {
                let workspace_id = owned_workspace_id(&frame)?;
                let data = state.data.clone();
                let info = blocking_data(move || data.workspace_info(&workspace_id)).await?;
                Ok(json!({
                    "type": "data_response",
                    "requestId": request_id,
                    "operation": "workspace_info",
                    "info": info,
                }))
            }
            _ => Err((
                "unknown_data_operation",
                "Unsupported data operation".into(),
            )),
        },
        RoutedAction::Subscribe { request_id, .. } => Ok(json!({
            "type": "runtime_subscribed",
            "requestId": request_id,
        })),
    }
}

fn owned_workspace_id(frame: &Value) -> Result<String, (&'static str, String)> {
    frame
        .get("workspaceId")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or(("invalid_workspace", "workspaceId is required".into()))
}

fn owned_session_id(frame: &Value) -> Result<String, (&'static str, String)> {
    frame
        .get("sessionId")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or(("invalid_session", "sessionId is required".into()))
}

/// Disk scans stay off the async runtime. The caller maps host data errors.
async fn blocking_data<T>(
    work: impl FnOnce() -> Result<T, crate::data::HostDataError> + Send + 'static,
) -> Result<T, (&'static str, String)>
where
    T: Send + 'static,
{
    match tokio::task::spawn_blocking(work).await {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(error)) => Err(host_data_error(error)),
        Err(error) => Err(("data_task_failed", error.to_string())),
    }
}
