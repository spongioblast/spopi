// ABOUTME: Desktop HTTP for phone access: settings, pairing, and devices.
// ABOUTME: The phone browser uses the HTTPS listener, not these loopback routes.

use super::super::HostState;
use crate::host::capabilities::capability_names;
use crate::host::phone::listen;
use crate::host::phone::{self, new_token, now_secs, token_hash};
use crate::host::router::{ClientKind, Tier};
use axum::extract::State;
use axum::Json;
use qrcode::QrCode;
use serde::Deserialize;
use serde_json::{json, Value};
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;

pub async fn status(State(state): State<Arc<HostState>>) -> Json<Value> {
    Json(json!({ "enabled": state.phone.is_enabled() }))
}

#[derive(Deserialize)]
pub struct PairRequest {
    pub host: String,
    pub port: u16,
}

/// Each call mints a new pairing secret and invalidates the previous QR code.
pub async fn pair(
    State(state): State<Arc<HostState>>,
    Json(body): Json<PairRequest>,
) -> Json<Value> {
    let secret = state.phone.issue_pair_code();
    let url = format!("https://{}:{}/pair#{secret}", body.host, body.port);
    let svg = QrCode::new(url.as_bytes())
        .ok()
        .map(|code| {
            code.render::<qrcode::render::svg::Color>()
                .min_dimensions(180, 180)
                .build()
        })
        .unwrap_or_default();
    Json(json!({
        "url": url,
        "svg": svg,
        "expiresIn": phone::PAIR_CODE_TTL.as_secs(),
    }))
}

#[derive(Deserialize)]
pub struct Decide {
    #[serde(rename = "claimId")]
    pub claim_id: String,
    pub tier: Option<String>,
    pub deny: Option<bool>,
}

pub async fn decide(State(state): State<Arc<HostState>>, Json(body): Json<Decide>) -> Json<Value> {
    let Some((name, source)) = state.phone.named_claim(&body.claim_id) else {
        return Json(json!({"error": "unknown_claim"}));
    };
    if body.deny.unwrap_or(false) {
        let _ = state.phone.deny_named(&body.claim_id);
        settled(&state, &body.claim_id);
        return Json(
            json!({"ok": true, "denied": true, "name": name, "source": source.to_string()}),
        );
    }
    let token = new_token();
    let tier = Tier::from_name(body.tier.as_deref().unwrap_or_default());
    let device = ClientKind::Remote {
        device_id: body.claim_id.clone(),
        name: name.clone(),
        tier,
    };
    log::info!("[spopi-host] remote {name} {:?}", capability_names(&device));
    if let Some(meta) = &state.metadata {
        if let Ok(guard) = meta.lock() {
            let _ = guard.connection().execute(
                "INSERT INTO devices (id, name, token_hash, tier, created_at, last_seen_at, revoked_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5, NULL)",
                rusqlite::params![body.claim_id, name, token_hash(&token), tier.name(), now_secs()],
            );
        }
    }
    if !state.phone.approve_named(&body.claim_id, token) {
        return Json(json!({"error": "unknown_claim"}));
    }
    settled(&state, &body.claim_id);
    Json(json!({"ok": true}))
}

/// Closes the request dialog in every other desktop window.
fn settled(state: &HostState, claim_id: &str) {
    let _ = state
        .fanout
        .send(json!({"type": "phone_claim_settled", "claimId": claim_id}));
}

pub async fn devices(State(state): State<Arc<HostState>>) -> Json<Value> {
    let mut rows = Vec::new();
    if let Some(meta) = &state.metadata {
        if let Ok(guard) = meta.lock() {
            let conn = guard.connection();
            let mut stmt = conn
                .prepare("SELECT id, name, tier, created_at, last_seen_at, revoked_at FROM devices")
                .ok();
            if let Some(stmt) = stmt.as_mut() {
                let mapped = stmt.query_map([], |row| {
                    Ok(json!({
                        "id": row.get::<_, String>(0)?,
                        "name": row.get::<_, String>(1)?,
                        "tier": row.get::<_, String>(2)?,
                        "createdAt": row.get::<_, i64>(3)?,
                        "lastSeenAt": row.get::<_, Option<i64>>(4)?,
                        "revokedAt": row.get::<_, Option<i64>>(5)?,
                    }))
                });
                if let Ok(mapped) = mapped {
                    rows.extend(mapped.flatten());
                }
            }
        }
    }
    Json(json!({"devices": rows}))
}

#[derive(Deserialize)]
pub struct Revoke {
    pub id: String,
}

pub async fn revoke(State(state): State<Arc<HostState>>, Json(body): Json<Revoke>) -> Json<Value> {
    if let Some(meta) = &state.metadata {
        if let Ok(guard) = meta.lock() {
            let _ = guard.connection().execute(
                "UPDATE devices SET revoked_at = ?1 WHERE id = ?2",
                rusqlite::params![now_secs(), body.id],
            );
        }
    }
    state.device_sockets.close(&body.id);
    let _ = state
        .fanout
        .send(json!({"type": "device_revoked", "id": body.id}));
    Json(json!({"ok": true}))
}

pub async fn firewall_status() -> Json<Value> {
    let status = tokio::task::spawn_blocking(crate::platform::firewall::status)
        .await
        .unwrap_or_default();
    Json(json!(status))
}

#[derive(Deserialize)]
pub struct FirewallAllow {
    pub port: u16,
    pub allow: Vec<String>,
}

pub async fn firewall_allow(Json(body): Json<FirewallAllow>) -> Json<Value> {
    let entries: Vec<&str> = body
        .allow
        .iter()
        .map(|entry| entry.trim())
        .filter(|entry| !entry.is_empty())
        .collect();
    if let Some(bad) = entries.iter().find(|e| !phone::allow_entry_valid(e)) {
        return Json(json!({"ok": false, "error": "allow_invalid", "entry": bad}));
    }
    if entries.is_empty() {
        return Json(json!({"ok": false, "error": "allow_empty"}));
    }
    let result = tokio::task::spawn_blocking(move || {
        crate::platform::firewall::allow(body.port, &body.allow)
    })
    .await
    .unwrap_or_else(|error| Err(error.to_string()));
    match result {
        Ok(()) => Json(json!({"ok": true})),
        Err(error) => Json(json!({"ok": false, "error": error})),
    }
}

#[derive(Deserialize)]
pub struct Enable {
    pub enabled: bool,
    pub ip: String,
    pub port: u16,
    pub allow: Vec<String>,
}

const ENABLED_KEY: &str = "ui.phone.enabled";

pub async fn enable(State(state): State<Arc<HostState>>, Json(body): Json<Enable>) -> Json<Value> {
    let wanted = body.enabled;
    let reply = apply_enable(&state, body).await;
    if reply.get("ok").and_then(Value::as_bool) == Some(true) {
        remember_enabled(&state, wanted);
    }
    Json(reply)
}

fn remember_enabled(state: &HostState, enabled: bool) {
    let Some(store) = state.metadata.as_ref() else {
        return;
    };
    if let Ok(mut store) = store.lock() {
        if let Err(error) = store.preference_set(ENABLED_KEY, &Value::Bool(enabled)) {
            log::warn!("[spopi-host] cannot save {ENABLED_KEY}: {error}");
        }
    }
}

/// Turns phone access back on at startup when it was on when SPOPI closed.
pub(crate) async fn restore(state: Arc<HostState>) {
    let Some(body) = saved_enable(&state) else {
        return;
    };
    let address = format!("{}:{}", body.ip, body.port);
    let reply = apply_enable(&state, body).await;
    if reply.get("ok").and_then(Value::as_bool) != Some(true) {
        log::warn!("[spopi-host] phone access did not come back on {address}: {reply}");
    }
}

fn saved_enable(state: &HostState) -> Option<Enable> {
    let store = state.metadata.as_ref()?.lock().ok()?;
    let get = |key: &str| store.preference_get(key).ok().flatten();
    if get(ENABLED_KEY).and_then(|value| value.as_bool()) != Some(true) {
        return None;
    }
    let ip = get("ui.phone.ip")?.as_str()?.to_string();
    let port = get("ui.phone.port")
        .and_then(|value| value.as_u64())
        .and_then(|value| u16::try_from(value).ok())
        .unwrap_or(57640);
    let allow = get("ui.phone.allow")?
        .as_array()?
        .iter()
        .filter_map(|entry| entry.as_str().map(str::to_string))
        .collect();
    Some(Enable {
        enabled: true,
        ip,
        port,
        allow,
    })
}

async fn apply_enable(state: &Arc<HostState>, body: Enable) -> Value {
    let allow: Vec<String> = body
        .allow
        .iter()
        .map(|entry| entry.trim().to_string())
        .filter(|entry| !entry.is_empty())
        .collect();
    if !body.enabled {
        stop_listener(state);
        state.phone.forget_pair_code();
        state.phone.set_enabled(false);
        state.phone.set_allow(
            allow
                .into_iter()
                .filter(|e| phone::allow_entry_valid(e))
                .collect(),
        );
        return json!({"ok": true, "enabled": false});
    }
    if let Some(bad) = allow.iter().find(|entry| !phone::allow_entry_valid(entry)) {
        return json!({"error": "allow_invalid", "entry": bad});
    }
    if allow.is_empty() {
        return json!({"error": "allow_empty"});
    }
    let Ok(ip) = body.ip.parse::<IpAddr>() else {
        return json!({"error": "bad_ip"});
    };
    if ip.is_unspecified() {
        return json!({"error": "unspecified"});
    }
    state.phone.set_allow(allow);
    state.phone.set_enabled(true);
    let addr = SocketAddr::from((ip, body.port));
    if state.phone.listener_addr() == Some(addr) {
        return json!({"ok": true, "enabled": true});
    }
    stop_listener(state);
    let dir = crate::data::app_paths::config_dir().join("tls");
    match start_listener(state, addr, dir).await {
        Ok(()) => json!({"ok": true, "enabled": true}),
        Err(error) => {
            state.phone.set_enabled(false);
            json!({"error": "listen_failed", "detail": error})
        }
    }
}

fn stop_listener(state: &HostState) {
    if let Some(running) = state.phone.replace_listener(None) {
        running.handle.shutdown();
    }
}

/// Waits until the listener is bound, so a busy port or a missing address is reported.
pub(crate) async fn start_listener(
    state: &Arc<HostState>,
    addr: SocketAddr,
    tls_dir: std::path::PathBuf,
) -> Result<(), String> {
    let handle = axum_server::Handle::new();
    let mut task = tokio::spawn(listen::serve(
        addr,
        state.ui.shipped.clone(),
        tls_dir,
        Arc::clone(state),
        handle.clone(),
    ));
    let started = tokio::time::timeout(std::time::Duration::from_secs(15), async {
        tokio::select! {
            bound = handle.listening() => match bound {
                Some(_) => Ok(()),
                None => Err(task_error((&mut task).await)),
            },
            done = &mut task => Err(task_error(done)),
        }
    })
    .await
    .unwrap_or_else(|_| Err("the listener did not start".into()));
    if let Err(error) = started {
        handle.shutdown();
        task.abort();
        log::warn!("[spopi-host] phone listener {addr}: {error}");
        return Err(error);
    }
    state
        .phone
        .replace_listener(Some(phone::RunningListener { addr, handle }));
    tokio::spawn(async move {
        if let Ok(Err(error)) = task.await {
            log::warn!("[spopi-host] phone listener {addr}: {error}");
        }
    });
    Ok(())
}

fn task_error(done: Result<Result<(), String>, tokio::task::JoinError>) -> String {
    match done {
        Ok(Err(error)) => error,
        Ok(Ok(())) => "the listener stopped".into(),
        Err(error) => error.to_string(),
    }
}
