// ABOUTME: WebSocket upgrade and the per-connection event loop.
// ABOUTME: Moved out of host_server/mod.rs; dispatch stays on the facade.

pub(super) mod route;

use super::auth::trusted_loopback_request;
use super::{send_error, structured_error, HostState, OpError, MAX_WS_MESSAGE_BYTES};
use crate::host::capabilities::capability_names;
use crate::host::router::{ClientKind, RoutedAction, PROTOCOL_VERSION};
use crate::pi::coordinator::RuntimeTarget;
use crate::platform::window_owner::OwnerId;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, State};
use axum::http::{HeaderMap, StatusCode, Uri};
use axum::response::IntoResponse;
use axum::response::Response;
use futures_util::{SinkExt, StreamExt};
use route::dispatch;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

pub(crate) async fn websocket_upgrade(
    State(state): State<Arc<HostState>>,
    peer: ConnectInfo<std::net::SocketAddr>,
    headers: HeaderMap,
    uri: Uri,
    kind: Option<axum::Extension<ClientKind>>,
    websocket: WebSocketUpgrade,
) -> Response {
    let loopback = trusted_loopback_request(peer, &headers, &uri);
    let kind = match kind {
        Some(axum::Extension(kind)) => kind,
        None if loopback => ClientKind::Desktop,
        None => {
            return (StatusCode::UNAUTHORIZED, "A paired device is required").into_response();
        }
    };
    websocket
        .max_message_size(MAX_WS_MESSAGE_BYTES)
        .on_upgrade(move |socket| handle_websocket(socket, state, kind))
}

pub(super) async fn handle_websocket(
    mut socket: WebSocket,
    state: Arc<HostState>,
    kind: ClientKind,
) {
    let Some(Ok(Message::Text(first))) = socket.next().await else {
        return;
    };
    let hello = match serde_json::from_str::<Value>(&first) {
        Ok(frame) => frame,
        Err(_) => {
            let _ = send_error(&mut socket, None, "invalid_json", "Invalid JSON frame").await;
            return;
        }
    };
    let client_id = match hello.get("clientId").and_then(Value::as_str) {
        Some(value) if !value.is_empty() => value.to_owned(),
        _ => {
            let _ = send_error(
                &mut socket,
                None,
                "invalid_client_id",
                "clientId is required",
            )
            .await;
            return;
        }
    };
    let handshake = state
        .router
        .lock()
        .map_err(|_| "Host router unavailable".to_string())
        .and_then(|mut router| {
            router
                .connect_as(&client_id, &hello, kind.clone())
                .map_err(|error| error.message)
        });
    if let Err(message) = handshake {
        let _ = send_error(&mut socket, None, "handshake_rejected", &message).await;
        return;
    }
    let terminal_owner = OwnerId::from_client_id(&client_id);
    if let Ok(mut clients) = state.ws_clients.lock() {
        track_connect(&mut clients, &client_id);
    }
    if socket
        .send(Message::Text(
            json!({
                "type": "hello_ack",
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": capability_names(&kind),
                "hostId": state.host_id,
            })
            .to_string()
            .into(),
        ))
        .await
        .is_err()
    {
        return;
    }

    let mut runtime_events = state.runtimes.subscribe();
    let mut terminal_events = state.terminal_events.subscribe();
    let mut git_events = state.git_events.subscribe();
    let mut ui_events = state.ui.subscribe();
    let mut fanout = state.fanout.subscribe();
    let mut subscriptions = HashSet::new();

    // Writing goes through a channel so this loop never blocks on the socket,
    // and — more importantly — so request dispatch can move off this task. A
    // runtime request stays pending for as long as the Pi command it triggers
    // runs, and a command that opens an extension dialog only finishes once
    // the user answers it. Answering needs the `extension_ui_request` event
    // that this very loop delivers, so awaiting dispatch inline deadlocked the
    // dialog until the 30s RPC timeout fired.
    let (mut socket_sink, mut socket_stream) = socket.split();
    let (outgoing_tx, mut outgoing_rx) = tokio::sync::mpsc::unbounded_channel::<Message>();
    let writer = tokio::spawn(async move {
        while let Some(message) = outgoing_rx.recv().await {
            if socket_sink.send(message).await.is_err() {
                break;
            }
        }
    });
    let send_frame = |value: Value| outgoing_tx.send(Message::Text(value.to_string().into()));
    let (remote_socket, mut close_rx, desktop_hold) =
        if let ClientKind::Remote { device_id, .. } = &kind {
            let (id, rx) = state.device_sockets.register(device_id);
            (Some((device_id.clone(), id)), rx, None)
        } else {
            let (tx, rx) = tokio::sync::mpsc::channel(1);
            (None, rx, Some(tx))
        };
    let _desktop_hold = desktop_hold;

    'connection: loop {
        tokio::select! {
            _ = close_rx.recv() => {
                break;
            }
            incoming = socket_stream.next() => {
                let Some(Ok(message)) = incoming else { break };
                let Message::Text(text) = message else {
                    if matches!(message, Message::Close(_)) { break; }
                    continue;
                };
                let frame = match serde_json::from_str::<Value>(&text) {
                    Ok(frame) => frame,
                    Err(_) => {
                        let _ = send_frame(structured_error(None, "invalid_json", "Invalid JSON frame"));
                        continue;
                    }
                };
                let request_id = frame
                    .get("requestId")
                    .and_then(Value::as_str)
                    .map(str::to_owned);
                let routed = state
                    .router
                    .lock()
                    .map_err(|_| ("router_unavailable", "Host router unavailable".to_string()))
                    .and_then(|router| {
                        router
                            .route(&client_id, &frame)
                            .map_err(|error| (error.code, error.message))
                    });
                // Subscribe stays on this task: it mutates `subscriptions`,
                // which the runtime-event branch below reads, and it never
                // awaits. Every other action is dispatched on its own task so a
                // long-running Pi command cannot stall event delivery.
                let mut after_response = Vec::new();
                let response = match routed {
                    Ok(RoutedAction::Subscribe { request_id, target, .. }) => {
                        match serde_json::from_value::<RuntimeTarget>(target) {
                            Ok(target) => {
                                subscriptions.insert(target.clone());
                                // The newest subscription is the chat this client shows.
                                state.runtimes.set_foreground(&client_id, &target);
                                let owns_session = state
                                    .session_owners
                                    .lock()
                                    .map(|mut owners| {
                                        owners.entry(target.clone()).or_insert_with(|| client_id.clone()) == &client_id
                                    })
                                    .unwrap_or(false);
                                if owns_session {
                                    if let Ok(pending) = state.runtimes.pending_extension_ui(&target) {
                                        after_response.extend(pending.into_iter().map(runtime_event_frame));
                                    }
                                }
                                Ok(json!({ "type": "runtime_subscribed", "requestId": request_id }))
                            }
                            Err(_) => Err(("invalid_target", "Runtime target is invalid".into())),
                        }
                    }
                    Ok(action) => {
                        let state = Arc::clone(&state);
                        let outgoing_tx = outgoing_tx.clone();
                        tokio::spawn(async move {
                            let outgoing = match dispatch(action, &state).await {
                                Ok(value) => value,
                                Err(OpError { code, message }) => {
                                    structured_error(request_id.as_deref(), code, &message)
                                }
                            };
                            let _ = outgoing_tx.send(Message::Text(outgoing.to_string().into()));
                        });
                        continue;
                    }
                    Err((code, message)) => Err((code, message)),
                };
                let outgoing = match response {
                    Ok(value) => value,
                    Err((code, message)) => structured_error(request_id.as_deref(), code, &message),
                };
                if send_frame(outgoing).is_err() {
                    break;
                }
                for replay in after_response {
                    if send_frame(replay).is_err() {
                        break 'connection;
                    }
                }
            }
            event = runtime_events.recv() => {
                match event {
                    Ok(event) if subscriptions.contains(&event.target) => {
                        if send_frame(runtime_event_frame(event)).is_err() {
                            break;
                        }
                    }
                    Ok(_) => {}
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        let outgoing = structured_error(
                            None,
                            "event_sequence_gap",
                            "Runtime events were missed; request a snapshot",
                        );
                        if send_frame(outgoing).is_err() {
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
            event = terminal_events.recv() => {
                match event {
                    Ok((owner, outgoing)) if owner == terminal_owner => {
                        if send_frame(outgoing).is_err() {
                            break;
                        }
                    }
                    Ok(_) | Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
            event = fanout.recv() => {
                if let Ok(frame) = event {
                    if !fanout_reaches(&kind, &frame) {
                        continue;
                    }
                    if send_frame(frame).is_err() {
                        break;
                    }
                }
            }
            event = ui_events.recv() => {
                if let Ok(kind) = event {
                    if send_frame(json!({ "type": "ui_reload", "kind": kind })).is_err() {
                        break;
                    }
                }
            }
            event = git_events.recv() => {
                match event {
                    Ok((owner, outgoing)) if owner == client_id => {
                        if send_frame(outgoing).is_err() {
                            break;
                        }
                    }
                    Ok(_) | Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }
    if let Some((device_id, id)) = remote_socket {
        state.device_sockets.unregister(&device_id, id);
    }
    drop(outgoing_tx);
    let _ = writer.await;
    if let Ok(mut owners) = state.session_owners.lock() {
        owners.retain(|_, owner| owner != &client_id);
    }
    state.runtimes.clear_foreground(&client_id);
    let last_socket = state
        .ws_clients
        .lock()
        .map(|mut clients| track_disconnect(&mut clients, &client_id))
        .unwrap_or(false);
    if last_socket {
        schedule_terminal_reap(state, client_id, terminal_owner);
    }
}

/// Pairing requests are answered on the desktop only; a paired phone never sees them.
fn fanout_reaches(kind: &ClientKind, frame: &Value) -> bool {
    let desktop_only = matches!(
        frame.get("type").and_then(Value::as_str),
        Some("phone_claim_pending" | "phone_claim_settled")
    );
    !(desktop_only && matches!(kind, ClientKind::Remote { .. }))
}

/// Grace before an owner's PTYs are reaped after its last socket closes. A
/// reload reconnects with the same sessionStorage clientId well inside this.
pub(crate) const TERMINAL_REAP_GRACE: Duration = Duration::from_secs(15);

pub(crate) fn track_connect(clients: &mut std::collections::HashMap<String, usize>, id: &str) {
    *clients.entry(id.to_owned()).or_insert(0) += 1;
}

/// Decrement the open-socket count; true when this was the client's last socket.
pub(crate) fn track_disconnect(
    clients: &mut std::collections::HashMap<String, usize>,
    id: &str,
) -> bool {
    match clients.get_mut(id) {
        Some(count) if *count > 1 => {
            *count -= 1;
            false
        }
        Some(_) => {
            clients.remove(id);
            true
        }
        None => true,
    }
}

fn schedule_terminal_reap(state: Arc<HostState>, client_id: String, owner: OwnerId) {
    tokio::spawn(async move {
        tokio::time::sleep(TERMINAL_REAP_GRACE).await;
        let reconnected = state
            .ws_clients
            .lock()
            .map(|clients| clients.contains_key(&client_id))
            .unwrap_or(true);
        if reconnected {
            return;
        }
        let manager = state.terminal_manager.clone();
        let _ = tokio::task::spawn_blocking(move || manager.kill_owner(&owner)).await;
    });
}

/// Most runtime commands are answered as soon as Pi has accepted them, so a
/// short deadline keeps a wedged runtime from leaking a pending request.
pub(crate) const RUNTIME_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
/// `prompt` is the exception. An extension command runs inline and its response
/// only arrives once the handler returns — and a handler that opens a dialog
/// does not return until the user has answered it, possibly several screens
/// later. Bound that generously instead of at human-reaction speed; a 30s
/// deadline turned every extension menu into a spurious "request failed".
pub(crate) const RUNTIME_INTERACTIVE_REQUEST_TIMEOUT: Duration = Duration::from_secs(15 * 60);

pub(crate) fn runtime_request_timeout(command: &Value) -> Duration {
    match command.get("type").and_then(Value::as_str) {
        Some("prompt") => RUNTIME_INTERACTIVE_REQUEST_TIMEOUT,
        _ => RUNTIME_REQUEST_TIMEOUT,
    }
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn extension_ui_requires_owner(event: &Value) -> bool {
    if event.get("type").and_then(Value::as_str) != Some("extension_ui_request") {
        return false;
    }
    matches!(
        event.get("method").and_then(Value::as_str),
        Some("select" | "confirm" | "input" | "editor")
    )
}

pub(super) fn runtime_event_frame(event: crate::pi::runtime::NativeRuntimeEvent) -> Value {
    json!({
        "type": "runtime_event",
        "target": event.target,
        "sequence": event.sequence,
        "event": event.event,
    })
}

type DeviceSocket = (u64, tokio::sync::mpsc::Sender<()>);

pub(crate) struct DeviceSockets {
    next: std::sync::atomic::AtomicU64,
    sockets: std::sync::Mutex<std::collections::HashMap<String, Vec<DeviceSocket>>>,
}

impl Default for DeviceSockets {
    fn default() -> Self {
        Self {
            next: std::sync::atomic::AtomicU64::new(1),
            sockets: std::sync::Mutex::new(std::collections::HashMap::new()),
        }
    }
}

impl DeviceSockets {
    pub(crate) fn register(&self, device_id: &str) -> (u64, tokio::sync::mpsc::Receiver<()>) {
        let (tx, rx) = tokio::sync::mpsc::channel(1);
        let id = self.next.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        self.sockets
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .entry(device_id.to_string())
            .or_default()
            .push((id, tx));
        (id, rx)
    }

    pub(crate) fn unregister(&self, device_id: &str, id: u64) {
        let mut sockets = self.sockets.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(list) = sockets.get_mut(device_id) {
            list.retain(|(socket_id, _)| *socket_id != id);
            if list.is_empty() {
                sockets.remove(device_id);
            }
        }
    }

    pub(crate) fn close(&self, device_id: &str) {
        self.sockets
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(device_id);
    }
}

#[cfg(test)]
mod tests {
    use super::{fanout_reaches, DeviceSockets};
    use crate::host::router::{ClientKind, Tier};
    use serde_json::json;

    #[test]
    fn pairing_requests_reach_the_desktop_only() {
        let phone = ClientKind::Remote {
            device_id: "d".into(),
            name: "Pixel".into(),
            tier: Tier::Full,
        };
        let claim = json!({"type": "phone_claim_pending", "claimId": "c"});
        assert!(fanout_reaches(&ClientKind::Desktop, &claim));
        assert!(!fanout_reaches(&phone, &claim));
        let settled = json!({"type": "phone_claim_settled", "claimId": "c"});
        assert!(fanout_reaches(&ClientKind::Desktop, &settled));
        assert!(!fanout_reaches(&phone, &settled));
        assert!(fanout_reaches(&phone, &json!({"type": "ui_reload"})));
    }

    #[tokio::test]
    async fn revoke_closes_a_registered_socket() {
        let sockets = DeviceSockets::default();
        let (id, mut rx) = sockets.register("dev");
        sockets.close("dev");
        assert!(rx.recv().await.is_none());
        sockets.unregister("dev", id);
    }
}
