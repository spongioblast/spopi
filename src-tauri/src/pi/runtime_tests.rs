// ABOUTME: Exercises runtime supervision, idle reaping, and session rebinding.
// ABOUTME: The module under test is pi::runtime.

use super::PiRuntime;
use crate::pi::coordinator::RuntimeTarget;
use serde_json::json;
use std::time::Duration;

#[tokio::test]
async fn idle_reaper_skips_foreground_busy_and_dialog_bound_runtimes() {
    use crate::pi::coordinator::RuntimeState;
    use std::time::Instant;

    let manager = PiRuntime::in_memory(8);
    let stale = |name: &str| RuntimeTarget::new("workspace-a", name, format!("i-{name}"));
    let open = stale("open");
    let busy = stale("busy");
    let dialog = stale("dialog");
    let idle = stale("idle");
    let fresh = stale("fresh");
    for target in [&open, &busy, &dialog, &idle, &fresh] {
        manager.register_in_memory(target.clone()).unwrap();
    }
    let hour_ago = Instant::now() - Duration::from_secs(3600);
    {
        let mut used = manager.inner.last_used.lock().unwrap();
        for target in [&open, &busy, &dialog, &idle] {
            used.insert(target.instance_id.clone(), hour_ago);
        }
    }
    manager.set_foreground("client-1", &open);
    manager
        .inner
        .last_used
        .lock()
        .unwrap()
        .insert(open.instance_id.clone(), hour_ago);
    manager
        .inner
        .coordinator
        .lock()
        .unwrap()
        .set_state(&busy, RuntimeState::Working)
        .unwrap();
    manager.inner.pending_ui.lock().unwrap().insert(
        dialog.instance_id.clone(),
        vec![super::NativeRuntimeEvent {
            target: dialog.clone(),
            sequence: 1,
            event: json!({ "type": "extension_ui_request", "id": "d1" }),
        }],
    );

    assert!(manager.idle_targets(Duration::ZERO).is_empty());
    let stopped = manager.reap_idle(Duration::from_secs(1800));
    assert_eq!(stopped, vec![idle.clone()]);
    assert!(manager.target_for_session("workspace-a", "idle").is_none());
    for target in [&open, &busy, &dialog, &fresh] {
        assert!(manager
            .target_for_session("workspace-a", &target.session_id)
            .is_some());
    }

    // Navigating a window away stops the workspace's idle runtimes but
    // keeps the busy one and the one a client still has open.
    let stopped = manager.stop_idle_workspace("workspace-a");
    assert_eq!(stopped.len(), 1);
    assert_eq!(stopped[0].session_id, "fresh");
    manager.clear_foreground("client-1");
    assert_eq!(manager.stop_idle_workspace("workspace-a"), vec![open]);
    assert!(manager.target_for_session("workspace-a", "busy").is_some());
}

#[test]
fn extension_ui_keeps_dialogs_and_only_the_latest_status_per_key() {
    let target = RuntimeTarget::new("workspace-a", "session-a", "instance-a");
    let event = |sequence: u64, value: serde_json::Value| super::NativeRuntimeEvent {
        target: target.clone(),
        sequence,
        event: value,
    };
    let mut list = Vec::new();
    for (sequence, text) in [(1, "building"), (2, "built")] {
        super::remember_extension_ui(
            &mut list,
            &event(
                sequence,
                json!({ "type": "extension_ui_request", "method": "setStatus", "statusKey": "build", "statusText": text }),
            ),
        );
    }
    super::remember_extension_ui(
        &mut list,
        &event(
            3,
            json!({ "type": "extension_ui_request", "method": "notify", "message": "hi" }),
        ),
    );
    super::remember_extension_ui(
        &mut list,
        &event(
            4,
            json!({ "type": "extension_ui_request", "id": "d1", "method": "select" }),
        ),
    );
    assert_eq!(list.len(), 2);
    assert_eq!(list[0].event["statusText"], "built");
    assert_eq!(list[1].event["method"], "select");
    assert!(!super::is_dialog(&list[0].event));
    assert!(super::is_dialog(&list[1].event));
}

#[tokio::test]
async fn a_status_update_alone_does_not_keep_an_idle_runtime_alive() {
    use std::time::Instant;

    let manager = PiRuntime::in_memory(8);
    let target = RuntimeTarget::new("workspace-a", "quiet", "i-quiet");
    manager.register_in_memory(target.clone()).unwrap();
    manager.inner.last_used.lock().unwrap().insert(
        target.instance_id.clone(),
        Instant::now() - Duration::from_secs(3600),
    );
    manager.inner.pending_ui.lock().unwrap().insert(
        target.instance_id.clone(),
        vec![super::NativeRuntimeEvent {
            target: target.clone(),
            sequence: 1,
            event: json!({ "type": "extension_ui_request", "method": "setStatus", "statusKey": "build" }),
        }],
    );
    assert_eq!(manager.reap_idle(Duration::from_secs(1800)), vec![target]);
}

#[tokio::test]
async fn routes_native_requests_by_opaque_target_and_rejects_session_replacement() {
    let manager = PiRuntime::in_memory(8);
    let target = RuntimeTarget::new("workspace-a", "session-a", "instance-a");
    let mut events = manager.subscribe();
    let mut fake = manager.register_in_memory(target.clone()).unwrap();

    fake.write_frame(json!({ "type": "agent_start" }))
        .await
        .unwrap();
    let event = events.recv().await.unwrap();
    assert_eq!(event.target, target);
    assert_eq!(event.sequence, 1);
    assert_eq!(event.event["type"], "agent_start");

    let request = tokio::spawn({
        let manager = manager.clone();
        let target = target.clone();
        async move {
            manager
                .request(
                    &target,
                    json!({ "type": "get_state" }),
                    None,
                    Duration::from_secs(1),
                )
                .await
        }
    });
    let outbound = fake.read_request().await.unwrap();
    let id = outbound["id"].as_str().unwrap();
    fake.write_frame(json!({
        "id": id,
        "type": "response",
        "command": "get_state",
        "success": true
    }))
    .await
    .unwrap();
    assert!(request.await.unwrap().unwrap()["success"]
        .as_bool()
        .unwrap());

    let first_prompt = tokio::spawn({
        let manager = manager.clone();
        let target = target.clone();
        async move {
            manager
                .request(
                    &target,
                    json!({ "type": "prompt", "message": "once" }),
                    Some("prompt-intent"),
                    Duration::from_secs(1),
                )
                .await
        }
    });
    let outbound = fake.read_request().await.unwrap();
    let id = outbound["id"].as_str().unwrap();
    fake.write_frame(json!({
        "id": id,
        "type": "response",
        "command": "prompt",
        "success": true
    }))
    .await
    .unwrap();
    let accepted = first_prompt.await.unwrap().unwrap();
    let duplicate = manager
        .request(
            &target,
            json!({ "type": "prompt", "message": "once" }),
            Some("prompt-intent"),
            Duration::from_secs(1),
        )
        .await
        .unwrap();
    assert_eq!(duplicate, accepted);
    assert!(fake.try_read_request().is_none());

    assert!(manager
        .request(
            &target,
            json!({ "type": "switch_session", "sessionPath": "/other.jsonl" }),
            Some("intent-1"),
            Duration::from_secs(1),
        )
        .await
        .is_err());
}

#[tokio::test]
async fn unregisters_runtime_when_the_rpc_stream_closes_unexpectedly() {
    let manager = PiRuntime::in_memory(8);
    let target = RuntimeTarget::new("workspace-a", "session-a", "instance-a");
    let fake = manager.register_in_memory(target.clone()).unwrap();

    assert_eq!(manager.target_for_session_id("session-a"), Some(target));
    drop(fake);

    tokio::time::timeout(Duration::from_secs(1), async {
        while manager.target_for_session_id("session-a").is_some() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("closed RPC stream should unregister its runtime");
    assert!(manager.statuses().unwrap().is_empty());
}

#[tokio::test]
async fn binds_a_temporary_session_once_and_routes_future_events_to_the_formal_target() {
    let manager = PiRuntime::in_memory(8);
    let temporary = RuntimeTarget::new("workspace-a", "temporary-a", "instance-a");
    let mut events = manager.subscribe();
    let mut fake = manager.register_in_memory(temporary.clone()).unwrap();

    let formal = manager.bind_session_id(&temporary, "session-a").unwrap();
    let binding = events.recv().await.unwrap();
    assert_eq!(binding.target, temporary);
    assert_eq!(binding.event["type"], "session_bound");
    assert_eq!(binding.event["sessionId"], "session-a");
    assert_eq!(formal.instance_id, "instance-a");

    fake.write_frame(json!({ "type": "agent_start" }))
        .await
        .unwrap();
    let event = events.recv().await.unwrap();
    assert_eq!(event.target, formal);
    assert_eq!(manager.target_for_session_id("session-a"), Some(formal));
}

#[tokio::test]
async fn rebinds_a_formal_session_after_an_in_place_fork_and_routes_future_events_there() {
    let manager = PiRuntime::in_memory(8);
    let original = RuntimeTarget::new("workspace-a", "session-a", "instance-a");
    let mut events = manager.subscribe();
    let mut fake = manager.register_in_memory(original.clone()).unwrap();

    // bind_session_id is a no-op once the session id is already formal;
    // only rebind_session_id can move an instance from one real session
    // id to another, which is what a fork does in place.
    assert_eq!(
        manager.bind_session_id(&original, "session-b").unwrap(),
        original
    );

    let forked = manager.rebind_session_id(&original, "session-b").unwrap();
    let binding = events.recv().await.unwrap();
    assert_eq!(binding.target, original);
    assert_eq!(binding.event["type"], "session_rebound");
    assert_eq!(binding.event["sessionId"], "session-b");
    assert_eq!(forked.instance_id, "instance-a");
    assert_eq!(forked.session_id, "session-b");

    // The old session id no longer resolves to this instance, and future
    // events carry the rebound target rather than the stale one — the
    // exact desync that broke a client's event subscription when only
    // the frontend, not the registry, learned about the new session id.
    assert_eq!(manager.target_for_session_id("session-a"), None);
    assert_eq!(
        manager.target_for_session_id("session-b"),
        Some(forked.clone())
    );

    fake.write_frame(json!({ "type": "agent_start" }))
        .await
        .unwrap();
    let event = events.recv().await.unwrap();
    assert_eq!(event.target, forked);
}

#[tokio::test]
async fn standby_is_adopted_refilled_and_reaped_without_a_duplicate() {
    let manager = PiRuntime::in_memory(8);
    let standby = RuntimeTarget::new("workspace-a", "standby-1", "instance-standby");
    let mut fake = manager.register_in_memory(standby.clone()).unwrap();
    manager.park_standby(&standby).unwrap();
    assert!(manager.park_standby(&standby).is_err());

    let switching = tokio::spawn({
        let manager = manager.clone();
        let standby = standby.clone();
        async move {
            manager
                .host_switch_session(&standby, "/sessions/open.jsonl")
                .await
        }
    });
    let outbound = fake.read_request().await.unwrap();
    assert_eq!(outbound["type"], "switch_session");
    let id = outbound["id"].as_str().unwrap();
    fake.write_frame(json!({
        "id": id,
        "type": "response",
        "command": "switch_session",
        "success": true
    }))
    .await
    .unwrap();
    assert!(switching.await.unwrap().unwrap()["success"]
        .as_bool()
        .unwrap());

    let adopted = manager
        .adopt_standby("workspace-a", "session-open")
        .unwrap()
        .unwrap();
    assert_eq!(adopted.session_id, "session-open");
    assert!(manager.standby_for("workspace-a").is_none());

    let refill = RuntimeTarget::new("workspace-a", "standby-2", "instance-standby-2");
    manager.register_in_memory(refill.clone()).unwrap();
    manager.park_standby(&refill).unwrap();
    assert!(manager.park_standby(&refill).is_err());

    let stopped = manager.stop_idle_workspace("workspace-a");
    assert!(stopped.iter().any(
        |target| target.session_id == "standby-2" || target.instance_id == "instance-standby-2"
    ));
    assert!(manager.standby_for("workspace-a").is_none());
}

#[tokio::test]
async fn standby_new_session_keeps_the_session_id_pi_already_has() {
    let manager = PiRuntime::in_memory(8);
    let standby = RuntimeTarget::new("workspace-a", "standby-1", "instance-standby");
    let mut fake = manager.register_in_memory(standby.clone()).unwrap();
    manager.park_standby(&standby).unwrap();

    let reading = tokio::spawn({
        let manager = manager.clone();
        let standby = standby.clone();
        async move { manager.host_session_id(&standby).await }
    });
    let outbound = fake.read_request().await.unwrap();
    assert_eq!(outbound["type"], "get_state");
    let id = outbound["id"].as_str().unwrap().to_owned();
    fake.write_frame(json!({
        "id": id,
        "type": "response",
        "command": "get_state",
        "success": true,
        "data": { "sessionId": "pi-session-9" }
    }))
    .await
    .unwrap();
    let session_id = reading.await.unwrap().unwrap().unwrap();
    let adopted = manager
        .adopt_standby("workspace-a", &session_id)
        .unwrap()
        .unwrap();
    assert_eq!(adopted.session_id, "pi-session-9");
    assert!(manager.standby_for("workspace-a").is_none());
}
