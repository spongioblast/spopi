// ABOUTME: Handles git remote and branch commands: push, fetch, pull, branches, init, checkout, and remotes.
// ABOUTME: It shapes protocol replies; git/remote.rs and git/commit.rs run the git processes.

use super::{command_failed, DispatchResult, GitRequest};
use serde_json::{json, Value};

pub(super) fn push(request: GitRequest) -> DispatchResult {
    // Push crosses the network, so it runs on a blocking worker and
    // reports through an event instead of holding the dispatch future
    // open for as long as the remote takes to answer.
    let service = request.service.clone();
    let events = request.events.clone();
    let owner = request.owner.to_owned();
    let event_request_id = request.request_id.to_owned();
    let generation = request.generation;
    let root = request.root;
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
        "requestId": request.request_id,
        "workspaceGeneration": generation,
    }))
}

pub(super) fn fetch(request: &GitRequest) -> DispatchResult {
    request
        .service
        .fetch(&request.root)
        .map_err(command_failed)?;
    Ok(request.ack())
}

pub(super) fn pull(request: &GitRequest) -> DispatchResult {
    request
        .service
        .pull(&request.root)
        .map_err(command_failed)?;
    Ok(request.ack())
}

pub(super) fn branches(request: &GitRequest) -> DispatchResult {
    let branches = request
        .service
        .branches(&request.root)
        .map_err(command_failed)?;
    Ok(json!({
        "type": "git_branches",
        "requestId": request.request_id,
        "workspaceGeneration": request.generation,
        "branches": branches,
    }))
}

pub(super) fn init(request: &GitRequest) -> DispatchResult {
    request
        .service
        .init_repository(&request.root)
        .map_err(command_failed)?;
    Ok(request.ack())
}

pub(super) fn checkout(request: &GitRequest) -> DispatchResult {
    let name = request
        .frame
        .pointer("/command/name")
        .and_then(Value::as_str)
        .unwrap_or("");
    let create = request
        .frame
        .pointer("/command/create")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    request
        .service
        .checkout(&request.root, name, create)
        .map_err(command_failed)?;
    Ok(request.ack())
}

pub(super) fn list_remotes(request: &GitRequest) -> DispatchResult {
    let remotes = request
        .service
        .remotes(&request.root)
        .map_err(command_failed)?;
    Ok(json!({
        "type": "git_remotes",
        "requestId": request.request_id,
        "workspaceGeneration": request.generation,
        "remotes": remotes,
    }))
}

pub(super) fn edit_remote(request: &GitRequest, command: &str) -> DispatchResult {
    let text = |key: &str| {
        request
            .frame
            .pointer(&format!("/command/{key}"))
            .and_then(Value::as_str)
            .unwrap_or("")
    };
    let (service, root, name) = (request.service, &request.root, text("name"));
    match command {
        "remote_add" => service.add_remote(root, name, text("url")),
        "remote_set_url" => service.set_remote_url(root, name, text("url")),
        _ => service.remove_remote(root, name),
    }
    .map_err(command_failed)?;
    Ok(request.ack())
}
