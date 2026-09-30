// ABOUTME: Tests the host server: health, static files, and the loopback check.
// ABOUTME: A non-loopback Host header is unauthorized.
// ABOUTME: Host server integration tests moved out of the facade.
use super::auth::{is_public_http_request, trusted_loopback_request};
use super::ws::{
    extension_ui_requires_owner, runtime_request_timeout, track_connect, track_disconnect,
    RUNTIME_INTERACTIVE_REQUEST_TIMEOUT, RUNTIME_REQUEST_TIMEOUT,
};
use super::{
    bundled_skill_dir, messages_from_entries_response, parse_host_port_override, HostServer,
};
use crate::data::metadata_store::MetadataStore;
use crate::pi::coordinator::RuntimeTarget;
use crate::pi::runtime::PiRuntime;
use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use std::fs;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

fn non_loopback_ipv4() -> Option<std::net::Ipv4Addr> {
    let socket = std::net::UdpSocket::bind((std::net::Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    match socket.local_addr().ok()?.ip() {
        std::net::IpAddr::V4(ip) if !ip.is_loopback() && !ip.is_unspecified() => Some(ip),
        _ => None,
    }
}

#[test]
fn the_customize_skill_is_found_next_to_the_installed_ui() {
    let resources = tempfile::tempdir().unwrap();
    let public = resources.path().join("public");
    let skill = resources.path().join("skills").join("spopi-customize");
    fs::create_dir_all(&public).unwrap();
    assert_eq!(bundled_skill_dir(&public, false), None);
    fs::create_dir_all(&skill).unwrap();
    fs::write(skill.join("SKILL.md"), "---\nname: spopi-customize\n---\n").unwrap();
    assert_eq!(bundled_skill_dir(&public, false), Some(skill));
    let dev = bundled_skill_dir(&resources.path().join("elsewhere").join("public"), true);
    assert!(dev.is_some_and(|dir| dir.ends_with("resources/skills/spopi-customize")));
}

#[test]
fn last_socket_disconnect_marks_the_client_for_terminal_reap() {
    let mut clients = std::collections::HashMap::new();
    track_connect(&mut clients, "desktop-a");
    track_connect(&mut clients, "desktop-a");
    // A reload overlaps: the old socket closes while the new one is open.
    assert!(!track_disconnect(&mut clients, "desktop-a"));
    assert!(clients.contains_key("desktop-a"));
    assert!(track_disconnect(&mut clients, "desktop-a"));
    assert!(!clients.contains_key("desktop-a"));
    // Unknown ids are treated as gone so a reap can never be skipped.
    assert!(track_disconnect(&mut clients, "never-seen"));
}

#[test]
fn parses_spopi_host_port_override() {
    assert_eq!(parse_host_port_override(Some("57700")), Some(57700));
    assert_eq!(parse_host_port_override(Some(" 57700 ")), Some(57700));
    assert_eq!(parse_host_port_override(Some("")), None);
    assert_eq!(parse_host_port_override(Some("nope")), None);
    assert_eq!(parse_host_port_override(None), None);
}

#[test]
fn exposes_static_assets_and_only_the_minimum_unauthenticated_protocol_routes() {
    use axum::http::Method;

    for path in [
        "/",
        "/app",
        "/locales/en.json",
        "/icons/logo-dark.svg",
        "/v/build/style.css",
    ] {
        assert!(is_public_http_request(&Method::GET, path), "{path}");
    }
    assert!(is_public_http_request(&Method::GET, "/v2/ws"));

    for (method, path) in [
        (Method::POST, "/v2/auth/exchange"),
        (Method::GET, "/v2/remote-access"),
        (Method::POST, "/v2/auth/device-requests"),
        (Method::POST, "/v2/auth/device-requests/request-1/claim"),
        (Method::GET, "/v2/auth/device-requests"),
        (Method::POST, "/v2/auth/device-requests/request-1/approve"),
        (Method::GET, "/v2/sessions"),
        (Method::GET, "/api/files/content"),
        (Method::DELETE, "/api/files/content"),
        (Method::GET, "/health/runtime"),
    ] {
        assert!(!is_public_http_request(&method, path), "{path}");
    }
}

#[test]
fn loopback_authority_requires_actual_peer_and_accepts_supported_hosts() {
    use axum::extract::connect_info::ConnectInfo;
    use axum::http::{HeaderMap, HeaderValue, Uri};
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};

    let peer = ConnectInfo(SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 1));
    let uri = Uri::from_static("/health");
    for host in [
        "localhost",
        "localhost:57620",
        "127.0.0.1:57620",
        "[::1]:57620",
    ] {
        let mut headers = HeaderMap::new();
        headers.insert("host", HeaderValue::from_static(host));
        assert!(trusted_loopback_request(peer, &headers, &uri), "{host}");
    }
    assert!(trusted_loopback_request(
        peer,
        &HeaderMap::new(),
        &Uri::from_static("http://localhost:57620/health"),
    ));
    let mut external = HeaderMap::new();
    external.insert("host", HeaderValue::from_static("remote.example"));
    assert!(!trusted_loopback_request(peer, &external, &uri));
    let non_loopback = ConnectInfo(SocketAddr::new(
        IpAddr::V4(Ipv4Addr::new(192, 168, 1, 10)),
        1,
    ));
    let mut spoofed = HeaderMap::new();
    spoofed.insert("host", HeaderValue::from_static("127.0.0.1:57620"));
    assert!(!trusted_loopback_request(non_loopback, &spoofed, &uri));
    let ipv6_peer = ConnectInfo(SocketAddr::new(IpAddr::V6(Ipv6Addr::LOCALHOST), 1));
    assert!(!trusted_loopback_request(ipv6_peer, &external, &uri));
    let mut ipv6_headers = HeaderMap::new();
    ipv6_headers.insert("host", HeaderValue::from_static("[::1]:57620"));
    assert!(trusted_loopback_request(ipv6_peer, &ipv6_headers, &uri));
}

#[test]
fn only_blocking_extension_ui_requests_require_the_session_owner() {
    assert!(extension_ui_requires_owner(&json!({
        "type": "extension_ui_request",
        "method": "select"
    })));
    assert!(!extension_ui_requires_owner(&json!({
        "type": "extension_ui_request",
        "method": "notify",
        "message": "{\"__spopiConfig\":\"cfg-1\",\"ok\":true}"
    })));
    assert!(!extension_ui_requires_owner(&json!({
        "type": "agent_start"
    })));
}

#[test]
fn derives_active_branch_messages_with_user_and_assistant_entry_ids_from_entries() {
    let response = json!({
        "type": "response",
        "command": "get_entries",
        "success": true,
        "data": {
            "leafId": "assistant-2",
            "entries": [
                {
                    "type": "message",
                    "id": "user-1",
                    "parentId": null,
                    "message": { "role": "user", "content": "first" }
                },
                {
                    "type": "message",
                    "id": "assistant-1",
                    "parentId": "user-1",
                    "message": { "role": "assistant", "content": [{ "type": "text", "text": "old" }] }
                },
                {
                    "type": "message",
                    "id": "user-abandoned",
                    "parentId": "assistant-1",
                    "message": { "role": "user", "content": "abandoned" }
                },
                {
                    "type": "message",
                    "id": "user-2",
                    "parentId": "assistant-1",
                    "message": { "role": "user", "content": "current" }
                },
                {
                    "type": "message",
                    "id": "assistant-2",
                    "parentId": "user-2",
                    "message": { "role": "assistant", "content": [{ "type": "text", "text": "new" }] }
                }
            ]
        }
    });

    let messages = messages_from_entries_response(&response);

    assert_eq!(
        messages,
        json!([
            { "role": "user", "content": "first", "entryId": "user-1" },
            { "role": "assistant", "content": [{ "type": "text", "text": "old" }], "entryId": "assistant-1" },
            { "role": "user", "content": "current", "entryId": "user-2" },
            { "role": "assistant", "content": [{ "type": "text", "text": "new" }], "entryId": "assistant-2" }
        ])
    );
}

#[tokio::test]
async fn serves_health_and_static_assets_from_one_origin() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let temp = std::env::temp_dir().join(format!("spopi-host-{nonce}"));
    let public = temp.join("public");
    fs::create_dir_all(&public).unwrap();
    fs::write(public.join("index.html"), "<h1>SPOPI native host</h1>").unwrap();
    let host = HostServer::start_with_workspaces(
        public,
        PiRuntime::new(32),
        std::collections::HashMap::new(),
        None,
        None,
    )
    .await
    .unwrap();

    let root = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap()
        .get(format!("{}/", host.origin()))
        .send()
        .await
        .unwrap();
    assert_eq!(root.status(), reqwest::StatusCode::TEMPORARY_REDIRECT);
    assert_eq!(root.headers().get("location").unwrap(), "/app");

    let health: serde_json::Value = reqwest::get(format!("{}/health", host.origin()))
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(health["protocolVersion"], 2);
    assert_eq!(health["piVersion"], env!("SPOPI_PI_VERSION_BUNDLED"));
    let pi_bin = health["piBin"].as_str().expect("bundled pi path");
    assert!(
        pi_bin.ends_with("pi.exe") || pi_bin.ends_with("pi"),
        "piBin should be the bundled binary, got {pi_bin}"
    );
    assert!(
        !pi_bin.eq_ignore_ascii_case("pi") && !pi_bin.eq_ignore_ascii_case("pi.exe"),
        "piBin must be a path, not a PATH lookup"
    );
    let index = reqwest::get(format!("{}/app/settings", host.origin()))
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    assert!(index.contains("SPOPI native host"));

    drop(host);
    let _ = fs::remove_dir_all(temp);
}

#[tokio::test]
async fn rejects_a_non_loopback_host_header() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let temp = std::env::temp_dir().join(format!("spopi-host-auth-boundary-{nonce}"));
    let public = temp.join("public");
    fs::create_dir_all(&public).unwrap();
    fs::write(public.join("index.html"), "SPOPI").unwrap();
    let host = HostServer::start_with_workspaces(
        public,
        PiRuntime::new(32),
        std::collections::HashMap::new(),
        None,
        None,
    )
    .await
    .unwrap();
    let client = reqwest::Client::new();
    let runtime_url = format!("{}/health/runtime", host.origin());

    let loopback = client.get(&runtime_url).send().await.unwrap();
    assert!(loopback.status().is_success());

    let external_authority = client
        .get(&runtime_url)
        .header("host", "remote.example")
        .send()
        .await
        .unwrap();
    assert_eq!(
        external_authority.status(),
        reqwest::StatusCode::UNAUTHORIZED
    );

    let invalid_bearer = client
        .get(&runtime_url)
        .header("host", "remote.example")
        .bearer_auth("invalid-token")
        .send()
        .await
        .unwrap();
    assert_eq!(invalid_bearer.status(), reqwest::StatusCode::UNAUTHORIZED);

    let port: u16 = host.origin().rsplit(':').next().unwrap().parse().unwrap();
    if let Some(ip) = non_loopback_ipv4() {
        let refused = std::net::TcpStream::connect_timeout(
            &std::net::SocketAddr::from((ip, port)),
            std::time::Duration::from_millis(400),
        );
        assert!(
            refused.is_err(),
            "loopback host accepted a connection on {ip}:{port}"
        );
    }

    drop(host);
    let _ = fs::remove_dir_all(temp);
}

#[tokio::test]
async fn serves_static_assets_under_a_content_fingerprinted_path() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let temp = std::env::temp_dir().join(format!("spopi-host-versioned-{nonce}"));
    let public = temp.join("public");
    fs::create_dir_all(public.join("native")).unwrap();
    fs::write(
        public.join("index.html"),
        "<html><head><base href=\"/\" /></head><body>SPOPI</body></html>",
    )
    .unwrap();
    fs::write(public.join("native/app.js"), "export const marker = 1;").unwrap();
    let host = HostServer::start_with_workspaces(
        public,
        PiRuntime::new(32),
        std::collections::HashMap::new(),
        None,
        None,
    )
    .await
    .unwrap();

    // The entry document's <base> should point at a `/v/<fingerprint>/`
    // path derived from the bundle contents, not the literal "/" that's
    // on disk — every relative script/import resolves under it.
    let index_response = reqwest::get(format!("{}/app/settings", host.origin()))
        .await
        .unwrap();
    assert_eq!(
        index_response
            .headers()
            .get("cache-control")
            .and_then(|value| value.to_str().ok()),
        Some("no-store, no-cache, must-revalidate, max-age=0")
    );
    let index = index_response.text().await.unwrap();
    let base_start = index.find("<base href=\"").unwrap() + "<base href=\"".len();
    let base_end = index[base_start..].find('"').unwrap();
    let base_href = &index[base_start..base_start + base_end];
    assert!(
        base_href.starts_with("/v/") && base_href.ends_with('/'),
        "expected a versioned base href, got {base_href:?}"
    );

    // The versioned path actually serves the underlying files.
    let app_js = reqwest::get(format!("{}{}native/app.js", host.origin(), base_href))
        .await
        .unwrap();
    assert_eq!(
        app_js
            .headers()
            .get("cache-control")
            .and_then(|value| value.to_str().ok()),
        Some("public, max-age=31536000, immutable")
    );
    let app_js = app_js.text().await.unwrap();
    assert_eq!(app_js, "export const marker = 1;");

    drop(host);
    let _ = fs::remove_dir_all(temp);
}

#[tokio::test]
async fn health_runtime_reports_zero_runtimes_when_idle() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let temp = std::env::temp_dir().join(format!("spopi-host-runtime-{nonce}"));
    let public = temp.join("public");
    fs::create_dir_all(&public).unwrap();
    fs::write(public.join("index.html"), "<h1>SPOPI native host</h1>").unwrap();
    let host = HostServer::start_with_workspaces(
        public,
        PiRuntime::new(32),
        std::collections::HashMap::new(),
        None,
        None,
    )
    .await
    .unwrap();

    let body: serde_json::Value = reqwest::get(format!("{}/health/runtime", host.origin()))
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(body["status"], "ok");
    assert_eq!(body["runtimeCount"], 0);
    assert!(body["runtimes"].as_array().unwrap().is_empty());

    drop(host);
    let _ = fs::remove_dir_all(temp);
}

#[tokio::test]
async fn sends_runtime_events_only_after_an_explicit_target_subscription() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let temp = std::env::temp_dir().join(format!("spopi-host-ws-{nonce}"));
    let public = temp.join("public");
    fs::create_dir_all(&public).unwrap();
    fs::write(public.join("index.html"), "SPOPI").unwrap();
    let runtimes = PiRuntime::new(32);
    let target = RuntimeTarget::new("workspace-a", "session-a", "instance-a");
    let mut fake = runtimes.register_in_memory(target.clone()).unwrap();
    let host = HostServer::start_with_workspaces(
        public,
        runtimes,
        std::collections::HashMap::new(),
        None,
        None,
    )
    .await
    .unwrap();
    let ws_url = host.origin().replace("http://", "ws://") + "/v2/ws";
    let (mut socket, _) = tokio_tungstenite::connect_async(ws_url).await.unwrap();
    socket
        .send(tokio_tungstenite::tungstenite::Message::Text(
            json!({
                "type": "hello",
                "protocolVersion": 2,
                "clientType": "desktop",
                "clientId": "desktop-a"
            })
            .to_string(),
        ))
        .await
        .unwrap();
    socket.next().await.unwrap().unwrap();
    socket
        .send(tokio_tungstenite::tungstenite::Message::Text(
            json!({
                "type": "runtime_subscribe",
                "requestId": "subscribe-1",
                "target": target,
            })
            .to_string(),
        ))
        .await
        .unwrap();
    socket.next().await.unwrap().unwrap();

    fake.write_frame(json!({ "type": "agent_start" }))
        .await
        .unwrap();
    let event = tokio::time::timeout(std::time::Duration::from_secs(1), socket.next())
        .await
        .expect("subscribed runtime event")
        .unwrap()
        .unwrap();
    let event: serde_json::Value = serde_json::from_str(event.to_text().unwrap()).unwrap();
    assert_eq!(event["type"], "runtime_event");
    assert_eq!(event["target"]["sessionId"], "session-a");
    assert_eq!(event["sequence"], 1);

    drop(host);
    let _ = fs::remove_dir_all(temp);
}

#[test]
fn prompts_get_the_interactive_deadline_and_everything_else_the_short_one() {
    assert_eq!(
        runtime_request_timeout(&json!({ "type": "prompt", "message": "/undo" })),
        RUNTIME_INTERACTIVE_REQUEST_TIMEOUT
    );
    assert_eq!(
        runtime_request_timeout(&json!({ "type": "get_commands" })),
        RUNTIME_REQUEST_TIMEOUT
    );
    assert_eq!(
        runtime_request_timeout(&json!({ "type": "steer", "message": "stop" })),
        RUNTIME_REQUEST_TIMEOUT
    );
    assert_eq!(runtime_request_timeout(&json!({})), RUNTIME_REQUEST_TIMEOUT);
}

#[tokio::test]
async fn routes_preference_operations_through_host_requests() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let temp = std::env::temp_dir().join(format!("spopi-host-pref-{nonce}"));
    let public = temp.join("public");
    fs::create_dir_all(&public).unwrap();
    fs::write(public.join("index.html"), "SPOPI").unwrap();
    let metadata = Arc::new(Mutex::new(
        MetadataStore::open(&temp.join("spopi.sqlite3")).unwrap(),
    ));
    let runtimes = PiRuntime::new(32);
    let host = HostServer::start_with_workspaces(
        public,
        runtimes,
        std::collections::HashMap::new(),
        None,
        Some(Arc::clone(&metadata)),
    )
    .await
    .unwrap();
    let ws_url = host.origin().replace("http://", "ws://") + "/v2/ws";
    let (mut socket, _) = tokio_tungstenite::connect_async(ws_url).await.unwrap();
    socket
        .send(tokio_tungstenite::tungstenite::Message::Text(
            json!({
                "type": "hello",
                "protocolVersion": 2,
                "clientType": "desktop",
                "clientId": "desktop-a"
            })
            .to_string(),
        ))
        .await
        .unwrap();
    socket.next().await.unwrap().unwrap();

    async fn preference_request(
        socket: &mut tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
        frame: serde_json::Value,
    ) -> serde_json::Value {
        use futures_util::{SinkExt, StreamExt};
        socket
            .send(tokio_tungstenite::tungstenite::Message::Text(
                frame.to_string(),
            ))
            .await
            .unwrap();
        loop {
            let message = tokio::time::timeout(std::time::Duration::from_secs(2), socket.next())
                .await
                .expect("preference response")
                .unwrap()
                .unwrap();
            let frame: serde_json::Value =
                serde_json::from_str(message.to_text().unwrap()).unwrap();
            if frame["type"] == "host_response" || frame["type"] == "error" {
                return frame;
            }
        }
    }

    let set_response = preference_request(
        &mut socket,
        json!({
            "type": "host_request",
            "requestId": "pref-1",
            "operation": "set_preference",
            "key": "ui.chatFontSize",
            "value": "large",
        }),
    )
    .await;
    assert_eq!(set_response["type"], "host_response");
    assert_eq!(set_response["operation"], "set_preference");
    assert_eq!(
        metadata
            .lock()
            .unwrap()
            .preference_get("ui.chatFontSize")
            .unwrap(),
        Some(json!("large"))
    );

    let get_response = preference_request(
        &mut socket,
        json!({
            "type": "host_request",
            "requestId": "pref-2",
            "operation": "get_preference",
            "key": "ui.chatFontSize",
        }),
    )
    .await;
    assert_eq!(get_response["value"], json!("large"));

    let missing = preference_request(
        &mut socket,
        json!({
            "type": "host_request",
            "requestId": "pref-3",
            "operation": "get_preference",
            "key": "ui.missingKey",
        }),
    )
    .await;
    assert!(missing["value"].is_null());

    let listed = preference_request(
        &mut socket,
        json!({
            "type": "host_request",
            "requestId": "pref-list",
            "operation": "list_preferences",
            "prefix": "ui.",
        }),
    )
    .await;
    assert_eq!(listed["entries"]["ui.chatFontSize"], json!("large"));
    let rejected_list = preference_request(
        &mut socket,
        json!({
            "type": "host_request",
            "requestId": "pref-list-bad",
            "operation": "list_preferences",
            "prefix": "agent.",
        }),
    )
    .await;
    assert_eq!(rejected_list["type"], "error");

    let rejected = preference_request(
        &mut socket,
        json!({
            "type": "host_request",
            "requestId": "pref-4",
            "operation": "set_preference",
            "key": "agent.thinkingLevel",
            "value": "high",
        }),
    )
    .await;
    // The migration scope only exposes ui.* keys to the browser; the
    // protocol error frame carries the structured code.
    assert_eq!(rejected["type"], "error");
    assert_eq!(rejected["error"]["code"], "invalid_preference");

    let removed = preference_request(
        &mut socket,
        json!({
            "type": "host_request",
            "requestId": "pref-5",
            "operation": "remove_preference",
            "key": "ui.chatFontSize",
        }),
    )
    .await;
    assert_eq!(removed["removed"], json!(true));
    assert_eq!(
        metadata
            .lock()
            .unwrap()
            .preference_get("ui.chatFontSize")
            .unwrap(),
        None
    );

    drop(host);
    let _ = fs::remove_dir_all(temp);
}

#[tokio::test]
async fn delivers_extension_dialog_events_while_a_runtime_request_is_still_pending() {
    // An extension command such as `/undo` blocks its `prompt` response
    // until the dialog it opens is answered. Dispatching that request on
    // the socket task starved the event branch, so the dialog only reached
    // the client when the 30s RPC timeout finally released the loop.
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let temp = std::env::temp_dir().join(format!("spopi-host-ws-pending-{nonce}"));
    let public = temp.join("public");
    fs::create_dir_all(&public).unwrap();
    fs::write(public.join("index.html"), "SPOPI").unwrap();
    let runtimes = PiRuntime::new(32);
    let target = RuntimeTarget::new("workspace-a", "session-a", "instance-a");
    let mut fake = runtimes.register_in_memory(target.clone()).unwrap();
    let host = HostServer::start_with_workspaces(
        public,
        runtimes,
        std::collections::HashMap::new(),
        None,
        None,
    )
    .await
    .unwrap();
    let ws_url = host.origin().replace("http://", "ws://") + "/v2/ws";
    let (mut socket, _) = tokio_tungstenite::connect_async(ws_url).await.unwrap();
    socket
        .send(tokio_tungstenite::tungstenite::Message::Text(
            json!({
                "type": "hello",
                "protocolVersion": 2,
                "clientType": "desktop",
                "clientId": "desktop-a"
            })
            .to_string(),
        ))
        .await
        .unwrap();
    socket.next().await.unwrap().unwrap();
    socket
        .send(tokio_tungstenite::tungstenite::Message::Text(
            json!({
                "type": "runtime_subscribe",
                "requestId": "subscribe-1",
                "target": target,
            })
            .to_string(),
        ))
        .await
        .unwrap();
    socket.next().await.unwrap().unwrap();

    socket
        .send(tokio_tungstenite::tungstenite::Message::Text(
            json!({
                "type": "runtime_request",
                "requestId": "prompt-1",
                "target": target,
                "idempotencyKey": "key-1",
                "command": { "type": "prompt", "message": "/undo" },
            })
            .to_string(),
        ))
        .await
        .unwrap();
    // Pi received the prompt; deliberately never answer it, the way an
    // extension command blocked on `ctx.ui.select()` does not.
    let forwarded = tokio::time::timeout(std::time::Duration::from_secs(1), fake.read_request())
        .await
        .expect("prompt forwarded to pi")
        .unwrap();
    assert_eq!(forwarded["type"], "prompt");

    fake.write_frame(json!({
        "type": "extension_ui_request",
        "id": "dialog-1",
        "method": "select",
        "title": "Undo",
        "options": ["Undo last turn"],
    }))
    .await
    .unwrap();

    let event = tokio::time::timeout(std::time::Duration::from_secs(2), socket.next())
        .await
        .expect("dialog event delivered without waiting for the prompt response")
        .unwrap()
        .unwrap();
    let event: serde_json::Value = serde_json::from_str(event.to_text().unwrap()).unwrap();
    assert_eq!(event["type"], "runtime_event");
    assert_eq!(event["event"]["type"], "extension_ui_request");
    assert_eq!(event["event"]["id"], "dialog-1");

    drop(host);
    let _ = fs::remove_dir_all(temp);
}

#[tokio::test]
async fn replays_startup_extension_ui_and_routes_the_owners_response_exactly_once() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let temp = std::env::temp_dir().join(format!("spopi-host-dialog-{nonce}"));
    let public = temp.join("public");
    fs::create_dir_all(&public).unwrap();
    fs::write(public.join("index.html"), "SPOPI").unwrap();
    let runtimes = PiRuntime::new(32);
    let target = RuntimeTarget::new("workspace-a", "session-a", "instance-a");
    let mut fake = runtimes.register_in_memory(target.clone()).unwrap();
    fake.write_frame(json!({
        "type": "extension_ui_request",
        "id": "dialog-1",
        "method": "select",
        "title": "Project trust",
        "options": ["Trust once", "Open untrusted"]
    }))
    .await
    .unwrap();
    tokio::task::yield_now().await;

    let host = HostServer::start_with_workspaces(
        public,
        runtimes,
        std::collections::HashMap::new(),
        None,
        None,
    )
    .await
    .unwrap();
    let ws_url = host.origin().replace("http://", "ws://") + "/v2/ws";
    let (mut socket, _) = tokio_tungstenite::connect_async(ws_url).await.unwrap();
    socket
        .send(tokio_tungstenite::tungstenite::Message::Text(
            json!({
                "type": "hello",
                "protocolVersion": 2,
                "clientType": "desktop",
                "clientId": "owner"
            })
            .to_string(),
        ))
        .await
        .unwrap();
    socket.next().await.unwrap().unwrap();
    socket
        .send(tokio_tungstenite::tungstenite::Message::Text(
            json!({
                "type": "runtime_subscribe",
                "requestId": "subscribe",
                "target": target,
            })
            .to_string(),
        ))
        .await
        .unwrap();
    socket.next().await.unwrap().unwrap();
    let replay = socket.next().await.unwrap().unwrap();
    let replay: serde_json::Value = serde_json::from_str(replay.to_text().unwrap()).unwrap();
    assert_eq!(replay["event"]["id"], "dialog-1");

    socket
        .send(tokio_tungstenite::tungstenite::Message::Text(
            json!({
                "type": "runtime_request",
                "requestId": "dialog-response",
                "target": target,
                "command": {
                    "type": "extension_ui_response",
                    "id": "dialog-1",
                    "value": "Trust once"
                }
            })
            .to_string(),
        ))
        .await
        .unwrap();
    socket.next().await.unwrap().unwrap();
    assert_eq!(
        fake.read_request().await.unwrap(),
        json!({
            "type": "extension_ui_response",
            "id": "dialog-1",
            "value": "Trust once"
        })
    );

    drop(host);
    let _ = fs::remove_dir_all(temp);
}

#[tokio::test]
#[ignore = "needs the fake OpenAI server; run via bun run smoke:stream -- --host"]
async fn host_stream() {
    let fake_url = std::env::var("SPOPI_FAKE_OPENAI_URL").expect("SPOPI_FAKE_OPENAI_URL");
    assert!(
        !fake_url.trim().is_empty(),
        "SPOPI_FAKE_OPENAI_URL must be the fake server"
    );
    assert_eq!(
        std::env::var("SPOPI_FAKE_PROVIDER").ok().as_deref(),
        Some("1"),
        "SPOPI_FAKE_PROVIDER=1 loads the fake bundle"
    );
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let temp = std::env::temp_dir().join(format!("spopi-host-stream-{nonce}"));
    let public = temp.join("public");
    let workspace = temp.join("workspace");
    fs::create_dir_all(&public).unwrap();
    fs::create_dir_all(&workspace).unwrap();
    fs::write(public.join("index.html"), "SPOPI").unwrap();
    fs::write(workspace.join("README.md"), "hello\n").unwrap();
    let mut roots = std::collections::HashMap::new();
    roots.insert("workspace-a".to_string(), workspace);
    let host = HostServer::start_with_workspaces(public, PiRuntime::new(32), roots, None, None)
        .await
        .unwrap();
    let created: serde_json::Value = reqwest::Client::new()
        .post(format!("{}/v2/new-session", host.origin()))
        .json(&json!({ "workspaceId": "workspace-a" }))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    let ws_url = host.origin().replace("http://", "ws://") + "/v2/ws";
    let (mut socket, _) = tokio_tungstenite::connect_async(ws_url).await.unwrap();
    socket
        .send(tokio_tungstenite::tungstenite::Message::Text(
            json!({
                "type": "hello",
                "protocolVersion": 2,
                "clientType": "desktop",
                "clientId": "desktop-stream"
            })
            .to_string(),
        ))
        .await
        .unwrap();
    socket.next().await.unwrap().unwrap();
    socket
        .send(tokio_tungstenite::tungstenite::Message::Text(
            json!({
                "type": "runtime_subscribe",
                "requestId": "subscribe-stream",
                "target": created,
            })
            .to_string(),
        ))
        .await
        .unwrap();
    socket.next().await.unwrap().unwrap();
    socket
        .send(tokio_tungstenite::tungstenite::Message::Text(
            json!({
                "type": "runtime_request",
                "requestId": "model-stream",
                "target": created,
                "idempotencyKey": "model-stream",
                "command": { "type": "set_model", "provider": "fake", "modelId": "fake-1" },
            })
            .to_string(),
        ))
        .await
        .unwrap();
    let model_ready = tokio::time::timeout(std::time::Duration::from_secs(20), async {
        loop {
            let message = socket.next().await.unwrap().unwrap();
            let Ok(text) = message.to_text() else {
                continue;
            };
            if text.is_empty() {
                continue;
            }
            let frame: serde_json::Value = serde_json::from_str(text).unwrap();
            if frame["requestId"] == "model-stream" {
                assert_eq!(
                    frame["response"]["success"], true,
                    "set_model failed: {frame}"
                );
                break;
            }
        }
    })
    .await;
    assert!(model_ready.is_ok(), "set_model did not finish");
    socket
        .send(tokio_tungstenite::tungstenite::Message::Text(
            json!({
                "type": "runtime_request",
                "requestId": "prompt-stream",
                "target": created,
                "idempotencyKey": "prompt-stream",
                "command": { "type": "prompt", "message": "ping" },
            })
            .to_string(),
        ))
        .await
        .unwrap();

    let mut frames = Vec::new();
    let collected = tokio::time::timeout(std::time::Duration::from_secs(45), async {
        while let Some(message) = socket.next().await {
            let message = message.unwrap();
            let Ok(text) = message.to_text() else {
                continue;
            };
            if text.is_empty() {
                continue;
            }
            let frame: serde_json::Value = serde_json::from_str(text).unwrap();
            let settled =
                frame["type"] == "runtime_event" && frame["event"]["type"] == "agent_settled";
            frames.push(frame);
            if settled {
                break;
            }
        }
    })
    .await;
    let mut text = String::new();
    for frame in &frames {
        let event = &frame["event"];
        if event["assistantMessageEvent"]["type"] == "text_delta" {
            if let Some(delta) = event["assistantMessageEvent"]["delta"].as_str() {
                text.push_str(delta);
            }
        }
    }
    assert!(
        collected.is_ok(),
        "host stream did not settle: {text} last={}",
        frames
            .last()
            .map(|frame| frame.to_string())
            .unwrap_or_default()
    );
    assert!(
        text.contains("pong"),
        "host stream text was {text}, frames={}",
        frames.len()
    );

    drop(socket);
    drop(host);
    let _ = fs::remove_dir_all(temp);
}

#[tokio::test]
#[ignore = "started by bun run test:e2e; it prints E2E_READY and waits"]
async fn host_e2e_serve() {
    let public = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../public");
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let temp = std::env::temp_dir().join(format!("spopi-e2e-{nonce}"));
    let workspace = temp.join("workspace");
    fs::create_dir_all(&workspace).unwrap();
    fs::write(workspace.join("README.md"), "hello\n").unwrap();
    let meta = Arc::new(Mutex::new(
        MetadataStore::open(&temp.join("spopi.sqlite3")).unwrap(),
    ));
    let mut roots = std::collections::HashMap::new();
    roots.insert("workspace-a".to_string(), workspace);
    let host =
        HostServer::start_with_workspaces(public, PiRuntime::new(32), roots, None, Some(meta))
            .await
            .unwrap();
    let probe = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let phone_port = probe.local_addr().unwrap().port();
    drop(probe);
    let state = host.state();
    state.phone.set_allow(vec!["127.0.0.1/32".into()]);
    state.phone.set_ca_open(true);
    let tls = temp.join("tls");
    let cert_path = tls.join("phone.crt");
    let addr = std::net::SocketAddr::from((std::net::Ipv4Addr::LOCALHOST, phone_port));
    let static_dir = state.ui.shipped.clone();
    let phone_state = std::sync::Arc::clone(&state);
    tokio::spawn(async move {
        let _ = crate::host::phone::listen::serve(addr, static_dir, tls, phone_state).await;
    });
    let phone_ready = std::net::SocketAddr::from((std::net::Ipv4Addr::LOCALHOST, phone_port));
    for _ in 0..50 {
        if std::net::TcpStream::connect_timeout(&phone_ready, std::time::Duration::from_millis(100))
            .is_ok()
        {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    let loopback_port = host.origin().rsplit(':').next().unwrap_or("57620");
    println!(
        "E2E_READY {loopback_port} {phone_port} {}",
        cert_path.display()
    );
    let _ = std::io::Write::flush(&mut std::io::stdout());
    let stop = std::env::var("SPOPI_E2E_STOP").unwrap_or_default();
    if stop.is_empty() {
        let mut stdin = tokio::io::stdin();
        let mut buf = vec![0u8; 64];
        loop {
            match tokio::io::AsyncReadExt::read(&mut stdin, &mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
        }
    } else {
        while std::path::Path::new(&stop).exists() {
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        }
    }
    drop(host);
    let _ = fs::remove_dir_all(temp);
}

#[tokio::test]
async fn enabling_the_phone_records_the_current_ui_baseline() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let temp = std::env::temp_dir().join(format!("spopi-phone-base-{nonce}"));
    let public = temp.join("public");
    fs::create_dir_all(&public).unwrap();
    fs::write(public.join("index.html"), "ok").unwrap();
    fs::write(public.join("a.js"), "shipped").unwrap();
    let metadata = Arc::new(Mutex::new(
        MetadataStore::open(&temp.join("spopi.sqlite3")).unwrap(),
    ));
    let host = HostServer::start_with_workspaces(
        public.clone(),
        PiRuntime::new(32),
        std::collections::HashMap::new(),
        None,
        Some(metadata),
    )
    .await
    .unwrap();
    let origin = host.origin();
    let before: serde_json::Value = reqwest::get(format!("{origin}/api/phone/status"))
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(!before["changes"].as_array().unwrap().is_empty());
    let probe = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = probe.local_addr().unwrap().port();
    drop(probe);
    let enabled = reqwest::Client::new()
        .post(format!("{origin}/api/phone/enable"))
        .json(&json!({
            "enabled": true,
            "ip": "127.0.0.1",
            "port": port,
            "allow": ["127.0.0.1/32"],
        }))
        .send()
        .await
        .unwrap();
    assert!(enabled.status().is_success());
    let after: serde_json::Value = reqwest::get(format!("{origin}/api/phone/status"))
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(
        after["changes"].as_array().unwrap().is_empty(),
        "changes after enable: {after}"
    );
    fs::write(public.join("audit2-probe.js"), "probe").unwrap();
    let edited: serde_json::Value = reqwest::get(format!("{origin}/api/phone/status"))
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(edited["changes"].as_array().unwrap().len(), 1);
    drop(host);
    let _ = fs::remove_dir_all(temp);
}
