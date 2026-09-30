// ABOUTME: Locates the bundled agent-browser binary and asks it which Chrome it can use.
// ABOUTME: The enable switch is read once at startup and passed to Pi as SPOPI_AGENT_BROWSER.

use std::path::{Path, PathBuf};

use serde_json::Value;

use super::browsers::{chrome_for_testing_present, configured_executable, detect_browsers};
use super::exec::run_capture;

pub const PREF: &str = "ui.agentBrowser.enabled";

/// Unset or any non-boolean means on. Only `false` turns the development browser off.
pub fn enabled_from_pref(value: Option<&Value>) -> bool {
    match value {
        Some(Value::Bool(enabled)) => *enabled,
        _ => true,
    }
}

pub fn bundled_version() -> &'static str {
    env!("SPOPI_AGENT_BROWSER_VERSION_BUNDLED")
}

pub fn bundled_agent_browser(static_dir: &Path) -> Option<PathBuf> {
    let bin_name = if cfg!(windows) {
        "agent-browser.exe"
    } else {
        "agent-browser"
    };
    if let Ok(explicit) = std::env::var("AGENT_BROWSER_BIN") {
        let candidate = PathBuf::from(explicit.trim());
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    if let Some(parent) = static_dir.parent() {
        let candidate = parent.join("agent-browser").join(bin_name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    if cfg!(debug_assertions) {
        let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("agent-browser")
            .join(bin_name);
        if dev.is_file() {
            return Some(dev);
        }
    }
    None
}

pub fn configure_env(enabled: bool, static_dir: &Path) {
    std::env::set_var("SPOPI_AGENT_BROWSER", if enabled { "1" } else { "0" });
    if enabled {
        if let Some(path) = bundled_agent_browser(static_dir) {
            if let Some(dir) = path.parent() {
                std::env::set_var("SPOPI_AGENT_BROWSER_DIR", dir);
                return;
            }
        }
    }
    std::env::remove_var("SPOPI_AGENT_BROWSER_DIR");
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChromeFinding {
    pub found: bool,
    pub path: Option<String>,
}

pub fn parse_doctor(json: &str) -> Option<ChromeFinding> {
    let value: Value = serde_json::from_str(json.trim()).ok()?;
    let checks = value.get("checks")?.as_array()?;
    let chrome = checks
        .iter()
        .find(|check| check.get("id").and_then(Value::as_str) == Some("chrome.installed"))?;
    let status = chrome.get("status").and_then(Value::as_str).unwrap_or("");
    if status != "pass" {
        return Some(ChromeFinding {
            found: false,
            path: None,
        });
    }
    let message = chrome.get("message").and_then(Value::as_str).unwrap_or("");
    let path = message
        .rsplit_once(" at ")
        .map(|(_, path)| path.trim().to_string())
        .filter(|path| !path.is_empty());
    Some(ChromeFinding {
        found: path.is_some(),
        path,
    })
}

pub fn source_for(path: &Path) -> &'static str {
    if configured_executable().as_deref() == Some(path) {
        return "config";
    }
    if let Some(home) = dirs::home_dir() {
        if path.starts_with(home.join(".agent-browser")) {
            return "chrome-for-testing";
        }
    }
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    if name.eq_ignore_ascii_case("msedge.exe")
        || name.eq_ignore_ascii_case("msedge")
        || name == "Microsoft Edge"
    {
        return "edge-fallback";
    }
    "detected"
}

pub struct BrowserProbe {
    pub state: &'static str,
    pub path: Option<String>,
    pub source: Option<String>,
    pub detail: Option<String>,
}

pub async fn probe_browser(binary: Option<&Path>) -> BrowserProbe {
    if let Some(binary) = binary {
        if let Ok(captured) = run_capture(
            binary,
            &[
                "doctor".into(),
                "--offline".into(),
                "--quick".into(),
                "--json".into(),
            ],
            None,
            std::time::Duration::from_secs(25),
        )
        .await
        {
            if captured.status_ok {
                if let Some(finding) = parse_doctor(&captured.stdout) {
                    if finding.found {
                        let path = finding.path.unwrap_or_default();
                        let source = source_for(Path::new(&path));
                        return BrowserProbe {
                            state: "ok",
                            path: Some(path),
                            source: Some(source.to_string()),
                            detail: None,
                        };
                    }
                }
            }
        }
    }
    if let Some(path) = configured_executable() {
        return found_probe(path, "config");
    }
    if let Some(browser) = detect_browsers()
        .into_iter()
        .find(|browser| browser.id != "edge" && !browser.snap)
    {
        return BrowserProbe {
            state: "ok",
            path: Some(browser.path),
            source: Some("detected".into()),
            detail: None,
        };
    }
    if chrome_for_testing_present() {
        return found_probe(
            super::browsers::chrome_for_testing_dir(),
            "chrome-for-testing",
        );
    }
    BrowserProbe {
        state: "missing",
        path: None,
        source: None,
        detail: Some("No Chrome was found.".into()),
    }
}

fn found_probe(path: PathBuf, source: &str) -> BrowserProbe {
    BrowserProbe {
        state: "ok",
        path: Some(path.to_string_lossy().into_owned()),
        source: Some(source.to_string()),
        detail: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DOCTOR: &str = include_str!("../../tests/fixtures/agent-browser/0.38.1/doctor.json");

    #[test]
    fn parse_doctor_reads_the_pinned_fixture() {
        let finding = parse_doctor(DOCTOR).unwrap();
        assert!(finding.found);
        assert!(finding
            .path
            .unwrap()
            .ends_with(r"Google\Chrome\Application\chrome.exe"));
    }

    #[test]
    fn a_failed_chrome_check_is_not_found() {
        let finding = parse_doctor(
            r#"{"checks":[{"id":"chrome.installed","status":"fail","message":"not installed"}]}"#,
        )
        .unwrap();
        assert!(!finding.found);
        assert!(finding.path.is_none());
    }

    #[test]
    fn unset_preference_leaves_agent_browser_on() {
        assert!(enabled_from_pref(None));
        assert!(enabled_from_pref(Some(&Value::String("false".into()))));
        assert!(!enabled_from_pref(Some(&Value::Bool(false))));
        assert!(enabled_from_pref(Some(&Value::Bool(true))));
    }
}
