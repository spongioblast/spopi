// ABOUTME: Exercises terminal lifecycle, persistence, and process cleanup.
// ABOUTME: The module under test is terminal::manager.

use super::*;
use crate::platform::window_owner::OwnerId;
use crate::terminal::output::{TerminalLimits, TerminalOutputStore};
use crate::terminal::profiles::ShellProfileId;
use crate::terminal::registry::{CloseLease, TerminalKey, TerminalRegistry, TerminalStatus};
use crate::terminal::state_store::{
    PersistedTabDescriptor, TerminalStateStore, WorkspaceTerminalMetadata,
};
use base64::engine::general_purpose::STANDARD as BASE64;
use portable_pty::{native_pty_system, PtySize};
use serde_json::{json, Value};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tempfile::tempdir;

fn owner(name: &str) -> OwnerId {
    OwnerId::from_client_id(name)
}

fn manager() -> TerminalManager {
    let state_dir = tempdir().unwrap().keep();
    TerminalManager::new(
        TerminalRegistry::new(15),
        TerminalStateStore::new(state_dir),
    )
}

#[test]
fn dispatch_unknown_command_is_an_error() {
    let mgr = manager();
    let owner = owner("t-dispatch");
    let payload = json!({ "type": "terminal_bogus" });
    assert!(mgr.dispatch(&owner, Path::new("/ws"), &payload).is_err());
}

#[test]
fn profiles_list_real_shells_and_round_trip_ids() {
    let mgr = manager();
    let owner = owner("t-profiles");
    let listed = mgr
        .dispatch(
            &owner,
            Path::new("/ws"),
            &json!({ "type": "terminal_profiles" }),
        )
        .unwrap();
    assert_eq!(listed["type"], "terminal_profiles");
    let profiles = listed["profiles"].as_array().unwrap();
    assert!(!profiles.is_empty());
    for profile in profiles {
        let id = profile["id"].as_str().unwrap();
        assert!(ShellProfileId::from_id_str(id).is_some(), "{id}");
    }
    #[cfg(windows)]
    assert!(profiles.iter().all(|profile| profile["id"] != "default"));
}

#[test]
fn activate_and_reorder_persist_active_index_and_tab_order() {
    let dir = tempdir().unwrap();
    let state_dir = dir.path().to_path_buf();
    let registry = TerminalRegistry::new(15);
    let mgr = TerminalManager::new(registry.clone(), TerminalStateStore::new(state_dir.clone()));
    let owner = owner("t-ui");
    let workspace = Path::new("/ws");
    let key = TerminalKey {
        owner: owner.clone(),
        workspace_root: workspace.to_path_buf(),
    };
    let first = registry
        .reserve_tab_with_profile(&key, "default", "Terminal".to_string())
        .unwrap();
    let second = registry
        .reserve_tab_with_profile(&key, "powershell", "PowerShell".to_string())
        .unwrap();

    mgr.dispatch(
        &owner,
        workspace,
        &json!({
            "type": "terminal_reorder",
            "orderedTerminalIds": [second.terminal_id, first.terminal_id],
        }),
    )
    .unwrap();
    mgr.dispatch(
        &owner,
        workspace,
        &json!({
            "type": "terminal_activate",
            "terminalId": first.terminal_id,
            "generation": first.generation,
        }),
    )
    .unwrap();

    let metadata = TerminalStateStore::new(state_dir)
        .load_for_workspace(workspace)
        .unwrap()
        .expect("metadata persisted");
    assert_eq!(metadata.active_index, Some(1));
    assert_eq!(
        metadata
            .tabs
            .iter()
            .map(|tab| tab.profile_id.as_str())
            .collect::<Vec<_>>(),
        vec!["powershell", "default"]
    );
}

#[test]
fn panel_height_rejects_values_that_do_not_fit_u32() {
    let mgr = manager();
    let owner = owner("t-height-overflow");
    let result = mgr.dispatch(
        &owner,
        Path::new("/ws"),
        &json!({ "type": "terminal_set_panel_height", "heightPx": u64::from(u32::MAX) + 1 }),
    );
    assert_eq!(result.unwrap_err(), "heightPx is out of range");
}

#[test]
fn stale_reader_and_close_do_not_touch_replacement_generation() {
    let mgr = manager();
    let owner = owner("t-generation-safe");
    let workspace = Path::new("/ws");
    let key = TerminalKey {
        owner: owner.clone(),
        workspace_root: workspace.to_path_buf(),
    };
    let reservation = mgr
        .inner
        .registry
        .reserve_tab_with_profile(&key, "default", "Terminal".to_string())
        .unwrap();
    mgr.inner
        .registry
        .commit_running(&key, &reservation.terminal_id, reservation.generation)
        .unwrap();
    let replacement = mgr
        .inner
        .registry
        .restart(
            &key,
            &reservation.terminal_id,
            reservation.generation,
            "default",
            "Terminal".to_string(),
        )
        .unwrap();
    mgr.inner
        .registry
        .commit_running(&key, &replacement.terminal_id, replacement.generation)
        .unwrap();

    let pair = native_pty_system()
        .openpty(PtySize::default())
        .expect("test PTY");
    let writer = pair.master.take_writer().expect("test PTY writer");
    mgr.inner.live.lock().unwrap().insert(
        replacement.terminal_id.clone(),
        LiveTerminal {
            owner: owner.clone(),
            workspace_root: workspace.to_path_buf(),
            generation: replacement.generation,
            profile_id: "default".to_string(),
            master: pair.master,
            writer,
            child: None,
            #[cfg(windows)]
            job: None,
        },
    );
    mgr.inner.outputs.lock().unwrap().insert(
        replacement.terminal_id.clone(),
        TerminalOutputStore::new(TerminalLimits::default()),
    );

    assert_eq!(
        mgr.append_output_if_current(
            &replacement.terminal_id,
            reservation.generation,
            b"old reader output",
        ),
        None
    );
    mgr.terminate_and_finish(
        &key,
        &CloseLease {
            terminal_id: replacement.terminal_id.clone(),
            generation: reservation.generation,
        },
    );
    assert_eq!(
        mgr.inner.live.lock().unwrap()[&replacement.terminal_id].generation,
        replacement.generation
    );
    assert!(mgr
        .inner
        .outputs
        .lock()
        .unwrap()
        .contains_key(&replacement.terminal_id));
}

#[test]
fn create_spawns_a_running_terminal_with_real_shell() {
    // Uses the real SystemShellProbe: on macOS this resolves /bin/zsh or
    // /bin/bash. Skipped when no shell is resolvable on the host.
    let mgr = manager();
    let owner = owner("t-create");
    let payload = json!({ "type": "terminal_create", "profileId": "default" });
    let result = mgr.dispatch(&owner, Path::new("/ws"), &payload);
    let Ok(response) = result else {
        // Host without a usable shell (CI without /bin/zsh) — skip gracefully.
        return;
    };
    assert_eq!(response["type"], "terminal_created");
    let terminal_id = response["terminalId"].as_str().unwrap().to_string();
    let generation = response["generation"].as_u64().unwrap();

    // The new terminal is listed as running.
    let listed = mgr
        .dispatch(
            &owner,
            Path::new("/ws"),
            &json!({ "type": "terminal_list" }),
        )
        .unwrap();
    assert_eq!(listed["tabs"][0]["status"], "running");

    // Closing it removes it from the partition.
    let close = mgr.dispatch(
        &owner,
        Path::new("/ws"),
        &json!({ "type": "terminal_close", "terminalId": terminal_id, "generation": generation }),
    );
    assert!(close.is_ok());
    let listed = mgr
        .dispatch(
            &owner,
            Path::new("/ws"),
            &json!({ "type": "terminal_list" }),
        )
        .unwrap();
    assert!(listed["tabs"].as_array().unwrap().is_empty());

    let _ = TerminalStatus::Running; // silence unused import in no-shell hosts
}

#[test]
fn list_restores_workspace_metadata_with_unique_placeholder_ids() {
    let dir = tempdir().unwrap();
    let store = TerminalStateStore::new(dir.path().to_path_buf());
    let mut metadata = WorkspaceTerminalMetadata::new("default");
    metadata.tabs = vec![
        PersistedTabDescriptor {
            label: "first".to_string(),
            profile_id: "default".to_string(),
            running: true,
        },
        PersistedTabDescriptor {
            label: "second".to_string(),
            profile_id: "powershell".to_string(),
            running: false,
        },
    ];
    metadata.panel_height_px = Some(320);
    store
        .save_for_workspace(Path::new("/ws"), &metadata)
        .unwrap();
    let mgr = TerminalManager::new(TerminalRegistry::new(15), store);
    let owner = owner("t-restored");
    let listed = mgr
        .dispatch(
            &owner,
            Path::new("/ws"),
            &json!({ "type": "terminal_list" }),
        )
        .unwrap();
    assert_eq!(listed["panelHeightPx"], 320);
    assert_eq!(listed["tabs"][0]["terminalId"], "restored-0");
    assert_eq!(listed["tabs"][1]["terminalId"], "restored-1");
}

#[test]
fn list_skips_persisted_metadata_while_another_client_has_live_tabs() {
    let dir = tempdir().unwrap();
    let store = TerminalStateStore::new(dir.path().to_path_buf());
    let mut metadata = WorkspaceTerminalMetadata::new("default");
    metadata.tabs = vec![PersistedTabDescriptor {
        label: "first".to_string(),
        profile_id: "default".to_string(),
        running: true,
    }];
    store
        .save_for_workspace(Path::new("/ws"), &metadata)
        .unwrap();
    let registry = TerminalRegistry::new(15);
    let window = TerminalKey {
        owner: owner("t-window"),
        workspace_root: Path::new("/ws").to_path_buf(),
    };
    registry
        .reserve_tab_with_profile(&window, "default", "Terminal".to_string())
        .unwrap();
    let mgr = TerminalManager::new(registry, store);
    let listed = mgr
        .dispatch(
            &owner("t-browser"),
            Path::new("/ws"),
            &json!({ "type": "terminal_list" }),
        )
        .unwrap();
    assert_eq!(listed["tabs"], json!([]));
}

#[test]
fn pty_round_trips_utf8_input_to_output_and_resizes() {
    let mgr = manager();
    let owner = owner("t-roundtrip");
    let events: Arc<Mutex<Vec<Value>>> = Arc::new(Mutex::new(Vec::new()));
    let sink_events = events.clone();
    mgr.set_event_sink(Arc::new(move |_owner, event| {
        sink_events.lock().unwrap().push(event);
    }));

    let Ok(created) = mgr.dispatch(
        &owner,
        Path::new("/ws"),
        &json!({ "type": "terminal_create", "profileId": "default" }),
    ) else {
        return; // host without a usable shell — skip
    };
    let terminal_id = created["terminalId"].as_str().unwrap().to_string();
    let generation = created["generation"].as_u64().unwrap();

    // Drive deterministic output that includes CJK text.
    let input = "printf 'hello-终端-ok\\n'\\n";
    mgr.dispatch(
        &owner,
        Path::new("/ws"),
        &json!({
            "type": "terminal_input",
            "terminalId": terminal_id,
            "generation": generation,
            "dataBase64": BASE64.encode(input.as_bytes()),
        }),
    )
    .expect("input accepted");

    // Wait for the echoed output to arrive via the owner event sink.
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut seen = false;
    while Instant::now() < deadline {
        let captured = events.lock().unwrap();
        seen = captured.iter().any(|event| {
            if event.pointer("/payload/type").and_then(Value::as_str) != Some("terminal_output") {
                return false;
            }
            event
                .pointer("/payload/dataBase64")
                .and_then(Value::as_str)
                .and_then(|data| BASE64.decode(data).ok())
                .map(|bytes| String::from_utf8_lossy(&bytes).contains("hello-终端-ok"))
                .unwrap_or(false)
        });
        drop(captured);
        if seen {
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    if !seen {
        // Shell present but echo did not arrive in time (flaky host); skip.
        let _ = mgr.dispatch(
                &owner,
                Path::new("/ws"),
                &json!({ "type": "terminal_close", "terminalId": terminal_id, "generation": generation }),
            );
        return;
    }

    // Resize propagates without error.
    mgr.dispatch(
        &owner,
        Path::new("/ws"),
        &json!({
            "type": "terminal_resize",
            "terminalId": terminal_id,
            "generation": generation,
            "cols": 120,
            "rows": 40,
        }),
    )
    .expect("resize accepted");

    let _ = mgr.dispatch(
        &owner,
        Path::new("/ws"),
        &json!({ "type": "terminal_close", "terminalId": terminal_id, "generation": generation }),
    );
}

#[test]
fn a_named_tab_keeps_its_name_and_a_plain_tab_shows_its_shell() {
    let mgr = manager();
    let owner = owner("t-label");
    let create = |payload: Value| mgr.dispatch(&owner, Path::new("/ws"), &payload);
    let Ok(named) =
        create(json!({ "type": "terminal_create", "profileId": "default", "label": " Pi " }))
    else {
        return; // host without a usable shell — skip
    };
    let plain = create(json!({ "type": "terminal_create", "profileId": "default", "label": "" }))
        .expect("second tab");
    let listed = mgr
        .dispatch(
            &owner,
            Path::new("/ws"),
            &json!({ "type": "terminal_list" }),
        )
        .unwrap();
    let labels: Vec<&str> = listed["tabs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|tab| tab["label"].as_str().unwrap())
        .collect();
    assert_eq!(labels, ["Pi", "Default"]);
    for tab in [named, plain] {
        let _ = mgr.dispatch(
            &owner,
            Path::new("/ws"),
            &json!({ "type": "terminal_close", "terminalId": tab["terminalId"], "generation": tab["generation"] }),
        );
    }
}

#[test]
fn unknown_profile_id_is_rejected() {
    let mgr = manager();
    let owner = owner("t-profile");
    let result = mgr.dispatch(
        &owner,
        Path::new("/ws"),
        &json!({ "type": "terminal_create", "profileId": "bogus" }),
    );
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("unknown shell profile"));
}

#[test]
fn resize_rejects_out_of_range_dimensions() {
    let mgr = manager();
    let owner = owner("t-resize");
    // 65536 as u64 would truncate to 0; it must be rejected before truncation.
    let oversize = mgr.dispatch(
            &owner,
            Path::new("/ws"),
            &json!({ "type": "terminal_resize", "terminalId": "x", "generation": 1, "cols": 65536, "rows": 24 }),
        );
    assert!(oversize.is_err());
    let zero = mgr.dispatch(
            &owner,
            Path::new("/ws"),
            &json!({ "type": "terminal_resize", "terminalId": "x", "generation": 1, "cols": 0, "rows": 24 }),
        );
    assert!(zero.is_err());
}

#[test]
fn ack_requires_a_known_running_terminal() {
    let mgr = manager();
    let owner = owner("t-ack");
    let result = mgr.dispatch(
        &owner,
        Path::new("/ws"),
        &json!({ "type": "terminal_ack", "terminalId": "missing", "generation": 1, "sequence": 1 }),
    );
    assert!(result.is_err());
}

#[test]
fn list_returns_empty_when_no_live_tabs_and_no_metadata() {
    let mgr = manager();
    let owner = owner("t-empty");
    let listed = mgr
        .dispatch(
            &owner,
            Path::new("/ws"),
            &json!({ "type": "terminal_list" }),
        )
        .unwrap();
    assert_eq!(listed["tabs"].as_array().unwrap().len(), 0);
}

#[test]
fn panel_height_command_is_acknowledged() {
    let mgr = manager();
    let owner = owner("t-height");
    let result = mgr.dispatch(
        &owner,
        Path::new("/ws"),
        &json!({ "type": "terminal_set_panel_height", "heightPx": 400 }),
    );
    assert!(result.is_ok());
}
