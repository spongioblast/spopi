// ABOUTME: Host-request operation match. The facade only routes here.
// ABOUTME: scripts/check-host-ops.mjs reads the operation names from these arms.

use super::super::http::engine;
use super::super::{HostState, OpError};
use crate::host::capabilities::may_register_workspace;
use super::{
    dependencies, git_identity, mcp, os, packages, preferences, projects, review_drafts, sessions,
    skills, worktrees,
};
use serde_json::Value;

pub(crate) async fn dispatch_host_operation(
    state: &HostState,
    client_id: &str,
    request_id: &str,
    operation: &str,
    frame: &Value,
) -> Result<Value, OpError> {
    match operation {
        "get_preference" | "set_preference" | "remove_preference" | "list_preferences" => {
            preferences::dispatch(state, request_id, operation, frame)
        }
        "list_pi_packages"
        | "browse_pi_packages"
        | "check_pi_package_updates"
        | "install_pi_package"
        | "remove_pi_package"
        | "update_pi_package" => packages::dispatch(state, request_id, operation, frame).await,
        "list_mcp_servers" | "add_mcp_server" | "remove_mcp_server" => {
            mcp::dispatch(state, request_id, operation, frame).await
        }
        "list_local_addresses"
        | "open_path"
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
        "resolve_workspace" => {
            let register = state
                .router
                .lock()
                .ok()
                .and_then(|router| router.client_kind(client_id))
                .is_none_or(|kind| may_register_workspace(&kind));
            sessions::resolve_workspace(state, request_id, frame, register)
        }
        "forget_workspace"
        | "delete_sessions"
        | "session_ui_profile_load"
        | "session_ui_profile_save"
        | "restart_runtime" => sessions::dispatch(state, request_id, operation, frame).await,
        "review_drafts_load" | "review_drafts_save" => {
            review_drafts::dispatch(state, request_id, operation, frame).await
        }
        "git_identity_get" | "git_identity_set" => {
            git_identity::dispatch(state, request_id, operation, frame).await
        }
        "create_worktree" | "merge_worktree" | "remove_worktree" => {
            worktrees::dispatch(state, request_id, operation, frame).await
        }
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
        _ => Err(OpError::new(
            "host_operation_unimplemented",
            "Host operation is not implemented on protocol v2",
        )),
    }
}
