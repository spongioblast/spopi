// ABOUTME: Opt-in HTTPS listener for phone clients: TLS bind, device gate, and the phone UI.
// ABOUTME: It never binds every interface; only the pair routes in pair.rs skip the device token.

use super::cert;
use super::{now_secs, origin_matches, token_hash};
use crate::host::router::{ClientKind, Tier};
use crate::host::server::ws::websocket_upgrade;
use crate::host::server::HostState;
use axum::body::Body;
use axum::extract::{ConnectInfo, State};
use axum::http::{header, HeaderMap, Method, StatusCode};
use axum::middleware::{self, Next};
use axum::response::Response;
use axum::routing::get;
use axum::Router;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

const PHONE_CSP: &str = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

fn security_headers() -> [(header::HeaderName, &'static str); 4] {
    [
        (header::CONTENT_SECURITY_POLICY, PHONE_CSP),
        (header::REFERRER_POLICY, "no-referrer"),
        (
            header::HeaderName::from_static("x-content-type-options"),
            "nosniff",
        ),
        (header::STRICT_TRANSPORT_SECURITY, "max-age=31536000"),
    ]
}

const NOT_PAIRED: &str = "This phone is not paired with SPOPI, or its pairing was revoked. On the desktop, open Settings → Phone access, click Pair, and scan the code.";

fn device_token(headers: &HeaderMap) -> Option<String> {
    if let Some(value) = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
    {
        if let Some(token) = value.strip_prefix("Bearer ") {
            if !token.is_empty() {
                return Some(token.to_string());
            }
        }
    }
    // HTTP/2 lets a browser send each cookie in its own header (Firefox does).
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|cookie| cookie.split(';'))
        .filter_map(|part| part.trim().strip_prefix("spopi_device="))
        .find(|token| !token.is_empty())
        .map(ToOwned::to_owned)
}

fn open_path(path: &str) -> bool {
    path == "/pair"
        || path.starts_with("/pair/")
        || path.starts_with("/v/")
        || path.starts_with("/locales/")
}

async fn gate(
    State(state): State<Arc<HostState>>,
    mut request: axum::extract::Request,
    next: Next,
) -> Response {
    let headers = request.headers().clone();
    if let Some(peer) = request.extensions().get::<ConnectInfo<SocketAddr>>() {
        if !state.phone.allows(peer.0.ip()) {
            return html(
                StatusCode::FORBIDDEN,
                "Address not allowed",
                &format!(
                    "This device's address ({}) is not in Allowed sources. Add it in SPOPI on the desktop: Settings → Phone access.",
                    peer.0.ip()
                ),
            );
        }
    }
    let host = request_host(&headers, request.uri());
    let origin = headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok());
    if origin.is_some() && !origin_matches(&format!("https://{host}"), origin) {
        return html(
            StatusCode::FORBIDDEN,
            "Request refused",
            "This request came from another site, so SPOPI refused it.",
        );
    }
    let path = request.uri().path().to_string();
    if !open_path(&path) && request.method() != Method::OPTIONS {
        let token = device_token(&headers);
        let Some(kind) = token.as_deref().and_then(|token| authorize(&state, token)) else {
            let peer = request
                .extensions()
                .get::<ConnectInfo<SocketAddr>>()
                .map(|peer| peer.0.ip().to_string())
                .unwrap_or_default();
            let why = if token.is_some() {
                "an unknown or revoked device"
            } else {
                "no device cookie"
            };
            log::info!("[spopi-host] phone refused {peer} {path}: {why}");
            return html(StatusCode::UNAUTHORIZED, "Not paired", NOT_PAIRED);
        };
        request.extensions_mut().insert(kind);
    }
    let mut response = next.run(request).await;
    for (name, value) in security_headers() {
        response.headers_mut().insert(name, value.parse().unwrap());
    }
    response
}

fn request_host(headers: &HeaderMap, uri: &axum::http::Uri) -> String {
    headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| uri.authority().map(|authority| authority.to_string()))
        .unwrap_or_default()
}

fn authorize(state: &HostState, token: &str) -> Option<ClientKind> {
    let meta = state.metadata.as_ref()?.lock().ok()?;
    let device = meta.find_device_by_token_hash(&token_hash(token)).ok()??;
    if device.revoked {
        return None;
    }
    let now = now_secs();
    if device.last_seen_at.unwrap_or(0) + 60 <= now {
        let _ = meta.touch_device(&device.id, now);
    }
    Some(ClientKind::Remote {
        device_id: device.id,
        name: device.name,
        tier: Tier::from_name(&device.tier),
    })
}

pub(super) fn document(status: StatusCode, body: String) -> Response {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .header(header::CACHE_CONTROL, "no-store")
        .body(Body::from(body))
        .unwrap_or_else(|_| Response::new(Body::empty()))
}

async fn phone_index(State(state): State<Arc<HostState>>) -> Response {
    document(
        StatusCode::OK,
        crate::host::server::ui_assets::index_html(&state.ui.shipped, Some(&state.ui.root), true),
    )
}

pub(super) fn html(status: StatusCode, title: &str, text: &str) -> Response {
    document(status, super::page::message(title, text))
}

fn router(state: Arc<HostState>, static_dir: PathBuf) -> Router {
    let ui = crate::host::server::ui_assets::router(static_dir, Some(state.ui.root.clone()), true);
    Router::new()
        .route("/", get(phone_index))
        .route("/index.html", get(phone_index))
        .merge(super::pair::routes())
        .route("/v2/ws", get(websocket_upgrade))
        .merge(crate::host::server::http::phone_runtime::routes())
        .merge(ui)
        .layer(middleware::from_fn_with_state(
            state.clone(),
            crate::host::server::http::ui::serve_overlay,
        ))
        .layer(middleware::from_fn_with_state(state.clone(), gate))
        .layer(tower_http::compression::CompressionLayer::new())
        .with_state(state)
}

/// Runs until `handle` is told to shut down.
pub async fn serve(
    addr: SocketAddr,
    static_dir: PathBuf,
    tls_dir: PathBuf,
    state: Arc<HostState>,
    handle: axum_server::Handle,
) -> Result<(), String> {
    if addr.ip().is_unspecified() {
        return Err("the phone listener never binds 0.0.0.0".into());
    }
    state.phone.set_tls_dir(tls_dir.clone());
    let _ = rustls::crypto::ring::default_provider().install_default();
    let files =
        cert::ensure(&tls_dir, "spopi.local", Some(addr.ip())).map_err(|e| e.to_string())?;
    let config =
        axum_server::tls_rustls::RustlsConfig::from_pem_file(&files.cert_pem, &files.key_pem)
            .await
            .map_err(|e| e.to_string())?;
    let app = router(state, static_dir).into_make_service_with_connect_info::<SocketAddr>();
    axum_server::bind_rustls(addr, config)
        .handle(handle)
        .serve(app)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::router;
    use crate::data::metadata_store::MetadataStore;
    use crate::host::phone::token_hash;
    use crate::host::server::HostServer;
    use crate::pi::runtime::PiRuntime;
    use axum::body::Body;
    use axum::http::Request;
    use rusqlite::params;
    use std::sync::{Arc, Mutex};
    use tower::ServiceExt;

    async fn started() -> (HostServer, std::path::PathBuf, std::path::PathBuf) {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let temp = std::env::temp_dir().join(format!("spopi-phone-listen-{nonce}"));
        let public = temp.join("public");
        std::fs::create_dir_all(&public).unwrap();
        std::fs::write(
            public.join("index.html"),
            "<head></head><base href=\"/\" /><h1>SPOPI</h1>",
        )
        .unwrap();
        let meta = Arc::new(Mutex::new(
            MetadataStore::open(&temp.join("spopi.sqlite3")).unwrap(),
        ));
        let host = HostServer::start_with_workspaces(
            public.clone(),
            PiRuntime::new(32),
            std::collections::HashMap::new(),
            None,
            Some(meta),
        )
        .await
        .unwrap();
        (host, public, temp)
    }

    fn insert_device(host: &HostServer, id: &str, token: &str, revoked: bool) {
        insert_device_with_tier(host, id, token, revoked, "control");
    }

    fn insert_device_with_tier(
        host: &HostServer,
        id: &str,
        token: &str,
        revoked: bool,
        tier: &str,
    ) {
        let state = host.state();
        let meta = state.metadata.as_ref().unwrap().lock().unwrap();
        meta.connection()
            .execute(
                "INSERT INTO devices (id, name, token_hash, tier, created_at, last_seen_at, revoked_at) VALUES (?1, 'phone', ?2, ?4, 1, NULL, ?3)",
                params![id, token_hash(token), if revoked { Some(1_i64) } else { None }, tier],
            )
            .unwrap();
    }

    #[tokio::test]
    async fn a_phone_reaches_the_session_routes_by_tier() {
        let (host, public, temp) = started().await;
        insert_device_with_tier(&host, "watch", "watch-token", false, "observe");
        insert_device(&host, "chat", "chat-token", false);
        let call = |token: &str| {
            router(host.state(), public.clone()).oneshot(
                Request::builder()
                    .uri("/v2/bootstrap?workspaceId=missing&sessionId=missing")
                    .header("cookie", format!("spopi_device={token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
        };
        let observe = call("watch-token").await.unwrap();
        assert_eq!(observe.status(), axum::http::StatusCode::FORBIDDEN);
        let control = call("chat-token").await.unwrap();
        assert_ne!(control.status(), axum::http::StatusCode::FORBIDDEN);
        let body = axum::body::to_bytes(control.into_body(), 64 * 1024)
            .await
            .unwrap();
        let reply: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert!(reply["error"]["code"].is_string(), "{reply}");
        assert_ne!(reply["error"]["code"], "not_allowed");
        let _ = std::fs::remove_dir_all(temp);
    }

    #[tokio::test]
    async fn phone_gate_requires_a_live_device_and_serves_the_ca() {
        let (host, public, temp) = started().await;
        let tls = temp.join("tls");
        std::fs::create_dir_all(&tls).unwrap();
        std::fs::write(tls.join("spopi-ca.crt"), "CA-PEM").unwrap();
        host.state().phone.set_tls_dir(tls);
        insert_device(&host, "revoked", "revoked-token", true);
        insert_device(&host, "live", "live-token", false);

        let denied = router(host.state(), public.clone())
            .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(denied.status(), axum::http::StatusCode::UNAUTHORIZED);

        let revoked = router(host.state(), public.clone())
            .oneshot(
                Request::builder()
                    .uri("/")
                    .header("cookie", "spopi_device=revoked-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(revoked.status(), axum::http::StatusCode::UNAUTHORIZED);

        let allowed = router(host.state(), public.clone())
            .oneshot(
                Request::builder()
                    .uri("/")
                    .header("cookie", "spopi_device=live-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(allowed.status(), axum::http::StatusCode::OK);
        let split = router(host.state(), public.clone())
            .oneshot(
                Request::builder()
                    .uri("/")
                    .header("cookie", "spopi-theme=dawn")
                    .header("cookie", "spopi_device=live-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            split.status(),
            axum::http::StatusCode::OK,
            "Firefox sends each cookie in its own header over HTTP/2"
        );
        let body = axum::body::to_bytes(allowed.into_body(), 64 * 1024)
            .await
            .unwrap();
        let html = String::from_utf8(body.to_vec()).unwrap();
        assert!(html.contains("manifest.webmanifest"));
        // Without credentials the manifest fetch is refused like any unpaired request.
        assert!(html.contains("crossorigin=\"use-credentials\""));
        let seen = host
            .state()
            .metadata
            .as_ref()
            .unwrap()
            .lock()
            .unwrap()
            .find_device_by_token_hash(&token_hash("live-token"))
            .unwrap()
            .unwrap();
        assert!(seen.last_seen_at.is_some());

        let ca = router(host.state(), public)
            .oneshot(
                Request::builder()
                    .uri("/pair/ca.crt")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(ca.status(), axum::http::StatusCode::OK);
        assert_eq!(
            ca.headers().get("content-type").unwrap(),
            "application/x-x509-ca-cert"
        );

        let loopback = reqwest::get(format!("{}/not-a-real-page", host.origin()))
            .await
            .unwrap()
            .text()
            .await
            .unwrap();
        assert!(!loopback.contains("manifest.webmanifest"));
        let _ = std::fs::remove_dir_all(temp);
    }

    #[tokio::test]
    async fn a_paired_phone_loads_the_ui_after_it_changes() {
        let (host, public, temp) = started().await;
        insert_device(&host, "live", "live-token", false);
        // The overlay root is the real app data folder here, so only the shipped tree changes.
        std::fs::write(public.join("added.js"), "export {};").unwrap();
        let page = router(host.state(), public)
            .oneshot(
                Request::builder()
                    .uri("/")
                    .header("cookie", "spopi_device=live-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(page.status(), axum::http::StatusCode::OK);
        let body = axum::body::to_bytes(page.into_body(), 64 * 1024)
            .await
            .unwrap();
        assert!(String::from_utf8_lossy(&body).contains("<h1>SPOPI</h1>"));
        let _ = std::fs::remove_dir_all(temp);
    }

    #[tokio::test]
    async fn phone_replies_with_brotli_when_the_client_asks() {
        let (host, public, temp) = started().await;
        insert_device(&host, "live", "live-token", false);
        std::fs::write(public.join("big.js"), "x".repeat(4096)).unwrap();
        let page = router(host.state(), public.clone())
            .oneshot(
                Request::builder()
                    .uri("/")
                    .header("cookie", "spopi_device=live-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let html = String::from_utf8(
            axum::body::to_bytes(page.into_body(), 64 * 1024)
                .await
                .unwrap()
                .to_vec(),
        )
        .unwrap();
        let marker = "<base href=\"";
        let start = html.find(marker).unwrap() + marker.len();
        let end = html[start..].find('"').unwrap();
        let base = &html[start..start + end];
        let asset = router(host.state(), public)
            .oneshot(
                Request::builder()
                    .uri(format!("{base}big.js"))
                    .header("cookie", "spopi_device=live-token")
                    .header("accept-encoding", "br")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            asset
                .headers()
                .get("content-encoding")
                .and_then(|value| value.to_str().ok()),
            Some("br")
        );
        let _ = std::fs::remove_dir_all(temp);
    }
}
