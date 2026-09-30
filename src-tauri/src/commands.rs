// ABOUTME: Tauri commands that open a workspace, a session, or a notification.
// ABOUTME: Window creation lives in workspace_windows.rs.

use std::path::PathBuf;

use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use crate::host::server::HostServer;

/// Open the native folder picker and, if the user selects a directory, switch
/// the focused SPOPI window to that workspace. Returns the chosen path, or
/// `None` if cancelled.
#[tauri::command]
pub(crate) async fn open_folder_as_workspace(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<Option<String>, String> {
    let Some(picked) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let path = picked
        .as_path()
        .ok_or_else(|| "Selected folder is not a local path".to_string())?
        .to_path_buf();
    super::workspace_windows::open_workspace_at_path(&app, Some(&window), &path, None)?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// The project at `from_path` went missing. Let the user pick where it is now,
/// bring its chats and records along, and open it there. `None` if cancelled.
#[tauri::command]
pub(crate) async fn locate_workspace(
    app: AppHandle,
    window: WebviewWindow,
    from_path: String,
) -> Result<Option<String>, String> {
    let Some(picked) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let path = picked
        .as_path()
        .ok_or_else(|| "Selected folder is not a local path".to_string())?
        .to_path_buf();
    let launcher = app
        .try_state::<super::workspace_windows::WorkspaceLauncher>()
        .ok_or_else(|| "Workspace launcher is not ready".to_string())?;
    let agent = crate::pi::binary::pi_agent_dir()
        .ok_or_else(|| "Pi agent directory is not available".to_string())?;
    crate::data::session_relocate::relocate_missing_project(
        &launcher.metadata,
        &from_path,
        &path,
        &agent,
    )?;
    super::workspace_windows::open_workspace_at_path(&app, Some(&window), &path, None)?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Open a brand-new session in the given workspace (identified by its
/// file-system path). If the workspace window is already open, spawn a fresh
/// runtime and navigate that window to the new temporary session; otherwise
/// open a new workspace window at the fresh session.
#[tauri::command]
pub(crate) async fn open_new_session_in_workspace(
    app: AppHandle,
    window: WebviewWindow,
    project_path: String,
) -> Result<(), String> {
    let cwd = PathBuf::from(&project_path);
    if !cwd.is_dir() {
        return Err(format!("Project folder no longer exists: {project_path}"));
    }
    super::workspace_windows::open_fresh_session_at_path(&app, Some(&window), &cwd)
}

/// Switch the focused SPOPI window to `projectPath` and resume the given saved
/// session in it. Used by the sidebar to jump to a session that belongs to a
/// different project without opening a second project window.
#[tauri::command]
pub(crate) async fn open_session_in_project(
    app: AppHandle,
    window: WebviewWindow,
    project_path: String,
    session_id: String,
) -> Result<(), String> {
    let cwd = PathBuf::from(&project_path);
    if !cwd.is_dir() {
        return Err(format!("Project folder no longer exists: {project_path}"));
    }
    let session = session_id.trim();
    let resume = if session.is_empty() {
        None
    } else {
        Some(session.to_string())
    };
    super::workspace_windows::open_workspace_at_path(&app, Some(&window), &cwd, resume.as_deref())
}

/// Show a task notification whose default click opens the completed session.
#[tauri::command]
pub(crate) async fn show_task_completion_notification(
    app: AppHandle,
    title: String,
    body: String,
    workspace_id: String,
    session_id: String,
) -> Result<(), String> {
    let host = app
        .try_state::<HostServer>()
        .ok_or_else(|| "Host server is not ready".to_string())?;
    let cwd = host.workspace_root_path(&workspace_id)?;

    #[cfg(target_os = "macos")]
    let _ = notify_rust::set_application(&app.config().identifier);

    let notification = notify_rust::Notification::new()
        .summary(&title)
        .body(&body)
        .show()
        .map_err(|error| format!("Cannot show task notification: {error}"))?;

    tauri::async_runtime::spawn_blocking(move || {
        notification.wait_for_action(move |action| {
            if action == "__closed" {
                return;
            }
            if let Err(error) = super::workspace_windows::open_workspace_at_path(
                &app,
                None,
                &cwd,
                Some(&session_id),
            ) {
                log::error!("[spopi-host] failed to open notification session: {error}");
            }
        });
    });
    Ok(())
}

/// Retry native startup from the bootstrap error window after a failed launch.
/// If startup already succeeded, just close the bootstrap window.
#[tauri::command]
pub(crate) fn retry_startup(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    if app.try_state::<HostServer>().is_some() {
        let _ = window.close();
        return Ok(());
    }
    let static_dir = super::find_static_dir(&app);
    super::setup_native_runtime(&app, static_dir)?;
    let _ = window.close();
    Ok(())
}
