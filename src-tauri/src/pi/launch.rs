// ABOUTME: Builds the pi launch spec and reads package settings and resources.
// ABOUTME: The bundled binary, CLI wrappers, and OS openers live in sibling modules.

use serde::Serialize;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

mod extensions;

use extensions::resolve_bundled_extensions;

/// A single configured pi package source with its resolved install path.
/// `scope` is "global" (user) or "project" (local to a workspace).
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PiPackageInfo {
    pub source: String,
    pub scope: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installed_path: Option<String>,
    /// True when the package entry is disabled (object form with all-empty resource arrays).
    pub disabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub package_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Number of resolved extensions/skills/prompts/themes contributed by this
    /// package (read from its `pi` manifest or conventional dirs when installed).
    #[serde(skip_serializing_if = "PackageResourceCounts::is_zero")]
    pub counts: PackageResourceCounts,
    /// The individual resolved resources (entry file per extension/skill/prompt/theme).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub resources: Vec<ResourceEntry>,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PackageResourceCounts {
    pub extensions: usize,
    pub skills: usize,
    pub prompts: usize,
    pub themes: usize,
}

impl PackageResourceCounts {
    fn is_zero(&self) -> bool {
        self.extensions == 0 && self.skills == 0 && self.prompts == 0 && self.themes == 0
    }

    pub(in crate::pi) fn from_resources(resources: &[ResourceEntry]) -> Self {
        let mut counts = PackageResourceCounts::default();
        for entry in resources {
            match entry.kind.as_str() {
                "extension" => counts.extensions += 1,
                "skill" => counts.skills += 1,
                "prompt" => counts.prompts += 1,
                "theme" => counts.themes += 1,
                _ => {}
            }
        }
        counts
    }
}

/// A single resolved resource contributed by an installed package — one entry
/// per extension/skill/prompt/theme, with the file (or skill dir) it resolves to.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ResourceEntry {
    pub kind: String,
    pub name: String,
    pub relative_path: String,
}

#[derive(Clone)]
pub struct PiLaunchResolver {
    pub(crate) static_dir: PathBuf,
}

impl PiLaunchResolver {
    pub fn new(static_dir: PathBuf) -> Self {
        Self { static_dir }
    }

    pub fn native_launch_spec(
        &self,
        cwd: &str,
        session_path: Option<&str>,
    ) -> Result<NativeLaunchSpec, String> {
        let binary = self.resolve_bundled_pi()?;
        let extensions =
            resolve_bundled_extensions(&self.static_dir, Path::new(cwd), session_path.is_some())?;
        Ok(NativeLaunchSpec {
            binary,
            cwd: PathBuf::from(crate::platform::open::strip_verbatim_prefix(cwd)),
            session_path: session_path
                .map(|path| PathBuf::from(crate::platform::open::strip_verbatim_prefix(path))),
            extensions,
            pi_version: crate::pi::binary::locked_pi_version().to_owned(),
            path_env: crate::pi::binary::build_augmented_path(),
            // SPOPI workspaces are opened via the OS folder picker, so the user
            // has already opted in; trust project-local resources for every
            // pi process SPOPI spawns.
            approve: true,
        })
    }
}

/// Locate the settings.json file for a given scope. Global is
/// `~/.pi/agent/settings.json`; project is `<cwd>/.pi/settings.json`.
pub fn settings_path(scope: &str, cwd: &str) -> Result<PathBuf, String> {
    if scope == "project" {
        let cwd = cwd.trim_end_matches('/');
        let cwd = Path::new(cwd);
        let path = cwd.join(".pi").join("settings.json");
        if !cwd.is_dir() {
            return Err(format!("Workspace directory does not exist: {cwd:?}"));
        }
        Ok(path)
    } else {
        let agent_dir = crate::pi::binary::pi_agent_dir()
            .ok_or_else(|| "Could not resolve home directory".to_string())?;
        Ok(agent_dir.join("settings.json"))
    }
}

pub struct PackageMetadata {
    pub name: Option<String>,
    pub version: Option<String>,
    pub description: Option<String>,
}

/// Read package.json metadata from an installed package path.
pub fn read_package_metadata(installed_path: &str) -> PackageMetadata {
    let path = Path::new(installed_path);
    let package_json = if path.is_dir() {
        path.join("package.json")
    } else {
        path.parent().unwrap_or(path).join("package.json")
    };
    let empty = || PackageMetadata {
        name: None,
        version: None,
        description: None,
    };
    let Ok(contents) = std::fs::read_to_string(&package_json) else {
        return empty();
    };
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&contents) else {
        return empty();
    };
    let name = parsed
        .get("name")
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned);
    let version = parsed
        .get("version")
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned);
    let description = parsed
        .get("description")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);
    PackageMetadata {
        name,
        version,
        description,
    }
}

fn resource_name(relative_path: &str) -> String {
    Path::new(relative_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(relative_path)
        .to_string()
}

fn dir_file_resources(
    dir: &Path,
    dir_name: &str,
    kind: &str,
    extensions: &[&str],
) -> Vec<ResourceEntry> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut resources: Vec<ResourceEntry> = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let ext = path.extension().and_then(|e| e.to_str())?;
            if !extensions.contains(&ext) {
                return None;
            }
            let file_name = path.file_name()?.to_str()?.to_string();
            Some(ResourceEntry {
                kind: kind.to_string(),
                name: resource_name(&file_name),
                relative_path: format!("{dir_name}/{file_name}"),
            })
        })
        .collect();
    resources.sort_by(|a, b| a.name.cmp(&b.name));
    resources
}

fn skill_resources(skills_dir: &Path) -> Vec<ResourceEntry> {
    let Ok(entries) = std::fs::read_dir(skills_dir) else {
        return Vec::new();
    };
    let mut resources = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() && path.join("SKILL.md").is_file() {
            let Some(dir_name) = path.file_name().and_then(|s| s.to_str()) else {
                continue;
            };
            resources.push(ResourceEntry {
                kind: "skill".to_string(),
                name: dir_name.to_string(),
                relative_path: format!("skills/{dir_name}/SKILL.md"),
            });
        } else if path.is_file() && path.extension().and_then(|e| e.to_str()) == Some("md") {
            let Some(file_name) = path.file_name().and_then(|s| s.to_str()) else {
                continue;
            };
            resources.push(ResourceEntry {
                kind: "skill".to_string(),
                name: resource_name(file_name),
                relative_path: format!("skills/{file_name}"),
            });
        }
    }
    resources.sort_by(|a, b| a.name.cmp(&b.name));
    resources
}

/// Resolve the individual extensions/skills/prompts/themes a package
/// contributes, used for the management detail view. Reads the package `pi`
/// manifest when present, or falls back to conventional directories.
pub fn read_package_resources(installed_path: &str) -> Vec<ResourceEntry> {
    let path = Path::new(installed_path);
    let root = if path.is_dir() {
        path.to_path_buf()
    } else {
        path.parent().unwrap_or(path).to_path_buf()
    };

    // Prefer the `pi` manifest arrays — each entry is a relative path string.
    if let Ok(contents) = std::fs::read_to_string(root.join("package.json")) {
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&contents) {
            if let Some(manifest) = parsed.get("pi").and_then(serde_json::Value::as_object) {
                let entries_from = |key: &str, kind: &str| -> Vec<ResourceEntry> {
                    manifest
                        .get(key)
                        .and_then(serde_json::Value::as_array)
                        .map(|values| {
                            values
                                .iter()
                                .filter_map(serde_json::Value::as_str)
                                .map(|value| ResourceEntry {
                                    kind: kind.to_string(),
                                    name: resource_name(value),
                                    relative_path: value.to_string(),
                                })
                                .collect()
                        })
                        .unwrap_or_default()
                };
                let mut resources = Vec::new();
                resources.extend(entries_from("extensions", "extension"));
                resources.extend(entries_from("skills", "skill"));
                resources.extend(entries_from("prompts", "prompt"));
                resources.extend(entries_from("themes", "theme"));
                if !resources.is_empty() {
                    return resources;
                }
            }
        }
    }

    // Fall back to conventional directories.
    let mut resources = Vec::new();
    resources.extend(dir_file_resources(
        &root.join("extensions"),
        "extensions",
        "extension",
        &["ts", "js"],
    ));
    resources.extend(skill_resources(&root.join("skills")));
    resources.extend(dir_file_resources(
        &root.join("prompts"),
        "prompts",
        "prompt",
        &["md"],
    ));
    resources.extend(dir_file_resources(
        &root.join("themes"),
        "themes",
        "theme",
        &["json"],
    ));
    resources
}

#[derive(Debug, Clone)]
pub struct NativeLaunchSpec {
    pub binary: PathBuf,
    pub cwd: PathBuf,
    pub session_path: Option<PathBuf>,
    pub extensions: Vec<PathBuf>,
    pub pi_version: String,
    pub path_env: String,
    /// When true, spawn `pi --approve`: the desktop owner trusts the chosen
    /// workspace's project-local resources (.pi/settings.json, .agents/skills,
    /// project extensions) for this run. SPOPI's workspace is opened via the OS
    /// folder picker, so the user has already opted in; pi's non-interactive
    /// rpc mode otherwise leaves the project untrusted even when a saved
    /// decision exists in ~/.pi/agent/trust.json.
    pub approve: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaunchDescription {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub environment: BTreeMap<String, String>,
}

impl NativeLaunchSpec {
    pub fn command_description(&self) -> LaunchDescription {
        let mut args = Vec::new();
        for extension in &self.extensions {
            args.push("--extension".into());
            args.push(extension.to_string_lossy().into_owned());
        }
        args.extend(["--mode".into(), "rpc".into()]);
        if self.approve {
            args.push("--approve".into());
        }
        if let Some(session_path) = &self.session_path {
            args.push("--session".into());
            args.push(session_path.to_string_lossy().into_owned());
        }
        let mut environment = BTreeMap::from([
            ("PATH".into(), self.path_env.clone()),
            ("SPOPI_PI_VERSION".into(), self.pi_version.clone()),
            ("PI_SKIP_VERSION_CHECK".into(), "1".into()),
        ]);
        for key in [
            "SPOPI_PUBLIC_DIR",
            "SPOPI_UI_OVERLAY",
            "SPOPI_SKILL_DIR",
            "SPOPI_INSTALL_DIR",
            "SPOPI_HOST_ORIGIN",
            "SPOPI_AGENT_BROWSER",
            "AGENT_BROWSER_EXECUTABLE_PATH",
            crate::platform::live_debug::CDP_PORT_ENV,
            extensions::MIRROR_ENV,
            "PI_CODING_AGENT_DIR",
        ] {
            if let Ok(value) = std::env::var(key) {
                if !value.trim().is_empty() {
                    environment.insert(key.into(), value);
                }
            }
        }
        if let Ok(fake_url) = std::env::var("SPOPI_FAKE_OPENAI_URL") {
            let fake_url = fake_url.trim();
            if !fake_url.is_empty() {
                environment.insert("SPOPI_FAKE_OPENAI_URL".into(), fake_url.to_string());
            }
        }
        if std::env::var("SPOPI_PERF").ok().as_deref() == Some("1") {
            environment.insert("PI_TIMING".into(), "1".into());
        }
        let surf_on = crate::pi::binary::pi_agent_dir()
            .map(|dir| crate::dependencies::surf::surf_package_state(&dir))
            .is_some_and(|package| package.installed && package.enabled);
        environment.insert("SPOPI_SURF".into(), if surf_on { "1" } else { "0" }.into());
        LaunchDescription {
            program: self.binary.clone(),
            args,
            environment,
        }
    }
}

#[cfg(test)]
mod tests;
