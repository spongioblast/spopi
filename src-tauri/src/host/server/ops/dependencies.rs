// ABOUTME: Host operations that test and install npm, the browser, and Surf.
// ABOUTME: Phone clients are refused; these run only on the desktop.

use super::super::HostState;
use crate::dependencies::agent_browser::{enabled_from_pref, PREF};
use crate::dependencies::browsers::{detect_browsers, spawn_extensions_page};
use crate::dependencies::check::check_dependencies;
use crate::dependencies::exec::run_capture;
use crate::dependencies::jobs::{command_for, JobKind};
use crate::dependencies::surf::{allowed_connect_browser, surf_cli, valid_extension_id};
use crate::pi::binary::pi_agent_dir;
use serde_json::{json, Value};
use std::path::Path;
use std::time::Duration;

pub(crate) async fn dispatch(
    state: &HostState,
    request_id: &str,
    operation: &str,
    frame: &Value,
) -> Result<Value, (&'static str, String)> {
    match operation {
        "check_dependencies" => {
            let quick = frame.get("quick").and_then(Value::as_bool).unwrap_or(false);
            let report = check_dependencies(
                quick,
                &state.pi_launch.static_dir,
                agent_browser_enabled(state),
            )
            .await;
            let report = serde_json::to_value(report)
                .map_err(|error| ("check_dependencies_failed", error.to_string()))?;
            Ok(json!({
                "type": "host_response",
                "requestId": request_id,
                "operation": "check_dependencies",
                "report": report,
            }))
        }
        "start_dependency_install" => {
            let kind = job_kind(frame)?;
            let command = command_for(kind, &state.pi_launch.static_dir).map_err(|error| {
                if error == "not_supported" {
                    (
                        "not_supported",
                        "Node.js cannot be installed from SPOPI on this system".to_string(),
                    )
                } else {
                    ("dependency_install_failed", error)
                }
            })?;
            let job = state.dependency_jobs.start(kind, command).await;
            Ok(json!({
                "type": "host_response",
                "requestId": request_id,
                "operation": "start_dependency_install",
                "job": job,
            }))
        }
        "dependency_install_status" => {
            let kind = job_kind(frame)?;
            let job = state.dependency_jobs.snapshot(kind);
            Ok(json!({
                "type": "host_response",
                "requestId": request_id,
                "operation": "dependency_install_status",
                "job": job,
            }))
        }
        "cancel_dependency_install" => {
            let kind = job_kind(frame)?;
            let cancelled = state.dependency_jobs.cancel(kind);
            Ok(json!({
                "type": "host_response",
                "requestId": request_id,
                "operation": "cancel_dependency_install",
                "cancelled": cancelled,
            }))
        }
        "surf_extension_path" => {
            let cli = surf_program()?;
            let captured = run_capture(
                &cli,
                &["extension-path".to_string()],
                Some(&crate::pi::binary::build_augmented_path()),
                Duration::from_secs(10),
            )
            .await
            .map_err(|error| ("surf_extension_path_failed", error))?;
            if !captured.status_ok {
                return Err((
                    "surf_extension_path_failed",
                    tail(&captured.stderr, &captured.stdout),
                ));
            }
            let path = captured
                .stdout
                .lines()
                .map(str::trim)
                .rfind(|line| !line.is_empty())
                .unwrap_or("")
                .to_string();
            if !Path::new(&path).is_dir() {
                return Err((
                    "surf_extension_path_failed",
                    format!("Surf extension folder was not found: {path}"),
                ));
            }
            Ok(json!({
                "type": "host_response",
                "requestId": request_id,
                "operation": "surf_extension_path",
                "path": path,
            }))
        }
        "surf_connect" => {
            let extension_id = frame
                .get("extensionId")
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or("");
            if !valid_extension_id(extension_id) {
                return Err((
                    "invalid_extension_id",
                    "An extension ID is 32 letters from a to p".into(),
                ));
            }
            let browser = frame
                .get("browser")
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or("");
            if !allowed_connect_browser(browser) {
                return Err(("unknown_browser", "That browser is not supported".into()));
            }
            let cli = surf_program()?;
            let captured = run_capture(
                &cli,
                &[
                    "install".into(),
                    extension_id.into(),
                    "--browser".into(),
                    browser.into(),
                ],
                Some(&crate::pi::binary::build_augmented_path()),
                Duration::from_secs(60),
            )
            .await
            .map_err(|error| ("surf_connect_failed", error))?;
            let lines = output_lines(&captured.stdout, &captured.stderr);
            Ok(json!({
                "type": "host_response",
                "requestId": request_id,
                "operation": "surf_connect",
                "ok": captured.status_ok,
                "lines": lines,
            }))
        }
        "open_browser_extensions" => {
            let id = frame
                .get("browser")
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or("");
            let browsers = detect_browsers();
            let Some(browser) = browsers.iter().find(|browser| browser.id == id) else {
                return Err(("unknown_browser", "That browser is not installed".into()));
            };
            spawn_extensions_page(browser)
                .map_err(|error| ("open_browser_extensions_failed", error))?;
            Ok(json!({
                "type": "host_response",
                "requestId": request_id,
                "operation": "open_browser_extensions",
                "ok": true,
            }))
        }
        _ => Err((
            "host_operation_unimplemented",
            "Host operation is not implemented on protocol v2".into(),
        )),
    }
}

fn job_kind(frame: &Value) -> Result<JobKind, (&'static str, String)> {
    frame
        .get("kind")
        .and_then(Value::as_str)
        .and_then(JobKind::parse)
        .ok_or((
            "invalid_request",
            "kind must be browser, node, or surf".into(),
        ))
}

fn agent_browser_enabled(state: &HostState) -> bool {
    let Some(metadata) = &state.metadata else {
        return true;
    };
    let Ok(store) = metadata.lock() else {
        return true;
    };
    let saved = store.preference_get(PREF).ok().flatten();
    enabled_from_pref(saved.as_ref())
}

fn surf_program() -> Result<std::path::PathBuf, (&'static str, String)> {
    let dir = pi_agent_dir().ok_or((
        "surf_not_installed",
        "Pi's agent folder was not found".to_string(),
    ))?;
    surf_cli(&dir).ok_or(("surf_not_installed", "Surf is not installed".to_string()))
}

fn tail(stderr: &str, stdout: &str) -> String {
    let text = if stderr.trim().is_empty() {
        stdout
    } else {
        stderr
    };
    text.lines()
        .map(str::trim)
        .rfind(|line| !line.is_empty())
        .unwrap_or("Surf failed")
        .to_string()
}

fn output_lines(stdout: &str, stderr: &str) -> Vec<String> {
    stdout
        .lines()
        .chain(stderr.lines())
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}
