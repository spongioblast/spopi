// ABOUTME: Routes git WebSocket frames to the read, history, write, and remote handlers.
// ABOUTME: It resolves the workspace and command name only; handlers own argument parsing.

mod history;
mod reads;
mod remotes;
mod writes;

use super::GitService;
use crate::data::HostDataPlane;
use crate::host::op_error::OpError;
use crate::pi::launch::PiLaunchResolver;
use serde_json::{json, Value};
use std::path::PathBuf;
use tokio::sync::broadcast;

type DispatchResult = Result<Value, OpError>;

struct GitRequest<'a> {
    service: &'a GitService,
    events: &'a broadcast::Sender<(String, Value)>,
    owner: &'a str,
    request_id: &'a str,
    frame: &'a Value,
    root: PathBuf,
    generation: u64,
}

impl GitRequest<'_> {
    fn ack(&self) -> Value {
        json!({
            "type": "git_command_ack",
            "requestId": self.request_id,
            "workspaceGeneration": self.generation,
        })
    }
}

fn command_failed(error: String) -> OpError {
    OpError::new("git_command_failed", error)
}

pub(crate) async fn dispatch(
    service: &GitService,
    data: &HostDataPlane,
    _launch: &PiLaunchResolver,
    events: &broadcast::Sender<(String, Value)>,
    client_id: &str,
    request_id: &str,
    frame: &Value,
) -> DispatchResult {
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
    let request = GitRequest {
        service,
        events,
        owner: client_id,
        request_id,
        frame,
        root,
        generation: 0,
    };

    if frame.get("type").and_then(Value::as_str) == Some("git_ai_commit_message") {
        return reads::ai_commit_message(&request);
    }

    let command = frame
        .pointer("/command/type")
        .and_then(Value::as_str)
        .unwrap_or("status");
    match command {
        "status" => reads::status(&request),
        "diff" => reads::diff(&request),
        "file_at_head" => reads::file_at_head(&request),
        "log" => history::log(&request),
        "log_detail" => history::log_detail(&request),
        "commit_diff" => history::commit_diff(&request),
        "stage" | "unstage" | "discard" => writes::write_paths(&request, command),
        "commit" => writes::commit(request),
        "push" => remotes::push(request),
        "fetch" => remotes::fetch(&request),
        "pull" => remotes::pull(&request),
        "branches" => remotes::branches(&request),
        "init" => remotes::init(&request),
        "checkout" => remotes::checkout(&request),
        "remotes" => remotes::list_remotes(&request),
        "remote_add" | "remote_set_url" | "remote_remove" => {
            remotes::edit_remote(&request, command)
        }
        _ => Err(command_failed("unsupported Git command".into())),
    }
}
