// ABOUTME: Project host ops: create, sweep, chat report, relink, keep chats, rename, close.
// ABOUTME: Every op that moves files first stops the project's Pi processes and terminals.

use super::super::HostState;
use crate::data::metadata_store::MetadataStore;
use crate::data::session_relocate::{
    foreign_chats, keep_chats_in_project, relink_chats, relocate_project, Relocation,
};
use crate::data::HostDataPlane;
use crate::pi::runtime::PiRuntime;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

type OpError = (&'static str, String);

pub(crate) async fn dispatch(
    state: &HostState,
    request_id: &str,
    operation: &str,
    frame: &Value,
) -> Result<Value, OpError> {
    let body = match operation {
        "create_project" => {
            let metadata = metadata(state)?;
            let data = state.data.clone();
            let (workspace_id, path) = blocking(move || create_project(&metadata, &data)).await?;
            json!({ "workspaceId": workspace_id, "projectPath": path })
        }
        "sweep_project" => {
            let project = project_path_param(frame)?;
            let metadata = metadata(state)?;
            stop_terminals(state, &project);
            let runtimes = state.runtimes.clone();
            let removed = blocking(move || sweep_project(&metadata, &runtimes, &project)).await?;
            json!({ "removed": removed })
        }
        "project_chats" => {
            let project = project_path_param(frame)?;
            let agent = agent_dir()?;
            let metadata = metadata(state)?;
            blocking(move || {
                let root = projects_root(&*lock(&metadata)?);
                Ok(chat_report(&project, &agent, &root))
            })
            .await?
        }
        "relink_project" => {
            let project = project_path_param(frame)?;
            let agent = agent_dir()?;
            stop_terminals(state, &project);
            let runtimes = state.runtimes.clone();
            let metadata = state.metadata.clone();
            let report = blocking(move || {
                stop_runtimes(metadata.as_ref(), &runtimes, &project);
                relink_chats(&project, &agent)
            })
            .await?;
            relocation_json(&report)
        }
        "keep_chats_in_project" => {
            let project = project_path_param(frame)?;
            let agent = agent_dir()?;
            stop_terminals(state, &project);
            let runtimes = state.runtimes.clone();
            let metadata = state.metadata.clone();
            let report = blocking(move || {
                stop_runtimes(metadata.as_ref(), &runtimes, &project);
                keep_chats_in_project(&project, &agent)
            })
            .await?;
            relocation_json(&report)
        }
        "rename_project" => {
            let project = project_path_param(frame)?;
            let name = frame
                .get("name")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or(("invalid_name", "name is required".into()))?
                .to_owned();
            if let Some(reason) = invalid_folder_name(&name) {
                return Err(("invalid_name", reason.into()));
            }
            let agent = agent_dir()?;
            stop_terminals(state, &project);
            let data = state.data.clone();
            let runtimes = state.runtimes.clone();
            let metadata = state.metadata.clone();
            let renamed = blocking(move || {
                rename_project(&data, &runtimes, metadata.as_ref(), &project, &name, &agent)
            })
            .await?;
            json!({
                "projectPath": renamed.path,
                "worktreeWarning": renamed.worktree_warning,
                "failed": renamed.relocation.failed,
            })
        }
        "close_project" => {
            let project = project_path_param(frame)?;
            let metadata = metadata(state)?;
            stop_terminals(state, &project);
            let runtimes = state.runtimes.clone();
            let hidden = blocking(move || {
                stop_runtimes(Some(&metadata), &runtimes, &project);
                let mut store = lock(&metadata)?;
                let id = store.workspace_id_for_path(&project).unwrap_or_default();
                store.remember_hidden_workspace(&id, &project.to_string_lossy())
            })
            .await?;
            json!({ "hidden": hidden })
        }
        _ => {
            return Err((
                "host_operation_unimplemented",
                "Host operation is not implemented on protocol v2".into(),
            ))
        }
    };
    let mut response = json!({
        "type": "host_response",
        "requestId": request_id,
        "operation": operation,
    });
    if let (Some(target), Some(source)) = (response.as_object_mut(), body.as_object()) {
        target.extend(source.clone());
    }
    Ok(response)
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, OpError> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|error| ("host_operation_failed", error.to_string()))?
        .map_err(|message| ("project_operation_failed", message))
}

fn metadata(state: &HostState) -> Result<Arc<Mutex<MetadataStore>>, OpError> {
    state.metadata.clone().ok_or((
        "host_operation_failed",
        "Preference store is not available".into(),
    ))
}

fn lock(
    metadata: &Mutex<MetadataStore>,
) -> Result<std::sync::MutexGuard<'_, MetadataStore>, String> {
    metadata
        .lock()
        .map_err(|_| "Preference store is busy".to_owned())
}

fn project_path_param(frame: &Value) -> Result<PathBuf, OpError> {
    frame
        .get("projectPath")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .ok_or(("invalid_project_path", "projectPath is required".into()))
}

fn agent_dir() -> Result<PathBuf, OpError> {
    crate::pi::binary::pi_agent_dir().ok_or((
        "host_operation_failed",
        "Pi agent directory is not available".into(),
    ))
}

fn relocation_json(report: &Relocation) -> Value {
    json!({ "moved": report.moved, "rewritten": report.rewritten, "failed": report.failed })
}

fn stop_terminals(state: &HostState, project: &Path) {
    state.terminal_manager.kill_workspace(project);
}

/// Stop the Pi processes running in this project, so its folder and chat
/// files are free to move.
fn stop_runtimes(
    metadata: Option<&Arc<Mutex<MetadataStore>>>,
    runtimes: &PiRuntime,
    project: &Path,
) {
    let id = metadata
        .and_then(|store| store.lock().ok())
        .and_then(|mut store| store.workspace_id_for_path(project).ok());
    if let Some(id) = id {
        runtimes.stop_workspace(&id);
    }
}

fn projects_root(store: &MetadataStore) -> PathBuf {
    use crate::data::projects_folder::{resolve_projects_folder, PROJECTS_FOLDER_PREF};
    let home = dirs::home_dir().unwrap_or_default();
    let preference = store
        .preference_get(PROJECTS_FOLDER_PREF)
        .ok()
        .flatten()
        .and_then(|value| value.as_str().map(str::to_owned));
    resolve_projects_folder(preference.as_deref(), &home)
}

/// A dated folder in the Projects folder, scaffolded and registered so a chat
/// can start in it right away.
fn create_project(
    metadata: &Mutex<MetadataStore>,
    data: &HostDataPlane,
) -> Result<(String, String), String> {
    use crate::data::projects_folder::{chat_folder_stamp, fresh_chat_folder, scaffold_project};
    let mut store = lock(metadata)?;
    let root = projects_root(&store);
    let folder = fresh_chat_folder(&root, &chat_folder_stamp())?;
    scaffold_project(&folder)?;
    let workspace_id = store.workspace_id_for_path(&folder)?;
    data.register_workspace(&workspace_id, folder.clone())
        .map_err(|error| format!("Cannot register {}: {error:?}", folder.display()))?;
    let path = crate::data::paths::canonical_path(&folder)
        .unwrap_or(folder)
        .to_string_lossy()
        .into_owned();
    Ok((workspace_id, path))
}

fn sweep_project(
    metadata: &Arc<Mutex<MetadataStore>>,
    runtimes: &PiRuntime,
    project: &Path,
) -> Result<bool, String> {
    use crate::data::projects_folder::is_untouched_dated_project;
    let root = projects_root(&*lock(metadata)?);
    let root = crate::data::paths::canonical_path(&root).unwrap_or(root);
    if !is_untouched_dated_project(project, &root) {
        return Ok(false);
    }
    stop_runtimes(Some(metadata), runtimes, project);
    // Pi may have written its first chat while it was being stopped.
    if !is_untouched_dated_project(project, &root) {
        return Ok(false);
    }
    std::fs::remove_dir_all(project)
        .map(|_| true)
        .map_err(|error| format!("Cannot remove {}: {error}", project.display()))
}

fn chat_report(project: &Path, agent: &Path, projects_root: &Path) -> Value {
    let foreign = foreign_chats(project, agent);
    let recorded_at = foreign.first().cloned().unwrap_or_default();
    let comparable = |path: &Path| {
        crate::data::paths::strip_verbatim_prefix(&path.to_string_lossy())
            .trim_end_matches(['/', '\\'])
            .to_lowercase()
    };
    let in_projects_folder = project
        .parent()
        .is_some_and(|parent| comparable(parent) == comparable(projects_root));
    json!({
        "foreign": foreign.len(),
        "recordedExists": !recorded_at.is_empty() && Path::new(&recorded_at).is_dir(),
        "recordedAt": recorded_at,
        "insideProject": crate::data::session_dirs::session_dir_for(project, agent)
            .starts_with(project),
        "inProjectsFolder": in_projects_folder,
    })
}

const RESERVED_NAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// A folder name Windows accepts. `None` when it is fine.
fn invalid_folder_name(name: &str) -> Option<&'static str> {
    if name.chars().count() > 120 {
        return Some("The name is too long");
    }
    if name == "." || name == ".." {
        return Some("The name cannot be . or ..");
    }
    if name.ends_with('.') || name.ends_with(' ') {
        return Some("The name cannot end with a dot or a space");
    }
    if name
        .chars()
        .any(|ch| r#"<>:"/\|?*"#.contains(ch) || ch.is_control())
    {
        return Some("The name contains a character a folder cannot use");
    }
    let stem = name.split('.').next().unwrap_or(name);
    if RESERVED_NAMES
        .iter()
        .any(|reserved| stem.eq_ignore_ascii_case(reserved))
    {
        return Some("The name is reserved by Windows");
    }
    None
}

#[derive(Debug)]
struct RenamedProject {
    path: String,
    worktree_warning: Option<String>,
    relocation: Relocation,
}

/// Rename the project folder and bring its chats, records and git worktrees
/// along. A refused rename changes nothing.
fn rename_project(
    data: &HostDataPlane,
    runtimes: &PiRuntime,
    metadata: Option<&Arc<Mutex<MetadataStore>>>,
    project: &Path,
    name: &str,
    agent: &Path,
) -> Result<RenamedProject, String> {
    let from = crate::data::paths::canonical_path(project)
        .map_err(|error| format!("Cannot find {}: {error}", project.display()))?;
    let to = from
        .parent()
        .ok_or("The project folder has no parent")?
        .join(name);
    let unchanged = RenamedProject {
        path: from.to_string_lossy().into_owned(),
        worktree_warning: None,
        relocation: Relocation::default(),
    };
    if to.as_os_str() == from.as_os_str() {
        return Ok(unchanged);
    }
    let case_only = from
        .to_string_lossy()
        .eq_ignore_ascii_case(&to.to_string_lossy());
    if to.exists() && !case_only {
        return Err(format!("A folder named {name} already exists"));
    }
    let workspace_id = metadata
        .and_then(|store| store.lock().ok())
        .and_then(|mut store| store.workspace_id_for_path(&from).ok());
    if let Some(id) = &workspace_id {
        runtimes.stop_workspace(id);
    }
    if let Err(error) = std::fs::rename(&from, &to) {
        return Err(format!(
            "Another program is using the folder, so it was not renamed ({error}). Close it and try again."
        ));
    }
    let relocation = match relocate_project(&from, &to, agent) {
        Ok(relocation) => relocation,
        Err(error) => {
            let _ = std::fs::rename(&to, &from);
            return Err(error);
        }
    };
    let new_path = to.to_string_lossy().into_owned();
    if let Some(id) = &workspace_id {
        if let Some(store) = metadata {
            lock(store)?.retarget_workspace(id, &new_path)?;
        }
        data.register_workspace(id, to.clone())
            .map_err(|error| format!("Cannot register {}: {error:?}", to.display()))?;
    }
    Ok(RenamedProject {
        path: new_path,
        worktree_warning: repair_worktrees(&to),
        relocation,
    })
}

/// Git records worktree paths absolutely, so a renamed repo needs a repair.
fn repair_worktrees(project: &Path) -> Option<String> {
    if !project.join(".git").exists() {
        return None;
    }
    let output = std::process::Command::new("git")
        .args(["worktree", "repair"])
        .current_dir(project)
        .output();
    match output {
        Ok(output) if output.status.success() => None,
        Ok(output) => {
            let detail = String::from_utf8_lossy(&output.stderr).trim().to_owned();
            Some(if detail.is_empty() {
                "git worktree repair failed. Run it in the project to fix its worktrees.".to_owned()
            } else {
                detail
            })
        }
        Err(error) => Some(format!("Cannot run git worktree repair: {error}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::fs;

    fn root() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    fn plane() -> HostDataPlane {
        HostDataPlane::new(HashMap::new()).unwrap()
    }

    fn canonical(path: &Path) -> PathBuf {
        crate::data::paths::canonical_path(path).unwrap()
    }

    #[test]
    fn rejects_names_windows_cannot_use() {
        for bad in [
            "CON", "nul", "com1.txt", "a:b", "ends.", "ends ", "..", "a|b",
        ] {
            assert!(invalid_folder_name(bad).is_some(), "{bad}");
        }
        for good in ["ok-name", "2026-09-29_07-30-05", "Console"] {
            assert!(invalid_folder_name(good).is_none(), "{good}");
        }
    }

    #[test]
    fn rename_moves_the_folder_its_chats_and_its_records() {
        let root = root();
        let base = canonical(root.path());
        let agent = base.join("agent");
        let project = base.join("alpha");
        fs::create_dir_all(project.join(".pi").join("sessions")).unwrap();
        fs::write(
            project.join(".pi").join("settings.json"),
            "{ \"sessionDir\": \".pi/sessions\" }",
        )
        .unwrap();
        fs::write(
            project.join(".pi").join("sessions").join("one.jsonl"),
            format!(
                "{}\n",
                json!({ "type": "session", "id": "s1", "cwd": project.to_string_lossy() })
            ),
        )
        .unwrap();
        let store = Arc::new(Mutex::new(
            MetadataStore::open(&base.join("db.sqlite3")).unwrap(),
        ));
        let id = store
            .lock()
            .unwrap()
            .workspace_id_for_path(&project)
            .unwrap();
        store
            .lock()
            .unwrap()
            .preference_set(
                "ui.sessions.pinnedItems",
                &json!({ "workspaces": [project.to_string_lossy()] }),
            )
            .unwrap();

        let renamed = rename_project(
            &plane(),
            &PiRuntime::new(4),
            Some(&store),
            &project,
            "beta",
            &agent,
        )
        .unwrap();
        let beta = base.join("beta");
        assert_eq!(renamed.path, beta.to_string_lossy());
        assert!(!project.exists());
        let chat = fs::read_to_string(beta.join(".pi").join("sessions").join("one.jsonl")).unwrap();
        assert!(chat.contains(&json!(beta.to_string_lossy()).to_string()));
        let guard = store.lock().unwrap();
        assert_eq!(
            guard.workspace_id_for_stored_path(&renamed.path).unwrap(),
            Some(id)
        );
        assert_eq!(
            guard.preference_get("ui.sessions.pinnedItems").unwrap(),
            Some(json!({ "workspaces": [beta.to_string_lossy()] }))
        );
    }

    #[test]
    fn a_collision_is_refused_and_a_case_only_rename_works() {
        let root = root();
        let base = canonical(root.path());
        let agent = base.join("agent");
        fs::create_dir(base.join("alpha")).unwrap();
        fs::create_dir(base.join("taken")).unwrap();
        let error = rename_project(
            &plane(),
            &PiRuntime::new(4),
            None,
            &base.join("alpha"),
            "taken",
            &agent,
        )
        .unwrap_err();
        assert!(error.contains("already exists"));
        assert!(base.join("alpha").is_dir());

        rename_project(
            &plane(),
            &PiRuntime::new(4),
            None,
            &base.join("alpha"),
            "Alpha",
            &agent,
        )
        .unwrap();
        let mut names: Vec<String> = fs::read_dir(&base)
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        assert_eq!(names, vec!["Alpha".to_owned(), "taken".to_owned()]);
    }

    #[cfg(windows)]
    #[test]
    fn a_folder_in_use_is_left_as_it_was() {
        let root = root();
        let base = canonical(root.path());
        let project = base.join("busy");
        fs::create_dir(&project).unwrap();
        let mut holder = std::process::Command::new("cmd")
            .args(["/c", "ping", "-n", "6", "127.0.0.1"])
            .current_dir(&project)
            .stdout(std::process::Stdio::null())
            .spawn()
            .unwrap();
        std::thread::sleep(std::time::Duration::from_millis(300));
        let result = rename_project(
            &plane(),
            &PiRuntime::new(4),
            None,
            &project,
            "free",
            &base.join("agent"),
        );
        let _ = holder.kill();
        let _ = holder.wait();
        let error = result.unwrap_err();
        assert!(error.contains("Another program"), "{error}");
        assert!(project.is_dir());
        assert!(!base.join("free").exists());
    }

    #[test]
    fn renaming_a_repo_repairs_its_worktrees() {
        let git_ok = std::process::Command::new("git")
            .arg("--version")
            .output()
            .is_ok_and(|output| output.status.success());
        if !git_ok {
            return;
        }
        let root = root();
        let base = canonical(root.path());
        let main = base.join("main");
        fs::create_dir(&main).unwrap();
        let git = |dir: &Path, args: &[&str]| {
            std::process::Command::new("git")
                .args([
                    "-c",
                    "user.name=spopi-test",
                    "-c",
                    "user.email=spopi-test@example.invalid",
                ])
                .args(args)
                .current_dir(dir)
                .output()
                .unwrap()
        };
        assert!(git(&main, &["init", "-q"]).status.success());
        assert!(git(&main, &["commit", "-q", "--allow-empty", "-m", "init"])
            .status
            .success());
        assert!(git(&main, &["worktree", "add", "-q", "../wt"])
            .status
            .success());

        let renamed = rename_project(
            &plane(),
            &PiRuntime::new(4),
            None,
            &main,
            "main-renamed",
            &base.join("agent"),
        )
        .unwrap();
        assert!(
            renamed.worktree_warning.is_none(),
            "{:?}",
            renamed.worktree_warning
        );
        assert!(git(&base.join("wt"), &["status", "--short"])
            .status
            .success());
    }

    #[test]
    fn a_found_project_keeps_its_workspace_id() {
        let root = root();
        let base = canonical(root.path());
        let agent = base.join("agent");
        let store = Mutex::new(MetadataStore::open(&base.join("db.sqlite3")).unwrap());
        let old = base.join("gone");
        fs::create_dir(&old).unwrap();
        let id = store.lock().unwrap().workspace_id_for_path(&old).unwrap();
        let old_path = old.to_string_lossy().into_owned();
        store
            .lock()
            .unwrap()
            .remember_hidden_workspace(&id, &old_path)
            .unwrap();
        let found = base.join("found");
        fs::rename(&old, &found).unwrap();

        let resolved = crate::data::session_relocate::relocate_missing_project(
            &store, &old_path, &found, &agent,
        )
        .unwrap();
        assert_eq!(resolved, id);
        let guard = store.lock().unwrap();
        assert_eq!(
            guard.preference_get("ui.workspaces.hidden").unwrap(),
            Some(json!([]))
        );
    }
}
