// ABOUTME: The session routes a paired phone needs to open and start chats, on the phone listener.
// ABOUTME: The listener's gate has already checked the device; these check its tier.

use super::super::{api_error, HostState};
use super::{files, routes, ui};
use crate::host::capabilities::may_register_workspace;
use crate::host::router::{ClientKind, Tier};
use crate::pi::coordinator::RuntimeTarget;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Extension, Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;

type Refused = (StatusCode, Json<Value>);

pub(crate) fn routes() -> Router<Arc<HostState>> {
    Router::new()
        .route("/v2/sessions", get(routes::list_all_sessions_http))
        .route("/v2/bootstrap", get(bootstrap))
        .route("/v2/new-session", post(new_session))
        .route("/v2/resolve-workspace", post(resolve_workspace))
        .route("/api/ui/overrides", get(ui::list))
        .route("/api/ui/locale", get(ui::locale))
}

/// Starting or resuming a Pi runtime is what Control adds over Observe.
fn may_run(kind: &ClientKind) -> Result<(), Refused> {
    match kind {
        ClientKind::Remote {
            tier: Tier::Observe,
            ..
        } => Err(api_error(StatusCode::FORBIDDEN, "not_allowed")),
        _ => Ok(()),
    }
}

async fn bootstrap(
    Extension(kind): Extension<ClientKind>,
    state: State<Arc<HostState>>,
    query: Query<routes::BootstrapQuery>,
) -> Result<Json<RuntimeTarget>, Refused> {
    may_run(&kind)?;
    routes::bootstrap_target(state, query).await
}

async fn new_session(
    Extension(kind): Extension<ClientKind>,
    state: State<Arc<HostState>>,
    body: Json<files::NewSessionRequest>,
) -> Result<Json<RuntimeTarget>, Refused> {
    may_run(&kind)?;
    files::new_session(state, body).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResolveBody {
    project_path: String,
}

async fn resolve_workspace(
    Extension(kind): Extension<ClientKind>,
    State(state): State<Arc<HostState>>,
    Json(body): Json<ResolveBody>,
) -> Result<Json<Value>, Refused> {
    may_run(&kind)?;
    let register = may_register_workspace(&kind);
    let workspace_id =
        files::resolve_workspace_path(&state, &body.project_path, register).map_err(|code| {
            let status = if code == "project_not_found" {
                StatusCode::NOT_FOUND
            } else if code == "loopback_required" {
                StatusCode::FORBIDDEN
            } else {
                StatusCode::INTERNAL_SERVER_ERROR
            };
            api_error(status, code)
        })?;
    Ok(Json(json!({ "workspaceId": workspace_id })))
}
