// ABOUTME: Tests git parsing and the service against temporary repositories.
// ABOUTME: The tests create their own git history.
// ABOUTME: Unit tests moved out of the facade.
use super::*;
use std::process::Command;
#[test]
fn parses_paths_and_renames() {
    let p = parse_porcelain_v2_z(
            b"# branch.oid abc\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +2 -1\x002 R. N... 100644 100644 100644 a a R100 new\0old\0? - weird\npath\0",
        );
    assert_eq!(p.entries.len(), 2);
    assert_eq!(p.entries[0].original_display_path.as_deref(), Some("old"));
    assert_eq!(p.head_state, "attached");
    assert_eq!(p.branch.as_deref(), Some("main"));
    assert_eq!(p.upstream.as_deref(), Some("origin/main"));
    assert_eq!(p.ahead, Some(2));
    assert_eq!(p.behind, Some(1));
}
#[test]
fn parses_unborn_branch() {
    let p = parse_porcelain_v2_z(b"# branch.oid (initial)\0# branch.head main\0");
    assert_eq!(p.head_state, "unborn");
    assert_eq!(p.branch.as_deref(), Some("main"));
}

#[test]
fn init_repository_creates_main_and_is_idempotent() {
    let root = tempfile::tempdir().unwrap();
    let service = GitService::new();
    service.init_repository(root.path()).unwrap();
    let head = git(root.path(), &["symbolic-ref", "--short", "HEAD"]).unwrap();
    assert_eq!(String::from_utf8_lossy(&head).trim(), "main");
    service.init_repository(root.path()).unwrap();
    assert!(root.path().join(".git").is_dir());
}

/// Host Git (GitHub's Windows runners, a machine-wide `* text=auto`) can
/// rewrite LF to CRLF on checkout. These tests assert the blob they wrote,
/// so turn that conversion off in this repository only.
fn pin_literal_checkout(root: &Path) {
    let info = root.join(".git").join("info");
    let _ = std::fs::create_dir_all(&info);
    std::fs::write(info.join("attributes"), "* -text\n").unwrap();
    let _ = Command::new("git")
        .current_dir(root)
        .args(["config", "core.autocrlf", "false"])
        .output();
    let _ = Command::new("git")
        .current_dir(root)
        .args(["config", "core.eol", "lf"])
        .output();
}

fn init_repo_with_commit(root: &Path) {
    let run = |args: &[&str]| {
        Command::new("git")
            .current_dir(root)
            .args(args)
            .output()
            .unwrap()
    };
    assert!(run(&["init"]).status.success());
    let _ = run(&["config", "user.name", "Test"]);
    let _ = run(&["config", "user.email", "test@example.com"]);
    pin_literal_checkout(root);
    std::fs::write(root.join("file.txt"), "base\n").unwrap();
    assert!(run(&["add", "file.txt"]).status.success());
    assert!(run(&["commit", "-m", "base"]).status.success());
}

#[test]
fn push_publishes_to_a_bare_remote_and_then_reuses_the_upstream() {
    let remote = tempfile::tempdir().unwrap();
    assert!(Command::new("git")
        .args(["init", "--bare"])
        .arg(remote.path())
        .output()
        .unwrap()
        .status
        .success());
    let root = tempfile::tempdir().unwrap();
    init_repo_with_commit(root.path());
    assert!(Command::new("git")
        .current_dir(root.path())
        .args(["remote", "add", "origin"])
        .arg(remote.path())
        .output()
        .unwrap()
        .status
        .success());

    let service = GitService::new();
    let first = service.push(root.path()).unwrap();
    assert_eq!(first.remote, "origin");
    assert!(first.set_upstream, "first push must publish the branch");
    // The branch now exists on the remote, so the upstream is real.
    let refs = Command::new("git")
        .current_dir(remote.path())
        .args(["for-each-ref", "--format=%(refname)"])
        .output()
        .unwrap();
    assert!(String::from_utf8_lossy(&refs.stdout).contains(&format!("refs/heads/{}", first.branch)));

    std::fs::write(root.path().join("file.txt"), "second\n").unwrap();
    assert!(Command::new("git")
        .current_dir(root.path())
        .args(["commit", "-am", "second"])
        .output()
        .unwrap()
        .status
        .success());
    let second = service.push(root.path()).unwrap();
    assert!(
        !second.set_upstream,
        "a configured upstream must be reused, not re-set"
    );
}

#[test]
fn push_refuses_a_detached_head() {
    let root = tempfile::tempdir().unwrap();
    init_repo_with_commit(root.path());
    assert!(Command::new("git")
        .current_dir(root.path())
        .args(["checkout", "--detach"])
        .output()
        .unwrap()
        .status
        .success());
    assert_eq!(
        service_push_error(root.path()),
        super::PUSH_DETACHED_HEAD,
        "a detached HEAD has no branch to publish"
    );
}

#[test]
fn push_reports_a_repository_without_a_remote() {
    let root = tempfile::tempdir().unwrap();
    init_repo_with_commit(root.path());
    assert_eq!(service_push_error(root.path()), super::PUSH_NO_REMOTE);
}

fn service_push_error(root: &Path) -> String {
    GitService::new()
        .push(root)
        .expect_err("push must fail")
        .to_string()
}

#[test]
fn bounded_push_output_keeps_the_tail_where_git_puts_the_reason() {
    let short = super::bounded_push_output(b"  ! [rejected] main -> main  ");
    assert_eq!(short, "! [rejected] main -> main");
    let long = format!("{}REASON", "x".repeat(super::MAX_PUSH_OUTPUT_BYTES));
    let bounded = super::bounded_push_output(long.as_bytes());
    assert!(bounded.starts_with("..."));
    assert!(bounded.ends_with("REASON"));
    assert!(bounded.len() <= super::MAX_PUSH_OUTPUT_BYTES + 3);
}

#[test]
fn missing_git_spawn_is_a_stable_unavailable_error() {
    let mapped = super::map_git_spawn_error(std::io::Error::new(
        std::io::ErrorKind::NotFound,
        "program not found",
    ));
    assert_eq!(mapped, super::GIT_NOT_FOUND);
    assert!(super::is_git_unavailable(&mapped));
    assert!(super::is_git_unavailable("program not found"));
    assert!(!super::is_git_unavailable("not a git repository"));
}

#[test]
fn parses_unmerged_stage_modes_and_object_ids() {
    let p = parse_porcelain_v2_z(
            b"u UU N... 100644 100755 100644 100644 deadbeef1111 deadbeef2222 deadbeef3333 conflict.txt\0",
        );
    let entry = &p.entries[0];
    assert_eq!(
        entry.unmerged_modes.as_deref(),
        Some(&["100644".into(), "100755".into(), "100644".into()][..])
    );
    assert_eq!(
        entry.unmerged_object_ids.as_deref(),
        Some(
            &[
                "deadbeef1111".into(),
                "deadbeef2222".into(),
                "deadbeef3333".into()
            ][..]
        )
    );
}
#[test]
fn stages_resolved_conflict_from_conflicted_snapshot() {
    let root = tempfile::tempdir().unwrap();
    let run = |args: &[&str]| {
        Command::new("git")
            .current_dir(root.path())
            .args(args)
            .output()
            .unwrap()
    };
    assert!(run(&["init"]).status.success());
    let _ = run(&["config", "user.name", "Test"]);
    let _ = run(&["config", "user.email", "test@example.com"]);
    assert!(run(&["config", "user.name", "Test"]).status.success());
    assert!(run(&["config", "user.email", "test@example.com"])
        .status
        .success());
    std::fs::write(root.path().join("file.txt"), "base\n").unwrap();
    assert!(run(&["add", "file.txt"]).status.success());
    assert!(run(&[
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "-m",
        "base",
    ])
    .status
    .success());
    assert!(run(&["checkout", "-b", "feature"]).status.success());
    std::fs::write(root.path().join("file.txt"), "feature\n").unwrap();
    assert!(run(&["commit", "-am", "feature"]).status.success());
    assert!(run(&["checkout", "-"]).status.success());
    std::fs::write(root.path().join("file.txt"), "main\n").unwrap();
    assert!(run(&["commit", "-am", "main"]).status.success());
    assert!(!run(&["merge", "feature"]).status.success());

    let service = GitService::new();
    let snapshot = service.status("owner", root.path(), 1).unwrap();
    let entry = snapshot
        .entries
        .iter()
        .find(|entry| entry.entry_kind == "unmerged")
        .unwrap();
    // Resolve the file in the editor, but keep the snapshot captured while
    // it was conflicted. Git Panel Stage must accept this transition.
    std::fs::write(root.path().join("file.txt"), "resolved\n").unwrap();
    service
        .write(
            &snapshot.snapshot_id,
            "owner",
            root.path(),
            1,
            &[GitPathIdentity {
                group: "conflicted".into(),
                path_bytes: BASE64.decode(&entry.path_bytes_base64).unwrap(),
                original_path_bytes: None,
            }],
            "stage",
        )
        .unwrap();
    let after = service.status("owner", root.path(), 1).unwrap();
    assert_eq!(after.counts.conflicted, 0);
    assert_eq!(after.counts.staged, 1);
}

#[test]
fn nested_workspace_is_rejected_for_subdirectory_root() {
    // The host-derived workspace root is `parent/sub`, but a git subprocess
    // whose cwd is `sub` would discover the parent repository. Git Panel
    // must refuse to operate so the user never stages or commits files
    // from a repository scope they did not authorize.
    let parent = tempfile::tempdir().unwrap();
    let run = |args: &[&str]| {
        Command::new("git")
            .current_dir(parent.path())
            .args(args)
            .output()
            .unwrap()
    };
    assert!(run(&["init"]).status.success());
    let _ = run(&["config", "user.name", "Test"]);
    let _ = run(&["config", "user.email", "test@example.com"]);
    std::fs::write(parent.path().join("parent.txt"), "p\n").unwrap();
    let sub = parent.path().join("sub");
    std::fs::create_dir_all(&sub).unwrap();
    std::fs::write(sub.join("sub.txt"), "s\n").unwrap();
    // Stage files in the parent repo from the parent root so a naive
    // `git commit` from `sub` would sweep them in.
    assert!(run(&["add", "parent.txt"]).status.success());
    assert!(run(&["add", "sub/sub.txt"]).status.success());

    let service = GitService::new();
    let err = service
        .status("owner", &sub, 1)
        .expect_err("nested workspace status must be refused");
    assert!(
        err.contains("nested") || err.contains("not a git repository"),
        "expected nested-repository rejection, got: {err}"
    );
    let err = service
        .prepare_ai_snapshot("owner", &sub, 1)
        .expect_err("nested workspace AI snapshot must be refused");
    assert!(
        err.contains("nested") || err.contains("not a git repository"),
        "expected nested-repository rejection, got: {err}"
    );
    let err = service
        .prepare_commit("snap", "owner", &sub, 1, "m", None, false)
        .expect_err("nested workspace commit must be refused");
    assert!(
        err.contains("nested") || err.contains("not a git repository"),
        "expected nested-repository rejection, got: {err}"
    );
}

#[test]
fn real_repo_stage_stale_and_discard_preserves_staged() {
    let root = tempfile::tempdir().unwrap();
    let run = |args: &[&str]| {
        Command::new("git")
            .current_dir(root.path())
            .args(args)
            .output()
            .unwrap()
    };
    assert!(run(&["init"]).status.success());
    let _ = run(&["config", "user.name", "Test"]);
    let _ = run(&["config", "user.email", "test@example.com"]);
    pin_literal_checkout(root.path());
    std::fs::write(root.path().join("file.txt"), "one\n").unwrap();
    assert!(run(&["add", "file.txt"]).status.success());
    assert!(run(&[
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "-m",
        "initial"
    ])
    .status
    .success());
    std::fs::write(root.path().join("file.txt"), "two\n").unwrap();
    let service = GitService::new();
    let before_stage = service.status("owner", root.path(), 1).unwrap();
    let entry = before_stage
        .entries
        .iter()
        .find(|entry| entry.display_path == "file.txt")
        .unwrap();
    let identity = GitPathIdentity {
        group: "changes".into(),
        path_bytes: b"file.txt".to_vec(),
        original_path_bytes: None,
    };
    service
        .write(
            &before_stage.snapshot_id,
            "owner",
            root.path(),
            1,
            &[identity],
            "stage",
        )
        .unwrap();
    std::fs::write(root.path().join("file.txt"), "three\n").unwrap();
    assert!(service
        .write(
            &before_stage.snapshot_id,
            "owner",
            root.path(),
            1,
            &[GitPathIdentity {
                group: "changes".into(),
                path_bytes: b"file.txt".to_vec(),
                original_path_bytes: None
            }],
            "stage"
        )
        .is_err());
    let after_stage = service.status("owner", root.path(), 1).unwrap();
    let staged = after_stage
        .entries
        .iter()
        .find(|entry| entry.display_path == "file.txt")
        .unwrap();
    assert!(service.belongs_to_group(staged, "staged"));
    service
        .write(
            &after_stage.snapshot_id,
            "owner",
            root.path(),
            1,
            &[GitPathIdentity {
                group: "changes".into(),
                path_bytes: b"file.txt".to_vec(),
                original_path_bytes: None,
            }],
            "discard",
        )
        .unwrap();
    assert_eq!(
        std::fs::read_to_string(root.path().join("file.txt")).unwrap(),
        "two\n"
    );
    let _ = entry;
}
#[test]
fn bounds_ai_diff_by_chars_files_and_lines() {
    let one_file = "diff --git a/a b/a\n".repeat(81);
    let (lines, lines_truncated) = bounded_ai_diff(one_file.as_bytes());
    assert!(lines_truncated);
    assert!(lines.lines().count() <= 80);

    let many_files = (0..81)
        .map(|index| format!("diff --git a/{index} b/{index}\n"))
        .collect::<String>();
    let (_, files_truncated) = bounded_ai_diff(many_files.as_bytes());
    assert!(files_truncated);

    let oversized = "x".repeat(24_001);
    let (chars, chars_truncated) = bounded_ai_diff(oversized.as_bytes());
    assert!(chars_truncated);
    assert!(chars.chars().count() <= 24_000);
}
#[test]
fn partial_stage_commit_requires_confirmation_token() {
    let root = tempfile::tempdir().unwrap();
    let run = |args: &[&str]| {
        Command::new("git")
            .current_dir(root.path())
            .args(args)
            .output()
            .unwrap()
    };
    assert!(run(&["init"]).status.success());
    let _ = run(&["config", "user.name", "Test"]);
    let _ = run(&["config", "user.email", "test@example.com"]);
    std::fs::write(root.path().join("file.txt"), "one\n").unwrap();
    assert!(run(&["add", "file.txt"]).status.success());
    assert!(run(&[
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "-m",
        "initial"
    ])
    .status
    .success());
    std::fs::write(root.path().join("file.txt"), "two\n").unwrap();
    assert!(run(&["add", "file.txt"]).status.success());
    std::fs::write(root.path().join("file.txt"), "three\n").unwrap();
    let service = GitService::new();
    let snapshot = service
        .prepare_ai_snapshot("owner", root.path(), 1)
        .unwrap();
    let error = service
        .prepare_commit(
            &snapshot.snapshot_id,
            "owner",
            root.path(),
            1,
            "test: partial",
            None,
            false,
        )
        .unwrap_err();
    let token = error
        .strip_prefix("confirmationRequired:")
        .unwrap()
        .to_string();
    assert!(service
        .prepare_commit(
            &snapshot.snapshot_id,
            "owner",
            root.path(),
            1,
            "test: partial",
            Some("wrong"),
            false,
        )
        .is_err());
    service
        .prepare_commit(
            &snapshot.snapshot_id,
            "owner",
            root.path(),
            1,
            "test: partial",
            Some(&token),
            false,
        )
        .unwrap();
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    service.commit_detached(
        snapshot.snapshot_id.clone(),
        "owner".into(),
        root.path().to_path_buf(),
        1,
        "req".into(),
        "test: partial".into(),
        Some(Box::new(move |frame| {
            let _ = tx.send(frame);
        })),
    );
    let frame = rx.recv_timeout(Duration::from_secs(10)).unwrap();
    assert!(
        frame.contains("\"status\":\"succeeded\""),
        "frame was: {frame}"
    );
}
#[test]
fn binary_diff_detected_as_fallback_reason() {
    let root = tempfile::tempdir().unwrap();
    let run = |args: &[&str]| {
        Command::new("git")
            .current_dir(root.path())
            .args(args)
            .output()
            .unwrap()
    };
    assert!(run(&["init"]).status.success());
    let _ = run(&["config", "user.name", "Test"]);
    let _ = run(&["config", "user.email", "test@example.com"]);
    // Write a file with NUL bytes so Git treats it as binary.
    let binary_content = vec![b'G', b'I', b'F', 0u8, 1u8, 2u8, 3u8];
    std::fs::write(root.path().join("blob.bin"), &binary_content).unwrap();
    assert!(run(&["add", "blob.bin"]).status.success());
    assert!(run(&[
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "-m",
        "initial"
    ])
    .status
    .success());
    let modified = vec![b'G', b'I', b'F', 0u8, 9u8, 9u8, 9u8];
    std::fs::write(root.path().join("blob.bin"), &modified).unwrap();
    let service = GitService::new();
    let snapshot = service.status("owner", root.path(), 1).unwrap();
    let entry = snapshot
        .entries
        .iter()
        .find(|e| e.display_path == "blob.bin")
        .unwrap();
    let path_bytes = BASE64.decode(&entry.path_bytes_base64).unwrap();
    let diff = service
        .diff(
            &snapshot.snapshot_id,
            "owner",
            root.path(),
            1,
            "changes",
            &path_bytes,
            "changes",
        )
        .unwrap();
    assert_eq!(diff.fallback_reason.as_deref(), Some("binary"));
}
#[test]
fn rejects_magic_paths() {
    let service = GitService::new();
    let root = tempfile::tempdir().unwrap();
    assert!(service
        .validate_path("missing", "owner", root.path(), 1, b":(glob)*")
        .is_err());
}
#[test]
fn missing_snapshots_are_rejected_before_path_use() {
    let service = GitService::new();
    let root = tempfile::tempdir().unwrap();
    assert!(service
        .validate_path("missing", "owner", root.path(), 7, b"file")
        .is_err());
}
#[test]
fn rejects_empty_write_batches() {
    let service = GitService::new();
    let root = tempfile::tempdir().unwrap();
    assert!(service
        .write("missing", "owner", root.path(), 1, &[], "stage")
        .is_err());
}

#[test]
fn detached_commit_captures_snapshot_before_waiting_for_write_slot() {
    let root = tempfile::tempdir().unwrap();
    let run = |args: &[&str]| {
        Command::new("git")
            .current_dir(root.path())
            .args(args)
            .output()
            .unwrap()
    };
    assert!(run(&["init"]).status.success());
    let _ = run(&["config", "user.name", "Test"]);
    let _ = run(&["config", "user.email", "test@example.com"]);
    run(&["config", "user.name", "Test"]);
    run(&["config", "user.email", "test@example.com"]);
    run(&["config", "core.hooksPath", ".git/hooks"]);
    std::fs::write(root.path().join("file.txt"), "one\n").unwrap();
    assert!(run(&["add", "file.txt"]).status.success());
    assert!(run(&["commit", "-m", "initial"]).status.success());
    std::fs::write(root.path().join("file.txt"), "two\n").unwrap();
    assert!(run(&["add", "file.txt"]).status.success());
    let service = GitService::new();
    let snapshot = service
        .prepare_ai_snapshot("owner", root.path(), 1)
        .unwrap();
    service
        .prepare_commit(
            &snapshot.snapshot_id,
            "owner",
            root.path(),
            1,
            "test",
            None,
            false,
        )
        .unwrap();
    let slot = service.lock_for_write(root.path());
    let guard = slot.lock().unwrap();
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    service.commit_detached(
        snapshot.snapshot_id,
        "owner".into(),
        root.path().to_path_buf(),
        1,
        "req".into(),
        "test".into(),
        Some(Box::new(move |frame| {
            let _ = tx.send(frame);
        })),
    );
    std::thread::sleep(Duration::from_millis(20));
    drop(guard);
    let frame = rx.recv_timeout(Duration::from_secs(10)).unwrap();
    assert!(
        frame.contains("\"status\":\"succeeded\""),
        "frame was: {frame}"
    );
}

#[test]
fn detached_commit_keeps_expected_tree_after_workspace_cleanup() {
    let root = tempfile::tempdir().unwrap();
    let run = |args: &[&str]| {
        Command::new("git")
            .current_dir(root.path())
            .args(args)
            .output()
            .unwrap()
    };
    assert!(run(&["init"]).status.success());
    let _ = run(&["config", "user.name", "Test"]);
    let _ = run(&["config", "user.email", "test@example.com"]);
    run(&["config", "user.name", "Test"]);
    run(&["config", "user.email", "test@example.com"]);
    run(&["config", "core.hooksPath", ".git/hooks"]);
    std::fs::write(root.path().join("file.txt"), "one\n").unwrap();
    assert!(run(&["add", "file.txt"]).status.success());
    assert!(run(&["commit", "-m", "initial"]).status.success());
    let hook = root.path().join(".git/hooks/pre-commit");
    std::fs::create_dir_all(root.path().join(".git/hooks")).unwrap();
    std::fs::write(&hook, "#!/bin/sh\nsleep 0.2\n").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    std::fs::write(root.path().join("file.txt"), "two\n").unwrap();
    assert!(run(&["add", "file.txt"]).status.success());
    let service = GitService::new();
    let snapshot = service
        .prepare_ai_snapshot("owner", root.path(), 1)
        .unwrap();
    service
        .prepare_commit(
            &snapshot.snapshot_id,
            "owner",
            root.path(),
            1,
            "test",
            None,
            false,
        )
        .unwrap();
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    service.commit_detached(
        snapshot.snapshot_id,
        "owner".into(),
        root.path().to_path_buf(),
        1,
        "req".into(),
        "test".into(),
        Some(Box::new(move |frame| {
            let _ = tx.send(frame);
        })),
    );
    std::thread::sleep(Duration::from_millis(50));
    let frame = rx.recv_timeout(Duration::from_secs(10)).unwrap();
    assert!(
        frame.contains("\"status\":\"succeeded\""),
        "frame was: {frame}"
    );
    assert!(
        frame.contains("\"hookChangedTree\":false"),
        "workspace cleanup must not erase the detached commit expected tree: {frame}"
    );
}

#[test]
fn commit_failure_preserves_hook_stderr() {
    // A pre-commit hook that rejects the commit must surface its stderr
    // in the failed outcome so the user can diagnose and retry.
    let root = tempfile::tempdir().unwrap();
    let run = |args: &[&str]| {
        Command::new("git")
            .current_dir(root.path())
            .args(args)
            .output()
            .unwrap()
    };
    assert!(run(&["init"]).status.success());
    let _ = run(&["config", "user.name", "Test"]);
    let _ = run(&["config", "user.email", "test@example.com"]);
    // Ensure the repo-local hooks dir is used (the test host may have a
    // global core.hooksPath that would bypass .git/hooks).
    run(&["config", "core.hooksPath", ".git/hooks"]);
    std::fs::write(root.path().join("file.txt"), "one\n").unwrap();
    assert!(run(&["add", "file.txt"]).status.success());
    // Make the initial commit before installing the failing hook.
    assert!(run(&[
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "-m",
        "initial"
    ])
    .status
    .success());
    // Install a failing pre-commit hook for the second commit.
    let hook = root.path().join(".git/hooks/pre-commit");
    std::fs::create_dir_all(root.path().join(".git/hooks")).unwrap();
    std::fs::write(&hook, "#!/bin/sh\necho 'hook says no' >&2\nexit 1\n").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    // Now stage a change the failing pre-commit hook will reject.
    std::fs::write(root.path().join("file.txt"), "two\n").unwrap();
    assert!(run(&["add", "file.txt"]).status.success());
    let service = GitService::new();
    let snapshot = service
        .prepare_ai_snapshot("owner", root.path(), 1)
        .unwrap();
    service
        .prepare_commit(
            &snapshot.snapshot_id,
            "owner",
            root.path(),
            1,
            "test",
            None,
            false,
        )
        .unwrap();
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    service.commit_detached(
        snapshot.snapshot_id.clone(),
        "owner".into(),
        root.path().to_path_buf(),
        1,
        "req".into(),
        "test".into(),
        Some(Box::new(move |frame| {
            let _ = tx.send(frame);
        })),
    );
    let frame = rx.recv_timeout(Duration::from_secs(10)).unwrap();
    assert!(
        frame.contains("\"status\":\"failed\""),
        "expected failed, got: {frame}"
    );
    assert!(
        frame.contains("hook says no"),
        "expected hook stderr preserved, got: {frame}"
    );
}

#[test]
fn per_root_write_locks_do_not_block_other_workspaces() {
    // Different canonical roots get independent write locks, so a write
    // to workspace A must not make a concurrent write to workspace B
    // return "busy".
    let service = GitService::new();
    let root_a = tempfile::tempdir().unwrap();
    let root_b = tempfile::tempdir().unwrap();
    let slot_a = service.lock_for_write(root_a.path());
    let _guard_a = slot_a.lock().unwrap();
    // Acquiring the lock for root B must succeed even though root A is held.
    let slot_b = service.lock_for_write(root_b.path());
    let guard_b = slot_b.try_lock();
    assert!(
        guard_b.is_ok(),
        "different workspace root should not be blocked"
    );
}

#[test]
fn commit_detached_rejects_stale_index_after_prepare() {
    let root = tempfile::tempdir().unwrap();
    let run = |args: &[&str]| {
        Command::new("git")
            .current_dir(root.path())
            .args(args)
            .output()
            .unwrap()
    };
    assert!(run(&["init"]).status.success());
    let _ = run(&["config", "user.name", "Test"]);
    let _ = run(&["config", "user.email", "test@example.com"]);
    std::fs::write(root.path().join("file.txt"), "one\n").unwrap();
    assert!(run(&["add", "file.txt"]).status.success());
    assert!(run(&[
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "-m",
        "initial"
    ])
    .status
    .success());
    std::fs::write(root.path().join("file.txt"), "two\n").unwrap();
    assert!(run(&["add", "file.txt"]).status.success());
    let service = GitService::new();
    let snapshot = service
        .prepare_ai_snapshot("owner", root.path(), 1)
        .unwrap();
    service
        .prepare_commit(
            &snapshot.snapshot_id,
            "owner",
            root.path(),
            1,
            "test: commit",
            None,
            false,
        )
        .unwrap();
    // Mutate the index after prepare_commit but before commit_detached runs,
    // simulating a concurrent stage that changes the index tree.
    std::fs::write(root.path().join("other.txt"), "x\n").unwrap();
    assert!(run(&["add", "other.txt"]).status.success());
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    service.commit_detached(
        snapshot.snapshot_id.clone(),
        "owner".into(),
        root.path().to_path_buf(),
        1,
        "req".into(),
        "test: commit".into(),
        Some(Box::new(move |frame| {
            let _ = tx.send(frame);
        })),
    );
    let frame = rx.recv_timeout(Duration::from_secs(10)).unwrap();
    assert!(
        frame.contains("\"status\":\"failed\""),
        "expected stale rejection, got: {frame}"
    );
}

#[test]
fn commit_detached_succeeds_for_unborn_repository() {
    let root = tempfile::tempdir().unwrap();
    let run = |args: &[&str]| {
        Command::new("git")
            .current_dir(root.path())
            .args(args)
            .output()
            .unwrap()
    };
    assert!(run(&["init"]).status.success());
    let _ = run(&["config", "user.name", "Test"]);
    let _ = run(&["config", "user.email", "test@example.com"]);
    std::fs::write(root.path().join("file.txt"), "one\n").unwrap();
    assert!(run(&["add", "file.txt"]).status.success());
    let service = GitService::new();
    let snapshot = service
        .prepare_ai_snapshot("owner", root.path(), 1)
        .unwrap();
    service
        .prepare_commit(
            &snapshot.snapshot_id,
            "owner",
            root.path(),
            1,
            "test: unborn",
            None,
            false,
        )
        .unwrap();
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    service.commit_detached(
        snapshot.snapshot_id.clone(),
        "owner".into(),
        root.path().to_path_buf(),
        1,
        "req".into(),
        "test: unborn".into(),
        Some(Box::new(move |frame| {
            let _ = tx.send(frame);
        })),
    );
    let frame = rx.recv_timeout(Duration::from_secs(10)).unwrap();
    assert!(
        frame.contains("\"status\":\"succeeded\""),
        "expected succeeded for unborn first commit, got: {frame}"
    );
    // The unborn repo should now have a HEAD.
    assert!(root.path().join(".git/HEAD").exists());
}

// ── History panel (log / detail / commit diff) ──
use std::process::Command as StdCommand;

fn test_repo() -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().to_path_buf();
    let run = |args: &[&str]| {
        let output = StdCommand::new("git")
            .current_dir(&root)
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    };
    run(&["init", "-q", "-b", "main"]);
    run(&["config", "user.name", "Test"]);
    run(&["config", "user.email", "test@example.com"]);
    (dir, root)
}

fn test_commit(root: &Path, path: &str, content: &str, message: &str) -> String {
    std::fs::write(root.join(path), content).unwrap();
    let run = |args: &[&str]| {
        let output = StdCommand::new("git")
            .current_dir(root)
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    };
    run(&["add", "-A"]);
    run(&["commit", "-q", "-m", message]);
    let output = StdCommand::new("git")
        .current_dir(root)
        .args(["rev-parse", "HEAD"])
        .output()
        .unwrap();
    String::from_utf8(output.stdout).unwrap().trim().to_owned()
}

#[test]
fn parses_diff_tree_name_status_z_flat_and_rename() {
    let files = parse_diff_tree_name_status_z(
        b"M\0a.txt\0A\0b.txt\0R100\0old.txt\0new.txt\0C75\0source\nname\0copy\"name\0\0",
    );
    assert_eq!(files.len(), 4);
    assert_eq!(files[0].status, "M");
    assert_eq!(files[0].path, "a.txt");
    assert_eq!(files[2].status, "R100");
    assert_eq!(files[2].path, "new.txt");
    assert_eq!(files[2].original_path.as_deref(), Some("old.txt"));
    assert_eq!(files[3].status, "C75");
    assert_eq!(files[3].original_path.as_deref(), Some("source\nname"));
    assert_eq!(files[3].path, "copy\"name");
}

#[test]
fn parses_diff_tree_name_status_z_empty_fields_and_missing_paths() {
    let files = parse_diff_tree_name_status_z(b"M\0A\0R50\0only-one\0\0");
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].status, "M");
    assert_eq!(files[0].path, "A");
}

#[test]
fn validate_oid_rejects_injection_and_bad_shape() {
    assert!(validate_oid(&"0".repeat(40)).is_ok());
    assert!(validate_oid(&"0".repeat(64)).is_ok());
    assert!(validate_oid("; rm -rf /").is_err());
    assert!(validate_oid("abc").is_err());
    assert!(validate_oid(&"g".repeat(40)).is_err());
}

#[test]
fn log_detail_and_commit_diff_preserve_empty_message_fields() {
    let (_dir, root) = test_repo();
    let awkward_name = if cfg!(windows) {
        "line_name.txt"
    } else {
        "line\nname.txt"
    };
    std::fs::write(root.join(awkward_name), "one\n").unwrap();
    let output = StdCommand::new("git")
        .current_dir(&root)
        .args(["add", "-A"])
        .output()
        .unwrap();
    assert!(output.status.success());
    let output = StdCommand::new("git")
        .current_dir(&root)
        .args(["commit", "-q", "--allow-empty-message", "-m", ""])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let root_oid = String::from_utf8(
        StdCommand::new("git")
            .current_dir(&root)
            .args(["rev-parse", "HEAD"])
            .output()
            .unwrap()
            .stdout,
    )
    .unwrap()
    .trim()
    .to_owned();
    let service = GitService::new();
    let page = service.log("owner", &root, 1, 50, None).unwrap();
    assert_eq!(page.commits.len(), 1);
    assert_eq!(page.commits[0].subject, "");
    let detail = service.log_detail("owner", &root, 1, &root_oid).unwrap();
    assert_eq!(detail.full_message, "");
    assert_eq!(detail.files[0].path, awkward_name);
    let diff = service
        .commit_diff("owner", &root, 1, &root_oid, awkward_name.as_bytes())
        .unwrap();
    assert_eq!(diff.comparison, "commit");
    assert!(diff.raw_patch.contains("+one"));
    let response = serde_json::to_value(&diff).unwrap();
    assert!(response.get("snapshotId").is_none());
    assert!(service
        .commit_diff("owner", &root, 1, &root_oid, b"missing")
        .is_err());
}

#[test]
fn log_detail_trims_git_format_newline_but_preserves_message_body() {
    let (_dir, root) = test_repo();
    let message_path = root.join("message.txt");
    std::fs::write(&message_path, "subject\n\nbody\n").unwrap();
    let output = StdCommand::new("git")
        .current_dir(&root)
        .args(["commit", "--allow-empty", "-q", "-F", "message.txt"])
        .output()
        .unwrap();
    assert!(output.status.success());
    let oid = String::from_utf8(
        StdCommand::new("git")
            .current_dir(&root)
            .args(["rev-parse", "HEAD"])
            .output()
            .unwrap()
            .stdout,
    )
    .unwrap()
    .trim()
    .to_owned();
    let detail = GitService::new()
        .log_detail("owner", &root, 1, &oid)
        .unwrap();
    assert_eq!(detail.full_message, "subject\n\nbody");
    assert!(!detail.full_message.ends_with(['\r', '\n']));
}

#[test]
fn log_detail_marks_oversized_message_as_truncated() {
    let (_dir, root) = test_repo();
    let message_path = root.join("message.txt");
    std::fs::write(
        &message_path,
        format!("{}\n", "x".repeat(MAX_LOG_MESSAGE_BYTES + 1)),
    )
    .unwrap();
    let output = StdCommand::new("git")
        .current_dir(&root)
        .args(["commit", "--allow-empty", "-q", "-F", "message.txt"])
        .output()
        .unwrap();
    assert!(output.status.success());
    let oid = String::from_utf8(
        StdCommand::new("git")
            .current_dir(&root)
            .args(["rev-parse", "HEAD"])
            .output()
            .unwrap()
            .stdout,
    )
    .unwrap()
    .trim()
    .to_owned();
    let detail = GitService::new()
        .log_detail("owner", &root, 1, &oid)
        .unwrap();
    assert!(detail.message_truncated);
    assert!(detail.full_message.ends_with('…'));
}

#[test]
fn log_detail_and_commit_diff_detect_real_rename() {
    let (_dir, root) = test_repo();
    test_commit(&root, "old.txt", "content\n", "add old");
    let output = StdCommand::new("git")
        .current_dir(&root)
        .args(["mv", "old.txt", "new.txt"])
        .output()
        .unwrap();
    assert!(output.status.success());
    let output = StdCommand::new("git")
        .current_dir(&root)
        .args(["commit", "-q", "-m", "rename"])
        .output()
        .unwrap();
    assert!(output.status.success());
    let oid = String::from_utf8(
        StdCommand::new("git")
            .current_dir(&root)
            .args(["rev-parse", "HEAD"])
            .output()
            .unwrap()
            .stdout,
    )
    .unwrap()
    .trim()
    .to_owned();
    let service = GitService::new();
    let detail = service.log_detail("owner", &root, 1, &oid).unwrap();
    assert_eq!(detail.files.len(), 1);
    assert!(detail.files[0].status.starts_with('R'));
    assert_eq!(detail.files[0].original_path.as_deref(), Some("old.txt"));
    assert_eq!(detail.files[0].path, "new.txt");
    let diff = service
        .commit_diff("owner", &root, 1, &oid, b"new.txt")
        .unwrap();
    assert_eq!(diff.fallback_reason.as_deref(), Some("rename"));
}

#[test]
fn log_paginates_first_parent_and_stops_at_root() {
    let (_dir, root) = test_repo();
    let root_oid = test_commit(&root, "root.txt", "root\n", "root");
    let second_oid = test_commit(&root, "second.txt", "second\n", "second");
    let service = GitService::new();
    let first = service.log("owner", &root, 1, 1, None).unwrap();
    assert_eq!(first.commits[0].oid, second_oid);
    assert!(first.has_more);
    let second = service
        .log("owner", &root, 1, 1, Some(&second_oid))
        .unwrap();
    assert_eq!(second.commits[0].oid, root_oid);
    let end = service.log("owner", &root, 1, 1, Some(&root_oid)).unwrap();
    assert!(end.commits.is_empty());
    assert!(!end.has_more);
    let unknown = "0".repeat(40);
    assert!(service.log("owner", &root, 1, 1, Some(&unknown)).is_err());
}

#[test]
fn log_detail_and_commit_diff_use_first_parent_for_merges() {
    let (_dir, root) = test_repo();
    test_commit(&root, "base.txt", "base\n", "base");
    let run = |args: &[&str]| {
        let output = StdCommand::new("git")
            .current_dir(&root)
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    };
    run(&["checkout", "-q", "-b", "side"]);
    test_commit(&root, "side.txt", "side\n", "side");
    run(&["checkout", "-q", "main"]);
    test_commit(&root, "main.txt", "main\n", "main");
    run(&["merge", "-q", "--no-ff", "-m", "merge", "side"]);
    let merge_oid = String::from_utf8(
        StdCommand::new("git")
            .current_dir(&root)
            .args(["rev-parse", "HEAD"])
            .output()
            .unwrap()
            .stdout,
    )
    .unwrap()
    .trim()
    .to_owned();
    let service = GitService::new();
    let detail = service.log_detail("owner", &root, 1, &merge_oid).unwrap();
    let paths = detail
        .files
        .iter()
        .map(|file| file.path.as_str())
        .collect::<Vec<_>>();
    assert!(paths.contains(&"side.txt"));
    assert!(!paths.contains(&"main.txt"));
    let diff = service
        .commit_diff("owner", &root, 1, &merge_oid, b"side.txt")
        .unwrap();
    assert!(diff.raw_patch.contains("+side"));
    assert!(service
        .commit_diff("owner", &root, 1, &merge_oid, b"main.txt")
        .is_err());
}

#[test]
fn discard_untracked_uses_clean() {
    let root = tempfile::tempdir().unwrap();
    init_repo_with_commit(root.path());
    std::fs::write(root.path().join("scratch.txt"), "tmp\n").unwrap();
    let service = GitService::new();
    let snapshot = service.status("owner", root.path(), 1).unwrap();
    service
        .write(
            &snapshot.snapshot_id,
            "owner",
            root.path(),
            1,
            &[GitPathIdentity {
                group: "untracked".into(),
                path_bytes: b"scratch.txt".to_vec(),
                original_path_bytes: None,
            }],
            "discard",
        )
        .unwrap();
    assert!(!root.path().join("scratch.txt").exists());
}

#[test]
fn fetch_and_ff_pull_from_a_bare_remote() {
    let remote = tempfile::tempdir().unwrap();
    assert!(Command::new("git")
        .args(["init", "--bare"])
        .arg(remote.path())
        .output()
        .unwrap()
        .status
        .success());
    let root = tempfile::tempdir().unwrap();
    init_repo_with_commit(root.path());
    assert!(Command::new("git")
        .current_dir(root.path())
        .args(["remote", "add", "origin"])
        .arg(remote.path())
        .output()
        .unwrap()
        .status
        .success());
    let service = GitService::new();
    service.push(root.path()).unwrap();
    std::fs::write(root.path().join("file.txt"), "remote\n").unwrap();
    assert!(Command::new("git")
        .current_dir(root.path())
        .args(["commit", "-am", "remote-ahead"])
        .output()
        .unwrap()
        .status
        .success());
    service.push(root.path()).unwrap();

    let other = tempfile::tempdir().unwrap();
    // The clone (and a later pull) checks the file out. Host-wide
    // `core.autocrlf=true` or `* text=auto` would turn "\n" into "\r\n".
    assert!(Command::new("git")
        .env("GIT_ATTR_NOSYSTEM", "1")
        .args(["-c", "core.autocrlf=false", "-c", "core.eol=lf", "clone"])
        .arg(remote.path())
        .arg(other.path())
        .output()
        .unwrap()
        .status
        .success());
    pin_literal_checkout(other.path());
    let _ = Command::new("git")
        .current_dir(other.path())
        .args(["config", "user.name", "Test"])
        .output();
    let _ = Command::new("git")
        .current_dir(other.path())
        .args(["config", "user.email", "test@example.com"])
        .output();
    service.fetch(other.path()).unwrap();
    service.pull(other.path()).unwrap();
    assert_eq!(
        std::fs::read_to_string(other.path().join("file.txt")).unwrap(),
        "remote\n"
    );
}

#[test]
fn pull_ff_only_reports_diverged_branches() {
    let remote = tempfile::tempdir().unwrap();
    assert!(Command::new("git")
        .args(["init", "--bare"])
        .arg(remote.path())
        .output()
        .unwrap()
        .status
        .success());
    let first = tempfile::tempdir().unwrap();
    init_repo_with_commit(first.path());
    assert!(Command::new("git")
        .current_dir(first.path())
        .args(["remote", "add", "origin"])
        .arg(remote.path())
        .output()
        .unwrap()
        .status
        .success());
    let service = GitService::new();
    service.push(first.path()).unwrap();

    let second = tempfile::tempdir().unwrap();
    assert!(Command::new("git")
        .args(["clone"])
        .arg(remote.path())
        .arg(second.path())
        .output()
        .unwrap()
        .status
        .success());
    let _ = Command::new("git")
        .current_dir(second.path())
        .args(["config", "user.name", "Test"])
        .output();
    let _ = Command::new("git")
        .current_dir(second.path())
        .args(["config", "user.email", "test@example.com"])
        .output();
    std::fs::write(second.path().join("file.txt"), "second\n").unwrap();
    assert!(Command::new("git")
        .current_dir(second.path())
        .args(["commit", "-am", "second"])
        .output()
        .unwrap()
        .status
        .success());
    assert!(Command::new("git")
        .current_dir(second.path())
        .args(["push"])
        .output()
        .unwrap()
        .status
        .success());

    std::fs::write(first.path().join("file.txt"), "first\n").unwrap();
    assert!(Command::new("git")
        .current_dir(first.path())
        .args(["commit", "-am", "first"])
        .output()
        .unwrap()
        .status
        .success());
    let error = service.pull(first.path()).expect_err("diverged pull");
    assert_eq!(error, super::remote::PULL_DIVERGED);
}

#[test]
fn amend_rewrites_the_last_commit_message() {
    let root = tempfile::tempdir().unwrap();
    init_repo_with_commit(root.path());
    std::fs::write(root.path().join("file.txt"), "amended\n").unwrap();
    assert!(Command::new("git")
        .current_dir(root.path())
        .args(["add", "file.txt"])
        .output()
        .unwrap()
        .status
        .success());
    let service = GitService::new();
    let snapshot = service
        .prepare_ai_snapshot("owner", root.path(), 1)
        .unwrap();
    service
        .prepare_commit(
            &snapshot.snapshot_id,
            "owner",
            root.path(),
            1,
            "test: amend",
            None,
            true,
        )
        .unwrap();
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    service.commit_detached(
        snapshot.snapshot_id.clone(),
        "owner".into(),
        root.path().to_path_buf(),
        1,
        "req".into(),
        "test: amend".into(),
        Some(Box::new(move |frame| {
            let _ = tx.send(frame);
        })),
    );
    let frame = rx.recv_timeout(std::time::Duration::from_secs(10)).unwrap();
    assert!(
        frame.contains("\"status\":\"succeeded\""),
        "frame was: {frame}"
    );
    let log = Command::new("git")
        .current_dir(root.path())
        .args(["log", "-1", "--pretty=%s"])
        .output()
        .unwrap();
    assert_eq!(String::from_utf8_lossy(&log.stdout).trim(), "test: amend");
    let count = Command::new("git")
        .current_dir(root.path())
        .args(["rev-list", "--count", "HEAD"])
        .output()
        .unwrap();
    assert_eq!(String::from_utf8_lossy(&count.stdout).trim(), "1");
}

#[test]
fn branches_and_checkout_create_switch() {
    let root = tempfile::tempdir().unwrap();
    init_repo_with_commit(root.path());
    let service = GitService::new();
    let before = service.branches(root.path()).unwrap();
    assert!(before.iter().any(|branch| branch.current));
    service.checkout(root.path(), "topic", true).unwrap();
    let after = service.branches(root.path()).unwrap();
    let topic = after.iter().find(|branch| branch.name == "topic").unwrap();
    assert!(topic.current);
    service
        .checkout(root.path(), &before[0].name, false)
        .unwrap();
    let restored = service.branches(root.path()).unwrap();
    assert!(restored
        .iter()
        .any(|branch| branch.name == before[0].name && branch.current));
}
