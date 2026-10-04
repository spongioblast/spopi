// ABOUTME: Checks installed pi packages for available upstream updates by running npm or git in the package.
// ABOUTME: Spec, version, and ref parsing lives in updates_npm.rs and updates_git.rs; this file decides and probes.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use futures_util::stream::{self, StreamExt};
use semver::{Version, VersionReq};
use serde::Serialize;
use tokio::process::Command;
use tokio::time::timeout;

use super::updates_git::{parse_ls_remote_reference, split_git_ref};
use super::updates_npm::{latest_npm_version, npm_package_spec};
use crate::pi::launch::{settings_path, PiPackageInfo};

const UPDATE_CHECK_CONCURRENCY: usize = 4;
const UPDATE_CHECK_TIMEOUT_SECS: u64 = 10;
const UPDATE_CHECK_AGGREGATE_TIMEOUT_SECS: u64 = 15;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiPackageUpdate {
    pub source: String,
    pub scope: String,
    pub available: bool,
}

#[derive(Debug, Clone)]
struct PackageLocations {
    global_settings: PathBuf,
    project_settings: Option<PathBuf>,
    project_root: Option<PathBuf>,
}

fn locations_for_workspace(workspace: Option<&Path>) -> Result<PackageLocations, String> {
    let global_settings = settings_path("global", "")?;
    let project_root = workspace.map(Path::to_path_buf);
    Ok(PackageLocations {
        project_settings: project_root
            .as_ref()
            .map(|root| root.join(".pi/settings.json")),
        global_settings,
        project_root,
    })
}

/// Check each installed package against its configured upstream. Only packages
/// with an actual update are reported; every failure degrades to "no update".
pub async fn check_available_updates(
    records: &[PiPackageInfo],
    workspace: Option<&Path>,
) -> Vec<PiPackageUpdate> {
    let Ok(locations) = locations_for_workspace(workspace) else {
        return Vec::new();
    };
    let records = records.to_vec();
    let result = timeout(
        Duration::from_secs(UPDATE_CHECK_AGGREGATE_TIMEOUT_SECS),
        stream::iter(records.into_iter().map(move |record| {
            let locations = locations.clone();
            async move {
                let available = check_package_update(&record, &locations).await;
                PiPackageUpdate {
                    source: record.source,
                    scope: record.scope,
                    available,
                }
            }
        }))
        .buffer_unordered(UPDATE_CHECK_CONCURRENCY)
        .filter(|update| std::future::ready(update.available))
        .collect::<Vec<PiPackageUpdate>>(),
    )
    .await
    // Bound the whole batch even when many subprocesses stall: buffer_unordered caps
    // per-subprocess time at UPDATE_CHECK_TIMEOUT_SECS, but with N packages the control
    // would otherwise run for ceil(N/4)*10s, so a blackholed network could hang the
    // update check well past its transport timeout. Degrade gracefully to no updates.
    .unwrap_or_default();
    result
}

async fn check_package_update(record: &PiPackageInfo, locations: &PackageLocations) -> bool {
    let Some(installed_path) = record.installed_path.as_deref() else {
        return false;
    };
    let Ok(source) = parse_source(&record.source) else {
        return false;
    };
    match source {
        ParsedSource::Npm {
            name,
            spec,
            version,
        } => {
            if version
                .as_deref()
                .and_then(|value| Version::parse(value).ok())
                .is_some()
            {
                return false;
            }
            let Some(installed_version) = record.version.as_deref() else {
                return false;
            };
            let package_spec = if version.is_some() {
                spec
            } else {
                name.clone()
            };
            let range = version
                .as_deref()
                .and_then(|value| VersionReq::parse(value).ok());
            let npm_locations = crate::dependencies::npm::NpmSettingsLocations {
                project_settings: locations.project_settings.clone(),
                global_settings: locations.global_settings.clone(),
            };
            let command = crate::dependencies::npm::npm_command(&npm_locations)
                .unwrap_or_else(|| vec!["npm".to_string()]);
            let mut args = command.iter().skip(1).cloned().collect::<Vec<_>>();
            let executable = command
                .first()
                .cloned()
                .unwrap_or_else(|| "npm".to_string());
            args.extend([
                "view".to_string(),
                package_spec,
                "version".to_string(),
                "--json".to_string(),
            ]);
            // Without a project (global packages only) npm still needs a folder to run in;
            // home has the user's `.npmrc`.
            let cwd = locations
                .project_root
                .clone()
                .or_else(dirs::home_dir)
                .unwrap_or_else(|| PathBuf::from(installed_path));
            let Ok(output) = run_update_command(&executable, &args, &cwd).await else {
                return false;
            };
            let Some(target_version) = latest_npm_version(&output, range.as_ref()) else {
                return false;
            };
            target_version != installed_version
        }
        ParsedSource::Git { reference: Some(_) } | ParsedSource::Local => false,
        ParsedSource::Git { reference: None } => {
            let Ok(local_head) = run_update_command(
                "git",
                &["rev-parse".to_string(), "HEAD".to_string()],
                Path::new(installed_path),
            )
            .await
            else {
                return false;
            };
            let Ok(remote_head) = remote_git_head(installed_path).await else {
                return false;
            };
            local_head.trim() != remote_head
        }
    }
}

#[derive(Debug, Clone)]
enum ParsedSource {
    Npm {
        name: String,
        spec: String,
        version: Option<String>,
    },
    Git {
        reference: Option<String>,
    },
    Local,
}

/// Parse a package source far enough to decide how its latest version can be
/// resolved. Git repository validation beyond ref extraction is not needed here:
/// the update probe runs inside the already-installed checkout.
fn parse_source(source: &str) -> Result<ParsedSource, String> {
    let source = source.trim();
    if let Some(spec) = source.strip_prefix("npm:") {
        let (name, version) = npm_package_spec(spec)?;
        return Ok(ParsedSource::Npm {
            name,
            spec: spec.to_string(),
            version,
        });
    }
    let (git_candidate, explicit_git) = if let Some(value) = source.strip_prefix("git:") {
        (value.trim(), true)
    } else if let Some(value) = source.strip_prefix("github:") {
        (value.trim(), true)
    } else {
        (source, false)
    };
    if explicit_git
        || git_candidate.starts_with("http://")
        || git_candidate.starts_with("https://")
        || git_candidate.starts_with("ssh://")
        || git_candidate.starts_with("git://")
    {
        let (_, reference) = split_git_ref(git_candidate);
        return Ok(ParsedSource::Git {
            reference: reference.map(ToOwned::to_owned),
        });
    }
    Ok(ParsedSource::Local)
}

async fn run_update_command(command: &str, args: &[String], cwd: &Path) -> Result<String, String> {
    if std::env::var("PI_OFFLINE")
        .ok()
        .is_some_and(|value| matches!(value.to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
    {
        return Err("offline mode".to_string());
    }
    let output = timeout(Duration::from_secs(UPDATE_CHECK_TIMEOUT_SECS), {
        let mut child = Command::new(command);
        crate::platform::windows_child::hide_console_tokio(&mut child);
        child
            .args(args)
            .current_dir(cwd)
            .env("GIT_TERMINAL_PROMPT", "0")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            // A per-subprocess timeout cancels the in-flight output() future, and a
            // cancelled child that stays attached would keep running detached; always
            // reap it on drop so stalled npm/git checks cannot leak orphan processes.
            .kill_on_drop(true)
            .output()
    })
    .await
    .map_err(|_| "package update check timed out".to_string())?
    .map_err(|error| format!("package update check failed: {error}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

async fn remote_git_head(installed_path: &str) -> Result<String, String> {
    let upstream = run_update_command(
        "git",
        &[
            "rev-parse".to_string(),
            "--abbrev-ref".to_string(),
            "@{upstream}".to_string(),
        ],
        Path::new(installed_path),
    )
    .await
    .ok()
    .map(|value| value.trim().to_string())
    .filter(|value| value.starts_with("origin/") && value.len() > "origin/".len());
    let output = if let Some(upstream) = upstream {
        let branch = &upstream["origin/".len()..];
        run_update_command(
            "git",
            &[
                "ls-remote".to_string(),
                "origin".to_string(),
                format!("refs/heads/{branch}"),
            ],
            Path::new(installed_path),
        )
        .await?
    } else {
        run_update_command(
            "git",
            &[
                "ls-remote".to_string(),
                "origin".to_string(),
                "HEAD".to_string(),
            ],
            Path::new(installed_path),
        )
        .await?
    };
    output
        .lines()
        .find_map(parse_ls_remote_reference)
        .ok_or_else(|| "failed to determine remote git HEAD".to_string())
}

#[cfg(test)]
mod tests {
    use super::{check_package_update, parse_source, ParsedSource};
    use crate::pi::launch::PiPackageInfo;

    fn info(source: &str, installed_path: Option<&str>, version: Option<&str>) -> PiPackageInfo {
        PiPackageInfo {
            source: source.to_string(),
            scope: "global".to_string(),
            installed_path: installed_path.map(ToOwned::to_owned),
            disabled: false,
            package_name: None,
            version: version.map(ToOwned::to_owned),
            description: None,
            counts: Default::default(),
            resources: Vec::new(),
        }
    }

    // Tests must never touch the real registry or remote hosts: PI_OFFLINE=1
    // makes run_update_command fail before spawning any subprocess.

    #[test]
    fn parse_source_distinguishes_npm_git_and_local() {
        assert!(matches!(
            parse_source("npm:foo"),
            Ok(ParsedSource::Npm { ref name, .. }) if name == "foo"
        ));
        assert!(matches!(
            parse_source("npm:@scope/name@^2.0.0"),
            Ok(ParsedSource::Npm { ref version, .. }) if version.as_deref() == Some("^2.0.0")
        ));
        assert!(matches!(
            parse_source("git:https://github.com/a/b#v1"),
            Ok(ParsedSource::Git { reference: Some(_) })
        ));
        assert!(matches!(
            parse_source("github:a/b"),
            Ok(ParsedSource::Git { reference: None })
        ));
        assert!(matches!(
            parse_source("./local/path"),
            Ok(ParsedSource::Local)
        ));
    }

    #[tokio::test]
    async fn check_short_circuits_without_network_for_pinned_local_and_refed_git() {
        std::env::set_var("PI_OFFLINE", "1");
        for record in [
            info("npm:foo@1.2.3", Some("/tmp/installed"), Some("1.0.0")),
            info("./local/pkg", Some("/tmp/local"), None),
            info("git:https://github.com/a/b#v1", Some("/tmp/gitpkg"), None),
            info("npm:foo", None, None),
            info("npm:foo", Some("/tmp/x"), None), // no installed version
        ] {
            let locations = super::locations_for_workspace(None).unwrap();
            assert!(
                !check_package_update(&record, &locations).await,
                "expected no update probe for {}",
                record.source
            );
        }
        std::env::remove_var("PI_OFFLINE");
    }

    #[tokio::test]
    async fn offline_guard_blocks_the_unpinned_npm_probe_before_spawning() {
        // Unpinned npm with an installed version is the one shape that reaches
        // the subprocess path; under PI_OFFLINE it must fail closed (no update)
        // without ever spawning npm.
        std::env::set_var("PI_OFFLINE", "1");
        let locations = super::locations_for_workspace(None).unwrap();
        assert!(
            !check_package_update(&info("npm:foo", Some("/tmp/x"), Some("1.0.0")), &locations)
                .await
        );
        std::env::remove_var("PI_OFFLINE");
    }
}
