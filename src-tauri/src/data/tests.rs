// ABOUTME: Tests the data plane: files, sessions, search, and the cost dashboard.
// ABOUTME: Each test uses a temporary workspace.
// ABOUTME: Unit tests moved out of the facade.
use super::{
    git_output, parse_session_metrics, parse_session_summary_with_metadata, read_jsonl_entries,
    FileKind, HostDataError, HostDataPlane,
};
use serde_json::json;
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

fn isolated_workspace(label: &str) -> (std::path::PathBuf, HostDataPlane, std::path::PathBuf) {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let temp = std::env::temp_dir().join(format!("spopi-host-{label}-{nonce}"));
    let workspace = temp.join("workspace");
    fs::create_dir_all(&workspace).unwrap();
    let data =
        HostDataPlane::new(HashMap::from([("workspace-a".into(), workspace.clone())])).unwrap();
    (temp, data, workspace)
}

#[test]
fn missing_git_binary_is_treated_as_unavailable() {
    let mut command = Command::new("spopi-missing-git-binary-for-tests");
    command.arg("--version");
    assert!(git_output(command).is_none());
}

#[test]
fn workspace_info_without_git_metadata_still_returns_the_path() {
    let (temp, data, workspace) = isolated_workspace("git-optional-info");
    let info = data.workspace_info("workspace-a").unwrap();
    assert_eq!(
        info.path,
        super::paths::canonical_path(&workspace)
            .unwrap()
            .to_string_lossy()
    );
    assert!(!info.is_git);
    assert!(info.git_branch.is_none());
    assert!(info.repository.is_empty());
    fs::remove_dir_all(temp).unwrap();
}

#[test]
fn git_stat_without_a_repository_is_empty_not_an_error() {
    let (temp, data, _) = isolated_workspace("git-optional-status");
    let stat = data.git_stat("workspace-a").unwrap();
    assert!(!stat.is_git_repository);
    assert_eq!(stat.files_changed, 0);
    fs::remove_dir_all(temp).unwrap();
}

#[test]
fn lists_registered_workspace_files_and_rejects_escape_paths() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let temp = std::env::temp_dir().join(format!("spopi-host-data-{nonce}"));
    let workspace = temp.join("workspace");
    fs::create_dir_all(workspace.join("src")).unwrap();
    fs::write(workspace.join("README.md"), "read me").unwrap();
    fs::write(workspace.join(".hidden"), "dotfile").unwrap();
    fs::write(temp.join("secret.txt"), "secret").unwrap();
    let data =
        HostDataPlane::new(HashMap::from([("workspace-a".into(), workspace.clone())])).unwrap();

    let entries = data.list_files("workspace-a", "", false).unwrap();
    assert_eq!(entries[0].name, "src");
    assert_eq!(entries[0].kind, FileKind::Directory);
    assert_eq!(entries[1].relative_path, "README.md");
    assert_eq!(
        data.list_files("workspace-a", "../", false),
        Err(HostDataError::InvalidRelativePath)
    );
    assert_eq!(
        data.list_files("missing", "", false),
        Err(HostDataError::UnknownWorkspace)
    );
    fs::remove_dir_all(temp).unwrap();
}

#[test]
fn resolve_open_path_stays_inside_registered_workspace() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let temp = std::env::temp_dir().join(format!("spopi-host-open-{nonce}"));
    let workspace = temp.join("workspace");
    fs::create_dir_all(workspace.join("src")).unwrap();
    fs::write(workspace.join("README.md"), "read me").unwrap();
    fs::write(temp.join("secret.txt"), "secret").unwrap();
    let data =
        HostDataPlane::new(HashMap::from([("workspace-a".into(), workspace.clone())])).unwrap();
    assert!(data
        .resolve_open_path(Some("workspace-a"), "README.md")
        .unwrap()
        .ends_with("README.md"));
    assert_eq!(
        data.resolve_open_path(Some("workspace-a"), "../secret.txt"),
        Err(HostDataError::InvalidRelativePath)
    );
    assert_eq!(
        data.resolve_open_path(None, temp.join("secret.txt").to_str().unwrap()),
        Err(HostDataError::OutsideWorkspace)
    );
    fs::remove_dir_all(temp).unwrap();
}

#[test]
fn list_files_hides_dotfiles_by_default_and_shows_them_when_opted_in() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let temp = std::env::temp_dir().join(format!("spopi-host-hidden-{nonce}"));
    let workspace = temp.join("workspace");
    fs::create_dir_all(workspace.join(".git")).unwrap();
    fs::write(workspace.join(".env"), "dotfile").unwrap();
    fs::write(workspace.join("visible.txt"), "visible").unwrap();
    let data = HostDataPlane::new(HashMap::from([("workspace-a".into(), workspace)])).unwrap();

    let hidden = data
        .list_files("workspace-a", "", false)
        .unwrap()
        .into_iter()
        .map(|entry| entry.name)
        .collect::<Vec<_>>();
    assert_eq!(hidden, vec!["visible.txt"]);

    let shown = data
        .list_files("workspace-a", "", true)
        .unwrap()
        .into_iter()
        .map(|entry| entry.name)
        .collect::<Vec<_>>();
    assert_eq!(shown, vec![".git", ".env", "visible.txt"]);
    fs::remove_dir_all(temp).unwrap();
}

#[test]
fn read_session_messages_preserves_user_and_assistant_entry_ids() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let temp = std::env::temp_dir().join(format!("spopi-host-messages-{nonce}"));
    let workspace = temp.join("workspace");
    let sessions = temp.join("sessions/project");
    fs::create_dir_all(&workspace).unwrap();
    fs::create_dir_all(&sessions).unwrap();
    fs::write(
            sessions.join("session-a.jsonl"),
            format!(
                "{{\"type\":\"session\",\"id\":\"session-a\",\"timestamp\":\"2026-01-01\",\"cwd\":{}}}\n\
                 {{\"type\":\"message\",\"id\":\"user-1\",\"parentId\":null,\"message\":{{\"role\":\"user\",\"content\":\"hello\"}}}}\n\
                 {{\"type\":\"message\",\"id\":\"assistant-1\",\"parentId\":\"user-1\",\"message\":{{\"role\":\"assistant\",\"content\":[{{\"type\":\"text\",\"text\":\"hi\"}}]}}}}\n",
                serde_json::to_string(&workspace.to_string_lossy()).unwrap()
            ),
        )
        .unwrap();
    let data = HostDataPlane::new(HashMap::from([("workspace-a".into(), workspace)]))
        .unwrap()
        .with_session_root(temp.join("sessions"));

    let messages = data
        .read_session_messages("workspace-a", "session-a")
        .unwrap();

    assert_eq!(
        messages,
        vec![
            json!({ "role": "user", "content": "hello", "entryId": "user-1" }),
            json!({ "role": "assistant", "content": [{ "type": "text", "text": "hi" }], "entryId": "assistant-1" }),
        ]
    );
    fs::remove_dir_all(temp).unwrap();
}

#[test]
fn read_session_messages_keeps_context_edits_for_visible_targets() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let temp = std::env::temp_dir().join(format!("spopi-host-context-edit-{nonce}"));
    let workspace = temp.join("workspace");
    let sessions = temp.join("sessions/project");
    fs::create_dir_all(&workspace).unwrap();
    fs::create_dir_all(&sessions).unwrap();
    fs::write(
            sessions.join("session-a.jsonl"),
            format!(
                "{{\"type\":\"session\",\"id\":\"session-a\",\"timestamp\":\"2026-01-01\",\"cwd\":{}}}\n\
                 {{\"type\":\"message\",\"id\":\"user-1\",\"parentId\":null,\"message\":{{\"role\":\"user\",\"content\":\"hello\"}}}}\n\
                 {{\"type\":\"context_edit\",\"id\":\"edit-1\",\"parentId\":\"user-1\",\"targetId\":\"user-1\",\"replacement\":null}}\n\
                 {{\"type\":\"context_edit\",\"id\":\"edit-2\",\"parentId\":\"edit-1\",\"targetId\":\"missing\",\"replacement\":null}}\n",
                serde_json::to_string(&workspace.to_string_lossy()).unwrap()
            ),
        )
        .unwrap();
    let data = HostDataPlane::new(HashMap::from([("workspace-a".into(), workspace)]))
        .unwrap()
        .with_session_root(temp.join("sessions"));
    let messages = data
        .read_session_messages("workspace-a", "session-a")
        .unwrap();
    assert_eq!(messages[0]["entryId"], "user-1");
    assert_eq!(messages[1]["type"], "context_edit");
    assert_eq!(messages[1]["targetId"], "user-1");
    assert_eq!(messages.len(), 2);
    fs::remove_dir_all(temp).unwrap();
}

#[cfg(unix)]
#[test]
fn rejects_symlinks_that_resolve_outside_the_workspace() {
    use std::os::unix::fs::symlink;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let temp = std::env::temp_dir().join(format!("spopi-host-data-link-{nonce}"));
    let workspace = temp.join("workspace");
    let outside = temp.join("outside");
    fs::create_dir_all(&workspace).unwrap();
    fs::create_dir_all(&outside).unwrap();
    symlink(&outside, workspace.join("escape")).unwrap();
    let data = HostDataPlane::new(HashMap::from([("workspace-a".into(), workspace)])).unwrap();
    assert_eq!(
        data.list_files("workspace-a", "escape", false),
        Err(HostDataError::OutsideWorkspace)
    );
    fs::remove_dir_all(temp).unwrap();
}

#[test]
fn lists_only_sessions_owned_by_the_registered_workspace_and_skips_unknown_entries() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let temp = std::env::temp_dir().join(format!("spopi-host-sessions-{nonce}"));
    let workspace = temp.join("workspace");
    let other = temp.join("other");
    let sessions = temp.join("sessions/project");
    fs::create_dir_all(&workspace).unwrap();
    fs::create_dir_all(&other).unwrap();
    fs::create_dir_all(&sessions).unwrap();
    fs::write(
            sessions.join("included.jsonl"),
            format!(
                "{{\"type\":\"session\",\"id\":\"session-a\",\"timestamp\":\"2026-01-01\",\"cwd\":{}}}\n{{\"type\":\"future_entry\",\"payload\":true}}\n{{\"type\":\"message\",\"message\":{{\"role\":\"user\",\"content\":\"hello from session\"}}}}\n",
                serde_json::to_string(&workspace.to_string_lossy()).unwrap()
            ),
        )
        .unwrap();
    fs::write(
            sessions.join("excluded.jsonl"),
            format!(
                "{{\"type\":\"session\",\"id\":\"session-b\",\"cwd\":{}}}\n{{\"type\":\"message\",\"message\":{{\"role\":\"user\",\"content\":\"private\"}}}}\n",
                serde_json::to_string(&other.to_string_lossy()).unwrap()
            ),
        )
        .unwrap();
    let data = HostDataPlane::new(HashMap::from([("workspace-a".into(), workspace)]))
        .unwrap()
        .with_session_root(temp.join("sessions"));

    let listed = data.list_sessions("workspace-a").unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, "session-a");
    assert!(listed[0].is_current_workspace);
    assert_eq!(listed[0].workspace_id, "workspace-a");
    assert_eq!(
        listed[0].first_message.as_deref(),
        Some("hello from session")
    );

    // list_all_sessions returns both projects, tagging only the current
    // workspace's session as current.
    let all = data.list_all_sessions("workspace-a").unwrap();
    assert_eq!(all.len(), 2);
    let current = all.iter().find(|s| s.id == "session-a").unwrap();
    assert!(current.is_current_workspace);
    assert_eq!(current.workspace_id, "workspace-a");
    let foreign = all.iter().find(|s| s.id == "session-b").unwrap();
    assert!(!foreign.is_current_workspace);
    assert!(foreign.workspace_id.is_empty());
    assert!(foreign.project_path.ends_with("other"));
    assert_eq!(foreign.project_name, "other");

    // The canonical /app launcher is targetless: it returns the same
    // catalog without inventing a current workspace.
    let launcher = data.list_launcher_sessions().unwrap();
    assert_eq!(launcher.len(), 2);
    assert!(launcher
        .iter()
        .all(|session| !session.is_current_workspace && session.workspace_id.is_empty()));
    fs::remove_dir_all(temp).unwrap();
}

#[test]
fn list_all_sessions_orders_by_user_activity_not_file_mtime() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let temp = std::env::temp_dir().join(format!("spopi-host-session-activity-{nonce}"));
    let older_workspace = temp.join("older-workspace");
    let newer_workspace = temp.join("newer-workspace");
    let sessions = temp.join("sessions/project");
    fs::create_dir_all(&older_workspace).unwrap();
    fs::create_dir_all(&newer_workspace).unwrap();
    fs::create_dir_all(&sessions).unwrap();

    let older_file = sessions.join("older.jsonl");
    fs::write(
            &older_file,
            format!(
                "{{\"type\":\"session\",\"id\":\"older\",\"timestamp\":\"2026-01-01T00:00:00.000Z\",\"cwd\":{}}}\n\
                 {{\"type\":\"message\",\"timestamp\":\"2026-01-01T00:00:01.000Z\",\"message\":{{\"role\":\"user\",\"timestamp\":1767225601000,\"content\":\"older activity\"}}}}\n",
                serde_json::to_string(&older_workspace.to_string_lossy()).unwrap()
            ),
        )
        .unwrap();
    fs::write(
            sessions.join("newer.jsonl"),
            format!(
                "{{\"type\":\"session\",\"id\":\"newer\",\"timestamp\":\"2026-01-02T00:00:00.000Z\",\"cwd\":{}}}\n\
                 {{\"type\":\"message\",\"timestamp\":\"2026-01-02T00:00:01.000Z\",\"message\":{{\"role\":\"user\",\"timestamp\":1767312001000,\"content\":\"newer activity\"}}}}\n",
                serde_json::to_string(&newer_workspace.to_string_lossy()).unwrap()
            ),
        )
        .unwrap();
    // Simulate a read-only resume/touch writing metadata to the older
    // session after the newer conversation activity already happened. This
    // must not pull the older project to the top of the sidebar.
    std::thread::sleep(std::time::Duration::from_millis(20));
    fs::OpenOptions::new()
        .append(true)
        .open(&older_file)
        .unwrap()
        .write_all(b"{\"type\":\"session_info\",\"name\":\"Touched title\"}\n")
        .unwrap();

    let data = HostDataPlane::new(HashMap::from([("workspace-a".into(), older_workspace)]))
        .unwrap()
        .with_session_root(temp.join("sessions"));

    let all = data.list_all_sessions("workspace-a").unwrap();
    assert_eq!(
        all.iter()
            .map(|session| session.id.as_str())
            .collect::<Vec<_>>(),
        vec!["newer", "older"]
    );
    assert!(all[1].modified_at_ms > all[0].modified_at_ms);
    assert!(all[0].activity_at_ms > all[1].activity_at_ms);
    fs::remove_dir_all(temp).unwrap();
}

#[test]
fn reads_session_name_appended_after_many_messages() {
    // Regression: the summary parser used to stop scanning after 50 lines,
    // so a `session_info` name appended at the end of a long session was
    // never read and the list fell back to the first message.
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let temp = std::env::temp_dir().join(format!("spopi-host-session-name-{nonce}"));
    let workspace = temp.join("workspace");
    let sessions = temp.join("sessions/project");
    fs::create_dir_all(&workspace).unwrap();
    fs::create_dir_all(&sessions).unwrap();
    let mut file = format!(
        "{{\"type\":\"session\",\"id\":\"session-a\",\"timestamp\":\"2026-01-01\",\"cwd\":{}}}\n",
        serde_json::to_string(&workspace.to_string_lossy()).unwrap(),
    );
    file.push_str(
        "{\"type\":\"message\",\"message\":{\"role\":\"user\",\"content\":\"first turn\"}}\n",
    );
    // Push well past the 50-line early-break threshold.
    for _ in 0..60 {
        file.push_str(
            "{\"type\":\"message\",\"message\":{\"role\":\"assistant\",\"content\":\"work\"}}\n",
        );
    }
    // The display name is appended at the very end.
    file.push_str("{\"type\":\"session_info\",\"name\":\"Generated title\"}\n");
    fs::write(sessions.join("long.jsonl"), file).unwrap();

    let data = HostDataPlane::new(HashMap::from([("workspace-a".into(), workspace)]))
        .unwrap()
        .with_session_root(temp.join("sessions"));

    let all = data.list_all_sessions("workspace-a").unwrap();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].id, "session-a");
    assert_eq!(all[0].name.as_deref(), Some("Generated title"));
    assert_eq!(all[0].first_message.as_deref(), Some("first turn"));
    fs::remove_dir_all(temp).unwrap();
}

#[test]
fn a_chat_kept_inside_the_project_is_listed_and_resolved() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let temp = std::env::temp_dir().join(format!("spopi-host-sessions-in-project-{nonce}"));
    let workspace = temp.join("workspace");
    let inside = workspace.join(".pi").join("sessions");
    fs::create_dir_all(&inside).unwrap();
    fs::create_dir_all(temp.join("agent").join("sessions")).unwrap();
    fs::write(
        workspace.join(".pi").join("settings.json"),
        "{ \"sessionDir\": \".pi/sessions\" }",
    )
    .unwrap();
    fs::write(
        inside.join("local.jsonl"),
        format!(
            "{{\"type\":\"session\",\"id\":\"session-local\",\"timestamp\":\"2026-01-01\",\"cwd\":{}}}\n{{\"type\":\"message\",\"message\":{{\"role\":\"user\",\"content\":\"kept inside\"}}}}\n",
            serde_json::to_string(&workspace.to_string_lossy()).unwrap()
        ),
    )
    .unwrap();
    let data = HostDataPlane::new(HashMap::from([("workspace-a".into(), workspace)]))
        .unwrap()
        .with_session_root(temp.join("agent").join("sessions"));

    let all = data.list_all_sessions("workspace-a").unwrap();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].id, "session-local");
    assert!(all[0].is_current_workspace);
    assert!(data
        .resolve_session_path("workspace-a", "session-local")
        .unwrap()
        .is_some());
    fs::remove_dir_all(temp).unwrap();
}

#[test]
fn list_all_sessions_skips_unreadable_session_files() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let temp = std::env::temp_dir().join(format!("spopi-host-sessions-unreadable-{nonce}"));
    let workspace = temp.join("workspace");
    let sessions = temp.join("sessions/project");
    fs::create_dir_all(&workspace).unwrap();
    fs::create_dir_all(&sessions).unwrap();
    fs::write(
            sessions.join("included.jsonl"),
            format!(
                "{{\"type\":\"session\",\"id\":\"session-a\",\"timestamp\":\"2026-01-01\",\"cwd\":{}}}\n{{\"type\":\"message\",\"message\":{{\"role\":\"user\",\"content\":\"hello from session\"}}}}\n",
                serde_json::to_string(&workspace.to_string_lossy()).unwrap()
            ),
        )
        .unwrap();
    let broken = sessions.join("broken.jsonl");
    fs::write(&broken, "").unwrap();
    fs::remove_file(&broken).unwrap();
    fs::create_dir(&broken).unwrap();
    let data = HostDataPlane::new(HashMap::from([("workspace-a".into(), workspace)]))
        .unwrap()
        .with_session_root(temp.join("sessions"));

    let all = data.list_all_sessions("workspace-a").unwrap();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].id, "session-a");
    fs::remove_dir_all(temp).unwrap();
}

#[test]
fn remove_session_file_trash_first_prefers_trash_and_falls_back_to_unlink() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let temp = std::env::temp_dir().join(format!("spopi-host-trash-first-{nonce}"));
    fs::create_dir_all(&temp).unwrap();
    let file = temp.join("session.jsonl");
    fs::write(&file, "{}").unwrap();

    // Trash succeeds → Ok, and the fallback unlink is never attempted
    // (proven by a second call on the same still-present file below).
    assert!(super::remove_session_file_trash_first_with(&file, |_| true).is_ok());
    assert!(file.exists());

    // Trash fails → permanent unlink fallback removes the file.
    assert!(super::remove_session_file_trash_first_with(&file, |_| false).is_ok());
    assert!(!file.exists());

    // Trash fails but the file is already gone → still Ok.
    assert!(super::remove_session_file_trash_first_with(&file, |_| false).is_ok());

    fs::remove_dir_all(temp).unwrap();
}

#[test]
fn deletes_sessions_by_id_across_projects_and_reports_missing_ids_as_errors() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let temp = std::env::temp_dir().join(format!("spopi-host-delete-{nonce}"));
    let workspace = temp.join("workspace");
    let other = temp.join("other");
    let sessions_a = temp.join("sessions/project-a");
    let sessions_b = temp.join("sessions/project-b");
    fs::create_dir_all(&workspace).unwrap();
    fs::create_dir_all(&other).unwrap();
    fs::create_dir_all(&sessions_a).unwrap();
    fs::create_dir_all(&sessions_b).unwrap();
    let file_a = sessions_a.join("a.jsonl");
    let file_b = sessions_b.join("b.jsonl");
    fs::write(
            &file_a,
            format!(
                "{{\"type\":\"session\",\"id\":\"session-a\",\"timestamp\":\"2026-01-01\",\"cwd\":{}}}\n{{\"type\":\"message\",\"message\":{{\"role\":\"user\",\"content\":\"hello\"}}}}\n",
                serde_json::to_string(&workspace.to_string_lossy()).unwrap()
            ),
        )
        .unwrap();
    fs::write(
            &file_b,
            format!(
                "{{\"type\":\"session\",\"id\":\"session-b\",\"timestamp\":\"2026-01-01\",\"cwd\":{}}}\n{{\"type\":\"message\",\"message\":{{\"role\":\"user\",\"content\":\"other project\"}}}}\n",
                serde_json::to_string(&other.to_string_lossy()).unwrap()
            ),
        )
        .unwrap();
    let data = HostDataPlane::new(HashMap::from([("workspace-a".into(), workspace)]))
        .unwrap()
        .with_session_root(temp.join("sessions"));

    let result = data
        .delete_sessions(&[
            "session-a".to_owned(),
            "session-b".to_owned(),
            "missing".to_owned(),
        ])
        .unwrap();
    assert_eq!(result.deleted, vec!["session-a", "session-b"]);
    assert_eq!(result.errors, vec!["missing"]);
    assert!(!file_a.exists());
    assert!(!file_b.exists());
    fs::remove_dir_all(temp).unwrap();
}

#[test]
fn deletes_session_files_that_are_not_visible_session_summaries() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let temp = std::env::temp_dir().join(format!("spopi-host-delete-hidden-{nonce}"));
    let workspace = temp.join("workspace");
    let sessions = temp.join("sessions/project");
    fs::create_dir_all(&workspace).unwrap();
    fs::create_dir_all(&sessions).unwrap();
    let file = sessions.join("empty.jsonl");
    fs::write(
            &file,
            format!(
                "{{\"type\":\"session\",\"id\":\"session-empty\",\"timestamp\":\"2026-01-01\",\"cwd\":{}}}\n{{\"type\":\"session_info\",\"name\":\"New thread\"}}\n",
                serde_json::to_string(&workspace.to_string_lossy()).unwrap()
            ),
        )
        .unwrap();
    let data = HostDataPlane::new(HashMap::from([("workspace-a".into(), workspace)]))
        .unwrap()
        .with_session_root(temp.join("sessions"));

    assert!(data.list_all_sessions("workspace-a").unwrap().is_empty());
    let result = data.delete_sessions(&["session-empty".to_owned()]).unwrap();

    assert_eq!(result.deleted, vec!["session-empty"]);
    assert!(result.errors.is_empty());
    assert!(!file.exists());
    fs::remove_dir_all(temp).unwrap();
}

#[test]
fn deletes_every_session_file_with_a_matching_id() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let temp = std::env::temp_dir().join(format!("spopi-host-delete-duplicates-{nonce}"));
    let workspace = temp.join("workspace");
    let sessions_a = temp.join("sessions/project-a");
    let sessions_b = temp.join("sessions/project-b");
    fs::create_dir_all(&workspace).unwrap();
    fs::create_dir_all(&sessions_a).unwrap();
    fs::create_dir_all(&sessions_b).unwrap();
    let file_a = sessions_a.join("a.jsonl");
    let file_b = sessions_b.join("b.jsonl");
    let contents = format!(
            "{{\"type\":\"session\",\"id\":\"session-a\",\"timestamp\":\"2026-01-01\",\"cwd\":{}}}\n{{\"type\":\"message\",\"message\":{{\"role\":\"user\",\"content\":\"hello\"}}}}\n",
            serde_json::to_string(&workspace.to_string_lossy()).unwrap()
        );
    fs::write(&file_a, &contents).unwrap();
    fs::write(&file_b, &contents).unwrap();
    let data = HostDataPlane::new(HashMap::from([("workspace-a".into(), workspace)]))
        .unwrap()
        .with_session_root(temp.join("sessions"));

    let result = data.delete_sessions(&["session-a".to_owned()]).unwrap();

    assert_eq!(result.deleted, vec!["session-a"]);
    assert!(result.errors.is_empty());
    assert!(!file_a.exists());
    assert!(!file_b.exists());
    assert!(data.list_all_sessions("workspace-a").unwrap().is_empty());
    fs::remove_dir_all(temp).unwrap();
}

#[test]
fn resolves_the_file_path_for_a_saved_session_in_the_workspace() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let temp = std::env::temp_dir().join(format!("spopi-host-resolve-{nonce}"));
    let workspace = temp.join("workspace");
    let other = temp.join("other");
    let sessions = temp.join("sessions/project");
    fs::create_dir_all(&workspace).unwrap();
    fs::create_dir_all(&other).unwrap();
    fs::create_dir_all(&sessions).unwrap();
    let included = sessions.join("included.jsonl");
    fs::write(
            &included,
            format!(
                "{{\"type\":\"session\",\"id\":\"session-a\",\"timestamp\":\"2026-01-01\",\"cwd\":{}}}\n{{\"type\":\"message\",\"message\":{{\"role\":\"user\",\"content\":\"hello\"}}}}\n",
                serde_json::to_string(&workspace.to_string_lossy()).unwrap()
            ),
        )
        .unwrap();
    fs::write(
            sessions.join("excluded.jsonl"),
            format!(
                "{{\"type\":\"session\",\"id\":\"session-b\",\"cwd\":{}}}\n{{\"type\":\"message\",\"message\":{{\"role\":\"user\",\"content\":\"private\"}}}}\n",
                serde_json::to_string(&other.to_string_lossy()).unwrap()
            ),
        )
        .unwrap();
    let data = HostDataPlane::new(HashMap::from([("workspace-a".into(), workspace)]))
        .unwrap()
        .with_session_root(temp.join("sessions"));

    assert_eq!(
        data.resolve_session_path("workspace-a", "session-a")
            .unwrap(),
        Some(included)
    );
    // A session owned by another workspace is not resolvable here.
    assert_eq!(
        data.resolve_session_path("workspace-a", "session-b")
            .unwrap(),
        None
    );
    // Unknown session id resolves to nothing.
    assert_eq!(
        data.resolve_session_path("workspace-a", "missing").unwrap(),
        None
    );
    fs::remove_dir_all(temp).unwrap();
}

#[cfg(unix)]
#[test]
fn resolve_session_path_reuses_the_index_without_rescanning_the_directory() {
    use std::os::unix::fs::PermissionsExt;

    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let temp = std::env::temp_dir().join(format!("spopi-host-resolve-index-{nonce}"));
    let workspace = temp.join("workspace");
    let sessions = temp.join("sessions");
    // A single project directory holds both session files, so *any* full
    // rescan (naive or otherwise) is forced to descend into it — there is
    // nowhere else in the tree to find a match. That makes the
    // permission-denied trick below deterministic, independent of
    // whatever order the OS happens to return directory entries in.
    let project = sessions.join("project");
    fs::create_dir_all(&workspace).unwrap();
    fs::create_dir_all(&project).unwrap();
    let write_session = |file: &str, id: &str| {
        fs::write(
                project.join(file),
                format!(
                    "{{\"type\":\"session\",\"id\":\"{id}\",\"timestamp\":\"2026-01-01\",\"cwd\":{}}}\n{{\"type\":\"message\",\"message\":{{\"role\":\"user\",\"content\":\"hello\"}}}}\n",
                    serde_json::to_string(&workspace.to_string_lossy()).unwrap()
                ),
            )
            .unwrap();
    };
    write_session("a.jsonl", "session-a");
    let included_b = project.join("b.jsonl");
    write_session("b.jsonl", "session-b");
    let data = HostDataPlane::new(HashMap::from([("workspace-a".into(), workspace)]))
        .unwrap()
        .with_session_root(sessions.clone());

    // Cold lookup for session-a has to walk the session root — during
    // that walk it also encounters session-b's file and, per
    // resolve_session_path's populate-during-scan behavior, indexes it
    // too even though nobody asked for it yet.
    assert!(data
        .resolve_session_path("workspace-a", "session-a")
        .unwrap()
        .is_some());

    // Revoke the *list* permission (read) on the project directory while
    // keeping *traverse* (execute) so a direct stat of a known file path
    // still succeeds (what the fast path does) but `std::fs::read_dir`
    // (what a full rescan does to enumerate files) deterministically
    // fails with a permission-denied `HostDataError::Io`.
    let mut perms = fs::metadata(&project).unwrap().permissions();
    perms.set_mode(0o111);
    fs::set_permissions(&project, perms.clone()).unwrap();

    // Resolving session-b must succeed straight from the index: the only
    // way to find it at all right now is via the cache, since walking
    // into `project` to look for it would error. A correct answer here
    // proves resolve_session_path is not doing a full rescan on this call.
    let resolved = data.resolve_session_path("workspace-a", "session-b");
    perms.set_mode(0o755);
    fs::set_permissions(&project, perms).unwrap();
    assert_eq!(resolved.unwrap(), Some(included_b));

    fs::remove_dir_all(temp).unwrap();
}

#[test]
fn searches_only_the_registered_workspace_and_returns_snippets() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let temp = std::env::temp_dir().join(format!("spopi-host-search-{nonce}"));
    let workspace = temp.join("workspace");
    let other = temp.join("other");
    let sessions = temp.join("sessions/project");
    fs::create_dir_all(&workspace).unwrap();
    fs::create_dir_all(&other).unwrap();
    fs::create_dir_all(&sessions).unwrap();
    fs::write(
            sessions.join("included.jsonl"),
            format!(
                "{{\"type\":\"session\",\"id\":\"session-a\",\"timestamp\":\"2026-01-01\",\"cwd\":{}}}\n{{\"type\":\"message\",\"message\":{{\"role\":\"user\",\"content\":\"please refactor the widget factory\"}}}}\n",
                serde_json::to_string(&workspace.to_string_lossy()).unwrap()
            ),
        )
        .unwrap();
    fs::write(
            sessions.join("excluded.jsonl"),
            format!(
                "{{\"type\":\"session\",\"id\":\"session-b\",\"cwd\":{}}}\n{{\"type\":\"message\",\"message\":{{\"role\":\"user\",\"content\":\"refactor this too\"}}}}\n",
                serde_json::to_string(&other.to_string_lossy()).unwrap()
            ),
        )
        .unwrap();
    let data = HostDataPlane::new(HashMap::from([("workspace-a".into(), workspace)]))
        .unwrap()
        .with_session_root(temp.join("sessions"));

    let results = data.search_sessions("workspace-a", "widget").unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].session_id, "session-a");
    assert!(results[0].matches[0].snippet.contains("widget"));

    assert!(
        data.search_sessions("workspace-a", "refactor")
            .unwrap()
            .len()
            == 1
    );
    assert!(data.search_sessions("missing", "widget").is_err());
    fs::remove_dir_all(temp).unwrap();
}

#[test]
fn builds_cost_dashboard_across_all_projects() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let temp = std::env::temp_dir().join(format!("spopi-host-cost-{nonce}"));
    let workspace = temp.join("workspace");
    let other = temp.join("other");
    let sessions = temp.join("sessions/project");
    fs::create_dir_all(&workspace).unwrap();
    fs::create_dir_all(&other).unwrap();
    fs::create_dir_all(&sessions).unwrap();
    fs::write(
            sessions.join("included.jsonl"),
            format!(
                "{{\"type\":\"session\",\"id\":\"session-a\",\"timestamp\":\"2026-01-01\",\"cwd\":{}}}\n{{\"type\":\"message\",\"message\":{{\"role\":\"user\",\"content\":\"hi\"}}}}\n{{\"type\":\"message\",\"message\":{{\"role\":\"assistant\",\"model\":\"gpt-5\",\"usage\":{{\"input\":10,\"output\":20,\"cost\":{{\"total\":0.5}}}},\"content\":[{{\"type\":\"toolCall\",\"name\":\"bash\"}}]}}}}\n",
                serde_json::to_string(&workspace.to_string_lossy()).unwrap()
            ),
        )
        .unwrap();
    fs::write(
            sessions.join("excluded.jsonl"),
            format!(
                "{{\"type\":\"session\",\"id\":\"session-b\",\"cwd\":{}}}\n{{\"type\":\"message\",\"message\":{{\"role\":\"assistant\",\"model\":\"gpt-5\",\"usage\":{{\"cost\":{{\"total\":99.0}}}}}}}}\n",
                serde_json::to_string(&other.to_string_lossy()).unwrap()
            ),
        )
        .unwrap();
    let data = HostDataPlane::new(HashMap::from([("workspace-a".into(), workspace)]))
        .unwrap()
        .with_session_root(temp.join("sessions"));

    let dashboard = data.cost_dashboard("workspace-a").unwrap();
    // Both projects are aggregated, not just the registered workspace.
    assert_eq!(dashboard.summary.session_count, 2);
    assert_eq!(dashboard.summary.total_cost, 99.5);
    assert_eq!(dashboard.summary.total_tokens, 30);
    assert_eq!(dashboard.by_model[0].name, "gpt-5");
    assert_eq!(dashboard.by_tool[0].name, "bash");
    // The most expensive session sorts first.
    assert_eq!(dashboard.top_sessions[0].id, "session-b");
    fs::remove_dir_all(temp).unwrap();
}

#[test]
fn cost_dashboard_reuses_parsed_metrics_until_a_file_changes() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let temp = std::env::temp_dir().join(format!("spopi-host-cost-cache-{nonce}"));
    let workspace = temp.join("workspace");
    let sessions = temp.join("sessions/project");
    fs::create_dir_all(&workspace).unwrap();
    fs::create_dir_all(&sessions).unwrap();
    let session_path = sessions.join("session-a.jsonl");
    fs::write(
            &session_path,
            format!(
                "{{\"type\":\"session\",\"id\":\"session-a\",\"cwd\":{}}}\n{{\"type\":\"message\",\"message\":{{\"role\":\"assistant\",\"model\":\"gpt-5\",\"usage\":{{\"input\":10,\"output\":20,\"cost\":{{\"total\":1.0}}}}}}}}\n",
                serde_json::to_string(&workspace.to_string_lossy()).unwrap(),
            ),
        )
        .unwrap();
    let data = HostDataPlane::new(HashMap::from([("workspace-a".into(), workspace)]))
        .unwrap()
        .with_session_root(temp.join("sessions"));

    let first = data.cost_dashboard("workspace-a").unwrap();
    assert_eq!(first.summary.total_cost, 1.0);

    // An unchanged file is served from the cache: same totals.
    let second = data.cost_dashboard("workspace-a").unwrap();
    assert_eq!(second.summary.total_cost, 1.0);

    // Appending changes (mtime, len) so the stale entry is re-parsed and
    // replaced with the updated metrics.
    let mut updated = fs::read_to_string(&session_path).unwrap();
    updated.push_str(
            "{\"type\":\"message\",\"message\":{\"role\":\"assistant\",\"model\":\"gpt-5\",\"usage\":{\"input\":1,\"output\":2,\"cost\":{\"total\":2.0}}}}\n",
        );
    fs::write(&session_path, updated).unwrap();
    let third = data.cost_dashboard("workspace-a").unwrap();
    assert_eq!(third.summary.total_cost, 3.0);

    fs::remove_dir_all(temp).unwrap();
}

#[test]
fn opens_convertible_preview_input_inside_the_registered_workspace() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let temp = std::env::temp_dir().join(format!("spopi-host-document-{nonce}"));
    let workspace = temp.join("workspace");
    fs::create_dir_all(&workspace).unwrap();
    fs::write(workspace.join("report.docx"), b"document bytes").unwrap();
    let data = HostDataPlane::new(HashMap::from([("workspace-a".into(), workspace)])).unwrap();

    let source = data
        .read_convertible_file("workspace-a", "report.docx")
        .unwrap()
        .unwrap();
    assert_eq!(source.suffix, "docx");
    assert_eq!(source.bytes, b"document bytes");
    assert!(data
        .read_convertible_file("workspace-a", "notes.csv")
        .unwrap()
        .is_none());
    fs::remove_dir_all(temp).unwrap();
}

#[test]
fn golden_session_fixture_reports_summary_tree_messages_and_cost() {
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../tests/fixtures/pi-sessions/0.87.1/scripted.jsonl");
    let entries = read_jsonl_entries(&path).unwrap();
    let types: Vec<&str> = entries
        .iter()
        .filter_map(|entry| entry.get("type").and_then(|value| value.as_str()))
        .collect();
    for kind in [
        "session",
        "session_info",
        "message",
        "thinking_level_change",
        "model_change",
        "usage",
        "compaction",
        "branch_summary",
        "custom",
        "custom_message",
        "context_edit",
        "label",
    ] {
        assert!(types.contains(&kind), "{kind}");
    }
    let assistant = entries
        .iter()
        .find(|entry| entry.get("id").and_then(|value| value.as_str()) == Some("assistant-1"))
        .unwrap();
    assert_eq!(
        assistant.get("parentId").and_then(|value| value.as_str()),
        Some("user-1")
    );
    assert_eq!(
        assistant
            .pointer("/message/role")
            .and_then(|value| value.as_str()),
        Some("assistant")
    );
    let metrics = parse_session_metrics(&path, None).unwrap().unwrap();
    assert!((metrics.total_cost - 0.25).abs() < 1e-9);
    let summary = parse_session_summary_with_metadata(&path, 1)
        .unwrap()
        .unwrap();
    assert_eq!(summary.id, "scripted");
    assert_eq!(summary.name.as_deref(), Some("Scripted"));
    assert_eq!(summary.first_message.as_deref(), Some("hello fixture"));
}

#[test]
fn parse_session_metrics_counts_cache_warm_usage() {
    let dir = std::env::temp_dir().join(format!("spopi-warm-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let path = dir.join("session.jsonl");
    fs::write(
            &path,
            "{\"type\":\"session\",\"id\":\"s\",\"timestamp\":\"t\",\"cwd\":\"/work\"}\n{\"type\":\"usage\",\"id\":\"u\",\"kind\":\"cache_warm\",\"model\":\"m\",\"usage\":{\"input\":1,\"output\":2,\"cacheRead\":50,\"cacheWrite\":3,\"cost\":{\"total\":0.4}}}\n",
        )
        .unwrap();
    let metrics = parse_session_metrics(&path, None).unwrap().unwrap();
    assert_eq!(metrics.input_tokens, 1);
    assert_eq!(metrics.output_tokens, 2);
    assert_eq!(metrics.cache_read, 50);
    assert_eq!(metrics.cache_write, 3);
    assert!((metrics.total_cost - 0.4).abs() < 1e-9);
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn persisted_summary_hit_skips_parse_until_the_file_changes() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let temp = std::env::temp_dir().join(format!("spopi-summary-cache-{nonce}"));
    let workspace = temp.join("workspace");
    fs::create_dir_all(&workspace).unwrap();
    let file = temp.join("session.jsonl");
    fs::write(
        &file,
        format!(
            "{{\"type\":\"session\",\"id\":\"session-a\",\"timestamp\":\"2026-01-01\",\"cwd\":{}}}\n{{\"type\":\"message\",\"id\":\"user-1\",\"message\":{{\"role\":\"user\",\"content\":\"from-file\"}}}}\n",
            serde_json::to_string(&workspace.to_string_lossy()).unwrap()
        ),
    )
    .unwrap();
    let store = std::sync::Arc::new(std::sync::Mutex::new(
        super::metadata_store::MetadataStore::open(&temp.join("spopi.sqlite3")).unwrap(),
    ));
    let mut data = HostDataPlane::new(HashMap::from([("workspace-a".into(), workspace)])).unwrap();
    let meta = std::fs::metadata(&file).unwrap();
    let mtime = super::session_format::metadata_modified_at_ms(&meta);
    store
        .lock()
        .unwrap()
        .write_cache(
            "session_summary_cache",
            &file.to_string_lossy(),
            mtime as i64,
            meta.len() as i64,
            &serde_json::json!({
                "id": "cached",
                "timestamp": "t",
                "name": "from-cache",
                "firstMessage": null,
                "workspaceId": "workspace-a",
                "projectPath": "/p",
                "projectName": "p",
                "isRemote": false,
                "isCurrentWorkspace": true,
                "filePath": file.to_string_lossy(),
                "fileName": "session.jsonl",
                "modifiedAtMs": mtime,
                "activityAtMs": mtime
            })
            .to_string(),
        )
        .unwrap();
    data.attach_metadata(store);
    let hit = data.cached_session_summary(&file).unwrap().unwrap();
    assert_eq!(hit.name.as_deref(), Some("from-cache"));
    fs::write(&file, "not json\n").unwrap();
    let again = data.cached_session_summary(&file).unwrap();
    assert!(again.is_none() || again.unwrap().name.as_deref() != Some("from-cache"));
    let _ = fs::remove_dir_all(temp);
}
