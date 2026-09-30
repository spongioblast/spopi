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

/// Host operations a phone may call. Settings writes and device management stay desktop-only.
const HOST_READ: &[&str] = &[
    "get_preference",
    "list_preferences",
    "list_pi_packages",
    "browse_pi_packages",
    "check_pi_package_updates",
    "list_installed_apps",
    "session_ui_profile_load",
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
        ],
        ClientKind::Remote { tier, .. } => {
            let mut names = vec!["subscribe", "data_read", "host_read"];
            if matches!(tier, Tier::Control | Tier::Full) {
                names.extend(["file_read", "prompt", "git_read"]);
            }
            if matches!(tier, Tier::Full) {
                names.extend(["runtime", "git_write", "terminal"]);
            }
            names
        }
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
        RoutedAction::Host { operation, .. } => HOST_READ.contains(&operation.as_str()),
    }
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
                frame: json!({"type": "runtime_request", "command": {"type": "set_model"}}),
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
            "list_installed_apps",
            "session_ui_profile_load",
        ];
        let desktop_only = [
            "set_preference",
            "remove_preference",
            "install_pi_package",
            "remove_pi_package",
            "update_pi_package",
            "list_local_addresses",
            "open_in_app",
            "reveal_path",
            "open_external",
            "resolve_workspace",
            "create_project",
            "sweep_project",
            "project_chats",
            "relink_project",
            "keep_chats_in_project",
            "rename_project",
            "close_project",
            "forget_workspace",
            "delete_sessions",
            "session_ui_profile_save",
            "restart_runtime",
            "pick_skill_folder",
            "engine_scrape",
            "check_dependencies",
            "start_dependency_install",
            "dependency_install_status",
            "cancel_dependency_install",
            "surf_extension_path",
            "surf_connect",
            "open_browser_extensions",
        ];
        for name in phone_read {
            for tier in [Tier::Observe, Tier::Control, Tier::Full] {
                assert!(allowed(&remote(tier), &host(name)), "{name} {tier:?}");
            }
            assert!(allowed(&ClientKind::Desktop, &host(name)));
        }
        for name in desktop_only {
            for tier in [Tier::Observe, Tier::Control, Tier::Full] {
                assert!(!allowed(&remote(tier), &host(name)), "{name} {tier:?}");
            }
            assert!(allowed(&ClientKind::Desktop, &host(name)));
        }
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
