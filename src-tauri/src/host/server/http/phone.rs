// ABOUTME: Desktop HTTP for phone access: settings, pairing, devices, and UI accept.
// ABOUTME: The phone browser uses the HTTPS listener, not these loopback routes.

use super::super::HostState;
use crate::host::capabilities::capability_names;
use crate::host::phone::listen;
use crate::host::phone::{self, new_token, now_secs, token_hash};
use crate::host::router::{ClientKind, Tier};
use axum::extract::{ConnectInfo, State};
use axum::Json;
use qrcode::QrCode;
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;

pub async fn status(State(state): State<Arc<HostState>>) -> Json<Value> {
    let changes = ui_changes(&state);
    state.phone.set_ui_current(changes.is_empty());
    Json(json!({
        "enabled": state.phone.ca_is_open(),
        "changes": changes.iter().map(|c| json!({"path": c.path, "kind": c.kind})).collect::<Vec<_>>(),
    }))
}

pub async fn accept(State(state): State<Arc<HostState>>) -> Json<Value> {
    let current = current_map(&state);
    if let Some(meta) = &state.metadata {
        if let Ok(mut guard) = meta.lock() {
            let value = Value::Object(
                current
                    .iter()
                    .map(|(k, v)| (k.clone(), Value::String(v.clone())))
                    .collect(),
            );
            let _ = guard.preference_set("phone.ui.accepted", &value);
        }
    }
    state.phone.set_ui_current(true);
    let _ = state
        .fanout
        .send(json!({"type": "ui_reload", "kind": "full"}));
    Json(json!({"ok": true}))
}

#[derive(Deserialize)]
pub struct PairRequest {
    pub host: String,
    pub port: u16,
}

pub async fn pair(
    State(_state): State<Arc<HostState>>,
    Json(body): Json<PairRequest>,
) -> Json<Value> {
    let url = format!("https://{}:{}/pair", body.host, body.port);
    let svg = QrCode::new(url.as_bytes())
        .ok()
        .map(|code| {
            code.render::<qrcode::render::svg::Color>()
                .min_dimensions(180, 180)
                .build()
        })
        .unwrap_or_default();
    Json(json!({"url": url, "svg": svg}))
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
        return Json(
            json!({"ok": true, "denied": true, "name": name, "source": source.to_string()}),
        );
    }
    let token = new_token();
    let tier_name = body.tier.unwrap_or_else(|| "control".into());
    let tier = match tier_name.as_str() {
        "observe" => Tier::Observe,
        "full" => Tier::Full,
        _ => Tier::Control,
    };
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
                rusqlite::params![body.claim_id, name, token_hash(&token), tier_name, now_secs()],
            );
        }
    }
    if !state.phone.approve_named(&body.claim_id, token) {
        return Json(json!({"error": "unknown_claim"}));
    }
    Json(json!({"ok": true}))
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

#[derive(Deserialize)]
pub struct Enable {
    pub enabled: bool,
    pub ip: String,
    pub port: u16,
    pub allow: Vec<String>,
}

pub async fn enable(
    State(state): State<Arc<HostState>>,
    ConnectInfo(_peer): ConnectInfo<SocketAddr>,
    Json(body): Json<Enable>,
) -> Json<Value> {
    state.phone.set_allow(body.allow);
    state.phone.set_ca_open(body.enabled);
    if !body.enabled {
        return Json(json!({"ok": true, "enabled": false}));
    }
    let Ok(ip) = body.ip.parse::<IpAddr>() else {
        return Json(json!({"error": "bad_ip"}));
    };
    if ip.is_unspecified() {
        return Json(json!({"error": "unspecified"}));
    }
    ensure_accepted_baseline(&state);
    refresh_ui_current(&state);
    let listener_state = Arc::clone(&state);
    let static_dir = state.ui.shipped.clone();
    let dir = crate::data::app_paths::config_dir().join("tls");
    let addr = SocketAddr::from((ip, body.port));
    tokio::spawn(async move {
        if let Err(error) = listen::serve(addr, static_dir, dir, listener_state).await {
            log::warn!("[spopi-host] phone listener: {error}");
        }
    });
    Json(json!({"ok": true, "enabled": true}))
}

fn current_map(state: &HostState) -> BTreeMap<String, String> {
    let shipped = phone::hash_tree(&state.ui.shipped);
    if state.ui.is_safe() {
        return shipped;
    }
    phone::effective(&shipped, &phone::hash_tree(&state.ui.root))
}

pub(crate) fn refresh_ui_current(state: &HostState) {
    state.phone.set_ui_current(ui_changes(state).is_empty());
}

fn ui_changes(state: &HostState) -> Vec<phone::Change> {
    let current = current_map(state);
    let accepted = accepted_map(state);
    phone::changes(&current, &accepted)
}

/// First enable records the tree phones are already allowed to see.
fn ensure_accepted_baseline(state: &HostState) {
    if !accepted_map(state).is_empty() {
        return;
    }
    let current = current_map(state);
    if current.is_empty() {
        return;
    }
    if let Some(meta) = &state.metadata {
        if let Ok(mut guard) = meta.lock() {
            let value = Value::Object(
                current
                    .iter()
                    .map(|(k, v)| (k.clone(), Value::String(v.clone())))
                    .collect(),
            );
            let _ = guard.preference_set("phone.ui.accepted", &value);
        }
    }
    state.phone.set_ui_current(true);
}

fn accepted_map(state: &HostState) -> BTreeMap<String, String> {
    let Some(meta) = &state.metadata else {
        return BTreeMap::new();
    };
    let Ok(guard) = meta.lock() else {
        return BTreeMap::new();
    };
    let Ok(Some(Value::Object(map))) = guard.preference_get("phone.ui.accepted") else {
        return BTreeMap::new();
    };
    json_map(map)
}

fn json_map(map: Map<String, Value>) -> BTreeMap<String, String> {
    map.into_iter()
        .filter_map(|(k, v)| v.as_str().map(|s| (k, s.to_string())))
        .collect()
}
