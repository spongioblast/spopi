// ABOUTME: Launch-spec tests, including the SPOPI_PERF timing flag.
// ABOUTME: Kept out of launch.rs so that file stays under its line cap.

use super::NativeLaunchSpec;
use std::path::PathBuf;

#[test]
fn launch_spec_has_no_tcp_port_and_resumes_only_at_process_start() {
    let spec = NativeLaunchSpec {
        binary: PathBuf::from("/embedded/pi"),
        cwd: PathBuf::from("/workspace"),
        session_path: Some(PathBuf::from("/sessions/a.jsonl")),
        extensions: vec![PathBuf::from("/extensions/spopi-bridge.mjs")],
        pi_version: env!("SPOPI_PI_VERSION_BUNDLED").into(),
        path_env: "/usr/bin".into(),
        approve: false,
    };
    let launch = spec.command_description();
    assert_eq!(launch.program, PathBuf::from("/embedded/pi"));
    assert!(launch.args.windows(2).any(|pair| pair == ["--mode", "rpc"]));
    assert!(launch
        .args
        .windows(2)
        .any(|pair| pair == ["--session", "/sessions/a.jsonl"]));
    assert!(!launch.environment.contains_key("SPOPI_HOST_PORT"));
    assert_eq!(
        launch
            .environment
            .get("PI_SKIP_VERSION_CHECK")
            .map(String::as_str),
        Some("1")
    );
    assert!(!launch
        .args
        .iter()
        .any(|argument| argument.parse::<u16>().is_ok()));
}

#[test]
fn approve_flag_appends_dash_dash_approve_arg() {
    let spec = NativeLaunchSpec {
        binary: PathBuf::from("/embedded/pi"),
        cwd: PathBuf::from("/workspace"),
        session_path: None,
        extensions: vec![],
        pi_version: env!("SPOPI_PI_VERSION_BUNDLED").into(),
        path_env: "/usr/bin".into(),
        approve: true,
    };
    assert!(spec
        .command_description()
        .args
        .contains(&"--approve".to_string()));
}

#[test]
fn coding_agent_dir_reaches_the_pi_process() {
    let spec = NativeLaunchSpec {
        binary: PathBuf::from("/embedded/pi"),
        cwd: PathBuf::from("/workspace"),
        session_path: None,
        extensions: vec![],
        pi_version: env!("SPOPI_PI_VERSION_BUNDLED").into(),
        path_env: "/usr/bin".into(),
        approve: false,
    };
    let previous = std::env::var("PI_CODING_AGENT_DIR").ok();
    std::env::set_var("PI_CODING_AGENT_DIR", "D:/scratch/pi-agent");
    let launch = spec.command_description();
    match previous {
        Some(value) => std::env::set_var("PI_CODING_AGENT_DIR", value),
        None => std::env::remove_var("PI_CODING_AGENT_DIR"),
    }
    assert_eq!(
        launch
            .environment
            .get("PI_CODING_AGENT_DIR")
            .map(String::as_str),
        Some("D:/scratch/pi-agent")
    );
}

#[test]
fn perf_mode_forwards_pi_timing() {
    let spec = NativeLaunchSpec {
        binary: PathBuf::from("/embedded/pi"),
        cwd: PathBuf::from("/workspace"),
        session_path: None,
        extensions: vec![],
        pi_version: env!("SPOPI_PI_VERSION_BUNDLED").into(),
        path_env: "/usr/bin".into(),
        approve: false,
    };
    let off = spec.command_description();
    if std::env::var("SPOPI_PERF").ok().as_deref() != Some("1") {
        assert!(!off.environment.contains_key("PI_TIMING"));
    }
    std::env::set_var("SPOPI_PERF", "1");
    let on = spec.command_description();
    std::env::remove_var("SPOPI_PERF");
    assert_eq!(
        on.environment.get("PI_TIMING").map(String::as_str),
        Some("1")
    );
}
