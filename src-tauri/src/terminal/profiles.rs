// ABOUTME: Resolves fixed, server-defined shell profiles into an executable and
// ABOUTME: argument array. macOS uses the user's shell with a safe system-shell
// ABOUTME: fallback; Windows prefers Git Bash, then PowerShell, then cmd.exe.

use std::path::{Path, PathBuf};

use serde::Serialize;

/// Server-defined shell profile identifiers. The WebView may only name one of
/// these; there is no arbitrary-executable profile, so user text is never
/// interpolated into a command line.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ShellProfileId {
    Default,
    GitBash,
    PowerShell,
    CommandPrompt,
}

impl ShellProfileId {
    /// Stable wire identifier persisted in terminal-state.json and carried in
    /// the broker protocol.
    pub fn as_id_str(&self) -> &'static str {
        match self {
            ShellProfileId::Default => "default",
            ShellProfileId::GitBash => "git-bash",
            ShellProfileId::PowerShell => "powershell",
            ShellProfileId::CommandPrompt => "command-prompt",
        }
    }

    pub fn from_id_str(s: &str) -> Option<ShellProfileId> {
        Some(match s {
            "default" => ShellProfileId::Default,
            "git-bash" => ShellProfileId::GitBash,
            "powershell" => ShellProfileId::PowerShell,
            "command-prompt" => ShellProfileId::CommandPrompt,
            _ => return None,
        })
    }

    pub fn label(self) -> &'static str {
        match self {
            ShellProfileId::Default => "Default",
            ShellProfileId::GitBash => "Git Bash",
            ShellProfileId::PowerShell => "PowerShell",
            ShellProfileId::CommandPrompt => "CMD",
        }
    }
}

/// Probe result for the WebView profile picker and Settings → Default shell.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListedShellProfile {
    pub id: String,
    pub label: String,
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub guidance: Option<String>,
}

/// Probe the real shells. `default` is not a shell: on Windows the list is
/// Git Bash, PowerShell, and CMD. On Unix, where those are unavailable, the
/// list is the one system shell (`default`) labeled with its program name.
pub fn list_shell_profiles(
    probe: &dyn ShellProbe,
    preferred_shell: &str,
) -> Vec<ListedShellProfile> {
    let concrete: Vec<ListedShellProfile> = [
        ShellProfileId::GitBash,
        ShellProfileId::PowerShell,
        ShellProfileId::CommandPrompt,
    ]
    .into_iter()
    .map(|id| listed_profile(id, id.label(), probe, preferred_shell))
    .collect();
    if concrete.iter().any(|profile| profile.available) {
        return concrete;
    }
    vec![listed_system_shell(probe, preferred_shell)]
}

fn listed_profile(
    id: ShellProfileId,
    label: &str,
    probe: &dyn ShellProbe,
    preferred_shell: &str,
) -> ListedShellProfile {
    match resolve_listed_profile(id, probe, preferred_shell) {
        Ok(()) => ListedShellProfile {
            id: id.as_id_str().to_string(),
            label: label.to_string(),
            available: true,
            guidance: None,
        },
        Err(ProfileError::ProfileUnavailable { guidance, .. }) => ListedShellProfile {
            id: id.as_id_str().to_string(),
            label: label.to_string(),
            available: false,
            guidance: Some(guidance),
        },
    }
}

fn listed_system_shell(probe: &dyn ShellProbe, preferred_shell: &str) -> ListedShellProfile {
    let resolved = if cfg!(windows) {
        resolve_windows_profile(ShellProfileId::Default, probe).ok()
    } else {
        resolve_macos_default(preferred_shell, probe).ok()
    };
    match resolved {
        Some(shell) => ListedShellProfile {
            id: ShellProfileId::Default.as_id_str().to_string(),
            label: shell_file_label(&shell.program),
            available: true,
            guidance: None,
        },
        None => ListedShellProfile {
            id: ShellProfileId::Default.as_id_str().to_string(),
            label: "bash".to_string(),
            available: false,
            guidance: Some("No usable interactive shell was found.".to_string()),
        },
    }
}

fn shell_file_label(program: &Path) -> String {
    let name = path_file_name(program).unwrap_or("bash");
    name.strip_suffix(".exe").unwrap_or(name).to_string()
}

fn resolve_listed_profile(
    profile: ShellProfileId,
    probe: &dyn ShellProbe,
    preferred_shell: &str,
) -> Result<(), ProfileError> {
    if cfg!(windows) {
        resolve_windows_profile(profile, probe).map(|_| ())
    } else if profile == ShellProfileId::Default {
        resolve_macos_default(preferred_shell, probe).map(|_| ())
    } else {
        Err(ProfileError::ProfileUnavailable {
            profile,
            guidance: "This shell profile is only available on Windows.".to_string(),
        })
    }
}

/// A resolved shell: an executable plus a fixed argument array. Never a
/// shell-concatenated command string.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResolvedShell {
    pub program: PathBuf,
    pub args: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProfileError {
    /// The requested profile is not available on this host. `guidance` is safe
    /// to show the user (e.g. Git for Windows installation instructions).
    ProfileUnavailable {
        profile: ShellProfileId,
        guidance: String,
    },
}

/// Abstracts filesystem probes so profile resolution is unit-testable without a
/// real shell installation and without coupling to a specific host layout.
pub trait ShellProbe: Send + Sync {
    /// True when `path` exists, is a regular file, and is executable for the
    /// current process.
    fn is_valid_executable(&self, path: &Path) -> bool;

    /// Windows Git Bash discovery hook. Returns the Git for Windows
    /// installation root (the directory containing `bin/bash.exe`) when
    /// discoverable, or `None`. The default implementation probes standard
    /// install paths plus PATH entries that look like `Git\cmd` / `Git\bin`.
    fn discover_git_bash_root(&self) -> Option<PathBuf> {
        None
    }
}

/// Production filesystem probe backed by `std::fs`.
pub struct SystemShellProbe;

impl ShellProbe for SystemShellProbe {
    fn is_valid_executable(&self, path: &Path) -> bool {
        is_executable_real(path)
    }

    fn discover_git_bash_root(&self) -> Option<PathBuf> {
        standard_git_bash_roots()
            .into_iter()
            .find(|root| is_executable_real(&git_bash_executable(root)))
    }
}

#[cfg(unix)]
fn is_executable_real(path: &Path) -> bool {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    let metadata = match fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return false,
    };
    if !metadata.is_file() {
        return false;
    }
    metadata.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn is_executable_real(path: &Path) -> bool {
    use std::fs;
    fs::metadata(path).map(|m| m.is_file()).unwrap_or(false)
}

/// Standard Git for Windows installation roots, probed in order. PATH entries
/// that point at `Git\cmd` or `Git\bin` are appended so Scoop/portable installs
/// still resolve. `C:\Windows\System32\bash.exe` (the WSL stub) is never a
/// Git-for-Windows root because its parent is not `cmd`/`bin`.
fn standard_git_bash_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(prog_files) = std::env::var_os("ProgramFiles") {
        roots.push(PathBuf::from(&prog_files).join("Git"));
    }
    if let Some(prog_files_x86) = std::env::var_os("ProgramFiles(x86)") {
        roots.push(PathBuf::from(&prog_files_x86).join("Git"));
    }
    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        roots.push(PathBuf::from(&local_app_data).join("Programs").join("Git"));
    }
    if let Some(home) = dirs::home_dir() {
        roots.push(home.join("scoop").join("apps").join("git").join("current"));
    }
    roots.push(PathBuf::from(r"C:\Git"));
    roots.extend(git_bash_roots_on_path());
    roots
}

fn git_bash_roots_on_path() -> Vec<PathBuf> {
    let Some(path) = std::env::var_os("PATH") else {
        return Vec::new();
    };
    std::env::split_paths(&path)
        .filter_map(|dir| git_install_root_from_path_entry(&dir))
        .collect()
}

/// Map a PATH directory to a Git for Windows root when it looks like
/// `<root>\cmd` or `<root>\bin`. Returns `None` for unrelated dirs (including
/// `C:\Windows\System32`, so WSL's `bash.exe` stub is never treated as Git Bash).
fn git_install_root_from_path_entry(dir: &Path) -> Option<PathBuf> {
    let name = path_file_name(dir)?;
    if !name.eq_ignore_ascii_case("cmd") && !name.eq_ignore_ascii_case("bin") {
        return None;
    }
    path_parent(dir)
}

fn git_bash_executable(root: &Path) -> PathBuf {
    root.join("bin").join("bash.exe")
}

/// File name that understands both POSIX and Windows separators so profile
/// helpers stay testable on a Unix host with `C:\...` fixtures.
fn path_file_name(path: &Path) -> Option<&str> {
    let raw = path.file_name().and_then(|name| name.to_str())?;
    raw.rsplit(['/', '\\'])
        .next()
        .filter(|name| !name.is_empty())
}

fn path_parent(path: &Path) -> Option<PathBuf> {
    let raw = path.to_str()?;
    let trimmed = raw.trim_end_matches(['/', '\\']);
    let idx = trimmed.rfind(['/', '\\'])?;
    Some(PathBuf::from(&trimmed[..idx]))
}

/// Resolve the default Unix shell: the user's preferred `$SHELL` when it is
/// a valid executable, otherwise `/bin/zsh`, otherwise `/bin/bash`. macOS and
/// Linux both use this. The shell starts interactively; no user text is interpolated.
pub fn resolve_macos_default(
    preferred_shell: &str,
    probe: &dyn ShellProbe,
) -> Result<ResolvedShell, ProfileError> {
    let candidates = [
        PathBuf::from(preferred_shell),
        PathBuf::from("/bin/zsh"),
        PathBuf::from("/bin/bash"),
    ];
    for program in candidates {
        if probe.is_valid_executable(&program) {
            return Ok(interactive_posix_shell(program));
        }
    }
    Err(ProfileError::ProfileUnavailable {
        profile: ShellProfileId::Default,
        guidance: "No usable interactive shell was found.".to_string(),
    })
}

fn interactive_posix_shell(program: PathBuf) -> ResolvedShell {
    ResolvedShell {
        program,
        args: vec!["-i".to_string()],
    }
}

/// Resolve a Windows shell profile. Git Bash launches `bin/bash.exe --login -i`
/// (never `git-bash.exe`, which opens a separate MinTTY window).
///
/// `Default` prefers Git Bash when it is discoverable, then PowerShell, then
/// Command Prompt, so the first new-tab action opens a shell on machines that
/// never installed Git for Windows. The explicit `git-bash` profile still fails
/// visibly when Git Bash is missing — it does not substitute PowerShell.
pub fn resolve_windows_profile(
    profile: ShellProfileId,
    probe: &dyn ShellProbe,
) -> Result<ResolvedShell, ProfileError> {
    match profile {
        ShellProfileId::Default => resolve_windows_default(probe),
        ShellProfileId::GitBash => resolve_git_bash(probe),
        ShellProfileId::PowerShell => resolve_powershell(probe),
        ShellProfileId::CommandPrompt => resolve_command_prompt(probe),
    }
}

fn resolve_windows_default(probe: &dyn ShellProbe) -> Result<ResolvedShell, ProfileError> {
    if let Ok(shell) = resolve_git_bash(probe) {
        return Ok(shell);
    }
    if let Ok(shell) = resolve_powershell(probe) {
        return Ok(shell);
    }
    if let Ok(shell) = resolve_command_prompt(probe) {
        return Ok(shell);
    }
    Err(ProfileError::ProfileUnavailable {
        profile: ShellProfileId::Default,
        guidance: "No usable Windows shell was found (Git Bash, PowerShell, or Command Prompt)."
            .to_string(),
    })
}

fn resolve_git_bash(probe: &dyn ShellProbe) -> Result<ResolvedShell, ProfileError> {
    let root = probe
        .discover_git_bash_root()
        .ok_or_else(|| ProfileError::ProfileUnavailable {
            profile: ShellProfileId::GitBash,
            guidance: "Git for Windows was not found. Install Git for Windows \
                       (https://git-scm.com/download/win) to use Git Bash, \
                       or choose PowerShell / Command Prompt."
                .to_string(),
        })?;
    Ok(ResolvedShell {
        program: git_bash_executable(&root),
        args: vec!["--login".to_string(), "-i".to_string()],
    })
}

fn resolve_powershell(probe: &dyn ShellProbe) -> Result<ResolvedShell, ProfileError> {
    let candidates = [
        PathBuf::from("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"),
        PathBuf::from("C:\\Program Files\\PowerShell\\7\\pwsh.exe"),
    ];
    for program in candidates {
        if probe.is_valid_executable(&program) {
            return Ok(ResolvedShell {
                program,
                args: vec!["-NoLogo".to_string()],
            });
        }
    }
    Err(ProfileError::ProfileUnavailable {
        profile: ShellProfileId::PowerShell,
        guidance: "PowerShell was not found on this system.".to_string(),
    })
}

fn resolve_command_prompt(probe: &dyn ShellProbe) -> Result<ResolvedShell, ProfileError> {
    let program = PathBuf::from("C:\\Windows\\System32\\cmd.exe");
    if probe.is_valid_executable(&program) {
        return Ok(ResolvedShell {
            program,
            args: Vec::new(),
        });
    }
    Err(ProfileError::ProfileUnavailable {
        profile: ShellProfileId::CommandPrompt,
        guidance: "Command Prompt was not found on this system.".to_string(),
    })
}

/// Windows `canonicalize` yields `\\?\C:\...`. cmd.exe treats that as a UNC
/// path and refuses it (`UNC paths are not supported. Defaulting to Windows
/// directory.`). Strip the prefix so every profile starts in the workspace.
pub fn pty_working_dir(workspace_root: &Path) -> PathBuf {
    PathBuf::from(crate::data::paths::strip_verbatim_prefix(
        &workspace_root.to_string_lossy(),
    ))
}

/// Extra env for a resolved Windows shell. Git Bash inside ConPTY needs
/// `MSYS=enable_pcon` (use the host PTY instead of mintty) and
/// `CHERE_INVOKING=1` (stay in `cwd` across `--login` instead of jumping $HOME).
pub fn windows_shell_env(program: &Path) -> Vec<(&'static str, &'static str)> {
    if is_windows_bash(program) {
        vec![("CHERE_INVOKING", "1"), ("MSYS", "enable_pcon")]
    } else {
        Vec::new()
    }
}

pub fn is_windows_bash(program: &Path) -> bool {
    path_file_name(program).is_some_and(|name| name.eq_ignore_ascii_case("bash.exe"))
}

/// When the Windows `default` profile resolved to Git Bash but the PTY spawn
/// failed, try PowerShell then Command Prompt so the panel can still open.
pub fn fallback_windows_shell_after_spawn_failure(
    profile_id: &str,
    failed: &ResolvedShell,
    probe: &dyn ShellProbe,
) -> Option<ResolvedShell> {
    if profile_id != "default" || !is_windows_bash(&failed.program) {
        return None;
    }
    resolve_powershell(probe)
        .ok()
        .or_else(|| resolve_command_prompt(probe).ok())
}

#[cfg(test)]
#[path = "profile_tests.rs"]
mod tests;
