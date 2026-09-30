// ABOUTME: Finds Chrome, Chromium, Brave, and Edge already installed on the computer.
// ABOUTME: Snap Chromium is reported so the Surf card can warn that it cannot connect.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Stdio;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledBrowser {
    pub id: String,
    pub name: String,
    pub path: String,
    pub snap: bool,
}

/// Chrome for Testing lands here after `agent-browser install`.
/// `get_browsers_dir` in agent-browser 0.38.1 (`cli/src/install.rs`) uses this path.
pub fn chrome_for_testing_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".agent-browser")
        .join("browsers")
}

pub fn chrome_for_testing_present() -> bool {
    let dir = chrome_for_testing_dir();
    std::fs::read_dir(dir)
        .ok()
        .is_some_and(|mut entries| entries.next().is_some())
}

pub fn configured_executable() -> Option<PathBuf> {
    let path = dirs::home_dir()?.join(".agent-browser").join("config.json");
    let text = std::fs::read_to_string(path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    let executable = value.get("executablePath")?.as_str()?.trim();
    if executable.is_empty() {
        return None;
    }
    let path = PathBuf::from(executable);
    path.is_file().then_some(path)
}

pub fn detect_browsers() -> Vec<InstalledBrowser> {
    let mut found = Vec::new();
    #[cfg(windows)]
    detect_windows(&mut found);
    #[cfg(target_os = "macos")]
    detect_macos(&mut found);
    #[cfg(all(unix, not(target_os = "macos")))]
    detect_linux(&mut found);
    found
}

pub fn extensions_page_url(id: &str) -> Option<&'static str> {
    match id {
        "chrome" | "chromium" => Some("chrome://extensions"),
        "edge" => Some("edge://extensions"),
        "brave" => Some("brave://extensions"),
        _ => None,
    }
}

pub fn spawn_extensions_page(browser: &InstalledBrowser) -> Result<(), String> {
    let url = extensions_page_url(&browser.id)
        .ok_or_else(|| format!("No extensions page for {}", browser.id))?;
    let mut command = std::process::Command::new(&browser.path);
    crate::platform::windows_child::hide_console(&mut command);
    command
        .arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to open {}: {error}", browser.name))?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

fn is_snap_path(path: &str) -> bool {
    path.contains("/snap/")
}

fn push_browser(found: &mut Vec<InstalledBrowser>, id: &str, name: &str, path: &Path) {
    if !path.is_file() {
        return;
    }
    let path_text = path.to_string_lossy().to_string();
    if found.iter().any(|browser| browser.path == path_text) {
        return;
    }
    let snap = is_snap_path(&path_text);
    found.push(InstalledBrowser {
        id: id.to_string(),
        name: name.to_string(),
        path: path_text,
        snap,
    });
}

#[cfg(windows)]
fn detect_windows(found: &mut Vec<InstalledBrowser>) {
    for (exe, id, name) in [
        ("chrome.exe", "chrome", "Google Chrome"),
        ("msedge.exe", "edge", "Microsoft Edge"),
        ("brave.exe", "brave", "Brave"),
    ] {
        if let Some(path) = app_path(exe) {
            push_browser(found, id, name, &path);
        }
    }
    let mut roots = Vec::new();
    for key in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
        if let Some(value) = std::env::var_os(key) {
            roots.push(PathBuf::from(value));
        }
    }
    for root in roots {
        push_browser(
            found,
            "chrome",
            "Google Chrome",
            &root
                .join("Google")
                .join("Chrome")
                .join("Application")
                .join("chrome.exe"),
        );
        push_browser(
            found,
            "edge",
            "Microsoft Edge",
            &root
                .join("Microsoft")
                .join("Edge")
                .join("Application")
                .join("msedge.exe"),
        );
        push_browser(
            found,
            "brave",
            "Brave",
            &root
                .join("BraveSoftware")
                .join("Brave-Browser")
                .join("Application")
                .join("brave.exe"),
        );
    }
}

#[cfg(windows)]
fn app_path(exe: &str) -> Option<PathBuf> {
    for hive in ["HKCU", "HKLM"] {
        let key = format!(r"{hive}\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{exe}");
        if let Some(path) = reg_default(&key) {
            if path.is_file() {
                return Some(path);
            }
        }
    }
    None
}

#[cfg(windows)]
fn reg_default(key: &str) -> Option<PathBuf> {
    let mut command = std::process::Command::new("reg");
    crate::platform::windows_child::hide_console(&mut command);
    let output = command.args(["query", key, "/ve"]).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    for line in text.lines() {
        let Some(rest) = line.split("REG_SZ").nth(1) else {
            continue;
        };
        let path = PathBuf::from(rest.trim());
        if !path.as_os_str().is_empty() {
            return Some(path);
        }
    }
    None
}

#[cfg(target_os = "macos")]
fn detect_macos(found: &mut Vec<InstalledBrowser>) {
    for (path, id, name) in [
        (
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "chrome",
            "Google Chrome",
        ),
        (
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
            "chromium",
            "Chromium",
        ),
        (
            "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
            "brave",
            "Brave",
        ),
        (
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "edge",
            "Microsoft Edge",
        ),
    ] {
        push_browser(found, id, name, Path::new(path));
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn detect_linux(found: &mut Vec<InstalledBrowser>) {
    let path_env = crate::pi::binary::build_augmented_path();
    for (command, id, name) in [
        ("google-chrome", "chrome", "Google Chrome"),
        ("google-chrome-stable", "chrome", "Google Chrome"),
        ("chromium", "chromium", "Chromium"),
        ("chromium-browser", "chromium", "Chromium"),
        ("brave-browser", "brave", "Brave"),
        ("microsoft-edge", "edge", "Microsoft Edge"),
    ] {
        if let Some(path) = super::exec::resolve_executable(command, &path_env) {
            push_browser(found, id, name, &path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extensions_page_url_matches_the_browser() {
        assert_eq!(extensions_page_url("chrome"), Some("chrome://extensions"));
        assert_eq!(extensions_page_url("edge"), Some("edge://extensions"));
        assert_eq!(extensions_page_url("brave"), Some("brave://extensions"));
        assert_eq!(extensions_page_url("firefox"), None);
    }

    #[test]
    fn snap_paths_are_marked() {
        assert!(is_snap_path("/snap/bin/chromium"));
        assert!(!is_snap_path("/usr/bin/chromium"));
    }
}
