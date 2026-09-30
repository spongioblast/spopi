// ABOUTME: Wraps pi install, remove, update, and list on the bundled binary.
// ABOUTME: It does not parse settings.json or open files in another app.

use std::process::{Command, Stdio};

use super::launch::{
    read_package_metadata, read_package_resources, PackageResourceCounts, PiLaunchResolver,
    PiPackageInfo,
};

impl PiLaunchResolver {
    /// Run the embedded `pi` CLI with the given arguments and return trimmed stdout.
    /// Blocking; callers on an async runtime should wrap this in `spawn_blocking`.
    pub fn run_pi_command(&self, args: &[&str]) -> Result<String, String> {
        let pi_bin = self.resolve_bundled_pi()?;
        let pi_bin_str = crate::platform::open::strip_verbatim_prefix(&pi_bin.to_string_lossy());
        let augmented_path = crate::pi::binary::build_augmented_path();
        let mut command = Command::new(&pi_bin_str);
        crate::platform::windows_child::hide_console(&mut command);
        crate::platform::appimage_env::scrub(&mut command);
        command
            .args(args)
            .env("PATH", augmented_path)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let output = command.output().map_err(|error| {
            format!("Failed to run embedded pi command ({pi_bin_str} {args:?}): {error}")
        })?;
        if output.status.success() {
            return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
        }
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let details = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!("exit status {}", output.status)
        };
        Err(format!(
            "Embedded pi command failed: {pi_bin_str} {args:?}: {details}"
        ))
    }

    /// Parse `pi list` output into configured packages. Pi 0.87.1 has no JSON
    /// flag (`pi list --help` offers only `--approve`), so `parse_pi_list`
    /// reads the text form. Install paths are then enriched from package.json.
    pub fn list_pi_packages(&self) -> Result<Vec<PiPackageInfo>, String> {
        let output = self.run_pi_command(&["list"])?;
        let mut packages = super::cli_parse::parse_pi_list(&output);
        // Enrich each package with package.json metadata (when installed).
        for pkg in packages.iter_mut() {
            if let Some(path) = pkg.installed_path.as_deref() {
                let metadata = read_package_metadata(path);
                pkg.package_name = metadata.name;
                pkg.version = metadata.version;
                pkg.description = metadata.description;
                pkg.resources = read_package_resources(path);
                pkg.counts = PackageResourceCounts::from_resources(&pkg.resources);
            }
        }
        Ok(packages)
    }

    pub fn install_pi_package(&self, source: &str, local: bool) -> Result<(), String> {
        if local {
            self.run_pi_command(&["install", source, "-l"]).map(|_| ())
        } else {
            self.run_pi_command(&["install", source]).map(|_| ())
        }
    }

    pub fn remove_pi_package(&self, source: &str, local: bool) -> Result<(), String> {
        if local {
            self.run_pi_command(&["remove", source, "-l"]).map(|_| ())
        } else {
            self.run_pi_command(&["remove", source]).map(|_| ())
        }
    }

    /// Update a single installed package (or pi itself when `source` is empty).
    pub fn update_pi_package(&self, source: &str) -> Result<(), String> {
        let source = source.trim();
        if source.is_empty() {
            self.run_pi_command(&["update", "--extensions"]).map(|_| ())
        } else {
            self.run_pi_command(&["update", source]).map(|_| ())
        }
    }
}
