// ABOUTME: Opens paths and URLs with the OS file manager and the default browser.
// ABOUTME: Pi launch does not call the shell.

use std::path::Path;
use std::process::Command;

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

/// Open a file or folder with the desktop's default app. Blocking.
pub fn open_path(path: &str) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("Missing path".to_string());
    }
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

/// Links in chat come from the model, so only web and mail schemes may reach
/// the OS opener. `file:`, `ms-*:` and custom protocol handlers can launch
/// programs.
const EXTERNAL_SCHEMES: [&str; 3] = ["http", "https", "mailto"];

/// Parse and normalize a URL the user asked to open. The result is
/// percent-encoded, so it carries no spaces, quotes or control characters.
pub(crate) fn checked_external_url(url: &str) -> Result<String, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("Missing URL".to_string());
    }
    let parsed = tauri::Url::parse(trimmed).map_err(|error| format!("Invalid URL: {error}"))?;
    let scheme = parsed.scheme();
    if !EXTERNAL_SCHEMES.contains(&scheme) {
        return Err(format!("Refusing to open a {scheme}: link"));
    }
    if scheme != "mailto" && parsed.host_str().is_none_or(str::is_empty) {
        return Err("URL has no host".to_string());
    }
    Ok(parsed.into())
}

/// Open a URL in the user's default browser via the OS opener. Blocking.
pub fn open_external(url: &str) -> Result<(), String> {
    let url = checked_external_url(url)?;

    #[cfg(target_os = "windows")]
    {
        shell_execute_open(&url)
    }
    #[cfg(not(target_os = "windows"))]
    {
        #[cfg(target_os = "macos")]
        let status = Command::new("open").arg(&url).status();
        #[cfg(not(target_os = "macos"))]
        let status = Command::new("xdg-open").arg(&url).status();
        match status.map_err(|error| format!("Failed to open URL: {error}"))? {
            code if code.success() => Ok(()),
            code => Err(format!("Opener exited with status {code}")),
        }
    }
}

/// ShellExecuteW hands the URL to its registered handler without a command
/// interpreter, so `&`, `|` and `^` stay part of the URL.
#[cfg(target_os = "windows")]
fn shell_execute_open(url: &str) -> Result<(), String> {
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let wide = |text: &str| text.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
    let verb = wide("open");
    let file = wide(url);
    // SAFETY: both strings are NUL-terminated UTF-16 buffers that outlive the call.
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            verb.as_ptr(),
            file.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    // Values above 32 mean success; lower values are SE_ERR_* codes.
    let code = result as isize;
    if code > 32 {
        Ok(())
    } else {
        Err(format!("Failed to open URL (ShellExecute error {code})"))
    }
}

pub(crate) use crate::data::paths::strip_verbatim_prefix;

#[cfg(test)]
mod tests {
    use super::{checked_external_url, file_manager_command, strip_verbatim_prefix};

    #[test]
    fn external_url_accepts_web_and_mail_links() {
        assert_eq!(
            checked_external_url(" https://example.com/a?b=1 ").unwrap(),
            "https://example.com/a?b=1"
        );
        assert!(checked_external_url("http://127.0.0.1:8000/v1").is_ok());
        assert!(checked_external_url("mailto:someone@example.com").is_ok());
    }

    #[test]
    fn external_url_keeps_shell_metacharacters_inside_the_url() {
        let url = checked_external_url("https://example.com/?a=1&calc.exe|x^y").unwrap();
        assert!(url.starts_with("https://example.com/?"));
        assert!(!url.contains(' '));
        let spaced = checked_external_url("https://example.com/a b\"&calc").unwrap();
        assert!(!spaced.contains(' ') && !spaced.contains('"'));
    }

    #[test]
    fn external_url_refuses_program_launching_schemes() {
        for url in [
            "file:///C:/Windows/System32/calc.exe",
            "ms-settings:privacy",
            "ms-msdt:/id",
            "javascript:alert(1)",
            "vscode://file/c:/x",
            "calc.exe",
            "C:\\Windows\\System32\\calc.exe",
            "https://",
            "",
        ] {
            assert!(
                checked_external_url(url).is_err(),
                "{url} should be refused"
            );
        }
    }

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
    fn open_path_needs_a_path() {
        assert!(super::open_path("  ").is_err());
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
