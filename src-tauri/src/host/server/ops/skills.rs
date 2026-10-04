// ABOUTME: Opens the OS folder dialog so Settings can install skills through Pi.
// ABOUTME: Scanning and the settings write stay in the bridge, inside Pi.

use super::super::{HostState, OpError};
use serde_json::{json, Value};
use tauri_plugin_dialog::DialogExt;

pub(crate) async fn dispatch(
    state: &HostState,
    _client_id: &str,
    request_id: &str,
    operation: &str,
    _frame: &Value,
) -> Result<Value, OpError> {
    match operation {
        "pick_skill_folder" => {
            let Some(app) = state.app_handle.clone() else {
                return Err(OpError::new(
                    "host_operation_failed",
                    "Folder picker is not available",
                ));
            };
            let path =
                tokio::task::spawn_blocking(move || app.dialog().file().blocking_pick_folder())
                    .await
                    .map_err(|error| ("host_operation_failed", error.to_string()))?;
            let path = path.and_then(|picked| {
                picked
                    .as_path()
                    .map(|folder| folder.to_string_lossy().into_owned())
            });
            Ok(json!({
                "type": "host_response",
                "requestId": request_id,
                "operation": "pick_skill_folder",
                "path": path,
            }))
        }
        _ => Err(OpError::new(
            "host_operation_unimplemented",
            "Host operation is not implemented on protocol v2",
        )),
    }
}
