// ABOUTME: Reports whether the Surf package is installed, enabled, and connected.
// ABOUTME: The connection probe is the read-only command the Surf README uses after setup.

use std::path::{Path, PathBuf};

use serde_json::Value;

use super::exec::run_capture;

const SURF_SOURCE: &str = "npm:surf-cli";
/// Read-only tab list. surf-cli 2.21.0 tells you to restart the browser and run `surf tab.list`, which talks to the native host.
const SURF_PROBE_ARGS: &[&str] = &["tab.list"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SurfPackage {
    pub installed: bool,
    pub enabled: bool,
}

pub fn surf_package_state(agent_dir: &Path) -> SurfPackage {
    let packages = global_packages();
    interpret_surf(agent_dir, &packages)
}

pub fn interpret_surf(agent_dir: &Path, packages: &[Value]) -> SurfPackage {
    let installed = agent_dir
        .join("npm")
        .join("node_modules")
        .join("surf-cli")
        .join("package.json")
        .is_file();
    let enabled = packages
        .iter()
        .any(|entry| is_surf(entry) && is_enabled(entry));
    SurfPackage { installed, enabled }
}

pub fn surf_cli(agent_dir: &Path) -> Option<PathBuf> {
    let bin = agent_dir.join("npm").join("node_modules").join(".bin");
    let name = if cfg!(windows) { "surf.cmd" } else { "surf" };
    let path = bin.join(name);
    path.is_file().then_some(path)
}

pub fn valid_extension_id(id: &str) -> bool {
    let bytes = id.as_bytes();
    bytes.len() == 32 && bytes.iter().all(|byte| (b'a'..=b'p').contains(byte))
}

pub fn allowed_connect_browser(browser: &str) -> bool {
    matches!(browser, "chrome" | "chromium" | "brave" | "edge")
}

pub async fn probe_connection(cli: &Path) -> Result<(), String> {
    let args = SURF_PROBE_ARGS
        .iter()
        .map(|arg| (*arg).to_string())
        .collect::<Vec<_>>();
    let captured = run_capture(
        cli,
        &args,
        Some(&crate::pi::binary::build_augmented_path()),
        std::time::Duration::from_secs(8),
    )
    .await?;
    if captured.status_ok {
        return Ok(());
    }
    let text = if captured.stderr.trim().is_empty() {
        captured.stdout.trim()
    } else {
        captured.stderr.trim()
    };
    Err(text
        .lines()
        .map(str::trim)
        .rfind(|line| !line.is_empty())
        .unwrap_or("Surf did not connect")
        .to_string())
}

fn global_packages() -> Vec<Value> {
    let Ok(path) = crate::pi::launch::settings_path("global", "") else {
        return Vec::new();
    };
    let Ok(root) = crate::data::atomic_json::read_object(&path) else {
        return Vec::new();
    };
    root.get("packages")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn is_surf(entry: &Value) -> bool {
    match entry {
        Value::String(source) => source == SURF_SOURCE,
        Value::Object(object) => object.get("source").and_then(Value::as_str) == Some(SURF_SOURCE),
        _ => false,
    }
}

fn is_enabled(entry: &Value) -> bool {
    match entry {
        Value::String(_) => true,
        Value::Object(object) => !matches!(
            object.get("extensions").and_then(Value::as_array),
            Some(items) if items.is_empty()
        ),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;

    fn disabled() -> Value {
        json!({
            "source": "npm:surf-cli",
            "extensions": [],
            "skills": [],
            "prompts": [],
            "themes": []
        })
    }

    #[test]
    fn package_state_reads_the_three_settings_shapes() {
        let dir = std::env::temp_dir().join(format!("spopi-surf-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let package_json = dir
            .join("npm")
            .join("node_modules")
            .join("surf-cli")
            .join("package.json");
        fs::create_dir_all(package_json.parent().unwrap()).unwrap();
        fs::write(&package_json, "{}").unwrap();

        let absent = interpret_surf(&dir, &[]);
        assert!(absent.installed);
        assert!(!absent.enabled);

        let enabled = interpret_surf(&dir, &[json!("npm:surf-cli")]);
        assert!(enabled.enabled);

        let off = interpret_surf(&dir, &[disabled()]);
        assert!(!off.enabled);

        let missing = interpret_surf(Path::new("does-not-exist"), &[json!("npm:surf-cli")]);
        assert!(!missing.installed);
        assert!(missing.enabled);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn extension_id_is_thirty_two_letters_a_to_p() {
        assert!(valid_extension_id("abcdefghijklmnopabcdefghijklmnop"));
        assert!(!valid_extension_id("abcdefghijklmnopabcdefghijklmno"));
        assert!(!valid_extension_id("abcdefghijklmnopabcdefghijklmnoq"));
        assert!(!allowed_connect_browser("firefox"));
        assert!(allowed_connect_browser("edge"));
    }
}
