// ABOUTME: Exercises static-dir resolution and the fresh startup target choice.
// ABOUTME: The module under test is the process entry in main.rs.

#[cfg(target_os = "macos")]
use super::set_press_and_hold_enabled;
use super::{
    choose_latest_existing_boot_target, find_latest_session_boot_target, resolve_static_dir,
    select_fresh_startup_target,
};
use crate::data::app_paths::resolve_app_data_dir;
use crate::data::metadata_store::MetadataStore;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

#[test]
fn app_data_dir_prefers_the_override() {
    let default_dir = PathBuf::from("default-data");
    assert_eq!(resolve_app_data_dir(None, default_dir.clone()), default_dir);
    assert_eq!(
        resolve_app_data_dir(Some("  ".into()), default_dir.clone()),
        default_dir
    );
    assert_eq!(
        resolve_app_data_dir(Some(" D:/scratch ".into()), default_dir),
        PathBuf::from("D:/scratch")
    );
}

fn unique_temp_dir(label: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("spopi-{label}-{suffix}"))
}

#[cfg(target_os = "macos")]
#[test]
fn press_and_hold_helper_disables_accent_picker() {
    let mut value = true;
    set_press_and_hold_enabled(|enabled| value = enabled);
    assert!(!value);
}

#[test]
fn debug_build_prefers_workspace_public_over_bundled_copy() {
    let root = unique_temp_dir("static-dir-debug");
    let workspace_public = root.join("workspace").join("public");
    let bundled_public = root.join("bundled").join("public");

    fs::create_dir_all(&workspace_public).unwrap();
    fs::create_dir_all(&bundled_public).unwrap();
    fs::write(workspace_public.join("index.html"), "workspace").unwrap();
    fs::write(bundled_public.join("index.html"), "bundled").unwrap();

    let resolved = resolve_static_dir(
        Some(root.join("bundled")),
        workspace_public.clone(),
        Some(root.join("workspace")),
        true,
    );

    assert_eq!(resolved, fs::canonicalize(&workspace_public).unwrap());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn keeps_the_latest_workspace_but_never_resumes_its_session_on_app_start() {
    let workspace = unique_temp_dir("startup-ws");
    fs::create_dir_all(&workspace).unwrap();
    let cwd = workspace.to_string_lossy().into_owned();
    let selected = select_fresh_startup_target(
        Some((cwd.clone(), "/sessions/old-session.jsonl".to_string())),
        || panic!("no-project folder must not be created when a workspace exists"),
    );
    assert_eq!(selected, (cwd, None));
    let _ = fs::remove_dir_all(workspace);
}

#[test]
fn uses_the_no_project_folder_when_latest_session_workspace_is_gone() {
    let selected = select_fresh_startup_target(
        Some((
            "/definitely-missing-spopi-workspace/does-not-exist".to_string(),
            "/sessions/old-session.jsonl".to_string(),
        )),
        || "/home/user/SPOPI/2026-09-27-1135".to_string(),
    );
    assert_eq!(
        selected,
        ("/home/user/SPOPI/2026-09-27-1135".to_string(), None)
    );
    let none = select_fresh_startup_target(None, || "/home/user/SPOPI/x".to_string());
    assert_eq!(none.0, "/home/user/SPOPI/x");
}

#[test]
fn startup_finds_chats_inside_a_project_and_skips_a_closed_one() {
    let root = unique_temp_dir("boot-projects");
    let agent = root.join("agent");
    fs::create_dir_all(agent.join("sessions")).unwrap();
    let project = crate::data::paths::canonical_path(&{
        let dir = root.join("proj");
        fs::create_dir_all(dir.join(".pi").join("sessions")).unwrap();
        dir
    })
    .unwrap();
    fs::write(
        project.join(".pi").join("settings.json"),
        "{ \"sessionDir\": \".pi/sessions\" }",
    )
    .unwrap();
    fs::write(
        project.join(".pi").join("sessions").join("chat.jsonl"),
        format!(
            "{}\n",
            serde_json::json!({ "type": "session", "id": "s", "cwd": project.to_string_lossy() })
        ),
    )
    .unwrap();
    let mut store = MetadataStore::open(&root.join("db.sqlite3")).unwrap();
    let id = store.workspace_id_for_path(&project).unwrap();

    let found = find_latest_session_boot_target(&store, &agent).unwrap();
    assert_eq!(found.0, project.to_string_lossy());

    store
        .remember_hidden_workspace(&id, &project.to_string_lossy())
        .unwrap();
    assert!(find_latest_session_boot_target(&store, &agent).is_none());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn skips_deleted_workspace_and_uses_next_existing_session() {
    let gone = unique_temp_dir("gone-ws");
    let live = unique_temp_dir("live-ws");
    fs::create_dir_all(&live).unwrap();
    let picked = choose_latest_existing_boot_target(vec![
        (
            gone.to_string_lossy().into_owned(),
            "newer-missing.jsonl".to_string(),
        ),
        (
            live.to_string_lossy().into_owned(),
            "older-live.jsonl".to_string(),
        ),
    ]);
    assert_eq!(
        picked,
        Some((
            live.to_string_lossy().into_owned(),
            "older-live.jsonl".to_string()
        ))
    );
    let _ = fs::remove_dir_all(live);
}
