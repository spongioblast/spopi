// ABOUTME: Opens, focuses, and navigates the native workspace windows.
// ABOUTME: Tauri command wrappers live in commands.rs. The menu lives in main.rs.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};

use tauri::image::Image;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use super::PiRuntimeState;
use crate::data::metadata_store::MetadataStore;
use crate::host::server::HostServer;
use crate::pi::coordinator::RuntimeTarget;
use crate::pi::launch::PiLaunchResolver;

/// Shared services needed to bring up an additional workspace window after
/// startup (when the user opens a folder as a new workspace).
pub(crate) struct WorkspaceLauncher {
    pub(crate) metadata: Arc<Mutex<MetadataStore>>,
    pub(crate) launch: PiLaunchResolver,
}

pub(crate) struct FocusedWorkspaceState(pub(crate) Mutex<Option<String>>);
pub(crate) struct WindowWorkspaceState(pub(crate) Mutex<HashMap<String, String>>);

/// Opening a folder brings a closed project back: it leaves the hidden list
/// and its chats show again.
fn reopen_workspace(launcher: &WorkspaceLauncher, cwd: &Path) -> Result<String, String> {
    let mut store = launcher
        .metadata
        .lock()
        .map_err(|_| "SPOPI metadata store is unavailable".to_string())?;
    let workspace_id = store.workspace_id_for_path(cwd)?;
    let canonical = crate::data::paths::canonical_path(cwd).unwrap_or_else(|_| cwd.to_path_buf());
    store.unhide_workspace(&canonical.to_string_lossy())?;
    Ok(workspace_id)
}

fn spawn_fresh_runtime(
    runtimes: &PiRuntimeState,
    launch: &PiLaunchResolver,
    cwd: &Path,
    workspace_id: String,
) -> Result<RuntimeTarget, String> {
    let session_id = format!("temporary-{}", uuid::Uuid::new_v4().simple());
    let instance_id = format!("instance-{}", uuid::Uuid::new_v4().simple());
    let target = RuntimeTarget::new(workspace_id, session_id, instance_id);
    let cwd_str = cwd.to_string_lossy().into_owned();
    let launch_spec = launch.native_launch_spec(&cwd_str, None)?;
    runtimes.spawn(target.clone(), launch_spec)?;
    Ok(target)
}

pub(crate) fn open_fresh_session_at_path(
    app: &AppHandle,
    source_window: Option<&WebviewWindow>,
    cwd: &Path,
) -> Result<(), String> {
    let launcher = app
        .try_state::<WorkspaceLauncher>()
        .ok_or_else(|| "Workspace launcher is not ready".to_string())?;
    let host = app
        .try_state::<HostServer>()
        .ok_or_else(|| "Host server is not ready".to_string())?;
    let runtimes = app
        .try_state::<PiRuntimeState>()
        .ok_or_else(|| "Native runtime manager is not ready".to_string())?;
    let workspace_id = reopen_workspace(&launcher, cwd)?;

    host.register_workspace(&workspace_id, cwd.to_path_buf())?;
    let target = spawn_fresh_runtime(&runtimes, &launcher.launch, cwd, workspace_id.clone())?;
    if let Some(window) =
        source_window.filter(|window| window.label().starts_with("native-workspace-"))
    {
        return navigate_workspace_window(app, window, host.origin(), &target, true);
    }
    let label = format!("native-workspace-{workspace_id}");
    if let Some(existing) = app.get_webview_window(&label) {
        return navigate_workspace_window(app, &existing, host.origin(), &target, true);
    }
    if let Err(error) = open_native_workspace_window(app, host.origin(), &target) {
        let _ = runtimes.stop(&target);
        return Err(error);
    }
    Ok(())
}

pub(crate) fn open_workspace_at_path(
    app: &AppHandle,
    source_window: Option<&WebviewWindow>,
    cwd: &Path,
    resume_session_id: Option<&str>,
) -> Result<(), String> {
    let launcher = app
        .try_state::<WorkspaceLauncher>()
        .ok_or_else(|| "Workspace launcher is not ready".to_string())?;
    let host = app
        .try_state::<HostServer>()
        .ok_or_else(|| "Host server is not ready".to_string())?;
    let runtimes = app
        .try_state::<PiRuntimeState>()
        .ok_or_else(|| "Native runtime manager is not ready".to_string())?;

    let workspace_id = reopen_workspace(&launcher, cwd)?;

    host.register_workspace(&workspace_id, cwd.to_path_buf())?;

    // When resuming a saved session, navigate directly to that session id so
    // its history loads; otherwise start a fresh temporary session.
    let target = match resume_session_id {
        Some(id) => RuntimeTarget::new(
            workspace_id.clone(),
            id.to_string(),
            format!("instance-{}", uuid::Uuid::new_v4().simple()),
        ),
        None => spawn_fresh_runtime(&runtimes, &launcher.launch, cwd, workspace_id.clone())?,
    };

    if let Some(window) =
        source_window.filter(|window| window.label().starts_with("native-workspace-"))
    {
        return navigate_workspace_window(
            app,
            window,
            host.origin(),
            &target,
            resume_session_id.is_none(),
        );
    }

    let label = format!("native-workspace-{workspace_id}");
    if let Some(existing) = app.get_webview_window(&label) {
        return navigate_workspace_window(
            app,
            &existing,
            host.origin(),
            &target,
            resume_session_id.is_none(),
        );
    }

    if let Err(error) = open_native_workspace_window(app, host.origin(), &target) {
        if resume_session_id.is_none() {
            let _ = runtimes.stop(&target);
        }
        return Err(error);
    }
    Ok(())
}

fn native_workspace_url(host_origin: &str, target: &RuntimeTarget) -> Result<tauri::Url, String> {
    format!(
        "{}/app/workspaces/{}/sessions/{}",
        host_origin, target.workspace_id, target.session_id
    )
    .parse()
    .map_err(|error| format!("Invalid native Host URL: {error}"))
}

fn set_window_workspace(app: &AppHandle, label: &str, workspace_id: &str) {
    let previous = app.try_state::<WindowWorkspaceState>().and_then(|state| {
        state
            .0
            .lock()
            .ok()
            .and_then(|mut windows| windows.insert(label.to_string(), workspace_id.to_string()))
    });
    // The window moved to another project. Its old project's runtimes are no
    // longer reachable from any window, so stop the idle ones now; a run still
    // in progress is left to the idle reaper.
    if let Some(previous) = previous.filter(|previous| previous != workspace_id) {
        if let Some(runtimes) = app.try_state::<PiRuntimeState>() {
            runtimes.stop_idle_workspace(&previous);
        }
    }
    if let Some(state) = app.try_state::<FocusedWorkspaceState>() {
        if let Ok(mut focused_workspace) = state.0.lock() {
            *focused_workspace = Some(workspace_id.to_string());
        }
    }
}

fn navigate_workspace_window(
    app: &AppHandle,
    window: &WebviewWindow,
    host_origin: &str,
    target: &RuntimeTarget,
    stop_target_on_error: bool,
) -> Result<(), String> {
    let url = native_workspace_url(host_origin, target)?;
    if let Err(error) = window.navigate(url) {
        if stop_target_on_error {
            if let Some(runtimes) = app.try_state::<PiRuntimeState>() {
                let _ = runtimes.stop(target);
            }
        }
        return Err(error.to_string());
    }
    set_window_workspace(app, window.label(), &target.workspace_id);
    let _ = window.set_focus();
    Ok(())
}

pub(crate) fn open_native_workspace_window(
    app: &AppHandle,
    host_origin: &str,
    target: &RuntimeTarget,
) -> Result<(), String> {
    let label = format!("native-workspace-{}", target.workspace_id);
    let url = native_workspace_url(host_origin, target)?;
    let icon = Image::from_bytes(include_bytes!("../icons/32x32.png"))
        .map_err(|error| format!("Failed to load window icon: {error}"))?;
    let builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(url))
        .title("SPOPI")
        .inner_size(1300.0, 860.0)
        .min_inner_size(800.0, 600.0)
        .icon(icon)
        .map_err(|error| error.to_string())?;

    let builder = crate::platform::live_debug::apply(builder.decorations(true));
    let window = builder.build().map_err(|error| error.to_string())?;
    set_window_workspace(app, window.label(), &target.workspace_id);
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn open_fresh_session_for_focused_workspace(app: &AppHandle) -> Result<(), String> {
    // Resolve the *actual* workspace window that currently has OS focus. Passing
    // this real window (instead of None) to `open_fresh_session_at_path`
    // guarantees the new session opens inside the focused window, rather than
    // falling back to a fragile label lookup that can spawn a brand-new window
    // when the global focus state is stale.
    let focused_window = app
        .webview_windows()
        .into_values()
        .find(|window| {
            window.label().starts_with("native-workspace-") && window.is_focused().unwrap_or(false)
        })
        .or_else(|| {
            // No window reports OS focus (e.g. focus was on the menu bar at
            // trigger time): fall back to the last-focused workspace id and look
            // up its existing window.
            let workspace_id = app
                .try_state::<FocusedWorkspaceState>()
                .and_then(|state| state.0.lock().ok().and_then(|guard| guard.clone()))?;
            app.get_webview_window(&format!("native-workspace-{workspace_id}"))
        })
        .ok_or_else(|| "No focused SPOPI workspace window".to_string())?;

    let label = focused_window.label().to_string();
    let workspace_id = app
        .try_state::<WindowWorkspaceState>()
        .and_then(|state| {
            state
                .0
                .lock()
                .ok()
                .and_then(|windows| windows.get(&label).cloned())
        })
        .or_else(|| label.strip_prefix("native-workspace-").map(str::to_string))
        .ok_or_else(|| "Unable to resolve workspace for focused window".to_string())?;

    let host = app
        .try_state::<HostServer>()
        .ok_or_else(|| "Host server is not ready".to_string())?;
    let cwd = host.workspace_root_path(&workspace_id)?;
    open_fresh_session_at_path(app, Some(&focused_window), &cwd)
}
