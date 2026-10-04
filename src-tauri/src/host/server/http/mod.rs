// ABOUTME: The loopback HTTP route table, with handlers grouped by files, git, search, and phone.
// ABOUTME: Non-public paths need a trusted loopback request; the check itself is in auth.rs.

pub(super) mod engine;
pub(super) mod files;
pub(super) mod git;
pub(crate) mod phone;
pub(crate) mod phone_runtime;
pub(super) mod routes;
pub(super) mod screenshot;
pub(super) mod search;
pub(crate) mod ui;

use super::auth::{is_public_http_request, trusted_loopback_request};
use super::{ui_assets, ws, HostState};
use axum::body::Body;
use axum::extract::{ConnectInfo, DefaultBodyLimit};
use axum::http::header::CONTENT_TYPE;
use axum::http::StatusCode;
use axum::middleware;
use axum::response::Response;
use axum::routing::{get, post};
use axum::Router;
use std::path::PathBuf;
use std::sync::Arc;

const MAX_HTTP_BODY_BYTES: usize = 1024 * 1024;

pub(super) fn router(state: Arc<HostState>, static_dir: PathBuf) -> Router {
    let ui_files = ui_assets::router(static_dir, Some(state.ui.root.clone()), false);
    let app = Router::new()
        .route("/", get(routes::app_launcher_redirect))
        .route("/health", get(routes::health))
        .route("/health/runtime", get(routes::health_runtime))
        .route("/v2/ws", get(ws::websocket_upgrade))
        .route("/v2/bootstrap", get(routes::bootstrap_target))
        .route("/v2/sessions", get(routes::list_all_sessions_http))
        .route(
            "/api/files/content",
            get(files::read_file_content).put(files::write_file_content),
        )
        .route("/api/files/raw", get(files::raw_file_content))
        .route("/api/git/diff", get(git::git_file_diff))
        .route("/api/git/stat", get(git::git_stat_handler))
        .route("/api/file-mentions", get(files::file_mentions))
        .route("/api/workspace-info", get(files::workspace_info_handler))
        .route("/api/search", get(search::search_handler))
        .route("/api/ui/overrides", get(ui::list))
        .route("/api/ui/locale", get(ui::locale))
        .route("/api/ui/three-way", get(ui::three_way))
        .route("/api/ui/revert", post(ui::revert))
        .route("/api/ui/safe", post(ui::safe_mode))
        .route("/api/ui/ready", post(ui::ready))
        .route("/api/ui/disabled", post(ui::disabled))
        .route("/api/ui/screenshot", get(screenshot::screenshot))
        .route("/api/phone/status", get(phone::status))
        .route("/api/phone/pair", post(phone::pair))
        .route("/api/phone/decide", post(phone::decide))
        .route("/api/phone/devices", get(phone::devices))
        .route("/api/phone/revoke", post(phone::revoke))
        .route("/api/phone/enable", post(phone::enable))
        .route(
            "/api/phone/firewall",
            get(phone::firewall_status).post(phone::firewall_allow),
        )
        .route("/v2/new-session", post(files::new_session))
        .route("/v2/resolve-workspace", post(files::resolve_workspace))
        .merge(ui_files)
        .layer(DefaultBodyLimit::max(MAX_HTTP_BODY_BYTES))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            ui::serve_overlay,
        ))
        .with_state(state);
    app.layer(middleware::from_fn(
        |request: axum::extract::Request, next: middleware::Next| async move {
            let path = request.uri().path();
            if is_public_http_request(request.method(), path) {
                return next.run(request).await;
            }
            let loopback = request
                .extensions()
                .get::<ConnectInfo<std::net::SocketAddr>>()
                .copied()
                .map(|peer| trusted_loopback_request(peer, request.headers(), request.uri()))
                .unwrap_or(false);
            if loopback {
                next.run(request).await
            } else {
                Response::builder()
                    .status(StatusCode::UNAUTHORIZED)
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(r#"{"error":{"code":"unauthorized"}}"#))
                    .expect("authorization response is valid")
            }
        },
    ))
}
