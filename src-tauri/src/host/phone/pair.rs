// ABOUTME: Phone pair routes: the pair page, named claims with their long poll, and the CA download.
// ABOUTME: Open without a device token; the desktop approves a claim, this file only hands out the cookie.

use super::listen::{document, html};
use super::NamedOutcome;
use crate::host::server::HostState;
use axum::body::Body;
use axum::extract::{ConnectInfo, Path, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;
use std::net::SocketAddr;
use std::sync::Arc;

const NAME_MAX_CHARS: usize = 40;
/// 400 days, the most browsers keep a cookie. Revoking the device ends it sooner.
const DEVICE_COOKIE_MAX_AGE: u64 = 400 * 24 * 60 * 60;

#[derive(Deserialize)]
struct ClaimBody {
    name: String,
    #[serde(default)]
    code: String,
}

async fn claim(
    State(state): State<Arc<HostState>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Json(body): Json<ClaimBody>,
) -> Response {
    if !state.phone.consume_pair_code(body.code.trim()) {
        return (StatusCode::FORBIDDEN, Json(json!({ "error": "pair_code" }))).into_response();
    }
    let name: String = body.name.trim().chars().take(NAME_MAX_CHARS).collect();
    let name = if name.is_empty() {
        "Phone".to_string()
    } else {
        name
    };
    let id = state.phone.open_named_claim(peer.ip(), &name);
    let _ = state.fanout.send(json!({
        "type": "phone_claim_pending",
        "claimId": id,
        "name": name,
        "source": peer.ip().to_string(),
    }));
    Json(json!({ "claimId": id })).into_response()
}

async fn claim_status(
    State(state): State<Arc<HostState>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Path(id): Path<String>,
) -> Response {
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(30);
    loop {
        match state.phone.named_status(&id, peer.ip()) {
            NamedOutcome::Ready | NamedOutcome::Approved(_) => {
                return Json(json!({ "ok": true, "enter": format!("/pair/enter/{id}") }))
                    .into_response();
            }
            NamedOutcome::Denied => {
                return Json(json!({ "ok": false, "denied": true })).into_response();
            }
            NamedOutcome::Expired | NamedOutcome::Missing => {
                return Json(json!({ "error": "expired" })).into_response();
            }
            NamedOutcome::Pending => {
                if tokio::time::Instant::now() >= deadline {
                    return Json(json!({ "status": "pending" })).into_response();
                }
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            }
        }
    }
}

/// The page navigates here once approved. Some phone browsers drop a cookie that
/// arrives on a `fetch` response, so it is set on this top-level navigation instead.
async fn enter(
    State(state): State<Arc<HostState>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Path(id): Path<String>,
) -> Response {
    let NamedOutcome::Approved(token) = state.phone.named_outcome(&id, peer.ip()) else {
        log::info!(
            "[spopi-phone] {} opened a used or expired pairing link",
            peer.ip()
        );
        return html(
            StatusCode::NOT_FOUND,
            "Link expired",
            "This pairing link was already used or has expired. Click Pair on the desktop again and scan the new code.",
        );
    };
    log::info!("[spopi-phone] {} received its device cookie", peer.ip());
    let cookie = format!(
        "spopi_device={token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age={DEVICE_COOKIE_MAX_AGE}"
    );
    let mut response = Response::builder()
        .status(StatusCode::SEE_OTHER)
        .header(header::LOCATION, "/")
        .header(header::CACHE_CONTROL, "no-store")
        .body(Body::empty())
        .unwrap_or_else(|_| Response::new(Body::empty()));
    if let Ok(value) = axum::http::HeaderValue::from_str(&cookie) {
        response.headers_mut().insert(header::SET_COOKIE, value);
    }
    response
}

const PAIR_BODY: &str = r#"<h1>Pair this phone</h1>
<p id="pair-intro">Give this phone a name. SPOPI on your desktop then asks you to allow it.</p>
<form id="pair-form">
<label>Device name<input name="name" maxlength="40" value="Phone" autocomplete="off"></label>
<button type="submit">Pair this phone</button>
</form>
<p id="pair-status" class="status" role="status" aria-live="polite"></p>
<script>
const code = location.hash.slice(1);
history.replaceState(null, "", location.pathname);
const form = document.getElementById("pair-form");
const button = form.querySelector("button");
const status = document.getElementById("pair-status");
const say = (text, state = "") => { status.textContent = text; status.dataset.state = state; };
const again = "Click Pair on the desktop again and scan the new code.";
if (!code) {
  form.hidden = true;
  document.getElementById("pair-intro").textContent = "Open this page by scanning the code in SPOPI on your desktop: Settings → Phone access → Pair.";
}
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  button.disabled = true;
  say("Sending the request…", "wait");
  const name = form.elements.name.value;
  let opened = {};
  try {
    const response = await fetch("/pair/claim", {method:"POST", credentials:"include", headers:{"content-type":"application/json"}, body: JSON.stringify({name, code})});
    opened = await response.json();
  } catch (error) { say("Could not reach SPOPI. Check that the phone is on the same network, then try again.", "error"); button.disabled = false; return; }
  if (opened.error === "pair_code") { say("This code was already used or has expired. " + again, "error"); return; }
  if (!opened.claimId) { say("Pairing failed. " + again, "error"); return; }
  form.hidden = true;
  say("Waiting for you to allow this phone on the desktop…", "wait");
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    let result = {};
    try { result = await fetch("/pair/claim/" + encodeURIComponent(opened.claimId), {credentials:"include"}).then((response) => response.json()); }
    catch (error) { await new Promise((done) => setTimeout(done, 2000)); continue; }
    if (result.ok) { say("Allowed. Opening SPOPI…", "ok"); location.replace(result.enter || "/"); return; }
    if (result.denied) { say("The desktop declined this phone.", "error"); return; }
    if (result.error) { say("The request expired. " + again, "error"); return; }
  }
  say("The request expired. " + again, "error");
});
</script>"#;

async fn pair_page() -> Response {
    document(
        StatusCode::OK,
        super::page::shell("Pair this phone", PAIR_BODY),
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
        Err(_) => html(
            StatusCode::NOT_FOUND,
            "Certificate not ready",
            "The certificate is not ready yet. Turn phone access on in SPOPI on the desktop, then try again.",
        ),
    }
}

pub(super) fn routes() -> Router<Arc<HostState>> {
    Router::new()
        .route("/pair", get(pair_page))
        .route("/pair/claim", post(claim))
        .route("/pair/claim/{id}", get(claim_status))
        .route("/pair/enter/{id}", get(enter))
        .route("/pair/ca.crt", get(ca_cert))
}

#[cfg(test)]
mod tests {
    use super::{claim, claim_status, enter, ClaimBody};
    use crate::data::metadata_store::MetadataStore;
    use crate::host::server::http::phone::{decide, Decide};
    use crate::host::server::HostServer;
    use crate::pi::runtime::PiRuntime;
    use axum::extract::{ConnectInfo, Path, State};
    use axum::Json;
    use std::sync::{Arc, Mutex};

    #[tokio::test]
    async fn claim_decide_and_deny_drive_the_long_poll() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let temp = std::env::temp_dir().join(format!("spopi-phone-pair-{nonce}"));
        let public = temp.join("public");
        std::fs::create_dir_all(&public).unwrap();
        std::fs::write(public.join("index.html"), "<head></head><h1>SPOPI</h1>").unwrap();
        let meta = Arc::new(Mutex::new(
            MetadataStore::open(&temp.join("spopi.sqlite3")).unwrap(),
        ));
        let host = HostServer::start_with_workspaces(
            public,
            PiRuntime::new(32),
            std::collections::HashMap::new(),
            None,
            Some(meta),
        )
        .await
        .unwrap();
        let state = host.state();
        let peer: std::net::SocketAddr = "192.168.1.20:443".parse().unwrap();
        let refused = claim(
            State(state.clone()),
            ConnectInfo(peer),
            Json(ClaimBody {
                name: "Pixel".into(),
                code: "guessed".into(),
            }),
        )
        .await;
        assert_eq!(refused.status(), axum::http::StatusCode::FORBIDDEN);

        let code = state.phone.issue_pair_code();
        let opened = body_json(
            claim(
                State(state.clone()),
                ConnectInfo(peer),
                Json(ClaimBody {
                    name: "Pixel".into(),
                    code: code.clone(),
                }),
            )
            .await,
        )
        .await;
        let id = opened["claimId"].as_str().unwrap().to_string();
        assert!(opened.get("token").is_none());
        let reused = claim(
            State(state.clone()),
            ConnectInfo(peer),
            Json(ClaimBody {
                name: "Again".into(),
                code,
            }),
        )
        .await;
        assert_eq!(reused.status(), axum::http::StatusCode::FORBIDDEN);

        let waiting = state.clone();
        let waiting_id = id.clone();
        let poll = tokio::spawn(async move {
            claim_status(State(waiting), ConnectInfo(peer), Path(waiting_id)).await
        });
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
        assert!(response
            .headers()
            .get(axum::http::header::SET_COOKIE)
            .is_none());
        let polled = body_json(response).await;
        assert_eq!(polled["ok"], true);
        let link = polled["enter"].as_str().unwrap().to_string();
        let entry_id = link.strip_prefix("/pair/enter/").unwrap().to_string();
        let stranger: std::net::SocketAddr = "192.168.1.99:443".parse().unwrap();
        let foreign = enter(
            State(state.clone()),
            ConnectInfo(stranger),
            Path(entry_id.clone()),
        )
        .await;
        assert_eq!(foreign.status(), axum::http::StatusCode::NOT_FOUND);
        let entered = enter(
            State(state.clone()),
            ConnectInfo(peer),
            Path(entry_id.clone()),
        )
        .await;
        assert_eq!(entered.status(), axum::http::StatusCode::SEE_OTHER);
        assert_eq!(entered.headers()[axum::http::header::LOCATION], "/");
        let cookie = entered.headers()[axum::http::header::SET_COOKIE]
            .to_str()
            .unwrap();
        assert!(cookie.starts_with("spopi_device="));
        assert!(cookie.contains("HttpOnly"));
        // Strict is dropped by iOS browsers on a page opened from the camera's QR scan.
        assert!(cookie.contains("SameSite=Lax"));
        assert!(cookie.contains("Max-Age="));
        let again = enter(State(state.clone()), ConnectInfo(peer), Path(entry_id)).await;
        assert!(again
            .headers()
            .get(axum::http::header::SET_COOKIE)
            .is_none());

        let denied_open = body_json(
            claim(
                State(state.clone()),
                ConnectInfo(peer),
                Json(ClaimBody {
                    name: "Other".into(),
                    code: state.phone.issue_pair_code(),
                }),
            )
            .await,
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
        let denied = claim_status(State(state), ConnectInfo(peer), Path(denied_id)).await;
        assert!(denied
            .headers()
            .get(axum::http::header::SET_COOKIE)
            .is_none());
        let _ = std::fs::remove_dir_all(temp);
    }

    async fn body_json(response: axum::response::Response) -> serde_json::Value {
        let bytes = axum::body::to_bytes(response.into_body(), 4096)
            .await
            .unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }
}
