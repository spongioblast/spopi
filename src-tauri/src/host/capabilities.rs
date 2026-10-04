// ABOUTME: Decides which routed actions a desktop or phone client may run.
// ABOUTME: The hello reply lists the same names. The WebView only asks can().

use super::router::{ClientKind, RoutedAction, Tier};
use serde_json::Value;

const CONTROL_RUNTIME: &[&str] = &[
    "prompt",
    "steer",
    "follow_up",
    "abort",
    "extension_ui_response",
    "new_session",
    "switch_session",
    "set_model",
    "cycle_model",
    "set_thinking_level",
    "cycle_thinking_level",
];

/// Pi commands that only read the session, so every tier may send them.
const RUNTIME_READ: &[&str] = &[
    "get_state",
    "get_messages",
    "get_entries",
    "get_tree",
    "get_session_stats",
    "get_commands",
    "get_available_models",
    "get_available_thinking_levels",
    "get_fork_messages",
    "get_last_assistant_text",
];

const GIT_READ: &[&str] = &[
    "status",
    "diff",
    "log",
    "log_detail",
    "commit_diff",
    "branches",
];

const OBSERVE_DATA: &[&str] = &[
    "list_sessions",
    "list_all_sessions",
    "list_launcher_sessions",
    "search_sessions",
    "cost_dashboard",
    "read_session_messages",
];

const FILE_READ: &[&str] = &["list_files", "workspace_info"];

/// Host operations every phone may call. Actions that only make sense at the desktop
/// (opening files or links there, folder pickers, browser setup, the phone's own interface
/// list) are in no list, so no phone runs them. `engine_scrape` is desktop only: the host
/// fetches the URL it is given, and loopback is always allowed, so a phone could read
/// SPOPI's own loopback routes through it.
const HOST_READ: &[&str] = &[
    "get_preference",
    "list_preferences",
    "list_pi_packages",
    "browse_pi_packages",
    "check_pi_package_updates",
    "session_ui_profile_load",
    "review_drafts_load",
];

/// What a Control phone needs to open a project, start a chat, and chat in it.
const HOST_CHAT: &[&str] = &[
    "create_project",
    "resolve_workspace",
    "project_chats",
    "session_ui_profile_save",
    "shadow_history_files",
    "shadow_history_file_pair",
    "git_identity_get",
];

/// Sidebar state (unread, favourites, archived) a Control phone may write.
const CHAT_PREFERENCE_PREFIX: &str = "ui.sessions.";

/// Phone access settings. The host applies them again at start, so a phone that wrote
/// them could widen its own allowlist; only the desktop changes them.
const PHONE_PREFERENCE_PREFIX: &str = "ui.phone.";

/// Everything else a Full phone may also run: projects, sessions, settings, and setup.
const HOST_MANAGE: &[&str] = &[
    "sweep_project",
    "relink_project",
    "keep_chats_in_project",
    "rename_project",
    "close_project",
    "delete_sessions",
    "review_drafts_save",
    "restart_runtime",
    "forget_workspace",
    "git_identity_set",
    "create_worktree",
    "merge_worktree",
    "remove_worktree",
    "set_preference",
    "remove_preference",
    "install_pi_package",
    "remove_pi_package",
    "update_pi_package",
    "list_mcp_servers",
    "add_mcp_server",
    "remove_mcp_server",
    "check_dependencies",
    "start_dependency_install",
    "dependency_install_status",
    "cancel_dependency_install",
];

pub fn capability_names(kind: &ClientKind) -> Vec<&'static str> {
    match kind {
        ClientKind::Desktop => vec![
            "subscribe",
            "data_read",
            "file_read",
            "prompt",
            "runtime",
            "git_read",
            "git_write",
            "terminal",
            "host_read",
            "settings_write",
            "devices",
        ],
        ClientKind::Remote { tier, .. } => {
            let mut names = vec!["subscribe", "data_read", "host_read"];
            if matches!(tier, Tier::Control | Tier::Full) {
                names.extend(["file_read", "prompt", "git_read"]);
            }
            if matches!(tier, Tier::Full) {
                names.extend(["runtime", "git_write", "terminal", "settings_write"]);
            }
            names
        }
    }
}

/// Whether `resolve_workspace` may add a folder SPOPI does not know yet. A Control phone
/// opens existing projects only; adding any folder would expose its files to `list_files`.
pub fn may_register_workspace(kind: &ClientKind) -> bool {
    match kind {
        ClientKind::Desktop => true,
        ClientKind::Remote { tier, .. } => matches!(tier, Tier::Full),
    }
}

pub fn allowed(kind: &ClientKind, action: &RoutedAction) -> bool {
    let ClientKind::Remote { tier, .. } = kind else {
        return true;
    };
    match action {
        RoutedAction::Subscribe { .. } => true,
        RoutedAction::Terminal { .. } => matches!(tier, Tier::Full),
        RoutedAction::Data { frame, .. } => data_allowed(*tier, frame),
        RoutedAction::Git { frame, .. } => git_allowed(*tier, frame),
        RoutedAction::Runtime { frame, .. } => runtime_allowed(*tier, frame),
        RoutedAction::Host {
            operation, frame, ..
        } => host_allowed(*tier, operation, frame),
    }
}

fn host_allowed(tier: Tier, operation: &str, frame: &Value) -> bool {
    if HOST_READ.contains(&operation) {
        return true;
    }
    let control = matches!(tier, Tier::Control | Tier::Full);
    if HOST_CHAT.contains(&operation) {
        return control;
    }
    if matches!(operation, "set_preference" | "remove_preference") {
        let key = frame.get("key").and_then(Value::as_str).unwrap_or("");
        if key.starts_with(PHONE_PREFERENCE_PREFIX) {
            return false;
        }
        if key.starts_with(CHAT_PREFERENCE_PREFIX) {
            return control;
        }
    }
    HOST_MANAGE.contains(&operation) && matches!(tier, Tier::Full)
}

fn data_allowed(tier: Tier, frame: &Value) -> bool {
    let op = frame.get("operation").and_then(Value::as_str).unwrap_or("");
    if OBSERVE_DATA.contains(&op) {
        return true;
    }
    FILE_READ.contains(&op) && matches!(tier, Tier::Control | Tier::Full)
}

fn git_allowed(tier: Tier, frame: &Value) -> bool {
    if frame.get("type").and_then(Value::as_str) == Some("git_ai_commit_message") {
        return matches!(tier, Tier::Full);
    }
    let command = frame
        .pointer("/command/type")
        .and_then(Value::as_str)
        .unwrap_or("status");
    if GIT_READ.contains(&command) {
        return matches!(tier, Tier::Control | Tier::Full);
    }
    matches!(tier, Tier::Full)
}

fn runtime_allowed(tier: Tier, frame: &Value) -> bool {
    let frame_type = frame.get("type").and_then(Value::as_str).unwrap_or("");
    if matches!(
        frame_type,
        "runtime_snapshot_request" | "runtime_capabilities_request" | "runtime_subscribe"
    ) {
        return true;
    }
    let command = frame
        .pointer("/command/type")
        .and_then(Value::as_str)
        .unwrap_or("");
    if frame_type == "runtime_request" && RUNTIME_READ.contains(&command) {
        return true;
    }
    if CONTROL_RUNTIME.contains(&command) || frame_type == "runtime_rebind_session_request" {
        return matches!(tier, Tier::Control | Tier::Full);
    }
    matches!(tier, Tier::Full)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::host::router::Tier;
    use serde_json::json;

    fn remote(tier: Tier) -> ClientKind {
        ClientKind::Remote {
            device_id: "d".into(),
            name: "Pixel".into(),
            tier,
        }
    }

    fn host(operation: &str) -> RoutedAction {
        RoutedAction::Host {
            client_id: "c".into(),
            request_id: "r".into(),
            operation: operation.into(),
            frame: json!({}),
        }
    }

    #[test]
    fn desktop_is_always_allowed_and_phones_follow_the_table() {
        let kinds = [
            ClientKind::Desktop,
            remote(Tier::Observe),
            remote(Tier::Control),
            remote(Tier::Full),
        ];
        let actions = [
            RoutedAction::Subscribe {
                client_id: "c".into(),
                request_id: "r".into(),
                target: json!({}),
            },
            RoutedAction::Data {
                client_id: "c".into(),
                request_id: "r".into(),
                frame: json!({"operation": "list_sessions"}),
            },
            RoutedAction::Data {
                client_id: "c".into(),
                request_id: "r".into(),
                frame: json!({"operation": "list_files"}),
            },
            RoutedAction::Runtime {
                client_id: "c".into(),
                request_id: "r".into(),
                frame: json!({"type": "runtime_request", "command": {"type": "prompt"}}),
            },
            RoutedAction::Runtime {
                client_id: "c".into(),
                request_id: "r".into(),
                frame: json!({"type": "runtime_request", "command": {"type": "bash"}}),
            },
            RoutedAction::Git {
                client_id: "c".into(),
                request_id: "r".into(),
                frame: json!({"type": "git_command", "command": {"type": "status"}}),
            },
            RoutedAction::Git {
                client_id: "c".into(),
                request_id: "r".into(),
                frame: json!({"type": "git_command", "command": {"type": "commit"}}),
            },
            RoutedAction::Terminal {
                client_id: "c".into(),
                request_id: "r".into(),
                frame: json!({}),
            },
        ];
        for kind in &kinds {
            for action in &actions {
                let _ = allowed(kind, action);
            }
        }
        assert!(!allowed(&remote(Tier::Observe), &actions[3]));
        assert!(allowed(&remote(Tier::Control), &actions[3]));
        assert!(!allowed(&remote(Tier::Control), &actions[4]));
        assert!(allowed(&remote(Tier::Full), &actions[4]));
        assert!(!allowed(&remote(Tier::Control), &actions[6]));
        assert!(!allowed(&remote(Tier::Control), &actions[7]));
        assert!(allowed(&remote(Tier::Full), &actions[7]));
        assert!(!allowed(&remote(Tier::Observe), &actions[2]));
        assert!(allowed(&remote(Tier::Control), &actions[2]));
    }

    #[test]
    fn every_host_operation_has_a_row() {
        let phone_read = [
            "get_preference",
            "list_preferences",
            "list_pi_packages",
            "browse_pi_packages",
            "check_pi_package_updates",
            "session_ui_profile_load",
            "review_drafts_load",
        ];
        let chat = [
            "create_project",
            "resolve_workspace",
            "project_chats",
            "session_ui_profile_save",
            "shadow_history_files",
            "shadow_history_file_pair",
            "git_identity_get",
        ];
        let manage = [
            "sweep_project",
            "relink_project",
            "keep_chats_in_project",
            "rename_project",
            "close_project",
            "delete_sessions",
            "review_drafts_save",
            "restart_runtime",
            "forget_workspace",
            "git_identity_set",
            "create_worktree",
            "merge_worktree",
            "remove_worktree",
            "set_preference",
            "remove_preference",
            "install_pi_package",
            "remove_pi_package",
            "update_pi_package",
            "list_mcp_servers",
            "add_mcp_server",
            "remove_mcp_server",
            "check_dependencies",
            "start_dependency_install",
            "dependency_install_status",
            "cancel_dependency_install",
        ];
        let desktop_only = [
            "list_local_addresses",
            "open_path",
            "reveal_path",
            "open_external",
            "pick_skill_folder",
            "surf_extension_path",
            "surf_connect",
            "open_browser_extensions",
            "engine_scrape",
        ];
        for name in phone_read {
            for tier in [Tier::Observe, Tier::Control, Tier::Full] {
                assert!(allowed(&remote(tier), &host(name)), "{name} {tier:?}");
            }
            assert!(allowed(&ClientKind::Desktop, &host(name)));
        }
        for name in chat {
            assert!(!allowed(&remote(Tier::Observe), &host(name)), "{name}");
            assert!(allowed(&remote(Tier::Control), &host(name)), "{name}");
            assert!(allowed(&remote(Tier::Full), &host(name)), "{name}");
        }
        for name in manage {
            assert!(!allowed(&remote(Tier::Observe), &host(name)), "{name}");
            assert!(!allowed(&remote(Tier::Control), &host(name)), "{name}");
            assert!(allowed(&remote(Tier::Full), &host(name)), "{name}");
        }
        for name in desktop_only {
            for tier in [Tier::Observe, Tier::Control, Tier::Full] {
                assert!(!allowed(&remote(tier), &host(name)), "{name} {tier:?}");
            }
            assert!(allowed(&ClientKind::Desktop, &host(name)));
        }
    }

    #[test]
    fn a_control_phone_writes_sidebar_state_but_not_other_settings() {
        let write = |key: &str| RoutedAction::Host {
            client_id: "c".into(),
            request_id: "r".into(),
            operation: "set_preference".into(),
            frame: json!({"key": key, "value": {}}),
        };
        let sidebar = write("ui.sessions.unread");
        let theme = write("ui.theme");
        assert!(!allowed(&remote(Tier::Observe), &sidebar));
        assert!(allowed(&remote(Tier::Control), &sidebar));
        assert!(!allowed(&remote(Tier::Control), &theme));
        assert!(allowed(&remote(Tier::Full), &theme));
    }

    #[test]
    fn only_the_desktop_and_full_phones_add_new_project_folders() {
        assert!(may_register_workspace(&ClientKind::Desktop));
        assert!(may_register_workspace(&remote(Tier::Full)));
        assert!(!may_register_workspace(&remote(Tier::Control)));
        assert!(!may_register_workspace(&remote(Tier::Observe)));
    }

    #[test]
    fn no_phone_changes_phone_access_settings() {
        for operation in ["set_preference", "remove_preference"] {
            for key in ["ui.phone.allow", "ui.phone.enabled", "ui.phone.ip"] {
                let action = RoutedAction::Host {
                    client_id: "c".into(),
                    request_id: "r".into(),
                    operation: operation.into(),
                    frame: json!({"key": key, "value": []}),
                };
                for tier in [Tier::Observe, Tier::Control, Tier::Full] {
                    assert!(
                        !allowed(&remote(tier), &action),
                        "{operation} {key} {tier:?}"
                    );
                }
                assert!(allowed(&ClientKind::Desktop, &action));
            }
        }
    }

    #[test]
    fn every_phone_may_read_the_session_and_control_may_pick_the_model() {
        let command = |name: &str| RoutedAction::Runtime {
            client_id: "c".into(),
            request_id: "r".into(),
            frame: json!({"type": "runtime_request", "command": {"type": name}}),
        };
        for name in [
            "get_state",
            "get_session_stats",
            "get_commands",
            "get_available_models",
        ] {
            assert!(allowed(&remote(Tier::Observe), &command(name)), "{name}");
        }
        assert!(!allowed(&remote(Tier::Observe), &command("prompt")));
        assert!(!allowed(&remote(Tier::Observe), &command("set_model")));
        assert!(allowed(&remote(Tier::Control), &command("set_model")));
        assert!(!allowed(&remote(Tier::Control), &command("bash")));
        assert!(allowed(&remote(Tier::Full), &command("bash")));
    }

    #[test]
    fn only_the_desktop_manages_devices() {
        assert!(capability_names(&ClientKind::Desktop).contains(&"devices"));
        for tier in [Tier::Observe, Tier::Control, Tier::Full] {
            assert!(!capability_names(&remote(tier)).contains(&"devices"));
        }
        assert!(capability_names(&remote(Tier::Full)).contains(&"settings_write"));
        assert!(!capability_names(&remote(Tier::Control)).contains(&"settings_write"));
    }

    #[test]
    fn remote_hello_lists_fewer_capabilities_than_desktop() {
        let phone = capability_names(&remote(Tier::Observe));
        let desktop = capability_names(&ClientKind::Desktop);
        assert!(phone.len() < desktop.len());
        assert!(!phone.contains(&"settings_write"));
    }

    #[test]
    fn remote_observe_is_denied_a_settings_write() {
        use crate::host::router::{HostRouter, PROTOCOL_VERSION};
        let mut router = HostRouter::new();
        router
            .connect_as(
                "phone",
                &json!({
                    "type": "hello",
                    "protocolVersion": PROTOCOL_VERSION,
                    "clientId": "phone",
                }),
                remote(Tier::Observe),
            )
            .unwrap();
        let error = router
            .route(
                "phone",
                &json!({
                    "type": "host_request",
                    "requestId": "1",
                    "operation": "set_preference",
                }),
            )
            .unwrap_err();
        assert_eq!(error.code, "not_allowed");
    }
}
