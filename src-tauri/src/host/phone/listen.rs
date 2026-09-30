// ABOUTME: Opt-in HTTPS listener for phone clients. It never binds every interface.
// ABOUTME: A device cookie or bearer token is required except on the pair routes.

use super::cert;
use super::{now_secs, origin_matches, token_hash};
use crate::host::router::{ClientKind, Tier};
use crate::host::server::ws::websocket_upgrade;
use crate::host::server::HostState;
use axum::body::Body;
use axum::extract::{ConnectInfo, Path, State};
use axum::http::{header, HeaderMap, Method, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

pub const PHONE_CSP: &str = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

pub fn security_headers() -> [(header::HeaderName, &'static str); 4] {
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
    let cookie = headers
        .get(header::COOKIE)
        .and_then(|value| value.to_str().ok())?;
    for part in cookie.split(';') {
        let part = part.trim();
        if let Some(token) = part.strip_prefix("spopi_device=") {
            if !token.is_empty() {
                return Some(token.to_string());
            }
        }
    }
    None
}

fn open_path(path: &str) -> bool {
    path == "/pair"
        || path == "/pair/claim"
        || path.starts_with("/pair/claim/")
        || path == "/pair/ca.crt"
        || path.starts_with("/pair/")
        || path.starts_with("/v/")
        || path.starts_with("/locales/")
}

fn tier_from_name(name: &str) -> Tier {
    match name {
        "observe" => Tier::Observe,
        "full" => Tier::Full,
        _ => Tier::Control,
    }
}

pub async fn gate(
    State(state): State<Arc<HostState>>,
    mut request: axum::extract::Request,
    next: Next,
) -> Response {
    let headers = request.headers().clone();
    if let Some(peer) = request.extensions().get::<ConnectInfo<SocketAddr>>() {
        if !state.phone.allows(peer.0.ip()) {
            return html(StatusCode::FORBIDDEN, "source is outside the allowlist");
        }
    }
    let host = request_host(&headers, request.uri());
    let origin = headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok());
    if origin.is_some() && !origin_matches(&format!("https://{host}"), origin) {
        return html(StatusCode::FORBIDDEN, "origin is not this listener");
    }
    let path = request.uri().path().to_string();
    if !open_path(&path) && request.method() != Method::OPTIONS {
        let Some(token) = device_token(&headers) else {
            return html(StatusCode::UNAUTHORIZED, "A paired device is required");
        };
        let Some(kind) = authorize(&state, &token) else {
            return html(StatusCode::UNAUTHORIZED, "A paired device is required");
        };
        if (path == "/" || path == "/index.html") && !state.phone.ui_current() {
            return waiting_page();
        }
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
        tier: tier_from_name(&device.tier),
    })
}

fn document(body: String) -> Response {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .header(header::CACHE_CONTROL, "no-store")
        .body(Body::from(body))
        .unwrap_or_else(|_| Response::new(Body::empty()))
}

async fn phone_index(State(state): State<Arc<HostState>>) -> Response {
    document(crate::host::server::ui_assets::index_html(
        &state.ui.shipped,
        Some(&state.ui.root),
        true,
    ))
}

fn html(status: StatusCode, text: &str) -> Response {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .body(Body::from(format!("<p>{text}</p>")))
        .unwrap_or_else(|_| Response::new(Body::empty()))
}

pub fn waiting_page() -> Response {
    html(
        StatusCode::OK,
        "UI changed on the desktop, waiting for approval",
    )
}

#[derive(Deserialize)]
pub struct ClaimBody {
    pub name: String,
}

pub async fn claim(
    State(state): State<Arc<HostState>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Json(body): Json<ClaimBody>,
) -> Json<Value> {
    let name = body.name.trim();
    let name = if name.is_empty() { "Phone" } else { name };
    let id = state.phone.open_named_claim(peer.ip(), name);
    let _ = state.fanout.send(json!({
        "type": "phone_claim_pending",
        "claimId": id,
        "name": name,
        "source": peer.ip().to_string(),
    }));
    Json(json!({ "claimId": id }))
}

pub async fn claim_status(State(state): State<Arc<HostState>>, Path(id): Path<String>) -> Response {
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(30);
    loop {
        match state.phone.named_outcome(&id) {
            super::NamedOutcome::Approved(token) => {
                let mut response = Json(json!({ "ok": true })).into_response();
                let cookie =
                    format!("spopi_device={token}; HttpOnly; Secure; SameSite=Strict; Path=/");
                if let Ok(value) = axum::http::HeaderValue::from_str(&cookie) {
                    response.headers_mut().insert(header::SET_COOKIE, value);
                }
                return response;
            }
            super::NamedOutcome::Denied => {
                return Json(json!({ "ok": false, "denied": true })).into_response();
            }
            super::NamedOutcome::Expired | super::NamedOutcome::Missing => {
                return Json(json!({ "error": "expired" })).into_response();
            }
            super::NamedOutcome::Pending => {
                if tokio::time::Instant::now() >= deadline {
                    return Json(json!({ "status": "pending" })).into_response();
                }
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            }
        }
    }
}

pub async fn pair_page(State(_state): State<Arc<HostState>>) -> Response {
    document(
        r#"<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pair</title></head><body>
<main><input aria-label="Device name" value="Phone"><button type="button">Pair this phone</button>
<p id="pair-status">Approve on your desktop</p></main>
<script>
document.querySelector("button").addEventListener("click", async () => {
  const name = document.querySelector("input").value;
  const status = document.getElementById("pair-status");
  const response = await fetch("/pair/claim", {method:"POST", credentials:"include", headers:{"content-type":"application/json"}, body: JSON.stringify({name})});
  const raw = await response.text();
  let opened = {};
  try { opened = JSON.parse(raw); } catch (error) {}
  status.textContent = response.status + " " + raw.slice(0, 200);
  if (!opened.claimId) return;
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    const result = await fetch("/pair/claim/" + encodeURIComponent(opened.claimId), {credentials:"include"}).then((response) => response.json());
    if (result.ok) { location.assign("/"); return; }
    if (result.denied || result.error) return;
  }
});
</script></body></html>"#
            .to_string(),
    )
}

async fn ca_cert(State(state): State<Arc<HostState>>) -> Response {
    let path = state.phone.tls_dir().join("spopi-ca.crt");
    match std::fs::read(&path) {
        Ok(bytes) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "application/x-x509-ca-cert")
            .body(Body::from(bytes))
            .unwrap_or_else(|_| Response::new(Body::empty())),
        Err(_) => html(StatusCode::NOT_FOUND, "CA is not ready"),
    }
}

pub fn router(state: Arc<HostState>, static_dir: PathBuf) -> Router {
    let ui = crate::host::server::ui_assets::router(static_dir, Some(state.ui.root.clone()), true);
    Router::new()
        .route("/", get(phone_index))
        .route("/index.html", get(phone_index))
        .route("/pair", get(pair_page))
        .route("/pair/claim", post(claim))
        .route("/pair/claim/{id}", get(claim_status))
        .route("/pair/ca.crt", get(ca_cert))
        .route("/v2/ws", get(websocket_upgrade))
        .merge(ui)
        .layer(middleware::from_fn_with_state(
            state.clone(),
            crate::host::server::http::ui::serve_overlay,
        ))
        .layer(middleware::from_fn_with_state(state.clone(), gate))
        .layer(tower_http::compression::CompressionLayer::new())
        .with_state(state)
}

pub async fn serve(
    addr: SocketAddr,
    static_dir: PathBuf,
    tls_dir: PathBuf,
    state: Arc<HostState>,
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
        let state = host.state();
        let meta = state.metadata.as_ref().unwrap().lock().unwrap();
        meta.connection()
            .execute(
                "INSERT INTO devices (id, name, token_hash, tier, created_at, last_seen_at, revoked_at) VALUES (?1, 'phone', ?2, 'control', 1, NULL, ?3)",
                params![id, token_hash(token), if revoked { Some(1_i64) } else { None }],
            )
            .unwrap();
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
        let body = axum::body::to_bytes(allowed.into_body(), 64 * 1024)
            .await
            .unwrap();
        let html = String::from_utf8(body.to_vec()).unwrap();
        assert!(html.contains("manifest.webmanifest"));
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

    #[tokio::test]
    async fn claim_decide_and_deny_drive_the_long_poll() {
        use super::{claim, claim_status, ClaimBody};
        use crate::host::server::http::phone::{decide, Decide};
        use axum::extract::{ConnectInfo, Path, State};
        use axum::Json;

        let (host, _public, temp) = started().await;
        let state = host.state();
        let peer = "192.168.1.20:443".parse().unwrap();
        let Json(opened) = claim(
            State(state.clone()),
            ConnectInfo(peer),
            Json(ClaimBody {
                name: "Pixel".into(),
            }),
        )
        .await;
        let id = opened["claimId"].as_str().unwrap().to_string();
        assert!(opened.get("token").is_none());
        let waiting = state.clone();
        let waiting_id = id.clone();
        let poll =
            tokio::spawn(async move { claim_status(State(waiting), Path(waiting_id)).await });
        tokio::time::sleep(std::time::Duration::from_millis(40)).await;
        let Json(decided) = decide(
            State(state.clone()),
            Json(Decide {
                claim_id: id,
                tier: Some("observe".into()),
                deny: None,
            }),
        )
        .await;
        assert_eq!(decided["ok"], true);
        assert!(decided.get("token").is_none());
        let response = poll.await.unwrap();
        let cookie = response
            .headers()
            .get(axum::http::header::SET_COOKIE)
            .unwrap()
            .to_str()
            .unwrap();
        assert!(cookie.starts_with("spopi_device="));
        assert!(cookie.contains("HttpOnly"));
        let text = String::from_utf8(
            axum::body::to_bytes(response.into_body(), 4096)
                .await
                .unwrap()
                .to_vec(),
        )
        .unwrap();
        assert!(text.contains("\"ok\":true"));
        assert!(!text.contains("spopi_device"));

        let Json(denied_open) = claim(
            State(state.clone()),
            ConnectInfo(peer),
            Json(ClaimBody {
                name: "Other".into(),
            }),
        )
        .await;
        let denied_id = denied_open["claimId"].as_str().unwrap().to_string();
        let _ = decide(
            State(state.clone()),
            Json(Decide {
                claim_id: denied_id.clone(),
                tier: None,
                deny: Some(true),
            }),
        )
        .await;
        let denied = claim_status(State(state), Path(denied_id)).await;
        assert!(denied
            .headers()
            .get(axum::http::header::SET_COOKIE)
            .is_none());
        let _ = std::fs::remove_dir_all(temp);
    }
}
