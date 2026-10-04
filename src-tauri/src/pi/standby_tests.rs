// ABOUTME: Exercises the warm standby: adoption, refill, reaping, and its session id.
// ABOUTME: The module under test is pi::standby.

use crate::pi::coordinator::RuntimeTarget;
use crate::pi::runtime::PiRuntime;
use serde_json::json;

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
