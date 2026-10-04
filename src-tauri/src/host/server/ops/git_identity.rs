// ABOUTME: Reads and sets the Git name and email for commits, per computer or per project.
// ABOUTME: SPOPI keeps no copy; Git's own config is the only place they live.

use super::super::{HostState, OpError};
use crate::git::identity::{read_identity, write_identity, GlobalConfig, IdentityScope};
use serde_json::{json, Value};

fn text<'a>(frame: &'a Value, key: &str) -> &'a str {
    frame.get(key).and_then(Value::as_str).unwrap_or("")
}

pub(crate) async fn dispatch(
    state: &HostState,
    request_id: &str,
    operation: &str,
    frame: &Value,
) -> Result<Value, OpError> {
    let workspace_id = text(frame, "workspaceId").trim();
    let root = if workspace_id.is_empty() {
        None
    } else {
        Some(state.data.workspace_root_path(workspace_id)?)
    };
    let report = match operation {
        "git_identity_get" => {
            tokio::task::spawn_blocking(move || {
                Ok(read_identity(root.as_deref(), &GlobalConfig::default()))
            })
            .await
        }
        "git_identity_set" => {
            let scope = IdentityScope::parse(text(frame, "scope"))
                .map_err(|message| OpError::new("invalid_scope", message))?;
            let name = text(frame, "name").to_owned();
            let email = text(frame, "email").to_owned();
            tokio::task::spawn_blocking(move || {
                write_identity(
                    root.as_deref(),
                    scope,
                    &name,
                    &email,
                    &GlobalConfig::default(),
                )
            })
            .await
        }
        _ => {
            return Err(OpError::new(
                "host_operation_unimplemented",
                "Host operation is not implemented on protocol v2",
            ))
        }
    }
    .map_err(|error| OpError::new("host_operation_failed", error.to_string()))?
    .map_err(|message| OpError::new("git_identity_failed", message))?;
    Ok(json!({
        "type": "host_response",
        "requestId": request_id,
        "operation": operation,
        "identity": report,
    }))
}
