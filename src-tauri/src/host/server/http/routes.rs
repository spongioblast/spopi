// ABOUTME: Handlers for /, /health, /health/runtime, /v2/bootstrap, and /v2/sessions.
// ABOUTME: The route table that mounts every HTTP handler is http/mod.rs.

use super::super::session_view::annotate_live_sessions;
use super::super::{api_error, api_error_with_detail, host_data_http_error, HostState};
use crate::host::router::PROTOCOL_VERSION;
use crate::pi::coordinator::RuntimeTarget;
use axum::extract::{Json, Query, State};
use axum::http::StatusCode;
use axum::response::Redirect;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;

pub(crate) async fn app_launcher_redirect() -> Redirect {
    Redirect::temporary("/app")
}

pub(crate) fn health_payload(runtime_count: usize) -> Value {
    json!({
        "status": "ok",
        "protocolVersion": PROTOCOL_VERSION,
        "piVersion": crate::pi::binary::locked_pi_version(),
        "spopiVersion": env!("CARGO_PKG_VERSION"),
        "appDataScratch": std::env::var("SPOPI_APP_DATA_DIR").ok().is_some_and(|value| !value.trim().is_empty()),
        "runtimeCount": runtime_count,
    })
}

pub(crate) async fn health(State(state): State<Arc<HostState>>) -> Json<Value> {
    let runtime_count = state.runtimes.statuses().map(|s| s.len()).unwrap_or(0);
    let mut body = health_payload(runtime_count);
    if let Some(pi_bin) = state.pi_launch.bundled_pi_bin() {
        body["piBin"] = json!(pi_bin);
    }
    Json(body)
}

/// L2 health check — reports the coordinator's live view of every tracked
/// runtime (workspace/session/instance + lifecycle state), plus a summary
/// count broken down by state. Useful for detecting stuck/crashed runtimes
/// without needing to inspect individual sessions.
pub(crate) async fn health_runtime(
    State(state): State<Arc<HostState>>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let statuses = state.runtimes.statuses().map_err(|message| {
        api_error_with_detail(
            StatusCode::INTERNAL_SERVER_ERROR,
            "statuses_unavailable",
            &message,
        )
    })?;
    let mut by_state: HashMap<String, usize> = HashMap::new();
    for status in &statuses {
        let key = serde_json::to_value(status.state)
            .ok()
            .and_then(|v| v.as_str().map(str::to_string))
            .unwrap_or_else(|| "unknown".to_string());
        *by_state.entry(key).or_insert(0) += 1;
    }
    Ok(Json(json!({
        "status": "ok",
        "runtimeCount": statuses.len(),
        "byState": by_state,
        "runtimes": statuses,
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BootstrapQuery {
    workspace_id: String,
    session_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionsQuery {
    workspace_id: String,
}

pub(crate) async fn list_all_sessions_http(
    State(state): State<Arc<HostState>>,
    Query(query): Query<SessionsQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let sessions = state
        .data
        .list_all_sessions(&query.workspace_id)
        .map_err(host_data_http_error)?;
    let mut sessions = serde_json::to_value(sessions)
        .map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "serialization_failed"))?;
    if let Ok(statuses) = state.runtimes.statuses() {
        annotate_live_sessions(&mut sessions, statuses);
    }
    Ok(Json(json!({ "sessions": sessions })))
}

pub(crate) async fn bootstrap_target(
    State(state): State<Arc<HostState>>,
    Query(query): Query<BootstrapQuery>,
) -> Result<Json<RuntimeTarget>, (StatusCode, Json<Value>)> {
    // A live runtime already exists for this session — reuse it.
    if let Some(target) = state
        .runtimes
        .target_for_session(&query.workspace_id, &query.session_id)
    {
        return Ok(Json(target));
    }

    // Otherwise this is a historical session opened from the sidebar. Lazily
    // spawn a runtime that resumes the saved session file so its messages load
    // instead of failing with "runtime stopped/unavailable".
    let session_path = state
        .data
        .resolve_session_path(&query.workspace_id, &query.session_id)
        .map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "session_lookup_failed"))?
        .ok_or_else(|| api_error(StatusCode::NOT_FOUND, "session_not_found"))?;
    let cwd = state
        .data
        .workspace_root_path(&query.workspace_id)
        .map_err(|_| api_error(StatusCode::NOT_FOUND, "workspace_not_found"))?;
    let launch = state
        .pi_launch
        .native_launch_spec(
            &cwd.to_string_lossy(),
            Some(&session_path.to_string_lossy()),
        )
        .map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "launch_spec_failed"))?;
    let target = RuntimeTarget::new(
        query.workspace_id.clone(),
        query.session_id.clone(),
        format!("instance-{}", uuid::Uuid::new_v4().simple()),
    );
    if let Some(parked) = state.runtimes.standby_for(&query.workspace_id) {
        if state
            .runtimes
            .host_switch_session(&parked, &session_path.to_string_lossy())
            .await
            .is_ok()
        {
            if let Ok(Some(adopted)) = state
                .runtimes
                .adopt_standby(&query.workspace_id, &query.session_id)
            {
                super::super::idle_reaper::refill_standbys(&state);
                return Ok(Json(adopted));
            }
        }
    }
    state
        .runtimes
        .spawn(target.clone(), launch)
        .map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "runtime_spawn_failed"))?;
    Ok(Json(target))
}

#[cfg(test)]
mod tests {
    use super::health_payload;

    #[test]
    fn health_omits_a_network_url() {
        let body = health_payload(0);
        assert!(body.get("lanUrl").is_none());
        assert_eq!(body["status"], "ok");
        assert_eq!(body["runtimeCount"], 0);
    }
}
