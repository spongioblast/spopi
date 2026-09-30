// ABOUTME: Finds a program on PATH and runs it with a timeout.
// ABOUTME: Windows resolves PATHEXT so npm.cmd and surf.cmd are real programs.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use tokio::process::Command;
use tokio::time::timeout;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Captured {
    pub status_ok: bool,
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

/// Extensions `Command` can start on Windows. Node ships an extensionless `npm`
/// shell script beside `npm.cmd`; starting that script fails with os error 193.
const WINDOWS_RUNNABLE: &[&str] = &[".exe", ".cmd", ".bat", ".com"];

/// Search `path_env` for `name`. On Windows, only runnable PATHEXT suffixes match.
pub fn resolve_executable(name: &str, path_env: &str) -> Option<PathBuf> {
    let suffixes = executable_suffixes(cfg!(windows), std::env::var("PATHEXT").ok().as_deref());
    resolve_with(name, path_env, &suffixes)
}

fn resolve_with(name: &str, path_env: &str, suffixes: &[String]) -> Option<PathBuf> {
    let name = name.trim();
    if name.is_empty() {
        return None;
    }
    let lower = name.to_ascii_lowercase();
    let has_runnable_ext = suffixes
        .iter()
        .any(|suffix| !suffix.is_empty() && lower.ends_with(suffix.as_str()));
    for dir in std::env::split_paths(path_env) {
        if has_runnable_ext {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
            continue;
        }
        for suffix in suffixes {
            let candidate = dir.join(format!("{name}{suffix}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn executable_suffixes(windows: bool, pathext: Option<&str>) -> Vec<String> {
    if !windows {
        return vec![String::new()];
    }
    let from_env: Vec<String> = pathext
        .unwrap_or(".EXE;.CMD;.BAT;.COM")
        .split(';')
        .map(|suffix| suffix.trim().to_ascii_lowercase())
        .filter(|suffix| WINDOWS_RUNNABLE.contains(&suffix.as_str()))
        .collect();
    if from_env.is_empty() {
        WINDOWS_RUNNABLE
            .iter()
            .map(|suffix| (*suffix).to_string())
            .collect()
    } else {
        from_env
    }
}

pub async fn run_capture(
    program: &Path,
    args: &[String],
    path_env: Option<&str>,
    limit: Duration,
) -> Result<Captured, String> {
    let mut command = Command::new(program);
    crate::platform::windows_child::hide_console_tokio(&mut command);
    scrub_tokio(&mut command);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(path_env) = path_env {
        command.env("PATH", path_env);
    }
    let output = timeout(limit, command.output())
        .await
        .map_err(|_| format!("{} timed out", program.display()))?
        .map_err(|error| format!("failed to run {}: {error}", program.display()))?;
    Ok(Captured {
        status_ok: output.status.success(),
        code: output.status.code(),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}

fn scrub_tokio(command: &mut Command) {
    use crate::platform::appimage_env::{plan, EnvAction};
    for (key, action) in plan() {
        match action {
            EnvAction::Set(value) => {
                command.env(key, value);
            }
            EnvAction::Unset => {
                command.env_remove(key);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[cfg(windows)]
    #[test]
    fn resolve_executable_finds_cmd_through_pathext() {
        let dir = std::env::temp_dir().join(format!("spopi-pathext-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("x.cmd"), "@echo ok\r\n").unwrap();
        let path_env = std::env::join_paths([&dir]).unwrap();
        let found = resolve_executable("x", &path_env.to_string_lossy());
        let _ = fs::remove_dir_all(&dir);
        let found = found.expect("x.cmd");
        assert!(found
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.eq_ignore_ascii_case("x.cmd")));
    }

    #[test]
    fn windows_lookup_skips_the_extensionless_npm_script() {
        let dir = std::env::temp_dir().join(format!("spopi-npm-shim-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("npm"), "#!/bin/sh\n").unwrap();
        fs::write(dir.join("npm.cmd"), "@echo 10.9.2\r\n").unwrap();
        fs::write(dir.join("npm.ps1"), "Write-Output 10.9.2\n").unwrap();
        let path_env = std::env::join_paths([&dir]).unwrap();
        let suffixes = executable_suffixes(
            true,
            Some(".COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC;.CPL"),
        );
        let found = resolve_with("npm", &path_env.to_string_lossy(), &suffixes);
        let explicit = resolve_with("npm.cmd", &path_env.to_string_lossy(), &suffixes);
        let _ = fs::remove_dir_all(&dir);
        assert_eq!(suffixes, vec![".com", ".exe", ".bat", ".cmd"]);
        assert_eq!(found.unwrap().file_name().unwrap(), "npm.cmd");
        assert_eq!(explicit.unwrap().file_name().unwrap(), "npm.cmd");
    }

    #[cfg(not(windows))]
    #[test]
    fn resolve_executable_finds_an_exact_name() {
        let dir = std::env::temp_dir().join(format!("spopi-pathext-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("tool"), "#!/bin/sh\n").unwrap();
        let path_env = std::env::join_paths([&dir]).unwrap();
        let found = resolve_executable("tool", &path_env.to_string_lossy());
        let _ = fs::remove_dir_all(&dir);
        assert_eq!(found.unwrap().file_name().unwrap(), "tool");
    }

    #[tokio::test]
    async fn run_capture_reads_stdout() {
        #[cfg(windows)]
        let (program, args) = (
            PathBuf::from("cmd"),
            vec!["/C".to_string(), "echo hello-spopi".to_string()],
        );
        #[cfg(not(windows))]
        let (program, args) = (PathBuf::from("echo"), vec!["hello-spopi".to_string()]);
        let captured = run_capture(&program, &args, None, Duration::from_secs(5))
            .await
            .unwrap();
        assert!(captured.status_ok);
        assert!(captured.stdout.contains("hello-spopi"));
    }
}
