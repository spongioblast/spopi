// ABOUTME: Cross-process lock for settings.json, matching Pi's SettingsManager.
// ABOUTME: An empty directory at settings.json.lock, stale after 10 seconds.

use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const SETTINGS_LOCK_STALE_MS: u64 = 10_000;
const SETTINGS_LOCK_RETRY_DELAY_MS: u64 = 20;
const SETTINGS_LOCK_MAX_ATTEMPTS: usize = 750;

fn settings_lock_dir(settings_path: &Path) -> PathBuf {
    let mut name = settings_path.as_os_str().to_string_lossy().into_owned();
    name.push_str(".lock");
    PathBuf::from(name)
}

/// Acquire Pi's settings lock, run `critical`, then release the directory.
pub(crate) fn with_settings_lock<R>(
    settings_path: &Path,
    critical: impl FnOnce() -> R,
) -> Result<R, String> {
    let lock_dir = settings_lock_dir(settings_path);
    if let Some(parent) = settings_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Cannot create settings dir: {error}"))?;
    }
    for _ in 0..SETTINGS_LOCK_MAX_ATTEMPTS {
        match std::fs::create_dir(&lock_dir) {
            Ok(()) => {
                let result = critical();
                let _ = std::fs::remove_dir(&lock_dir);
                return Ok(result);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                match std::fs::metadata(&lock_dir) {
                    Ok(meta) => {
                        let mtime = meta
                            .modified()
                            .ok()
                            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                            .map(|duration| duration.as_millis() as u64)
                            .unwrap_or(0);
                        let now = SystemTime::now()
                            .duration_since(UNIX_EPOCH)
                            .map(|duration| duration.as_millis() as u64)
                            .unwrap_or(0);
                        if now.saturating_sub(mtime) > SETTINGS_LOCK_STALE_MS {
                            let _ = std::fs::remove_dir(&lock_dir);
                            continue;
                        }
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                    Err(error) => return Err(format!("Settings lock stat failed: {error}")),
                }
                thread::sleep(Duration::from_millis(SETTINGS_LOCK_RETRY_DELAY_MS));
            }
            Err(error) => return Err(format!("Cannot acquire settings lock: {error}")),
        }
    }
    Err(format!(
        "Timed out waiting for settings lock: {}",
        lock_dir.display()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn two_threads_do_not_lose_an_increment() {
        let dir = tempfile::tempdir().unwrap();
        let path = Arc::new(dir.path().join("settings.json"));
        std::fs::write(&*path, "{}\n").unwrap();
        let mut handles = Vec::new();
        for _ in 0..2 {
            let path = Arc::clone(&path);
            handles.push(thread::spawn(move || {
                with_settings_lock(&path, || {
                    let text = std::fs::read_to_string(&*path).unwrap_or_else(|_| "{}".into());
                    let mut value: serde_json::Value =
                        serde_json::from_str(&text).unwrap_or_else(|_| serde_json::json!({}));
                    let count = value.get("n").and_then(|item| item.as_u64()).unwrap_or(0);
                    value["n"] = serde_json::json!(count + 1);
                    std::fs::write(&*path, value.to_string()).unwrap();
                })
                .unwrap();
            }));
        }
        for handle in handles {
            handle.join().unwrap();
        }
        let text = std::fs::read_to_string(&*path).unwrap();
        let value: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(value["n"], 2);
    }
}
