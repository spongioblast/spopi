// ABOUTME: Resolves workspaces, hides a missing folder, and restarts a live runtime.
// ABOUTME: forget_workspace records a preference. It does not delete Pi session files.

use super::super::http::files;
use super::super::{host_data_error, HostState, OpError};
use crate::pi::coordinator::RuntimeTarget;
use serde_json::{json, Value};

/// `register` is false for a client that may only open folders SPOPI already knows.
pub(crate) fn resolve_workspace(
    state: &HostState,
    request_id: &str,
    frame: &Value,
    register: bool,
) -> Result<Value, OpError> {
    let project_path = frame
        .get("projectPath")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or(("invalid_project_path", "projectPath is required".into()))?;
    let workspace_id = files::resolve_workspace_path(state, project_path, register)
        .map_err(|code| (code, code.replace('_', " ")))?;
    Ok(json!({
        "type": "host_response",
        "requestId": request_id,
        "operation": "resolve_workspace",
        "workspaceId": workspace_id,
    }))
}

pub(crate) async fn dispatch(
    state: &HostState,
    request_id: &str,
    operation: &str,
    frame: &Value,
) -> Result<Value, OpError> {
    match operation {
        "forget_workspace" => {
            let workspace_id = frame
                .get("workspaceId")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .to_owned();
            let project_path = frame
                .get("projectPath")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .to_owned();
            if workspace_id.is_empty() && project_path.is_empty() {
                return Err(OpError::new("invalid_workspace", "workspaceId is required"));
            }
            let metadata = state.metadata.clone().ok_or((
                "host_operation_failed",
                "Preference store is not available".into(),
            ))?;
            let hidden = tokio::task::spawn_blocking(move || {
                let mut store = metadata
                    .lock()
                    .map_err(|_| "Preference store is busy".to_owned())?;
                store.remember_hidden_workspace(&workspace_id, &project_path)
            })
            .await
            .map_err(|error| ("host_operation_failed", error.to_string()))?
            .map_err(|message| ("forget_workspace_failed", message))?;
            Ok(json!({
                "type": "host_response",
                "requestId": request_id,
                "operation": "forget_workspace",
                "hidden": hidden,
            }))
        }
        "delete_sessions" => {
            let session_ids: Vec<String> = frame
                .get("sessionIds")
                .and_then(Value::as_array)
                .map(|values| {
                    values
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_owned)
                        .collect()
                })
                .unwrap_or_default();
            let data = state.data.clone();
            let result = tokio::task::spawn_blocking(move || data.delete_sessions(&session_ids))
                .await
                .map_err(|error| ("host_operation_failed", error.to_string()))?
                .map_err(host_data_error)?;
            Ok(json!({
                "type": "host_response",
                "requestId": request_id,
                "operation": "delete_sessions",
                "deleted": result.deleted,
                "errors": result.errors,
            }))
        }
        "session_ui_profile_load" => {
            // Look up the persisted provider/modelId/thinkingLevel for a
            // session. The frontend identifies the session by its runtime
            // sessionId (stable for the lifetime of the underlying file);
            // we accept any non-empty string as a key — the store trims and
            // bounds-checks internally.
            let expected = frame
                .get("expectedSessionId")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or(("invalid_session", "expectedSessionId is required".into()))?
                .to_owned();
            let profiles = state.session_ui_profiles.clone();
            let profile = tokio::task::spawn_blocking(move || profiles.load(&expected))
                .await
                .map_err(|error| ("host_operation_failed", error.to_string()))?
                .map_err(|message| ("session_ui_profile_load_failed", message))?;
            Ok(json!({
                "type": "host_response",
                "requestId": request_id,
                "operation": "session_ui_profile_load",
                "profile": profile,
            }))
        }
        "session_ui_profile_save" => {
            let expected = frame
                .get("expectedSessionId")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or(("invalid_session", "expectedSessionId is required".into()))?
                .to_owned();
            let provider = frame
                .get("provider")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or(("invalid_provider", "provider is required".into()))?
                .to_owned();
            let model_id = frame
                .get("modelId")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or(("invalid_model", "modelId is required".into()))?
                .to_owned();
            let thinking_level = frame
                .get("thinkingLevel")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .unwrap_or_else(|| "off".to_string());
            let profiles = state.session_ui_profiles.clone();
            let saved = tokio::task::spawn_blocking(move || {
                profiles.save(&expected, &provider, &model_id, &thinking_level)
            })
            .await
            .map_err(|error| ("host_operation_failed", error.to_string()))?
            .map_err(|message| ("session_ui_profile_save_failed", message))?;
            Ok(json!({
                "type": "host_response",
                "requestId": request_id,
                "operation": "session_ui_profile_save",
                "profile": saved,
            }))
        }
        "restart_runtime" => {
            let workspace_id = frame
                .get("workspaceId")
                .and_then(Value::as_str)
                .ok_or(("invalid_workspace", "workspaceId is required".into()))?
                .to_owned();
            let session_id = frame
                .get("sessionId")
                .and_then(Value::as_str)
                .ok_or(("invalid_session", "sessionId is required".into()))?
                .to_owned();
            let session_path = state
                .data
                .resolve_session_path(&workspace_id, &session_id)
                .ok()
                .flatten();
            let cwd = state.data.workspace_root_path(&workspace_id).map_err(|_| {
                (
                    "workspace_not_found",
                    "Could not resolve workspace root".into(),
                )
            })?;
            let cwd = cwd.to_string_lossy().to_string();
            let session_path_str = session_path
                .as_ref()
                .map(|p| p.to_string_lossy().to_string());
            let spec = state
                .pi_launch
                .native_launch_spec(&cwd, session_path_str.as_deref())
                .map_err(|message| ("launch_spec_failed", message))?;
            let target =
                RuntimeTarget::new(workspace_id, session_id, "restart-pending".to_string());
            let runtimes = state.runtimes.clone();
            let new_instance = tokio::task::spawn_blocking(move || runtimes.restart(&target, spec))
                .await
                .map_err(|error| ("host_operation_failed", error.to_string()))?
                .map_err(|message| ("restart_runtime_failed", message))?;
            Ok(json!({
                "type": "host_response",
                "requestId": request_id,
                "operation": "restart_runtime",
                "instanceId": new_instance,
                "ok": true,
            }))
        }
        _ => Err(OpError::new(
            "host_operation_unimplemented",
            "Host operation is not implemented on protocol v2",
        )),
    }
}
