// ABOUTME: Loads and saves a project's review comment drafts.
// ABOUTME: The drafts belong to the project folder, not to one chat.

use super::super::{HostState, OpError};
use serde_json::{json, Value};

pub(crate) async fn dispatch(
    state: &HostState,
    request_id: &str,
    operation: &str,
    frame: &Value,
) -> Result<Value, OpError> {
    let workspace_id = frame
        .get("workspaceId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| OpError::new("invalid_workspace", "workspaceId is required"))?
        .to_owned();
    let project = state.data.workspace_root_path(&workspace_id)?;
    let drafts = state.review_drafts.clone();
    match operation {
        "review_drafts_load" => {
            let loaded = tokio::task::spawn_blocking(move || drafts.load(&project))
                .await
                .map_err(|error| OpError::new("host_operation_failed", error.to_string()))?
                .map_err(|message| OpError::new("review_drafts_load_failed", message))?;
            Ok(json!({
                "type": "host_response",
                "requestId": request_id,
                "operation": "review_drafts_load",
                "drafts": loaded,
            }))
        }
        "review_drafts_save" => {
            let incoming = frame.get("drafts").cloned().unwrap_or(Value::Null);
            let saved = tokio::task::spawn_blocking(move || drafts.save(&project, incoming))
                .await
                .map_err(|error| OpError::new("host_operation_failed", error.to_string()))?
                .map_err(|message| OpError::new("review_drafts_save_failed", message))?;
            Ok(json!({
                "type": "host_response",
                "requestId": request_id,
                "operation": "review_drafts_save",
                "drafts": saved,
            }))
        }
        _ => Err(OpError::new(
            "host_operation_unimplemented",
            "Host operation is not implemented on protocol v2",
        )),
    }
}
