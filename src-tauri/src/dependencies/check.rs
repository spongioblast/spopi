// ABOUTME: Builds the dependency report shown on first launch and in Settings.
// ABOUTME: A quick check skips the browser and Surf probes.

use std::path::Path;

use serde::Serialize;

use super::agent_browser::{bundled_agent_browser, probe_browser};
use super::browsers::detect_browsers;
use super::npm::{
    npm_command, npm_install_offer, npm_version, NpmInstallOffer, NpmSettingsLocations,
};
use super::surf::{probe_connection, surf_cli, surf_package_state};
use crate::pi::binary::{locked_pi_version, pi_agent_dir};
use crate::pi::launch::PiLaunchResolver;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DependencyStatus {
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repair: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub install: Option<NpmInstallOffer>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub downloadable: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub browsers: Option<Vec<super::browsers::InstalledBrowser>>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DependencyReport {
    pub pi: DependencyStatus,
    pub agent_browser: DependencyStatus,
    pub npm: DependencyStatus,
    pub browser: DependencyStatus,
    pub surf: DependencyStatus,
}

pub async fn check_dependencies(
    quick: bool,
    static_dir: &Path,
    agent_browser_enabled: bool,
) -> DependencyReport {
    let (pi, agent_browser, npm) = tokio::join!(
        check_pi(static_dir),
        check_agent_browser(static_dir, agent_browser_enabled),
        check_npm(),
    );
    if quick {
        return DependencyReport {
            pi,
            agent_browser,
            npm,
            browser: plain("unknown"),
            surf: plain("unknown"),
        };
    }
    let (browser, surf) = tokio::join!(
        check_browser(static_dir, agent_browser_enabled),
        check_surf(),
    );
    DependencyReport {
        pi,
        agent_browser,
        npm,
        browser,
        surf,
    }
}

fn plain(state: &str) -> DependencyStatus {
    DependencyStatus {
        state: state.to_string(),
        version: None,
        path: None,
        detail: None,
        enabled: None,
        repair: None,
        install: None,
        source: None,
        downloadable: None,
        installed: None,
        browsers: None,
    }
}

async fn check_pi(static_dir: &Path) -> DependencyStatus {
    let resolver = PiLaunchResolver::new(static_dir.to_path_buf());
    let binary = resolver.resolve_bundled_pi().ok();
    let mut status = versioned(binary.as_deref(), locked_pi_version(), "Pi").await;
    status.repair = Some("reinstall".into());
    status
}

async fn check_agent_browser(static_dir: &Path, enabled: bool) -> DependencyStatus {
    let binary = bundled_agent_browser(static_dir);
    let mut status = versioned(
        binary.as_deref(),
        super::agent_browser::bundled_version(),
        "agent-browser",
    )
    .await;
    status.enabled = Some(enabled);
    status.repair = Some("reinstall".into());
    status
}

async fn versioned(binary: Option<&Path>, expected: &str, label: &str) -> DependencyStatus {
    let Some(binary) = binary else {
        return DependencyStatus {
            state: "missing".into(),
            detail: Some("Not found in this installation.".into()),
            ..plain("missing")
        };
    };
    let path = Some(crate::platform::open::strip_verbatim_prefix(
        &binary.to_string_lossy(),
    ));
    match super::exec::run_capture(
        binary,
        &["--version".into()],
        None,
        std::time::Duration::from_secs(10),
    )
    .await
    {
        Ok(captured) if captured.status_ok && captured.stdout.contains(expected) => {
            DependencyStatus {
                state: "ok".into(),
                version: Some(expected.to_string()),
                path,
                ..plain("ok")
            }
        }
        Ok(captured) if captured.status_ok => {
            let shown = captured.stdout.trim();
            let shown = shown.lines().next().unwrap_or(shown);
            DependencyStatus {
                state: "error".into(),
                version: Some(shown.to_string()),
                path,
                detail: Some(format!("version {shown}, expected {expected}")),
                ..plain("error")
            }
        }
        Ok(captured) => DependencyStatus {
            state: "error".into(),
            path,
            detail: Some(detail_line(
                label,
                if captured.stderr.trim().is_empty() {
                    &captured.stdout
                } else {
                    &captured.stderr
                },
            )),
            ..plain("error")
        },
        Err(error) => DependencyStatus {
            state: "error".into(),
            path,
            detail: Some(error),
            ..plain("error")
        },
    }
}

fn detail_line(label: &str, text: &str) -> String {
    text.lines()
        .map(str::trim)
        .rfind(|line| !line.is_empty())
        .unwrap_or(label)
        .to_string()
}

async fn check_npm() -> DependencyStatus {
    let locations = match crate::pi::launch::settings_path("global", "") {
        Ok(global_settings) => NpmSettingsLocations {
            project_settings: None,
            global_settings,
        },
        Err(error) => {
            return DependencyStatus {
                detail: Some(error),
                install: Some(npm_install_offer()),
                ..plain("missing")
            };
        }
    };
    let Some(command) = npm_command(&locations) else {
        return DependencyStatus {
            detail: Some("npm was not found on PATH".into()),
            install: Some(npm_install_offer()),
            ..plain("missing")
        };
    };
    match npm_version(&command).await {
        Ok(version) => DependencyStatus {
            state: "ok".into(),
            version: Some(version),
            path: command.first().cloned(),
            ..plain("ok")
        },
        Err(error) => DependencyStatus {
            state: "error".into(),
            path: command.first().cloned(),
            detail: Some(error),
            install: Some(npm_install_offer()),
            ..plain("error")
        },
    }
}

async fn check_browser(static_dir: &Path, enabled: bool) -> DependencyStatus {
    if !enabled {
        return plain("off");
    }
    let binary = bundled_agent_browser(static_dir);
    let probe = probe_browser(binary.as_deref()).await;
    DependencyStatus {
        state: probe.state.to_string(),
        path: probe.path,
        source: probe.source,
        detail: probe.detail,
        downloadable: Some(true),
        ..plain(probe.state)
    }
}

async fn check_surf() -> DependencyStatus {
    let browsers = detect_browsers();
    let agent_dir = pi_agent_dir();
    let package =
        agent_dir
            .as_deref()
            .map(surf_package_state)
            .unwrap_or(super::surf::SurfPackage {
                installed: false,
                enabled: false,
            });
    if !package.installed {
        return DependencyStatus {
            state: "not_installed".into(),
            installed: Some(false),
            enabled: Some(false),
            browsers: Some(browsers),
            ..plain("not_installed")
        };
    }
    if !package.enabled {
        return DependencyStatus {
            state: "off".into(),
            installed: Some(true),
            enabled: Some(false),
            browsers: Some(browsers),
            ..plain("off")
        };
    }
    let Some(dir) = agent_dir.as_deref() else {
        return DependencyStatus {
            state: "error".into(),
            installed: Some(true),
            enabled: Some(true),
            detail: Some("Pi's agent folder was not found.".into()),
            browsers: Some(browsers),
            ..plain("error")
        };
    };
    let Some(cli) = surf_cli(dir) else {
        return DependencyStatus {
            state: "error".into(),
            installed: Some(true),
            enabled: Some(true),
            detail: Some("surf was not found next to the package.".into()),
            browsers: Some(browsers),
            ..plain("error")
        };
    };
    match probe_connection(&cli).await {
        Ok(()) => DependencyStatus {
            state: "ok".into(),
            installed: Some(true),
            enabled: Some(true),
            path: Some(cli.to_string_lossy().into_owned()),
            browsers: Some(browsers),
            ..plain("ok")
        },
        Err(error) => DependencyStatus {
            state: "not_connected".into(),
            installed: Some(true),
            enabled: Some(true),
            path: Some(cli.to_string_lossy().into_owned()),
            detail: Some(error),
            browsers: Some(browsers),
            ..plain("not_connected")
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quick_rows_serialize_browser_and_surf_as_unknown() {
        let report = DependencyReport {
            pi: plain("ok"),
            agent_browser: DependencyStatus {
                enabled: Some(true),
                repair: Some("reinstall".into()),
                ..plain("ok")
            },
            npm: DependencyStatus {
                detail: Some("npm was not found on PATH".into()),
                install: Some(crate::dependencies::npm::npm_install_offer_for(
                    "linux", false, false,
                )),
                ..plain("missing")
            },
            browser: plain("unknown"),
            surf: plain("unknown"),
        };
        let value = serde_json::to_value(&report).unwrap();
        assert_eq!(value["agentBrowser"]["state"], "ok");
        assert_eq!(value["agentBrowser"]["repair"], "reinstall");
        assert_eq!(value["browser"]["state"], "unknown");
        assert_eq!(value["surf"]["state"], "unknown");
        assert_eq!(value["npm"]["install"]["oneClick"], false);
        assert!(value["browser"].get("browsers").is_none());
    }
}
