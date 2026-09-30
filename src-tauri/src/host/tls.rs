// ABOUTME: Passes extra TLS CAs into the embedded Pi process so device-code
// ABOUTME: OAuth can trust the same user-installed proxy CAs as the system browser.

#[cfg(target_os = "macos")]
use std::path::Path;
use std::path::PathBuf;
use std::process::Command;
#[cfg(target_os = "macos")]
use std::time::Duration;

#[cfg(target_os = "macos")]
const BUNDLE_MAX_AGE: Duration = Duration::from_secs(24 * 60 * 60);

/// Add `NODE_EXTRA_CA_CERTS` when the parent process did not already set it.
/// Additive only — never `SSL_CERT_FILE` (that replaces the default store) and
/// never `NODE_TLS_REJECT_UNAUTHORIZED`.
pub fn apply_runtime_tls_env(command: &mut Command) {
    apply_runtime_tls_env_with(command, std::env::var_os("NODE_EXTRA_CA_CERTS").is_some());
}

fn apply_runtime_tls_env_with(command: &mut Command, extra_ca_already_set: bool) {
    if extra_ca_already_set {
        return;
    }
    if let Some(path) = extra_ca_bundle_path() {
        command.env("NODE_EXTRA_CA_CERTS", path);
    }
}

fn extra_ca_bundle_path() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        macos_keychain_ca_bundle()
    }
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

#[cfg(target_os = "macos")]
fn macos_keychain_ca_bundle() -> Option<PathBuf> {
    let dest = bundle_dest()?;
    if bundle_is_fresh(&dest) {
        return Some(dest);
    }
    export_macos_keychain_cas(&dest).ok()?;
    dest.exists().then_some(dest)
}

#[cfg(target_os = "macos")]
fn bundle_dest() -> Option<PathBuf> {
    let dir = crate::data::app_paths::cache_tls_dir();
    Some(dir.join("macos-keychain-cas.pem"))
}

#[cfg(target_os = "macos")]
fn bundle_is_fresh(path: &Path) -> bool {
    let Ok(metadata) = std::fs::metadata(path) else {
        return false;
    };
    if metadata.len() == 0 {
        return false;
    }
    let Ok(modified) = metadata.modified() else {
        return false;
    };
    modified
        .elapsed()
        .ok()
        .is_some_and(|age| age < BUNDLE_MAX_AGE)
}

#[cfg(target_os = "macos")]
fn export_macos_keychain_cas(dest: &Path) -> Result<(), String> {
    let home = dirs::home_dir().ok_or_else(|| "home directory is unavailable".to_string())?;
    let keychains = [
        PathBuf::from("/Library/Keychains/System.keychain"),
        home.join("Library/Keychains/login.keychain-db"),
    ];
    let mut pem = String::new();
    for keychain in keychains {
        if !keychain.exists() {
            continue;
        }
        let output = Command::new("security")
            .args(["find-certificate", "-a", "-p"])
            .arg(&keychain)
            .output()
            .map_err(|error| error.to_string())?;
        if output.status.success() {
            pem.push_str(&String::from_utf8_lossy(&output.stdout));
        }
    }
    if !pem.contains("BEGIN CERTIFICATE") {
        return Err("no certificates exported from macOS keychains".into());
    }
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    std::fs::write(dest, pem).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use std::process::Command;

    #[test]
    fn skips_when_extra_ca_is_already_set() {
        let mut command = Command::new("true");
        super::apply_runtime_tls_env_with(&mut command, true);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn fresh_bundle_requires_nonempty_recent_file() {
        use super::bundle_is_fresh;
        use std::time::{SystemTime, UNIX_EPOCH};
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("spopi-tls-fresh-{nonce}.pem"));
        std::fs::write(
            &path,
            "-----BEGIN CERTIFICATE-----\nM\n-----END CERTIFICATE-----\n",
        )
        .expect("write");
        assert!(bundle_is_fresh(&path));
        let _ = std::fs::remove_file(&path);
        assert!(!bundle_is_fresh(&path));
    }
}
