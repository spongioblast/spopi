// ABOUTME: Wraps pi install, remove, update, and list on the bundled binary.
// ABOUTME: It does not parse settings.json or open files in another app.

use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

/// Exit code and both streams. A non-zero exit is not an error: `pi mcp list`
/// exits 1 when a server is down and still prints a usable document.
#[derive(Debug)]
pub struct PiCommandOutput {
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

/// Spawn `command` (stdout and stderr already piped), read both streams on
/// their own threads, and kill the process tree if it outlives `timeout`.
pub(crate) fn run_with_timeout(
    mut command: Command,
    timeout: Duration,
) -> Result<PiCommandOutput, String> {
    let mut child = command
        .spawn()
        .map_err(|error| format!("failed to start command: {error}"))?;
    let mut tree = super::child_supervision::ChildTree::attach(child.id());
    let mut stdout_pipe = child
        .stdout
        .take()
        .ok_or_else(|| "stdout pipe missing".to_string())?;
    let mut stderr_pipe = child
        .stderr
        .take()
        .ok_or_else(|| "stderr pipe missing".to_string())?;
    let stdout_thread = thread::spawn(move || {
        let mut buf = String::new();
        let _ = stdout_pipe.read_to_string(&mut buf);
        buf
    });
    let stderr_thread = thread::spawn(move || {
        let mut buf = String::new();
        let _ = stderr_pipe.read_to_string(&mut buf);
        buf
    });
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() >= timeout => {
                tree.terminate();
                let _ = child.kill();
                let _ = child.wait();
                let _ = stdout_thread.join();
                let _ = stderr_thread.join();
                return Err(format!("pi mcp timed out after {} s", timeout.as_secs()));
            }
            Ok(None) => thread::sleep(Duration::from_millis(100)),
            Err(error) => {
                tree.terminate();
                let _ = child.kill();
                let _ = child.wait();
                let _ = stdout_thread.join();
                let _ = stderr_thread.join();
                return Err(format!("failed to wait for command: {error}"));
            }
        }
    };
    let stdout = stdout_thread.join().unwrap_or_default();
    let stderr = stderr_thread.join().unwrap_or_default();
    Ok(PiCommandOutput {
        code: status.code(),
        stdout,
        stderr,
    })
}

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

    /// Like `run_pi_command`, in `cwd`, with a timeout and the process tree
    /// killed on expiry. The exit code is returned; callers decide what it means.
    pub fn run_pi_command_in(
        &self,
        cwd: &Path,
        args: &[&str],
        timeout: Duration,
    ) -> Result<PiCommandOutput, String> {
        let pi_bin = self.resolve_bundled_pi()?;
        let pi_bin_str = crate::platform::open::strip_verbatim_prefix(&pi_bin.to_string_lossy());
        let augmented_path = crate::pi::binary::build_augmented_path();
        let mut command = Command::new(&pi_bin_str);
        crate::platform::windows_child::hide_console(&mut command);
        crate::platform::appimage_env::scrub(&mut command);
        super::child_supervision::make_group_leader(&mut command);
        command
            .args(args)
            .current_dir(cwd)
            .env("PATH", augmented_path)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        run_with_timeout(command, timeout).map_err(|error| {
            format!("Failed to run embedded pi command ({pi_bin_str} {args:?}): {error}")
        })
    }

    /// Parse `pi list` output into configured packages. Pi has no JSON
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
        let source = package_source(source)?;
        if local {
            self.run_pi_command(&["install", source, "-l"]).map(|_| ())
        } else {
            self.run_pi_command(&["install", source]).map(|_| ())
        }
    }

    pub fn remove_pi_package(&self, source: &str, local: bool) -> Result<(), String> {
        let source = package_source(source)?;
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
            self.run_pi_command(&["update", package_source(source)?])
                .map(|_| ())
        }
    }
}

/// A package source goes to `pi` as a bare argument, so one that starts with `-`
/// would be read as an option.
fn package_source(source: &str) -> Result<&str, String> {
    let source = source.trim();
    if source.is_empty() {
        return Err("package source is required".into());
    }
    if source.starts_with('-') {
        return Err(format!("\"{source}\" is not a package source"));
    }
    Ok(source)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn a_package_source_is_never_an_option() {
        assert_eq!(package_source(" npm:pi-lens ").unwrap(), "npm:pi-lens");
        assert_eq!(package_source("./local-pkg").unwrap(), "./local-pkg");
        for bad in ["", "  ", "-l", "--help", " --extensions"] {
            assert!(package_source(bad).is_err(), "{bad:?}");
        }
    }

    /// `node` on this machine, `bun` on CI. None when neither can run `-e`.
    fn script_bin() -> Option<&'static str> {
        for bin in ["node", "bun"] {
            let ok = Command::new(bin)
                .arg("-e")
                .arg("process.exit(0)")
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .is_ok_and(|status| status.success());
            if ok {
                return Some(bin);
            }
        }
        eprintln!("run_with_timeout tests skipped: node and bun are not on PATH");
        None
    }

    fn script(bin: &str, code: &str) -> Command {
        let mut command = Command::new(bin);
        command
            .arg("-e")
            .arg(code)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        command
    }

    #[test]
    fn a_failing_child_keeps_its_stdout_and_exit_code() {
        let Some(bin) = script_bin() else { return };
        let output = run_with_timeout(
            script(bin, "process.stdout.write('kept'); process.exit(1)"),
            Duration::from_secs(10),
        )
        .unwrap();
        assert_eq!(output.code, Some(1));
        assert!(output.stdout.contains("kept"));
    }

    #[test]
    fn a_sleeping_child_times_out_within_three_seconds() {
        let Some(bin) = script_bin() else { return };
        let started = Instant::now();
        let error = run_with_timeout(
            script(bin, "setTimeout(() => {}, 60000)"),
            Duration::from_secs(1),
        )
        .unwrap_err();
        assert!(started.elapsed() < Duration::from_secs(3), "{error}");
        assert!(error.contains("timed out"));
    }

    #[test]
    fn a_timeout_kills_the_grandchild_too() {
        let Some(bin) = script_bin() else { return };
        let file = std::env::temp_dir().join(format!("spopi-mcp-pids-{}.json", std::process::id()));
        let code = format!(
            "const {{spawn}} = require('child_process'); const fs = require('fs'); \
             const child = spawn(process.execPath, ['-e', 'setTimeout(() => {{}}, 60000)'], {{stdio: 'ignore'}}); \
             fs.writeFileSync({}, JSON.stringify({{parent: process.pid, child: child.pid}})); \
             setTimeout(() => {{}}, 60000);",
            serde_json::to_string(&file).unwrap()
        );
        let error = run_with_timeout(script(bin, &code), Duration::from_secs(1)).unwrap_err();
        assert!(error.contains("timed out"));
        let pids: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
        let _ = fs::remove_file(&file);
        thread::sleep(Duration::from_millis(200));
        for key in ["parent", "child"] {
            let pid = pids[key].as_u64().unwrap() as u32;
            assert!(
                !super::super::child_supervision::pid_is_alive(pid),
                "{key} {pid} still alive"
            );
        }
    }

    #[test]
    fn a_megabyte_of_stdout_does_not_deadlock() {
        let Some(bin) = script_bin() else { return };
        let output = run_with_timeout(
            script(bin, "process.stdout.write('x'.repeat(1_200_000))"),
            Duration::from_secs(15),
        )
        .unwrap();
        assert_eq!(output.code, Some(0));
        assert!(output.stdout.len() > 1_000_000);
    }
}
