// ABOUTME: Starts the Tauri window, the host, and the first Pi runtime.
// ABOUTME: Tauri commands and workspace windows live in sibling modules.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod data;
mod dependencies;
mod editor;
mod git;
mod host;
mod metrics;
mod packages;
mod pi;
mod platform;
mod terminal;
mod workspace_windows;

use commands::{
    locate_workspace, open_folder_as_workspace, open_new_session_in_workspace,
    open_session_in_project, retry_startup, show_task_completion_notification,
};
use data::metadata_store::MetadataStore;
use host::server::HostServer;
use pi::coordinator::RuntimeTarget;
use pi::launch::PiLaunchResolver;
use pi::runtime::PiRuntime;
use serde_json::Value;
use std::cmp::Reverse;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::image::Image;
#[cfg(target_os = "macos")]
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_dialog::MessageDialogKind;

type PiRuntimeState = PiRuntime;

#[cfg(target_os = "macos")]
const MENU_NEW_SESSION_ID: &str = "spopi-new-session";

// With a native menu bar installed, macOS wires WKWebView's text-input
// context fully — including the "Press and Hold" accent picker, which
// swallows key auto-repeat and pops the diacritic popover (hold "u" → ü…).
// Terminal-style repeat requires the picker off; the flag lives in this
// app's own defaults domain, so the change is scoped to SPOPI only. Must run
// before the first webview creates its NSTextInputContext.
#[cfg(target_os = "macos")]
fn set_press_and_hold_enabled(setter: impl FnOnce(bool)) {
    setter(false);
}

#[cfg(target_os = "macos")]
fn disable_press_and_hold_accents() {
    use objc2_foundation::{NSString, NSUserDefaults};
    set_press_and_hold_enabled(|enabled| {
        let key = NSString::from_str("ApplePressAndHoldEnabled");
        NSUserDefaults::standardUserDefaults().setBool_forKey(enabled, &key);
    });
}

// Native menus belong in the macOS system menu bar. On Windows/Linux, Tauri
// draws the same items inside the window as File/Edit/Window/Help, which we
// do not want. New Session (Ctrl+N) is handled in the frontend.
#[cfg(target_os = "macos")]
fn build_app_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let new_session = MenuItem::with_id(
        app,
        MENU_NEW_SESSION_ID,
        "New Session",
        true,
        Some("CmdOrCtrl+N"),
    )?;
    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &new_session,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;
    let help = Submenu::with_items(app, "Help", true, &[])?;
    let app_menu = Submenu::with_items(
        app,
        app.package_info().name.clone(),
        true,
        &[
            &PredefinedMenuItem::about(app, None, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;
    let view = Submenu::with_items(
        app,
        "View",
        true,
        &[&PredefinedMenuItem::fullscreen(app, None)?],
    )?;
    Menu::with_items(app, &[&app_menu, &file, &edit, &view, &window, &help])
}

fn open_bootstrap_window(app: &AppHandle, startup_error: &str) -> Result<(), String> {
    let icon = Image::from_bytes(include_bytes!("../icons/32x32.png"))
        .map_err(|error| format!("Failed to load window icon: {error}"))?;
    let encoded_error = startup_error
        .replace('&', "%26")
        .replace(' ', "%20")
        .replace('\n', "%0A");
    let url = format!("bootstrap.html?startupError={encoded_error}");
    let builder = WebviewWindowBuilder::new(app, "bootstrap", WebviewUrl::App(url.into()))
        .title("SPOPI")
        .inner_size(900.0, 640.0)
        .min_inner_size(700.0, 480.0)
        .icon(icon)
        .map_err(|error| error.to_string())?;

    let builder = crate::platform::live_debug::apply(builder.decorations(true));
    builder.build().map_err(|error| error.to_string())?;
    Ok(())
}

fn canonical_if_exists(dir: PathBuf) -> Option<PathBuf> {
    if dir.join("index.html").exists() {
        Some(fs::canonicalize(&dir).unwrap_or(dir))
    } else {
        None
    }
}

fn resolve_static_dir(
    resource_dir: Option<PathBuf>,
    workspace_public: PathBuf,
    current_dir: Option<PathBuf>,
    debug_assertions: bool,
) -> PathBuf {
    let bundled_public = resource_dir.as_ref().map(|dir| dir.join("public"));
    let current_public = current_dir.unwrap_or_default().join("public");

    if debug_assertions {
        if let Some(dir) = canonical_if_exists(workspace_public) {
            return dir;
        }
        if let Some(dir) = canonical_if_exists(current_public.clone()) {
            return dir;
        }
        return current_public;
    }

    if let Some(dir) = bundled_public.and_then(canonical_if_exists) {
        return dir;
    }

    resource_dir
        .map(|dir| dir.join("public"))
        .unwrap_or_else(|| PathBuf::from("public"))
}

fn find_static_dir(app: &AppHandle) -> PathBuf {
    resolve_static_dir(
        app.path().resource_dir().ok(),
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("public"),
        std::env::current_dir().ok(),
        cfg!(debug_assertions),
    )
}

fn list_session_files(root: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let Ok(entries) = fs::read_dir(root) else {
        return files;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Ok(inner_entries) = fs::read_dir(path) else {
            continue;
        };
        for inner in inner_entries.flatten() {
            let session_path = inner.path();
            if session_path.extension().and_then(|ext| ext.to_str()) == Some("jsonl") {
                files.push(session_path);
            }
        }
    }
    files
}

fn extract_session_cwd(session_path: &Path) -> Option<String> {
    let file = File::open(session_path).ok()?;
    let reader = BufReader::new(file);
    for line in reader.lines().take(200).flatten() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if value.get("type").and_then(Value::as_str) != Some("session") {
            continue;
        }
        let cwd = value.get("cwd").and_then(Value::as_str)?.trim();
        if cwd.is_empty() {
            return None;
        }
        return Some(cwd.to_string());
    }
    None
}

fn choose_latest_existing_boot_target(
    session_cwds_newest_first: impl IntoIterator<Item = (String, String)>,
) -> Option<(String, String)> {
    for (cwd, session_path) in session_cwds_newest_first {
        if Path::new(&cwd).is_dir() {
            return Some((cwd, session_path));
        }
        log::info!("[spopi-host] startup skipped missing workspace {cwd} from {session_path}");
    }
    None
}

/// The newest chat whose folder still exists and is not a closed project.
/// Looks in Pi's session folder and in the session folder of every known
/// project, since a project SPOPI created keeps its chats inside it.
fn find_latest_session_boot_target(
    metadata: &MetadataStore,
    agent_dir: &Path,
) -> Option<(String, String)> {
    let sessions_root = agent_dir.join("sessions");
    let mut files = list_session_files(&sessions_root);
    let hidden = hidden_project_paths(metadata);
    let mut extra_dirs: Vec<PathBuf> = Vec::new();
    if let Some(global) = crate::data::session_dirs::global_session_dir(agent_dir) {
        extra_dirs.push(global);
    }
    for project in open_project_paths(metadata) {
        if hidden
            .iter()
            .any(|path| same_path(path, &project.to_string_lossy()))
        {
            continue;
        }
        extra_dirs.push(crate::data::session_dirs::session_dir_for(
            &project, agent_dir,
        ));
    }
    extra_dirs.sort();
    extra_dirs.dedup();
    for dir in extra_dirs {
        if dir.starts_with(&sessions_root) {
            continue;
        }
        files.extend(
            fs::read_dir(&dir)
                .into_iter()
                .flatten()
                .flatten()
                .map(|entry| entry.path())
                .filter(|path| path.extension().and_then(|ext| ext.to_str()) == Some("jsonl")),
        );
    }
    if files.is_empty() {
        log::info!("[spopi-host] startup target skipped: no session files found");
        return None;
    }

    let mut ranked: Vec<(std::time::SystemTime, PathBuf)> = files
        .into_iter()
        .filter_map(|path| {
            let mtime = fs::metadata(&path).ok()?.modified().ok()?;
            Some((mtime, path))
        })
        .collect();
    ranked.sort_by_key(|(mtime, _)| Reverse(*mtime));
    let candidates = ranked.into_iter().filter_map(|(_, session_path)| {
        let cwd = extract_session_cwd(&session_path)?;
        if hidden.iter().any(|path| same_path(path, &cwd)) {
            log::info!("[spopi-host] startup skipped closed project {cwd}");
            return None;
        }
        Some((cwd, session_path.to_string_lossy().into_owned()))
    });
    choose_latest_existing_boot_target(candidates)
}

fn open_project_paths(metadata: &MetadataStore) -> Vec<PathBuf> {
    metadata
        .connection()
        .prepare("SELECT canonical_path FROM workspaces")
        .and_then(|mut statement| {
            statement
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()
        })
        .unwrap_or_default()
        .into_iter()
        .map(PathBuf::from)
        .collect()
}

fn hidden_project_paths(metadata: &MetadataStore) -> Vec<String> {
    metadata
        .preference_get("ui.workspaces.hidden")
        .ok()
        .flatten()
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default()
        .into_iter()
        .filter_map(|row| row.get("path").and_then(Value::as_str).map(str::to_owned))
        .collect()
}

fn same_path(stored: &str, cwd: &str) -> bool {
    let normalize = |path: &str| {
        crate::data::paths::strip_verbatim_prefix(path)
            .trim_end_matches(['/', '\\'])
            .to_lowercase()
    };
    normalize(stored) == normalize(cwd)
}

/// The latest session's folder when it still exists; otherwise `no_project()`
/// picks a folder for a chat that has no project yet.
fn select_fresh_startup_target(
    latest_session: Option<(String, String)>,
    no_project: impl FnOnce() -> String,
) -> (String, Option<String>) {
    let cwd = latest_session
        .and_then(|(session_cwd, _session_path)| {
            Path::new(&session_cwd).is_dir().then_some(session_cwd)
        })
        .unwrap_or_else(no_project);
    (cwd, None)
}

/// A dated folder under the projects folder. When the chosen folder cannot be
/// used, `<home>/SPOPI` is used instead and the window says so.
fn no_project_cwd(metadata: &Mutex<MetadataStore>) -> String {
    use crate::data::projects_folder::{
        chat_folder_stamp, fresh_chat_folder, resolve_projects_folder, scaffold_project,
        PROJECTS_FOLDER_FALLBACK_PREF, PROJECTS_FOLDER_PREF,
    };
    let home = dirs::home_dir().unwrap_or_default();
    let preference = metadata
        .lock()
        .ok()
        .and_then(|store| store.preference_get(PROJECTS_FOLDER_PREF).ok().flatten())
        .and_then(|value| value.as_str().map(str::to_owned));
    let root = resolve_projects_folder(preference.as_deref(), &home);
    let fallback = home.join("SPOPI");
    let stamp = chat_folder_stamp();
    let (folder, failure) = match fresh_chat_folder(&root, &stamp) {
        Ok(folder) => (Some(folder), None),
        Err(error) if root != fallback => {
            log::warn!("[spopi-host] {error}; using {}", fallback.display());
            (fresh_chat_folder(&fallback, &stamp).ok(), Some(error))
        }
        Err(error) => (None, Some(error)),
    };
    if let Some(error) = &failure {
        if let Ok(mut store) = metadata.lock() {
            let _ = store.preference_set(
                PROJECTS_FOLDER_FALLBACK_PREF,
                &serde_json::json!({
                    "wanted": root.to_string_lossy(),
                    "used": folder.as_ref().map(|path| path.to_string_lossy().into_owned()),
                    "error": error,
                }),
            );
        }
    }
    match folder {
        Some(folder) => {
            if let Err(error) = scaffold_project(&folder) {
                log::warn!("[spopi-host] {error}");
            }
            folder.to_string_lossy().into_owned()
        }
        None => {
            log::warn!("[spopi-host] no projects folder is usable; starting in the home folder");
            home.to_string_lossy().into_owned()
        }
    }
}

fn setup_native_runtime(app: &AppHandle, static_dir: PathBuf) -> Result<(), String> {
    use crate::data::app_paths::{config_dir, move_legacy_database, DATABASE_FILE};
    let data_dir = config_dir();
    let scratch = std::env::var("SPOPI_APP_DATA_DIR").is_ok_and(|dir| !dir.trim().is_empty());
    if !scratch {
        if let Ok(legacy) = app.path().app_data_dir() {
            if move_legacy_database(&legacy, &data_dir) {
                log::info!(
                    "[spopi-host] moved {DATABASE_FILE} from {} to {}",
                    legacy.display(),
                    data_dir.display()
                );
            }
        }
    }
    let metadata_path = data_dir.join(DATABASE_FILE);
    let metadata = Arc::new(Mutex::new(MetadataStore::open(&metadata_path)?));
    {
        use crate::platform::live_debug::{configure, preference_enabled, LIVE_DEBUG_PREF};
        let saved = metadata
            .lock()
            .ok()
            .and_then(|store| store.preference_get(LIVE_DEBUG_PREF).ok().flatten());
        configure(preference_enabled(saved.as_ref()));
    }
    {
        use crate::dependencies::agent_browser::{configure_env, enabled_from_pref, PREF};
        let saved = metadata
            .lock()
            .ok()
            .and_then(|store| store.preference_get(PREF).ok().flatten());
        configure_env(enabled_from_pref(saved.as_ref()), &static_dir);
    }
    static SWEEP_LOCK: std::sync::OnceLock<std::fs::File> = std::sync::OnceLock::new();
    let sweep_lock = crate::data::projects_folder::claim_sweep_lock(&data_dir);
    if sweep_lock.is_none() {
        log::info!("[spopi-host] another SPOPI is running; unused projects are left alone");
    }
    let first_instance = sweep_lock.is_some_and(|lock| SWEEP_LOCK.set(lock).is_ok());
    if let Some(store) = metadata.lock().ok().filter(|_| first_instance) {
        use crate::data::projects_folder::{
            resolve_projects_folder, sweep_untouched_projects, PROJECTS_FOLDER_PREF,
        };
        let home = dirs::home_dir().unwrap_or_default();
        let preference = store
            .preference_get(PROJECTS_FOLDER_PREF)
            .ok()
            .flatten()
            .and_then(|value| value.as_str().map(str::to_owned));
        let root = resolve_projects_folder(preference.as_deref(), &home);
        let removed = sweep_untouched_projects(&root, Path::new(""));
        if removed > 0 {
            log::info!("[spopi-host] removed {removed} untouched project folder(s)");
        }
    }
    let boot_target = crate::pi::binary::pi_agent_dir().and_then(|agent| {
        metadata
            .lock()
            .ok()
            .and_then(|store| find_latest_session_boot_target(&store, &agent))
    });
    let (cwd, session_path) =
        select_fresh_startup_target(boot_target, || no_project_cwd(&metadata));
    let workspace_id = metadata
        .lock()
        .map_err(|_| "SPOPI metadata store is unavailable".to_string())?
        .workspace_id_for_path(Path::new(&cwd))?;
    let session_id = format!("temporary-{}", uuid::Uuid::new_v4().simple());
    let target = RuntimeTarget::new(
        workspace_id,
        session_id,
        format!("instance-{}", uuid::Uuid::new_v4().simple()),
    );
    let launch_resolver = PiLaunchResolver::new(static_dir.clone());
    let launch = launch_resolver.native_launch_spec(&cwd, session_path.as_deref())?;
    let runtimes = PiRuntime::new(256);
    let host = tauri::async_runtime::block_on(async {
        let host = HostServer::start_with_workspaces(
            static_dir,
            runtimes.clone(),
            std::collections::HashMap::from([(target.workspace_id.clone(), PathBuf::from(&cwd))]),
            Some(app.clone()),
            Some(Arc::clone(&metadata)),
        )
        .await?;
        runtimes.spawn(target.clone(), launch)?;
        Ok::<HostServer, String>(host)
    })?;
    if let Err(error) = workspace_windows::open_native_workspace_window(app, host.origin(), &target)
    {
        runtimes.stop_all();
        return Err(error);
    }
    log::info!(
        "[spopi-host] started workspace_id={} session_id={} instance_id={} origin={}",
        target.workspace_id,
        target.session_id,
        target.instance_id,
        host.origin()
    );
    app.manage(runtimes);
    app.manage(host);
    app.manage(workspace_windows::WorkspaceLauncher {
        metadata,
        launch: launch_resolver,
    });
    app.manage(workspace_windows::FocusedWorkspaceState(Mutex::new(Some(
        target.workspace_id.clone(),
    ))));
    let window_workspaces = HashMap::from([(
        format!("native-workspace-{}", target.workspace_id),
        target.workspace_id.clone(),
    )]);
    app.manage(workspace_windows::WindowWorkspaceState(Mutex::new(
        window_workspaces,
    )));
    Ok(())
}

fn main() {
    if let Err(error) = fix_path_env::fix_all_vars() {
        eprintln!("[spopi-host] failed to sync login-shell environment: {error}");
    }

    // Runtimes left behind by a SPOPI that was killed outright: no teardown of
    // ours ran for those, so this is the only chance to collect them.
    let swept = pi::child_supervision::sweep_orphans();
    if swept > 0 {
        log::info!("[spopi-host] cleaned up {swept} orphaned pi runtime(s) from a previous run");
    }

    #[cfg(target_os = "macos")]
    disable_press_and_hold_accents();

    let builder = tauri::Builder::default();
    #[cfg(target_os = "macos")]
    let builder = builder.menu(build_app_menu).on_menu_event(|app, event| {
        if event.id().as_ref() == MENU_NEW_SESSION_ID {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) =
                    workspace_windows::open_fresh_session_for_focused_workspace(&app)
                {
                    log::error!("[spopi-host] failed to open new session from menu: {error}");
                }
            });
        }
    });
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            open_folder_as_workspace,
            locate_workspace,
            open_new_session_in_workspace,
            open_session_in_project,
            show_task_completion_notification,
            retry_startup
        ])
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .level_for("tokio_util", log::LevelFilter::Warn)
                .level_for("hyper", log::LevelFilter::Warn)
                .build(),
        )
        .setup(|app| {
            let handle = app.handle().clone();
            let static_dir = find_static_dir(&handle);
            if let Err(error) = setup_native_runtime(&handle, static_dir) {
                log::error!("[spopi-host] startup failed: {error}");
                if let Err(window_error) = open_bootstrap_window(&handle, &error) {
                    log::error!(
                        "[spopi-host] failed to open bootstrap window after startup error: {window_error}"
                    );
                    app.dialog()
                        .message(format!(
                            "SPOPI could not start the embedded pi runtime.\n\n{error}\n\nThe SPOPI installation may be incomplete or corrupted. Please reinstall SPOPI and try again."
                        ))
                        .title("SPOPI startup failed")
                        .kind(MessageDialogKind::Error)
                        .show(|_| {});
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            let label = window.label();
            match event {
                tauri::WindowEvent::Focused(true) if label.starts_with("native-workspace-") => {
                    let workspace_id = window
                        .try_state::<workspace_windows::WindowWorkspaceState>()
                        .and_then(|state| {
                            state
                                .0
                                .lock()
                                .ok()
                                .and_then(|windows| windows.get(label).cloned())
                        })
                        .or_else(|| label.strip_prefix("native-workspace-").map(str::to_string));
                    if let (Some(workspace_id), Some(state)) =
                        (workspace_id, window.try_state::<workspace_windows::FocusedWorkspaceState>())
                    {
                        if let Ok(mut focused_workspace) = state.0.lock() {
                            *focused_workspace = Some(workspace_id);
                        }
                    }
                }
                tauri::WindowEvent::Destroyed if label.starts_with("native-workspace-") => {
                    let workspace_id = window
                        .try_state::<workspace_windows::WindowWorkspaceState>()
                        .and_then(|state| {
                            state
                                .0
                                .lock()
                                .ok()
                                .and_then(|mut windows| windows.remove(label))
                        })
                        .or_else(|| label.strip_prefix("native-workspace-").map(str::to_string));
                    if let Some(workspace_id) = workspace_id {
                        if let Some(state) = window.try_state::<workspace_windows::FocusedWorkspaceState>() {
                            if let Ok(mut focused_workspace) = state.0.lock() {
                                if focused_workspace.as_deref() == Some(workspace_id.as_str()) {
                                    *focused_workspace = None;
                                }
                            }
                        }
                        if let Some(manager) = window.try_state::<PiRuntimeState>() {
                            manager.stop_workspace(&workspace_id);
                        }
                    }
                }
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle: &tauri::AppHandle, event| {
            if let tauri::RunEvent::Ready = event {
                install_termination_handlers(app_handle.clone());
            }
            if let tauri::RunEvent::Exit = event {
                if let Some(manager) = app_handle.try_state::<PiRuntimeState>() {
                    manager.stop_all();
                }
                pi::child_supervision::clear_registry();
            }
        });
}

/// Tear runtimes down on the signals that otherwise skip `RunEvent::Exit`
/// entirely: Ctrl-C under `tauri dev`, a logout or shutdown (SIGTERM), and a
/// closing terminal (SIGHUP). Nothing can be done about SIGKILL — that case is
/// what the startup sweep exists for.
#[cfg(unix)]
fn install_termination_handlers(app_handle: tauri::AppHandle) {
    use std::sync::atomic::{AtomicBool, Ordering};
    static INSTALLED: AtomicBool = AtomicBool::new(false);
    if INSTALLED.swap(true, Ordering::SeqCst) {
        return;
    }
    for signal in [
        tokio::signal::unix::SignalKind::terminate(),
        tokio::signal::unix::SignalKind::interrupt(),
        tokio::signal::unix::SignalKind::hangup(),
    ] {
        let app_handle = app_handle.clone();
        tauri::async_runtime::spawn(async move {
            let Ok(mut stream) = tokio::signal::unix::signal(signal) else {
                return;
            };
            if stream.recv().await.is_none() {
                return;
            }
            if let Some(manager) = app_handle.try_state::<PiRuntimeState>() {
                manager.stop_all();
            }
            pi::child_supervision::clear_registry();
            app_handle.exit(0);
        });
    }
}

#[cfg(not(unix))]
fn install_termination_handlers(_app_handle: tauri::AppHandle) {}

#[cfg(test)]
#[path = "main_tests.rs"]
mod tests;
