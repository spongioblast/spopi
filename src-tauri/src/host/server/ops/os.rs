// ABOUTME: Opens paths and URLs and lists the apps that can open a folder.
// ABOUTME: The operation names stay in dispatch.rs so the host-op check can see them.

use super::super::{host_data_error, HostState};
use crate::platform::open::{list_installed_apps, open_external, open_in_app, reveal_path};
use serde_json::{json, Value};

pub(crate) async fn dispatch(
    state: &HostState,
    request_id: &str,
    operation: &str,
    frame: &Value,
) -> Result<Value, (&'static str, String)> {
    match operation {
        "list_installed_apps" => Ok(json!({
            "type": "host_response",
            "requestId": request_id,
            "operation": "list_installed_apps",
            "apps": list_installed_apps(),
        })),
        "list_local_addresses" => Ok(json!({
            "type": "host_response",
            "requestId": request_id,
            "operation": "list_local_addresses",
            "addresses": local_ipv4(),
        })),
        "open_in_app" => {
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
            let app_name = frame
                .get("appName")
                .and_then(Value::as_str)
                .map(str::to_owned);
            let command = frame
                .get("command")
                .and_then(Value::as_str)
                .map(str::to_owned);
            tokio::task::spawn_blocking(move || {
                open_in_app(&path, app_name.as_deref(), command.as_deref())
            })
            .await
            .map_err(|error| ("host_operation_failed", error.to_string()))?
            .map_err(|message| ("open_in_app_failed", message))?;
            Ok(json!({
                "type": "host_response",
                "requestId": request_id,
                "operation": "open_in_app",
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
        _ => Err((
            "host_operation_unimplemented",
            "Host operation is not implemented on protocol v2".into(),
        )),
    }
}

fn local_ipv4() -> Vec<String> {
    let mut ips = if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|iface| match iface.ip() {
            std::net::IpAddr::V4(addr) if !addr.is_loopback() && !addr.is_unspecified() => {
                Some(addr.to_string())
            }
            _ => None,
        })
        .collect::<Vec<_>>();
    ips.sort_by_key(|ip| if is_tailscale(ip) { 0 } else { 1 });
    ips.dedup();
    ips
}

fn is_tailscale(ip: &str) -> bool {
    let Ok(addr) = ip.parse::<std::net::Ipv4Addr>() else {
        return false;
    };
    let [first, second, _, _] = addr.octets();
    first == 100 && (64..128).contains(&second)
}
