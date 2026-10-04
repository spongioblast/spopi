// ABOUTME: Exercises runtime supervision, extension UI memory, and session rebinding.
// ABOUTME: The module under test is pi::runtime; idle and standby tests sit beside their files.

use super::PiRuntime;
use crate::pi::coordinator::RuntimeTarget;
use serde_json::json;
use std::time::Duration;

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

    // The runtime leaves the session index before the coordinator, so wait for both.
    tokio::time::timeout(Duration::from_secs(1), async {
        while manager.target_for_session_id("session-a").is_some()
            || !manager.statuses().unwrap().is_empty()
        {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("closed RPC stream should unregister its runtime");
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
