// ABOUTME: Exercises shell profile listing and Windows shell resolution.
// ABOUTME: The module under test is terminal::profiles.

use super::*;

/// Probe that treats an allow-list of paths as valid executables.
struct FakeProbe {
    valid: Vec<PathBuf>,
    git_root: Option<PathBuf>,
}

impl ShellProbe for FakeProbe {
    fn is_valid_executable(&self, path: &Path) -> bool {
        self.valid.iter().any(|p| p == path)
    }
    fn discover_git_bash_root(&self) -> Option<PathBuf> {
        self.git_root.clone()
    }
}

fn fake_fs(valid: &[&str]) -> FakeProbe {
    FakeProbe {
        valid: valid.iter().map(PathBuf::from).collect(),
        git_root: None,
    }
}

#[test]
fn invalid_macos_shell_falls_back_to_zsh() {
    let probe = fake_fs(&["/bin/zsh"]);
    let profile = resolve_macos_default("/not/executable", &probe).unwrap();
    assert_eq!(profile.program, PathBuf::from("/bin/zsh"));
    assert_eq!(profile.args, vec!["-i".to_string()]);
}

#[test]
fn valid_preferred_macos_shell_is_used() {
    let probe = fake_fs(&["/usr/local/bin/fish"]);
    let profile = resolve_macos_default("/usr/local/bin/fish", &probe).unwrap();
    assert_eq!(profile.program, PathBuf::from("/usr/local/bin/fish"));
}

#[test]
fn macos_falls_back_to_bash_when_zsh_missing() {
    let probe = fake_fs(&["/bin/bash"]);
    let profile = resolve_macos_default("/nope", &probe).unwrap();
    assert_eq!(profile.program, PathBuf::from("/bin/bash"));
}

#[test]
fn macos_with_no_shell_errors_visibly() {
    let probe = fake_fs(&[]);
    let err = resolve_macos_default("/nope", &probe).unwrap_err();
    assert!(matches!(
        err,
        ProfileError::ProfileUnavailable {
            profile: ShellProfileId::Default,
            ..
        }
    ));
}

#[test]
fn windows_git_bash_missing_is_visible_not_silent_powershell() {
    let probe = fake_fs(&[]);
    let err = resolve_windows_profile(ShellProfileId::GitBash, &probe).unwrap_err();
    assert!(matches!(
        err,
        ProfileError::ProfileUnavailable {
            profile: ShellProfileId::GitBash,
            ..
        }
    ));
    // Guidance mentions Git for Windows, not a silent PowerShell switch.
    match err {
        ProfileError::ProfileUnavailable { guidance, .. } => {
            assert!(guidance.contains("Git for Windows"));
        }
    }
}

#[test]
fn windows_default_falls_back_to_powershell_when_git_bash_missing() {
    let probe = fake_fs(&[r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"]);
    let shell = resolve_windows_profile(ShellProfileId::Default, &probe).unwrap();
    assert_eq!(
        shell.program,
        PathBuf::from(r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe")
    );
    assert_eq!(shell.args, vec!["-NoLogo".to_string()]);
}

#[test]
fn windows_default_falls_back_to_cmd_when_git_and_powershell_missing() {
    let probe = fake_fs(&[r"C:\Windows\System32\cmd.exe"]);
    let shell = resolve_windows_profile(ShellProfileId::Default, &probe).unwrap();
    assert_eq!(shell.program, PathBuf::from(r"C:\Windows\System32\cmd.exe"));
    assert!(shell.args.is_empty());
}

#[test]
fn windows_default_with_no_shell_errors_visibly() {
    let probe = fake_fs(&[]);
    let err = resolve_windows_profile(ShellProfileId::Default, &probe).unwrap_err();
    match err {
        ProfileError::ProfileUnavailable { profile, guidance } => {
            assert_eq!(profile, ShellProfileId::Default);
            assert!(guidance.contains("PowerShell"));
        }
    }
}

#[test]
fn git_path_entry_maps_cmd_and_bin_to_install_root() {
    assert_eq!(
        git_install_root_from_path_entry(Path::new(r"C:\Program Files\Git\cmd")),
        Some(PathBuf::from(r"C:\Program Files\Git"))
    );
    assert_eq!(
        git_install_root_from_path_entry(Path::new(r"C:\Program Files\Git\bin")),
        Some(PathBuf::from(r"C:\Program Files\Git"))
    );
    assert_eq!(
        git_install_root_from_path_entry(Path::new(r"C:\Windows\System32")),
        None
    );
}

#[test]
fn git_bash_conpty_env_is_set_only_for_bash_exe() {
    assert_eq!(
        windows_shell_env(Path::new(r"C:\Program Files\Git\bin\bash.exe")),
        vec![("CHERE_INVOKING", "1"), ("MSYS", "enable_pcon")]
    );
    assert!(windows_shell_env(Path::new(
        r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
    ))
    .is_empty());
}

#[test]
fn default_git_bash_spawn_failure_falls_back_to_powershell() {
    let probe = fake_fs(&[r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"]);
    let failed = ResolvedShell {
        program: PathBuf::from(r"C:\Program Files\Git\bin\bash.exe"),
        args: vec!["--login".to_string(), "-i".to_string()],
    };
    let fallback = fallback_windows_shell_after_spawn_failure("default", &failed, &probe).unwrap();
    assert_eq!(
        fallback.program,
        PathBuf::from(r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe")
    );
    assert!(fallback_windows_shell_after_spawn_failure("git-bash", &failed, &probe).is_none());
}

#[test]
fn windows_git_bash_present_launches_bin_bash_login_i() {
    let probe = FakeProbe {
        valid: vec![PathBuf::from("C:\\Program Files\\Git\\bin\\bash.exe")],
        git_root: Some(PathBuf::from("C:\\Program Files\\Git")),
    };
    let shell = resolve_windows_profile(ShellProfileId::Default, &probe).unwrap();
    let expected_program = PathBuf::from("C:\\Program Files\\Git")
        .join("bin")
        .join("bash.exe");
    assert_eq!(shell.program, expected_program);
    assert_eq!(shell.args, vec!["--login".to_string(), "-i".to_string()]);
}

#[test]
fn command_prompt_label_is_short_cmd() {
    assert_eq!(ShellProfileId::CommandPrompt.label(), "CMD");
}

#[test]
fn pty_working_dir_strips_windows_verbatim_prefix() {
    assert_eq!(
        pty_working_dir(Path::new(r"\\?\C:\Users\me\AppData\Local\Temp\spopi-repo")),
        PathBuf::from(r"C:\Users\me\AppData\Local\Temp\spopi-repo")
    );
    assert_eq!(
        pty_working_dir(Path::new(r"\\?\UNC\server\share\repo")),
        PathBuf::from(r"\\server\share\repo")
    );
    assert_eq!(
        pty_working_dir(Path::new(r"C:\Users\me\repo")),
        PathBuf::from(r"C:\Users\me\repo")
    );
    assert_eq!(
        pty_working_dir(Path::new("/home/me/repo")),
        PathBuf::from("/home/me/repo")
    );
}

#[test]
fn profile_id_round_trips_through_wire_strings() {
    for id in [
        ShellProfileId::Default,
        ShellProfileId::GitBash,
        ShellProfileId::PowerShell,
        ShellProfileId::CommandPrompt,
    ] {
        assert_eq!(
            ShellProfileId::from_id_str(id.as_id_str()),
            Some(id),
            "round trip for {:?}",
            id
        );
    }
    assert_eq!(ShellProfileId::from_id_str("nonsense"), None);
}

#[cfg(windows)]
#[test]
fn listed_profiles_are_real_shells_without_a_default_row() {
    let probe = FakeProbe {
        valid: vec![PathBuf::from(
            r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe",
        )],
        git_root: None,
    };
    let listed = list_shell_profiles(&probe, "");
    assert_eq!(listed.len(), 3);
    assert!(listed.iter().all(|profile| profile.id != "default"));
    assert!(listed
        .iter()
        .any(|profile| profile.id == "powershell" && profile.available));
    assert!(listed
        .iter()
        .any(|profile| profile.id == "git-bash" && !profile.available));
}

#[cfg(unix)]
#[test]
fn listed_profiles_name_the_system_shell() {
    let probe = fake_fs(&["/bin/zsh"]);
    let listed = list_shell_profiles(&probe, "/bin/zsh");
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, "default");
    assert_eq!(listed[0].label, "zsh");
    assert!(listed[0].available);
}
