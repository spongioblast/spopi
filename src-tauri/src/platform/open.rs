// ABOUTME: Opens paths and URLs with the OS file manager and the default browser.
// ABOUTME: Command allowlisting lives here. Pi launch does not call the shell.

use serde::Serialize;
#[cfg(target_os = "macos")]
use std::collections::HashSet;
use std::path::Path;
#[cfg(target_os = "macos")]
use std::path::PathBuf;
use std::process::Command;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppTarget {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub app_name: Option<String>,
    pub command: Option<String>,
}

#[cfg(target_os = "macos")]
fn macos_installed_app_names() -> HashSet<String> {
    let mut roots = vec![
        PathBuf::from("/Applications"),
        PathBuf::from("/System/Applications"),
        PathBuf::from("/Applications/Utilities"),
        PathBuf::from("/System/Applications/Utilities"),
    ];
    if let Some(home) = dirs::home_dir() {
        roots.push(home.join("Applications"));
    }
    let mut names = HashSet::new();
    for root in roots {
        let Ok(entries) = std::fs::read_dir(root) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() || path.extension().and_then(|ext| ext.to_str()) != Some("app") {
                continue;
            }
            if let Some(stem) = path.file_stem().and_then(|stem| stem.to_str()) {
                names.insert(stem.to_ascii_lowercase());
            }
        }
    }
    names
}

/// List launch targets SPOPI can use to open a workspace in an external app.
pub fn list_installed_apps() -> Vec<AppTarget> {
    let candidates: [(&str, &str, &[&str], &str); 6] = [
        ("vscode", "VS Code", &["Visual Studio Code", "Code"], "code"),
        ("cursor", "Cursor", &["Cursor"], "cursor"),
        (
            "webstorm",
            "WebStorm",
            &["WebStorm", "WebStorm EAP"],
            "webstorm",
        ),
        ("zed", "Zed", &["Zed"], "zed"),
        ("terminal", "Terminal", &["Terminal", "iTerm", "Warp"], ""),
        ("ghostty", "Ghostty", &["Ghostty"], ""),
    ];

    #[cfg(target_os = "macos")]
    {
        let installed = macos_installed_app_names();
        let mut targets = Vec::new();
        for (id, label, bundle_names, _command) in candidates {
            if let Some(app_name) = bundle_names
                .iter()
                .find(|name| installed.contains(&name.to_ascii_lowercase()))
            {
                targets.push(AppTarget {
                    id: id.to_string(),
                    label: label.to_string(),
                    kind: "app".to_string(),
                    app_name: Some((*app_name).to_string()),
                    command: None,
                });
            }
        }
        targets.push(AppTarget {
            id: "finder".to_string(),
            label: "Finder".to_string(),
            kind: "finder".to_string(),
            app_name: None,
            command: None,
        });
        targets
    }

    #[cfg(not(target_os = "macos"))]
    {
        let mut targets: Vec<AppTarget> = candidates
            .iter()
            .filter(|(_, _, _, command)| !command.is_empty())
            .map(|(id, label, _, command)| AppTarget {
                id: id.to_string(),
                label: label.to_string(),
                kind: "command".to_string(),
                app_name: None,
                command: Some(command.to_string()),
            })
            .collect();
        targets.push(AppTarget {
            id: "finder".to_string(),
            label: "File Manager".to_string(),
            kind: "finder".to_string(),
            app_name: None,
            command: None,
        });
        targets
    }
}

/// Open a project directory in an external app (editor / terminal / file manager). Blocking.
pub fn open_in_app(
    path: &str,
    app_name: Option<&str>,
    command: Option<&str>,
) -> Result<(), String> {
    let trimmed_path = path.trim();
    if trimmed_path.is_empty() {
        return Err("Missing path".to_string());
    }

    if let Some(command) = command.map(str::trim).filter(|command| !command.is_empty()) {
        const ALLOWED: &[&str] = &["code", "code.cmd", "cursor", "cursor.cmd", "notepad"];
        let exe = Path::new(command)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(command);
        if !ALLOWED.iter().any(|name| name.eq_ignore_ascii_case(exe)) {
            return Err("custom open command is not allowlisted".into());
        }
        let mut launcher = Command::new(command);
        crate::platform::windows_child::hide_console(&mut launcher);
        let status = launcher
            .arg(trimmed_path)
            .status()
            .map_err(|error| format!("Failed to launch `{command}`: {error}"))?;
        if !status.success() {
            return Err(format!("`{command}` exited with status {status}"));
        }
        return Ok(());
    }

    if let Some(app_name) = app_name
        .map(str::trim)
        .filter(|app_name| !app_name.is_empty())
    {
        #[cfg(target_os = "macos")]
        let status = Command::new("open")
            .arg("-a")
            .arg(app_name)
            .arg(trimmed_path)
            .status();
        #[cfg(not(target_os = "macos"))]
        let status = {
            let mut launcher = Command::new(app_name);
            crate::platform::windows_child::hide_console(&mut launcher);
            launcher.arg(trimmed_path).status()
        };

        let status = status.map_err(|error| format!("Failed to open `{app_name}`: {error}"))?;
        if !status.success() {
            return Err(format!("`{app_name}` failed to open (status {status})"));
        }
        return Ok(());
    }

    open_path(trimmed_path)
}

/// Open a directory, or select a file, in the OS file manager.
pub fn reveal_path(path: &str) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("path is required".into());
    }
    let (program, args) = file_manager_command(trimmed, Path::new(trimmed).is_dir());
    launch_file_manager(program, &args)
}

/// Directory targets open that folder. File targets select the item.
pub(crate) fn file_manager_command(path: &str, is_dir: bool) -> (&'static str, Vec<String>) {
    let path = strip_verbatim_prefix(path.trim());
    if is_dir {
        open_path_command(&path)
    } else {
        reveal_path_command(&path)
    }
}

pub(crate) fn reveal_path_command(path: &str) -> (&'static str, Vec<String>) {
    #[cfg(target_os = "windows")]
    {
        ("explorer", vec![format!("/select,{path}")])
    }
    #[cfg(target_os = "macos")]
    {
        ("open", vec!["-R".into(), path.to_string()])
    }
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        let as_path = Path::new(path);
        // A missing path is not a directory. Reveal still opens the parent so
        // the file manager is not given the same argv as Open.
        let target = if as_path.is_dir() {
            path.to_string()
        } else {
            as_path
                .parent()
                .filter(|parent| !parent.as_os_str().is_empty())
                .map(|parent| parent.to_string_lossy().into_owned())
                .unwrap_or_else(|| path.to_string())
        };
        ("xdg-open", vec![target])
    }
}

fn open_path_command(path: &str) -> (&'static str, Vec<String>) {
    #[cfg(target_os = "macos")]
    {
        ("open", vec![path.to_string()])
    }
    #[cfg(target_os = "windows")]
    {
        ("explorer", vec![path.to_string()])
    }
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        ("xdg-open", vec![path.to_string()])
    }
}

fn open_path(path: &str) -> Result<(), String> {
    let path = strip_verbatim_prefix(path.trim());
    let (program, args) = open_path_command(&path);
    launch_file_manager(program, &args)
}

fn launch_file_manager(program: &str, args: &[String]) -> Result<(), String> {
    let mut command = Command::new(program);
    #[cfg(target_os = "windows")]
    crate::platform::windows_child::hide_console(&mut command);
    command.args(args);
    // explorer.exe hands the window to the running shell and then exits 1.
    // Waiting on that status reports a failure after the folder has opened.
    if program.eq_ignore_ascii_case("explorer") {
        return command
            .spawn()
            .map(drop)
            .map_err(|error| format!("Failed to reveal path: {error}"));
    }
    let status = command
        .status()
        .map_err(|error| format!("Failed to reveal path: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("File manager exited with status {status}"))
    }
}

/// Open a URL in the user's default browser via the OS opener. Blocking.
pub fn open_external(url: &str) -> Result<(), String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("Missing URL".to_string());
    }

    #[cfg(target_os = "macos")]
    let status = Command::new("open").arg(trimmed).status();
    #[cfg(target_os = "windows")]
    let status = {
        let mut command = Command::new("cmd");
        crate::platform::windows_child::hide_console(&mut command);
        command.args(["/C", "start", "", trimmed]).status()
    };
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let status = Command::new("xdg-open").arg(trimmed).status();

    match status.map_err(|error| format!("Failed to open URL: {error}"))? {
        code if code.success() => Ok(()),
        code => Err(format!("Opener exited with status {code}")),
    }
}

pub(crate) fn strip_verbatim_prefix(path: &str) -> String {
    if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{}", rest)
    } else if let Some(rest) = path.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        path.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::{file_manager_command, strip_verbatim_prefix};

    // Windows `std::fs::canonicalize` returns `\\?\`-prefixed extended-length
    // paths. Bun (the embedded pi runtime) cannot resolve modules from such
    // paths, so the prefix must be stripped before any canonicalized path
    // reaches pi — as cwd, session path, binary, or extension argument.
    #[test]
    fn strip_verbatim_prefix_removes_extended_length_prefix() {
        // Drive-prefixed extended-length path: strip the `\\?\` prefix,
        // keep the drive letter.
        assert_eq!(
            strip_verbatim_prefix(r"\\?\C:\Users\WIN10\.pi\agent"),
            r"C:\Users\WIN10\.pi\agent"
        );
        // UNC extended-length path: collapse `\\?\UNC\` to the plain `\\`
        // UNC form.
        assert_eq!(
            strip_verbatim_prefix(r"\\?\UNC\server\share\dir"),
            r"\\server\share\dir"
        );
        // Plain Windows path: returned unchanged.
        assert_eq!(strip_verbatim_prefix(r"C:\Users\WIN10"), r"C:\Users\WIN10");
        // Plain POSIX path: returned unchanged (no prefix to strip).
        assert_eq!(
            strip_verbatim_prefix("/home/user/.pi/agent"),
            "/home/user/.pi/agent"
        );
        // Empty string is a valid no-op input.
        assert_eq!(strip_verbatim_prefix(""), "");
    }

    #[test]
    fn open_in_app_rejects_non_allowlisted_command() {
        let err = super::open_in_app(".", None, Some("calc.exe")).unwrap_err();
        assert!(err.contains("allowlisted"), "{err}");
    }

    #[test]
    fn reveal_path_command_is_distinct_from_open() {
        let (program, args) = super::reveal_path_command("/tmp/example.txt");
        assert_ne!(args, vec!["/tmp/example.txt".to_string()]);
        #[cfg(target_os = "windows")]
        {
            assert_eq!(program, "explorer");
            assert_eq!(args, vec!["/select,/tmp/example.txt".to_string()]);
        }
        #[cfg(target_os = "macos")]
        {
            assert_eq!(program, "open");
            assert_eq!(args, vec!["-R".to_string(), "/tmp/example.txt".to_string()]);
        }
        #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
        {
            assert_eq!(program, "xdg-open");
        }
    }

    #[test]
    fn file_manager_opens_a_directory_and_strips_the_verbatim_prefix() {
        let (program, args) = file_manager_command(r"\\?\C:\work\triff", true);
        #[cfg(target_os = "windows")]
        {
            assert_eq!(program, "explorer");
            assert_eq!(args, vec![r"C:\work\triff".to_string()]);
        }
        #[cfg(not(target_os = "windows"))]
        {
            assert!(!args.iter().any(|arg| arg.contains(r"\\?\")));
            let _ = program;
        }
    }

    #[test]
    fn file_manager_selects_a_file_without_the_verbatim_prefix() {
        let (program, args) = file_manager_command(r"\\?\C:\work\triff\update_nfo.py", false);
        #[cfg(target_os = "windows")]
        {
            assert_eq!(program, "explorer");
            assert_eq!(
                args,
                vec![r"/select,C:\work\triff\update_nfo.py".to_string()]
            );
        }
        #[cfg(not(target_os = "windows"))]
        {
            assert!(!args.iter().any(|arg| arg.contains(r"\\?\")));
            let _ = program;
        }
    }
}
