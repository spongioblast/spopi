// ABOUTME: /api/terminal/run, /output, /stop: Pi's spopi_terminal tools run a command in a dock tab the user sees.
// ABOUTME: Loopback only and refused from browser pages; the tab, PTY, and output tail are terminal::agent_run's.

use super::super::{api_error_with_detail, HostState};
use super::screenshot::same_folder;
use crate::pi::coordinator::RuntimeTarget;
use crate::platform::window_owner::OwnerId;
use crate::terminal::agent_run::AGENT_TAIL_BYTES;
use axum::extract::{Json, Query, State};
use axum::http::header::ORIGIN;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use serde_json::json;
use std::path::{Path, PathBuf};
use std::sync::Arc;

const DEFAULT_OUTPUT_BYTES: usize = 64 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunRequest {
    cwd: String,
    session_id: Option<String>,
    command: String,
    title: Option<String>,
}

#[derive(Deserialize)]
pub struct OutputQuery {
    id: String,
    bytes: Option<usize>,
}

#[derive(Deserialize)]
pub struct StopRequest {
    id: String,
}

fn failure(status: StatusCode, code: &'static str, message: &str) -> Response {
    api_error_with_detail(status, code, message).into_response()
}

/// Pi's bridge sends neither header. A page in a browser always sends at least one,
/// so a site cannot start a command through a cross-site request.
fn from_browser(headers: &HeaderMap) -> bool {
    headers.contains_key(ORIGIN) || headers.contains_key("sec-fetch-site")
}

fn browser_refused() -> Response {
    failure(
        StatusCode::FORBIDDEN,
        "browser_request",
        "Terminal commands are only accepted from Pi.",
    )
}

/// The window that shows this Pi session, else one that shows its project, with the project root
/// the window lists terminals under.
fn session_window(
    state: &HostState,
    session_id: Option<&str>,
    cwd: &Path,
) -> Option<(OwnerId, PathBuf)> {
    let connected = |client: &str| {
        state
            .ws_clients
            .lock()
            .map(|clients| clients.contains_key(client))
            .unwrap_or(false)
    };
    let owners: Vec<(RuntimeTarget, String)> = state
        .session_owners
        .lock()
        .ok()?
        .iter()
        .filter(|(_, client)| connected(client))
        .map(|(target, client)| (target.clone(), client.clone()))
        .collect();
    let root_of =
        |target: &RuntimeTarget| state.data.workspace_root_path(&target.workspace_id).ok();
    let live = session_id.and_then(|id| state.runtimes.target_for_session_id(id));
    if let Some(live) = live {
        let shown = owners
            .iter()
            .find(|(target, _)| target.instance_id == live.instance_id)
            .and_then(|(target, client)| Some((OwnerId::from_client_id(client), root_of(target)?)));
        if shown.is_some() {
            return shown;
        }
    }
    owners.iter().find_map(|(target, client)| {
        let root = root_of(target)?;
        same_folder(&root, cwd).then(|| (OwnerId::from_client_id(client), root))
    })
}

pub async fn run(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
    Json(request): Json<RunRequest>,
) -> Response {
    if from_browser(&headers) {
        return browser_refused();
    }
    let cwd = PathBuf::from(request.cwd.trim());
    if !cwd.is_dir() {
        return failure(
            StatusCode::BAD_REQUEST,
            "invalid_cwd",
            "The working folder does not exist.",
        );
    }
    let Some((owner, root)) = session_window(&state, request.session_id.as_deref(), &cwd) else {
        return failure(
            StatusCode::NOT_FOUND,
            "no_window",
            "No SPOPI window shows this project, so there is no terminal to run the command in.",
        );
    };
    let manager = state.terminal_manager.clone();
    let started = tokio::task::spawn_blocking(move || {
        manager.run_agent_command(
            &owner,
            &root,
            &cwd,
            &request.command,
            request.title.as_deref(),
        )
    })
    .await;
    match started {
        Ok(Ok(started)) => Json(started).into_response(),
        Ok(Err(message)) => failure(StatusCode::UNPROCESSABLE_ENTITY, "run_failed", &message),
        Err(_) => failure(
            StatusCode::INTERNAL_SERVER_ERROR,
            "run_failed",
            "The terminal could not be started.",
        ),
    }
}

pub async fn output(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
    Query(query): Query<OutputQuery>,
) -> Response {
    if from_browser(&headers) {
        return browser_refused();
    }
    let bytes = query
        .bytes
        .unwrap_or(DEFAULT_OUTPUT_BYTES)
        .min(AGENT_TAIL_BYTES);
    match state
        .terminal_manager
        .agent_run_view(query.id.trim(), bytes)
    {
        Some(view) => Json(view).into_response(),
        None => failure(
            StatusCode::NOT_FOUND,
            "unknown_terminal",
            "No terminal with that id: Pi did not start it, or its tab was closed.",
        ),
    }
}

pub async fn stop(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
    Json(request): Json<StopRequest>,
) -> Response {
    if from_browser(&headers) {
        return browser_refused();
    }
    let manager = state.terminal_manager.clone();
    let id = request.id.trim().to_string();
    match tokio::task::spawn_blocking(move || manager.stop_agent_run(&id)).await {
        Ok(Ok(())) => Json(json!({ "ok": true })).into_response(),
        Ok(Err(message)) => failure(StatusCode::NOT_FOUND, "unknown_terminal", &message),
        Err(_) => failure(
            StatusCode::INTERNAL_SERVER_ERROR,
            "stop_failed",
            "The command could not be stopped.",
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::from_browser;
    use axum::http::{HeaderMap, HeaderValue};

    #[test]
    fn browser_requests_are_recognized_by_their_headers() {
        assert!(!from_browser(&HeaderMap::new()));
        let mut origin = HeaderMap::new();
        origin.insert("origin", HeaderValue::from_static("https://example.com"));
        assert!(from_browser(&origin));
        let mut fetch = HeaderMap::new();
        fetch.insert("sec-fetch-site", HeaderValue::from_static("cross-site"));
        assert!(from_browser(&fetch));
    }
}
