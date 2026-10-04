// ABOUTME: Downloads the current Node.js LTS from nodejs.org into SPOPI's data folder, without sudo.
// ABOUTME: The archive is checked against the release's SHASUMS256.txt before it is unpacked.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::Value;
use sha2::{Digest, Sha256};
use tokio::io::AsyncWriteExt;

pub const DIST: &str = "https://nodejs.org/dist";

/// `~/.local/share/spopi/node` on Linux, `~/Library/Application Support/spopi/node` on macOS.
pub fn install_dir() -> Option<PathBuf> {
    dirs::data_dir().map(|dir| dir.join("spopi").join("node"))
}

pub fn bin_dir() -> Option<PathBuf> {
    install_dir().map(|dir| dir.join("bin"))
}

/// The part of the archive name nodejs.org uses for this OS and CPU (`linux-x64`, `darwin-arm64`).
pub fn platform_suffix(os: &str, arch: &str) -> Option<&'static str> {
    match (os, arch) {
        ("linux", "x86_64") => Some("linux-x64"),
        ("linux", "aarch64") => Some("linux-arm64"),
        ("macos", "x86_64") => Some("darwin-x64"),
        ("macos", "aarch64") => Some("darwin-arm64"),
        _ => None,
    }
}

/// Newest release in `index.json` that has an LTS codename, as `(version, codename)`.
pub fn latest_lts(index: &Value) -> Option<(String, String)> {
    index.as_array()?.iter().find_map(|release| {
        let codename = release.get("lts")?.as_str()?;
        let version = release.get("version")?.as_str()?;
        version
            .starts_with('v')
            .then(|| (version.to_string(), codename.to_string()))
    })
}

pub fn archive_name(version: &str, suffix: &str) -> String {
    format!("node-{version}-{suffix}.tar.gz")
}

/// The lowercase SHA-256 listed for `name` in a SHASUMS256.txt.
pub fn expected_sha256(shasums: &str, name: &str) -> Option<String> {
    shasums.lines().find_map(|line| {
        let mut parts = line.split_whitespace();
        let hash = parts.next()?;
        let file = parts.next()?;
        (file == name && hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_hexdigit()))
            .then(|| hash.to_ascii_lowercase())
    })
}

/// Downloads, checks, and unpacks Node.js into `dest`, replacing an earlier copy.
/// `log` receives one line per step.
pub async fn install(dest: &Path, log: impl Fn(String)) -> Result<(), String> {
    let suffix = platform_suffix(std::env::consts::OS, std::env::consts::ARCH)
        .ok_or("nodejs.org has no build for this system")?;
    let parent = dest
        .parent()
        .ok_or("the Node.js folder has no parent")?
        .to_path_buf();
    tokio::fs::create_dir_all(&parent)
        .await
        .map_err(|error| format!("cannot create {}: {error}", parent.display()))?;
    let (archive, staging) = partial_paths(&parent);
    discard_partial(dest).await;

    let client = reqwest::Client::builder()
        .user_agent("spopi")
        .connect_timeout(Duration::from_secs(20))
        .read_timeout(Duration::from_secs(60))
        .build()
        .map_err(|error| error.to_string())?;

    let index_url = format!("{DIST}/index.json");
    log(format!("Reading {index_url}"));
    let index: Value = fetch(&client, &index_url)
        .await?
        .json()
        .await
        .map_err(|error| format!("{index_url}: {error}"))?;
    let (version, codename) = latest_lts(&index).ok_or("index.json lists no LTS release")?;
    log(format!("Node.js {version} (LTS {codename})"));

    let name = archive_name(&version, suffix);
    let sums_url = format!("{DIST}/{version}/SHASUMS256.txt");
    let sums = fetch(&client, &sums_url)
        .await?
        .text()
        .await
        .map_err(|error| format!("{sums_url}: {error}"))?;
    let expected =
        expected_sha256(&sums, &name).ok_or_else(|| format!("{name} is not in {sums_url}"))?;

    let url = format!("{DIST}/{version}/{name}");
    log(format!("Downloading {url}"));
    let actual = download(&client, &url, &archive, &log).await?;
    if actual != expected {
        let _ = tokio::fs::remove_file(&archive).await;
        return Err(format!(
            "SHA-256 mismatch for {name}: expected {expected}, got {actual}"
        ));
    }
    log(format!("SHA-256 matches {sums_url}"));

    log(format!("Unpacking into {}", dest.display()));
    tokio::fs::create_dir_all(&staging)
        .await
        .map_err(|error| format!("cannot create {}: {error}", staging.display()))?;
    let mut tar = tokio::process::Command::new("tar");
    super::jobs::scrub_tokio(&mut tar);
    let output = tar
        .arg("-xzf")
        .arg(&archive)
        .arg("-C")
        .arg(&staging)
        .arg("--strip-components=1")
        .kill_on_drop(true)
        .output()
        .await
        .map_err(|error| format!("tar did not start: {error}"))?;
    let _ = tokio::fs::remove_file(&archive).await;
    if !output.status.success() {
        let _ = tokio::fs::remove_dir_all(&staging).await;
        return Err(format!(
            "tar failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let node = staging.join("bin").join("node");
    if !node.is_file() {
        let _ = tokio::fs::remove_dir_all(&staging).await;
        return Err("the archive has no bin/node".into());
    }

    let _ = tokio::fs::remove_dir_all(dest).await;
    tokio::fs::rename(&staging, dest)
        .await
        .map_err(|error| format!("cannot move Node.js into {}: {error}", dest.display()))?;
    log(format!(
        "Installed. node and npm are in {}",
        dest.join("bin").display()
    ));
    Ok(())
}

/// The download and the unpacked copy before it replaces `dest`.
fn partial_paths(parent: &Path) -> (PathBuf, PathBuf) {
    (parent.join("node-download.tar.gz"), parent.join("node-new"))
}

/// Removes what a cancelled or timed-out install left next to `dest`.
pub async fn discard_partial(dest: &Path) {
    let Some(parent) = dest.parent() else {
        return;
    };
    let (archive, staging) = partial_paths(parent);
    let _ = tokio::fs::remove_file(&archive).await;
    let _ = tokio::fs::remove_dir_all(&staging).await;
}

async fn fetch(client: &reqwest::Client, url: &str) -> Result<reqwest::Response, String> {
    client
        .get(url)
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|error| format!("{url}: {error}"))
}

async fn download(
    client: &reqwest::Client,
    url: &str,
    path: &Path,
    log: &impl Fn(String),
) -> Result<String, String> {
    let mut response = fetch(client, url).await?;
    let total = response.content_length();
    let mut file = tokio::fs::File::create(path)
        .await
        .map_err(|error| format!("cannot write {}: {error}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut received: u64 = 0;
    let mut next_report: u64 = 10;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("{url}: {error}"))?
    {
        hasher.update(&chunk);
        file.write_all(&chunk)
            .await
            .map_err(|error| format!("cannot write {}: {error}", path.display()))?;
        received += chunk.len() as u64;
        if let Some(total) = total.filter(|total| *total > 0) {
            let percent = received * 100 / total;
            if percent >= next_report {
                log(format!("{} of {} MB", received >> 20, total >> 20));
                next_report = (percent / 10 + 1) * 10;
            }
        }
    }
    file.flush()
        .await
        .map_err(|error| format!("cannot write {}: {error}", path.display()))?;
    Ok(hex::encode(hasher.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn platform_suffix_covers_the_release_targets() {
        assert_eq!(platform_suffix("linux", "x86_64"), Some("linux-x64"));
        assert_eq!(platform_suffix("linux", "aarch64"), Some("linux-arm64"));
        assert_eq!(platform_suffix("macos", "aarch64"), Some("darwin-arm64"));
        assert_eq!(platform_suffix("macos", "x86_64"), Some("darwin-x64"));
        assert_eq!(platform_suffix("windows", "x86_64"), None);
        assert_eq!(platform_suffix("linux", "riscv64"), None);
    }

    #[test]
    fn latest_lts_skips_current_releases() {
        let index = json!([
            { "version": "v26.1.0", "lts": false },
            { "version": "v24.11.0", "lts": "Krypton" },
            { "version": "v22.21.0", "lts": "Jod" },
        ]);
        assert_eq!(
            latest_lts(&index),
            Some(("v24.11.0".to_string(), "Krypton".to_string()))
        );
        assert_eq!(
            latest_lts(&json!([{ "version": "v26.1.0", "lts": false }])),
            None
        );
        assert_eq!(latest_lts(&json!({})), None);
    }

    #[test]
    fn expected_sha256_matches_the_exact_file_name() {
        let hash = "a".repeat(64);
        let other = "b".repeat(64);
        let sums = format!(
            "{other}  node-v24.11.0-linux-x64.tar.xz\n{hash}  node-v24.11.0-linux-x64.tar.gz\n"
        );
        assert_eq!(
            expected_sha256(&sums, &archive_name("v24.11.0", "linux-x64")),
            Some(hash)
        );
        assert_eq!(
            expected_sha256(&sums, "node-v24.11.0-linux-arm64.tar.gz"),
            None
        );
        assert_eq!(expected_sha256("short  node.tar.gz", "node.tar.gz"), None);
    }
}
