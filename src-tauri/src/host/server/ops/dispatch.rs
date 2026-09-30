// ABOUTME: Host-request operation match. The facade only routes here.
// ABOUTME: scripts/check-host-ops.mjs reads the operation names from these arms.

use super::super::http::engine;
use super::super::{dispatch_preference_operation, HostState};
use super::{dependencies, os, packages, projects, sessions, skills};
use serde_json::Value;

pub(crate) async fn dispatch_host_operation(
    state: &HostState,
    client_id: &str,
    request_id: &str,
    operation: &str,
    frame: &Value,
) -> Result<Value, (&'static str, String)> {
    match operation {
        "get_preference" | "set_preference" | "remove_preference" | "list_preferences" => {
            dispatch_preference_operation(state, request_id, operation, frame)
        }
        "list_pi_packages"
        | "browse_pi_packages"
        | "check_pi_package_updates"
        | "install_pi_package"
        | "remove_pi_package"
        | "update_pi_package" => packages::dispatch(state, request_id, operation, frame).await,
        "list_installed_apps"
        | "list_local_addresses"
        | "open_in_app"
        | "reveal_path"
        | "open_external"
        | "shadow_history_files"
        | "shadow_history_file_pair" => os::dispatch(state, request_id, operation, frame).await,
        "create_project"
        | "sweep_project"
        | "project_chats"
        | "relink_project"
        | "keep_chats_in_project"
        | "rename_project"
        | "close_project" => projects::dispatch(state, request_id, operation, frame).await,
        "resolve_workspace"
        | "forget_workspace"
        | "delete_sessions"
        | "session_ui_profile_load"
        | "session_ui_profile_save"
        | "restart_runtime" => sessions::dispatch(state, request_id, operation, frame).await,
        "pick_skill_folder" => {
            skills::dispatch(state, client_id, request_id, operation, frame).await
        }
        "engine_scrape" => engine::dispatch_extra(state, request_id, operation, frame).await,
        "check_dependencies"
        | "start_dependency_install"
        | "dependency_install_status"
        | "cancel_dependency_install"
        | "surf_extension_path"
        | "surf_connect"
        | "open_browser_extensions" => {
            dependencies::dispatch(state, request_id, operation, frame).await
        }
        _ => Err((
            "host_operation_unimplemented",
            "Host operation is not implemented on protocol v2".into(),
        )),
    }
}
