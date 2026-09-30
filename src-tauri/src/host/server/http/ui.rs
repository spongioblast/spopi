// ABOUTME: HTTP for the UI overlay: list, revert, merge, safe mode, locale overrides.
// ABOUTME: Static overlay bytes are answered before the shipped ServeDir.

use super::super::HostState;
use axum::body::Body;
use axum::extract::{Query, State};
use axum::http::header::{CACHE_CONTROL, CONTENT_TYPE};
use axum::http::{HeaderValue, Method, StatusCode};
use axum::middleware::Next;
use axum::response::Response;
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;

pub async fn serve_overlay(
    State(state): State<Arc<HostState>>,
    request: axum::extract::Request,
    next: Next,
) -> Response {
    if request.method() == Method::GET {
        if let Some(served) = state.ui.try_serve(request.uri().path()) {
            return Response::builder()
                .header(CONTENT_TYPE, served.content_type)
                .header(CACHE_CONTROL, HeaderValue::from_static("no-store"))
                .body(Body::from(served.body))
                .unwrap_or_else(|_| Response::new(Body::empty()));
        }
    }
    next.run(request).await
}

pub async fn list(State(state): State<Arc<HostState>>) -> Json<Value> {
    Json(state.ui.list_json())
}

#[derive(Deserialize)]
pub struct LangQuery {
    lang: String,
}

pub async fn locale(
    State(state): State<Arc<HostState>>,
    Query(query): Query<LangQuery>,
) -> Json<Value> {
    Json(state.ui.locale_override(&query.lang))
}

#[derive(Deserialize)]
pub struct PathQuery {
    path: String,
}

pub async fn three_way(
    State(state): State<Arc<HostState>>,
    Query(query): Query<PathQuery>,
) -> Result<Json<Value>, StatusCode> {
    state
        .ui
        .three_way(&query.path)
        .map(Json)
        .ok_or(StatusCode::BAD_REQUEST)
}

#[derive(Deserialize)]
pub struct PathBody {
    path: String,
}

pub async fn revert(
    State(state): State<Arc<HostState>>,
    Json(body): Json<PathBody>,
) -> Json<Value> {
    Json(json!({ "ok": state.ui.revert(&body.path) }))
}

#[derive(Deserialize)]
pub struct SafeBody {
    enabled: bool,
}

pub async fn safe_mode(
    State(state): State<Arc<HostState>>,
    Json(body): Json<SafeBody>,
) -> Json<Value> {
    state.ui.set_safe(body.enabled);
    Json(json!({ "ok": true, "safe": state.ui.is_safe() }))
}

#[derive(Deserialize)]
pub struct DisabledBody {
    name: String,
    enabled: bool,
}

pub async fn disabled(
    State(state): State<Arc<HostState>>,
    Json(body): Json<DisabledBody>,
) -> Json<Value> {
    state.ui.set_disabled(&body.name, body.enabled);
    Json(json!({ "ok": true }))
}

pub async fn ready(State(state): State<Arc<HostState>>) -> Json<Value> {
    state.ui.note_ready();
    Json(json!({ "ok": true }))
}
