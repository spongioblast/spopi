// ABOUTME: GET /api/ui/screenshot: a PNG of the SPOPI window, for the model's spopi_screenshot tool.
// ABOUTME: Loopback only, like every host route; the phone listener has no /api routes.

use super::super::HostState;
use axum::body::Body;
use axum::extract::{Query, State};
use axum::http::header::{CACHE_CONTROL, CONTENT_TYPE};
use axum::http::StatusCode;
use axum::response::Response;
use serde::Deserialize;
use std::path::Path;
use std::sync::Arc;
use tauri::Manager;

use crate::platform::webview_capture::{capture_png, CaptureError};
use crate::workspace_windows::{FocusedWorkspaceState, WindowWorkspaceState};

const WINDOW_PREFIX: &str = "native-workspace-";

#[derive(Deserialize)]
pub struct ScreenshotQuery {
    /// The caller's project folder. Picks the window that shows that project.
    cwd: Option<String>,
}

fn error(status: StatusCode, code: &str, message: &str) -> Response {
    let body = serde_json::json!({ "error": { "code": code, "message": message } });
    Response::builder()
        .status(status)
        .header(CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap_or_else(|_| Response::new(Body::empty()))
}

pub(crate) fn same_folder(a: &Path, b: &Path) -> bool {
    let canonical =
        |path: &Path| std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let normalize = |path: &Path| {
        let text = canonical(path).to_string_lossy().replace('\\', "/");
        let text = text
            .trim_start_matches("//?/")
            .trim_end_matches('/')
            .to_string();
        if cfg!(windows) {
            text.to_lowercase()
        } else {
            text
        }
    };
    normalize(a) == normalize(b)
}

fn window_for(
    state: &HostState,
    app: &tauri::AppHandle,
    cwd: Option<&str>,
) -> Option<tauri::WebviewWindow> {
    let windows: Vec<tauri::WebviewWindow> = app
        .webview_windows()
        .into_values()
        .filter(|window| window.label().starts_with(WINDOW_PREFIX))
        .collect();
    let workspace_of = |window: &tauri::WebviewWindow| -> Option<String> {
        app.try_state::<WindowWorkspaceState>()
            .and_then(|state| {
                state
                    .0
                    .lock()
                    .ok()
                    .and_then(|map| map.get(window.label()).cloned())
            })
            .or_else(|| {
                window
                    .label()
                    .strip_prefix(WINDOW_PREFIX)
                    .map(str::to_string)
            })
    };
    if let Some(cwd) = cwd.map(Path::new) {
        let shown = windows.iter().find(|window| {
            workspace_of(window)
                .and_then(|id| state.data.workspace_root_path(&id).ok())
                .is_some_and(|root| same_folder(&root, cwd))
        });
        if let Some(window) = shown {
            return Some(window.clone());
        }
    }
    if let Some(window) = windows
        .iter()
        .find(|window| window.is_focused().unwrap_or(false))
    {
        return Some(window.clone());
    }
    let last_focused = app
        .try_state::<FocusedWorkspaceState>()
        .and_then(|state| state.0.lock().ok().and_then(|guard| guard.clone()));
    if let Some(id) = last_focused {
        if let Some(window) = windows
            .iter()
            .find(|window| workspace_of(window).as_deref() == Some(id.as_str()))
        {
            return Some(window.clone());
        }
    }
    windows.into_iter().next()
}

pub async fn screenshot(
    State(state): State<Arc<HostState>>,
    Query(query): Query<ScreenshotQuery>,
) -> Response {
    let Some(app) = state.app_handle.clone() else {
        return error(
            StatusCode::SERVICE_UNAVAILABLE,
            "no_window",
            "SPOPI has no window in this process.",
        );
    };
    let cwd = query
        .cwd
        .as_deref()
        .map(str::trim)
        .filter(|cwd| !cwd.is_empty());
    let Some(window) = window_for(&state, &app, cwd) else {
        return error(
            StatusCode::NOT_FOUND,
            "no_window",
            "No SPOPI project window is open.",
        );
    };
    match capture_png(&window).await {
        Ok(png) => Response::builder()
            .header(CONTENT_TYPE, "image/png")
            .header(CACHE_CONTROL, "no-store")
            .body(Body::from(png))
            .unwrap_or_else(|_| Response::new(Body::empty())),
        Err(CaptureError::Unsupported) => error(
            StatusCode::NOT_IMPLEMENTED,
            "unsupported",
            &CaptureError::Unsupported.to_string(),
        ),
        Err(CaptureError::Failed(message)) => error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "capture_failed",
            &message,
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::same_folder;
    use std::path::Path;

    #[test]
    fn folders_compare_across_separators_and_trailing_slashes() {
        let dir = tempfile::tempdir().unwrap();
        let with_slash = format!("{}/", dir.path().display());
        assert!(same_folder(dir.path(), Path::new(&with_slash)));
        assert!(!same_folder(dir.path(), &dir.path().join("other")));
    }
}
