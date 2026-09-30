// ABOUTME: Exercises terminal id allocation, quotas, and close leases.
// ABOUTME: The module under test is terminal::registry.

use super::*;

fn test_registry(global_quota: usize) -> TerminalRegistry {
    TerminalRegistry::new(global_quota)
}

fn test_key(owner_label: &str, root: &str) -> TerminalKey {
    TerminalKey {
        owner: OwnerId::from_client_id(owner_label),
        workspace_root: PathBuf::from(root),
    }
}

fn reserve(
    registry: &TerminalRegistry,
    key: &TerminalKey,
) -> Result<TerminalReservation, TerminalError> {
    registry.reserve_tab_with_profile(key, "default", "Default".to_string())
}

fn live_count(registry: &TerminalRegistry) -> usize {
    let state = registry
        .inner
        .lock()
        .expect("terminal registry lock poisoned");
    registry.live_reservations_locked(&state)
}

fn commit(
    registry: &TerminalRegistry,
    key: &TerminalKey,
    reservation: &TerminalReservation,
) -> TerminalHandle {
    registry
        .commit_running(key, &reservation.terminal_id, reservation.generation)
        .expect("commit_running")
}

#[test]
fn sixth_non_closing_tab_is_rejected_and_five_reserve_global_slots() {
    let registry = test_registry(15);
    let key = test_key("owner-a", "/workspace-a");
    for _ in 0..WORKSPACE_TAB_QUOTA {
        reserve(&registry, &key).unwrap();
    }
    assert_eq!(
        reserve(&registry, &key),
        Err(TerminalError::WorkspaceTabQuota)
    );
    // Creating tabs atomically reserve global live slots before spawn.
    assert_eq!(live_count(&registry), WORKSPACE_TAB_QUOTA);
}

#[test]
fn restart_of_exited_tab_reserves_global_quota() {
    let registry = test_registry(1);
    let exited_key = test_key("owner-restart-exited", "/ws-restart-exited");
    let exited = reserve(&registry, &exited_key).unwrap();
    commit(&registry, &exited_key, &exited);
    registry
        .mark_exited(&exited_key, &exited.terminal_id, exited.generation, Some(0))
        .unwrap();
    let live_key = test_key("owner-restart-live", "/ws-restart-live");
    reserve(&registry, &live_key).unwrap();

    assert_eq!(
        registry.restart(
            &exited_key,
            &exited.terminal_id,
            exited.generation,
            "default",
            "Terminal".to_string(),
        ),
        Err(TerminalError::GlobalProcessQuota)
    );
    assert_eq!(live_count(&registry), 1);
}

#[test]
fn restart_updates_the_visible_profile_and_label() {
    let registry = test_registry(15);
    let key = test_key("owner-restart-profile", "/ws-restart-profile");
    let initial = reserve(&registry, &key).unwrap();
    commit(&registry, &key, &initial);
    let restarted = registry
        .restart(
            &key,
            &initial.terminal_id,
            initial.generation,
            "powershell",
            "PowerShell".to_string(),
        )
        .unwrap();

    assert_eq!(
        registry.descriptors(&key),
        vec![TerminalDescriptor {
            terminal_id: initial.terminal_id,
            generation: restarted.generation,
            status: TerminalStatus::Creating,
            profile_id: "powershell".to_string(),
            label: "PowerShell".to_string(),
            exit_code: None,
            fail_reason: None,
        }]
    );
}

#[test]
fn restart_rejects_a_closing_lease() {
    let registry = test_registry(15);
    let key = test_key("owner-restart-closing", "/ws-restart-closing");
    let reservation = reserve(&registry, &key).unwrap();
    commit(&registry, &key, &reservation);
    registry
        .begin_close(&key, &reservation.terminal_id, reservation.generation)
        .unwrap();

    assert_eq!(
        registry.restart(
            &key,
            &reservation.terminal_id,
            reservation.generation,
            "default",
            "Terminal".to_string(),
        ),
        Err(TerminalError::AlreadyClosing)
    );
}

#[test]
fn stale_terminal_generation_cannot_mutate_restarted_tab() {
    let registry = test_registry(15);
    let key = test_key("owner-a", "/workspace-a");
    let first = reserve(&registry, &key).unwrap();
    let second = registry
        .restart(
            &key,
            &first.terminal_id,
            first.generation,
            "default",
            "Terminal".to_string(),
        )
        .unwrap();
    assert_eq!(second.generation, first.generation + 1);
    assert!(matches!(
        registry.require_running(&key, &first.terminal_id, first.generation),
        Err(TerminalError::StaleGeneration)
    ));
    assert!(registry
        .require_running(&key, &first.terminal_id, second.generation)
        .is_err());
}

#[test]
fn failed_spawn_keeps_tab_slot_but_releases_live_quota() {
    let registry = test_registry(15);
    let key = test_key("owner-fail", "/ws-fail");
    let reservation = reserve(&registry, &key).unwrap();
    // Creating holds a global live slot until it resolves.
    assert_eq!(live_count(&registry), 1);
    registry
        .mark_failed(
            &key,
            &reservation.terminal_id,
            reservation.generation,
            "no pty".to_string(),
        )
        .unwrap();
    // Failed releases the live slot it reserved.
    assert_eq!(live_count(&registry), 0);
    // ... but still consumes a workspace slot.
    let descriptors = registry.descriptors(&key);
    assert_eq!(descriptors.len(), 1);
    assert_eq!(descriptors[0].status, TerminalStatus::Failed);
    // Fill the remaining slots; the sixth is rejected.
    for _ in 0..(WORKSPACE_TAB_QUOTA - 1) {
        reserve(&registry, &key).unwrap();
    }
    assert_eq!(
        reserve(&registry, &key),
        Err(TerminalError::WorkspaceTabQuota)
    );
    // The four newly reserved Creating tabs hold live slots; the failed one does not.
    assert_eq!(live_count(&registry), WORKSPACE_TAB_QUOTA - 1);
}

#[test]
fn exited_tab_releases_live_quota_but_keeps_slot() {
    let registry = test_registry(15);
    let key = test_key("owner-exit", "/ws-exit");
    let reservation = reserve(&registry, &key).unwrap();
    commit(&registry, &key, &reservation);
    assert_eq!(live_count(&registry), 1);
    registry
        .mark_exited(
            &key,
            &reservation.terminal_id,
            reservation.generation,
            Some(0),
        )
        .unwrap();
    assert_eq!(live_count(&registry), 0);
    // Exited tab still consumes a workspace slot until explicitly closed.
    for _ in 0..(WORKSPACE_TAB_QUOTA - 1) {
        reserve(&registry, &key).unwrap();
    }
    assert_eq!(
        reserve(&registry, &key),
        Err(TerminalError::WorkspaceTabQuota)
    );
}

#[test]
fn global_process_quota_blocks_reserve_tab_before_spawn() {
    let registry = test_registry(1);
    let key_a = test_key("owner-q1", "/ws-q1");
    let key_b = test_key("owner-q2", "/ws-q2");
    let _a = reserve(&registry, &key_a).unwrap();
    // Global quota is checked atomically at reserve time, before any spawn.
    assert_eq!(
        reserve(&registry, &key_b),
        Err(TerminalError::GlobalProcessQuota)
    );
}

#[test]
fn require_running_rejects_wrong_generation() {
    let registry = test_registry(15);
    let key = test_key("owner-req", "/ws-req");
    let reservation = reserve(&registry, &key).unwrap();
    commit(&registry, &key, &reservation);
    assert!(matches!(
        registry.require_running(&key, &reservation.terminal_id, 999),
        Err(TerminalError::StaleGeneration)
    ));
    assert!(registry
        .require_running(&key, &reservation.terminal_id, reservation.generation)
        .is_ok());
}

#[test]
fn close_releases_workspace_slot_and_live_quota() {
    let registry = test_registry(15);
    let key = test_key("owner-close", "/ws-close");
    let reservation = reserve(&registry, &key).unwrap();
    commit(&registry, &key, &reservation);
    let lease = registry
        .begin_close(&key, &reservation.terminal_id, reservation.generation)
        .unwrap();
    registry
        .finish_close(&key, &lease.terminal_id, lease.generation)
        .unwrap();
    assert!(registry.descriptors(&key).is_empty());
    assert_eq!(live_count(&registry), 0);
    // Slot is free again.
    reserve(&registry, &key).unwrap();
}

#[test]
fn double_close_is_already_closing() {
    let registry = test_registry(15);
    let key = test_key("owner-dbl", "/ws-dbl");
    let reservation = reserve(&registry, &key).unwrap();
    commit(&registry, &key, &reservation);
    registry
        .begin_close(&key, &reservation.terminal_id, reservation.generation)
        .unwrap();
    assert_eq!(
        registry.begin_close(&key, &reservation.terminal_id, reservation.generation),
        Err(TerminalError::AlreadyClosing)
    );
}

#[test]
fn same_path_different_owners_are_isolated() {
    let registry = test_registry(15);
    let key_a = test_key("owner-same-a", "/same");
    let key_b = test_key("owner-same-b", "/same");
    for _ in 0..WORKSPACE_TAB_QUOTA {
        reserve(&registry, &key_a).unwrap();
    }
    // Owner B on the same root has its own five slots.
    reserve(&registry, &key_b).unwrap();
}

#[test]
fn cleanup_owner_leases_every_live_terminal_across_roots() {
    let registry = test_registry(15);
    let key_root1 = test_key("owner-clean", "/root1");
    let key_root2 = TerminalKey {
        owner: key_root1.owner.clone(),
        workspace_root: PathBuf::from("/root2"),
    };
    let owner = key_root1.owner.clone();
    let a = reserve(&registry, &key_root1).unwrap();
    let b = reserve(&registry, &key_root2).unwrap();
    commit(&registry, &key_root1, &a);
    commit(&registry, &key_root2, &b);

    assert_eq!(live_count(&registry), 2);
    let leases = registry.cleanup_owner(&owner);
    assert_eq!(leases.len(), 2);
    // Closing tabs still hold live quota until finish_close.
    assert_eq!(live_count(&registry), 2);
    for (key, lease) in &leases {
        registry
            .finish_close(key, &lease.terminal_id, lease.generation)
            .unwrap();
    }
    assert_eq!(live_count(&registry), 0);
}

#[test]
fn descriptors_are_redacted() {
    let registry = test_registry(15);
    let key = test_key("owner-redact", "/ws-redact");
    let reservation = reserve(&registry, &key).unwrap();
    commit(&registry, &key, &reservation);
    let json = serde_json::to_string(&registry.descriptors(&key)).unwrap();
    assert!(!json.contains("cwd"));
    assert!(!json.contains("pid"));
    assert!(!json.contains("port"));
    assert!(!json.contains("capability"));
    assert!(json.contains("terminalId"));
    assert!(json.contains("generation"));
}
