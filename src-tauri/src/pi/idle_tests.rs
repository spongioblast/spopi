// ABOUTME: Exercises idle reaping: foreground, busy, and dialog runtimes are spared.
// ABOUTME: The module under test is pi::idle.

use crate::pi::coordinator::{RuntimeState, RuntimeTarget};
use crate::pi::runtime::{NativeRuntimeEvent, PiRuntime};
use serde_json::json;
use std::time::{Duration, Instant};

#[tokio::test]
async fn idle_reaper_skips_foreground_busy_and_dialog_bound_runtimes() {
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
        vec![NativeRuntimeEvent {
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

#[tokio::test]
async fn a_status_update_alone_does_not_keep_an_idle_runtime_alive() {
    let manager = PiRuntime::in_memory(8);
    let target = RuntimeTarget::new("workspace-a", "quiet", "i-quiet");
    manager.register_in_memory(target.clone()).unwrap();
    manager.inner.last_used.lock().unwrap().insert(
        target.instance_id.clone(),
        Instant::now() - Duration::from_secs(3600),
    );
    manager.inner.pending_ui.lock().unwrap().insert(
        target.instance_id.clone(),
        vec![NativeRuntimeEvent {
            target: target.clone(),
            sequence: 1,
            event: json!({ "type": "extension_ui_request", "method": "setStatus", "statusKey": "build" }),
        }],
    );
    assert_eq!(manager.reap_idle(Duration::from_secs(1800)), vec![target]);
}
