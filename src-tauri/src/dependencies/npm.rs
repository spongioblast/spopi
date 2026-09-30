// ABOUTME: Resolves the npm command from Pi settings, then from PATH.
// ABOUTME: The package update check uses the same resolver so npm.cmd is found on Windows.

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;

use super::exec::{resolve_executable, run_capture};

#[derive(Debug, Clone)]
pub struct NpmSettingsLocations {
    pub project_settings: Option<PathBuf>,
    pub global_settings: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NpmInstallOffer {
    pub one_click: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commands: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link: Option<String>,
}

pub fn configured_npm_command(locations: &NpmSettingsLocations) -> Option<Vec<String>> {
    let project_command = locations
        .project_settings
        .as_deref()
        .and_then(read_settings)
        .and_then(|settings| npm_command_from_settings(&settings));
    project_command.or_else(|| {
        read_settings(&locations.global_settings)
            .and_then(|settings| npm_command_from_settings(&settings))
    })
}

fn npm_command_from_settings(settings: &serde_json::Map<String, Value>) -> Option<Vec<String>> {
    let command = settings.get("npmCommand")?.as_array()?;
    let command = command
        .iter()
        .map(Value::as_str)
        .collect::<Option<Vec<_>>>()?;
    (!command.is_empty()).then(|| command.into_iter().map(ToOwned::to_owned).collect())
}

fn read_settings(path: &Path) -> Option<serde_json::Map<String, Value>> {
    crate::data::atomic_json::read_object(path).ok()
}

/// Configured command first. Otherwise `npm` resolved to an absolute path on `path_env`.
pub fn npm_command(locations: &NpmSettingsLocations) -> Option<Vec<String>> {
    resolve_npm_invocation(
        configured_npm_command(locations),
        &crate::pi::binary::build_augmented_path(),
    )
}

pub fn resolve_npm_invocation(
    configured: Option<Vec<String>>,
    path_env: &str,
) -> Option<Vec<String>> {
    let mut command = configured.unwrap_or_else(|| vec!["npm".to_string()]);
    let first = command.first()?.clone();
    if Path::new(&first).is_file() {
        return Some(command);
    }
    let lookup = Path::new(&first)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(first.as_str());
    let resolved = resolve_executable(lookup, path_env)?;
    command[0] = resolved.to_string_lossy().into_owned();
    Some(command)
}

pub fn npm_install_offer() -> NpmInstallOffer {
    let path_env = crate::pi::binary::build_augmented_path();
    let winget = cfg!(windows) && resolve_executable("winget", &path_env).is_some();
    let brew = cfg!(target_os = "macos")
        && (Path::new("/opt/homebrew/bin/brew").is_file()
            || Path::new("/usr/local/bin/brew").is_file());
    npm_install_offer_for(std::env::consts::OS, winget, brew)
}

pub fn npm_install_offer_for(os: &str, winget: bool, brew: bool) -> NpmInstallOffer {
    if os == "windows" && winget {
        return NpmInstallOffer {
            one_click: true,
            method: Some("winget".into()),
            commands: None,
            link: None,
        };
    }
    if os == "macos" && brew {
        return NpmInstallOffer {
            one_click: true,
            method: Some("brew".into()),
            commands: None,
            link: None,
        };
    }
    let commands = if os == "linux" {
        Some(vec![
            "sudo apt install -y nodejs npm".into(),
            "sudo dnf install -y nodejs npm".into(),
            "sudo pacman -S nodejs npm".into(),
        ])
    } else {
        None
    };
    NpmInstallOffer {
        one_click: false,
        method: None,
        commands,
        link: Some("https://nodejs.org/en/download".into()),
    }
}

/// The first line of `npm --version`, when it is a semver (`10.9.2` or `v10.9.2`).
pub fn npm_version_text(stdout: &str) -> Option<String> {
    let line = stdout
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())?;
    let bare = line.strip_prefix('v').unwrap_or(line);
    let token = bare.split_whitespace().next().unwrap_or(bare);
    semver::Version::parse(token).ok()?;
    Some(token.to_string())
}

pub async fn npm_version(command: &[String]) -> Result<String, String> {
    let program = PathBuf::from(command.first().ok_or("npm command is empty")?);
    let mut args: Vec<String> = command.iter().skip(1).cloned().collect();
    args.push("--version".into());
    let captured = run_capture(
        &program,
        &args,
        Some(&crate::pi::binary::build_augmented_path()),
        std::time::Duration::from_secs(10),
    )
    .await?;
    if !captured.status_ok {
        let detail = captured.stderr.trim();
        return Err(if detail.is_empty() {
            format!("npm exited {}", captured.code.unwrap_or(-1))
        } else {
            detail.to_string()
        });
    }
    npm_version_text(&captured.stdout).ok_or_else(|| "npm did not print a version".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn configured_command_prefers_the_project_file() {
        let dir = std::env::temp_dir().join(format!("spopi-npm-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let project = dir.join("project.json");
        let global = dir.join("global.json");
        fs::write(&project, r#"{"npmCommand":["project-npm"]}"#).unwrap();
        fs::write(&global, r#"{"npmCommand":["global-npm"]}"#).unwrap();
        let both = NpmSettingsLocations {
            project_settings: Some(project.clone()),
            global_settings: global.clone(),
        };
        assert_eq!(
            configured_npm_command(&both).unwrap(),
            vec!["project-npm".to_string()]
        );
        let global_only = NpmSettingsLocations {
            project_settings: None,
            global_settings: global,
        };
        assert_eq!(
            configured_npm_command(&global_only).unwrap(),
            vec!["global-npm".to_string()]
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolve_falls_back_to_an_absolute_npm() {
        let dir = std::env::temp_dir().join(format!("spopi-npm-bin-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let file_name = if cfg!(windows) { "npm.cmd" } else { "npm" };
        fs::write(dir.join(file_name), "echo").unwrap();
        let path_env = std::env::join_paths([&dir]).unwrap();
        let resolved = resolve_npm_invocation(None, &path_env.to_string_lossy()).unwrap();
        assert!(resolved[0].contains("npm"));
        assert!(Path::new(&resolved[0]).is_file());
        let configured =
            resolve_npm_invocation(Some(vec!["custom-npm".into()]), &path_env.to_string_lossy());
        assert!(configured.is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn npm_version_text_requires_a_semver() {
        assert_eq!(npm_version_text("10.9.2\n").as_deref(), Some("10.9.2"));
        assert_eq!(npm_version_text("v22.14.0").as_deref(), Some("22.14.0"));
        assert!(npm_version_text("npm is not recognized").is_none());
        assert!(npm_version_text("").is_none());
    }

    #[test]
    fn install_offer_matches_the_package_manager() {
        let winget = npm_install_offer_for("windows", true, false);
        assert!(winget.one_click);
        assert_eq!(winget.method.as_deref(), Some("winget"));
        let brew = npm_install_offer_for("macos", false, true);
        assert_eq!(brew.method.as_deref(), Some("brew"));
        let linux = npm_install_offer_for("linux", false, false);
        assert!(!linux.one_click);
        assert_eq!(linux.commands.unwrap().len(), 3);
        assert!(linux.link.unwrap().contains("nodejs.org"));
        let plain = npm_install_offer_for("windows", false, false);
        assert!(!plain.one_click);
        assert!(plain.link.is_some());
    }
}
