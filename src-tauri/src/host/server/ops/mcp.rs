// ABOUTME: Host ops that run `pi mcp list`, `add`, and `remove`.
// ABOUTME: Pi writes the config files. These ops never open mcp.json themselves.

use std::time::Duration;

use serde_json::{json, Value};

use crate::pi::mcp_cli;

use super::super::{HostState, OpError};

const LIST_TIMEOUT: Duration = Duration::from_secs(120);
const MUTATE_TIMEOUT: Duration = Duration::from_secs(60);

pub(crate) async fn dispatch(
    state: &HostState,
    request_id: &str,
    operation: &str,
    frame: &Value,
) -> Result<Value, OpError> {
    match operation {
        "list_mcp_servers" => list_mcp_servers(state, request_id, frame).await,
        "add_mcp_server" => add_mcp_server(state, request_id, frame).await,
        "remove_mcp_server" => remove_mcp_server(state, request_id, frame).await,
        _ => Err(OpError::new(
            "host_operation_unimplemented",
            "Host operation is not implemented on protocol v2",
        )),
    }
}

fn workspace_root(state: &HostState, frame: &Value) -> Result<std::path::PathBuf, OpError> {
    let id = frame
        .get("workspaceId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or(("invalid_workspace", "workspaceId is required".to_string()))?;
    state
        .data
        .workspace_root_path(id)
        .map_err(|_| OpError::new("invalid_workspace", format!("unknown workspace {id}")))
}

fn failure_text(stderr: &str, stdout: &str, code: Option<i32>) -> String {
    let stderr = stderr.trim();
    if !stderr.is_empty() {
        return stderr.to_string();
    }
    let stdout = stdout.trim();
    if !stdout.is_empty() {
        return stdout.to_string();
    }
    format!("pi exited {}", code.unwrap_or(-1))
}

fn response(request_id: &str, operation: &str, body: Value) -> Value {
    let mut frame = json!({
        "type": "host_response",
        "requestId": request_id,
        "operation": operation,
        "ok": true,
    });
    if let (Some(frame), Some(body)) = (frame.as_object_mut(), body.as_object()) {
        for (key, value) in body {
            frame.insert(key.clone(), value.clone());
        }
    }
    frame
}

async fn list_mcp_servers(
    state: &HostState,
    request_id: &str,
    frame: &Value,
) -> Result<Value, OpError> {
    let root = workspace_root(state, frame)?;
    let resolver = state.pi_launch.clone();
    let output = tokio::task::spawn_blocking(move || {
        let args = mcp_cli::list_args();
        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        resolver.run_pi_command_in(&root, &refs, LIST_TIMEOUT)
    })
    .await
    .map_err(|error| ("host_operation_failed", error.to_string()))?
    .map_err(|message| ("mcp_list_failed", message))?;
    if output.code != Some(0) && output.code != Some(1) {
        return Err(OpError::new(
            "mcp_list_failed",
            failure_text(&output.stderr, &output.stdout, output.code),
        ));
    }
    let list = mcp_cli::parse_list(&output.stdout).map_err(|message| {
        (
            "mcp_list_failed",
            format!(
                "{message}: {}",
                failure_text(&output.stderr, &output.stdout, output.code)
            ),
        )
    })?;
    Ok(response(
        request_id,
        "list_mcp_servers",
        json!({ "list": list }),
    ))
}

async fn add_mcp_server(
    state: &HostState,
    request_id: &str,
    frame: &Value,
) -> Result<Value, OpError> {
    let root = workspace_root(state, frame)?;
    let spec: mcp_cli::McpAddSpec =
        serde_json::from_value(frame.get("spec").cloned().unwrap_or(Value::Null))
            .map_err(|error| ("invalid_spec", error.to_string()))?;
    let args = mcp_cli::add_args(&spec).map_err(|message| ("invalid_spec", message))?;
    let resolver = state.pi_launch.clone();
    let output = tokio::task::spawn_blocking(move || {
        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        resolver.run_pi_command_in(&root, &refs, MUTATE_TIMEOUT)
    })
    .await
    .map_err(|error| ("host_operation_failed", error.to_string()))?
    .map_err(|message| ("mcp_add_failed", message))?;
    if output.code != Some(0) {
        return Err(OpError::new(
            "mcp_add_failed",
            failure_text(&output.stderr, &output.stdout, output.code),
        ));
    }
    let _ = state.fanout.send(json!({ "type": "mcp_config_changed" }));
    Ok(response(request_id, "add_mcp_server", json!({})))
}

async fn remove_mcp_server(
    state: &HostState,
    request_id: &str,
    frame: &Value,
) -> Result<Value, OpError> {
    let root = workspace_root(state, frame)?;
    let name = frame
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let scope = mcp_cli::parse_scope(
        frame
            .get("scope")
            .and_then(Value::as_str)
            .unwrap_or("global"),
    )
    .map_err(|message| ("invalid_spec", message))?;
    let args = mcp_cli::remove_args(&name, scope).map_err(|message| ("invalid_spec", message))?;
    let resolver = state.pi_launch.clone();
    let output = tokio::task::spawn_blocking(move || {
        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        resolver.run_pi_command_in(&root, &refs, MUTATE_TIMEOUT)
    })
    .await
    .map_err(|error| ("host_operation_failed", error.to_string()))?
    .map_err(|message| ("mcp_remove_failed", message))?;
    if output.code != Some(0) {
        return Err(OpError::new(
            "mcp_remove_failed",
            failure_text(&output.stderr, &output.stdout, output.code),
        ));
    }
    let _ = state.fanout.send(json!({ "type": "mcp_config_changed" }));
    Ok(response(request_id, "remove_mcp_server", json!({})))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pi::launch::PiLaunchResolver;
    use std::fs;

    /// Add, list, remove, and list again through the bundled pi. Needs the
    /// echo fixture and `node`. Not part of `cargo test` by default.
    #[test]
    #[ignore]
    fn mcp_ops_roundtrip() {
        let previous = std::env::var("PI_CODING_AGENT_DIR").ok();
        let agent =
            std::env::temp_dir().join(format!("spopi-mcp-roundtrip-{}", std::process::id()));
        let _ = fs::remove_dir_all(&agent);
        fs::create_dir_all(&agent).unwrap();
        std::env::set_var("PI_CODING_AGENT_DIR", &agent);
        let result = std::panic::catch_unwind(|| roundtrip(&agent));
        match previous {
            Some(value) => std::env::set_var("PI_CODING_AGENT_DIR", value),
            None => std::env::remove_var("PI_CODING_AGENT_DIR"),
        }
        let _ = fs::remove_dir_all(&agent);
        result.unwrap();
    }

    fn roundtrip(agent: &std::path::Path) {
        let echo = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../tests/fixtures/mcp/echo-server.mjs");
        let resolver = PiLaunchResolver::new(
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/public"),
        );
        let cwd = agent;
        let spec: mcp_cli::McpAddSpec = serde_json::from_value(json!({
            "name": "echo",
            "scope": "global",
            "kind": "stdio",
            "command": "node",
            "args": [echo],
        }))
        .unwrap();
        let add = mcp_cli::add_args(&spec).unwrap();
        let add_refs: Vec<&str> = add.iter().map(String::as_str).collect();
        let added = resolver
            .run_pi_command_in(cwd, &add_refs, MUTATE_TIMEOUT)
            .unwrap();
        assert_eq!(added.code, Some(0), "{}", added.stderr);
        let list = mcp_cli::list_args();
        let list_refs: Vec<&str> = list.iter().map(String::as_str).collect();
        let listed = resolver
            .run_pi_command_in(cwd, &list_refs, LIST_TIMEOUT)
            .unwrap();
        let parsed = mcp_cli::parse_list(&listed.stdout).unwrap();
        let echo_row = parsed["servers"]
            .as_array()
            .unwrap()
            .iter()
            .find(|row| row["name"] == "echo")
            .unwrap();
        assert_eq!(echo_row["state"], "connected");
        assert_eq!(echo_row["tools"].as_array().unwrap().len(), 3);
        let remove = mcp_cli::remove_args("echo", mcp_cli::McpScope::Global).unwrap();
        let remove_refs: Vec<&str> = remove.iter().map(String::as_str).collect();
        let removed = resolver
            .run_pi_command_in(cwd, &remove_refs, MUTATE_TIMEOUT)
            .unwrap();
        assert_eq!(removed.code, Some(0), "{}", removed.stderr);
        let again = resolver
            .run_pi_command_in(cwd, &list_refs, LIST_TIMEOUT)
            .unwrap();
        let empty = mcp_cli::parse_list(&again.stdout).unwrap();
        assert!(empty["servers"].as_array().unwrap().is_empty());
    }
}
