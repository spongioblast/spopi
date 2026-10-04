// ABOUTME: Creates, merges, and removes a git worktree from the sidebar.
// ABOUTME: The worktree is registered as a normal project. Git stays the source of truth.

use super::super::{HostState, OpError};
use super::projects::{
    agent_dir, lock, metadata, project_path_param, stop_runtimes, stop_terminals,
};
use crate::data::metadata_store::MetadataStore;
use crate::data::paths::canonical_path;
use crate::data::session_dirs::session_dir_for;
use crate::data::HostDataPlane;
use crate::git::worktree_link::main_checkout_of;
use crate::git::GitService;
use crate::pi::runtime::PiRuntime;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

pub(crate) async fn dispatch(
    state: &HostState,
    request_id: &str,
    operation: &str,
    frame: &Value,
) -> Result<Value, OpError> {
    let project = project_path_param(frame)?;
    let service = state.git_service.clone();
    let body = match operation {
        "create_worktree" => {
            let branch = frame
                .get("branch")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| OpError::new("invalid_branch", "branch is required"))?
                .to_owned();
            let metadata = metadata(state)?;
            let data = state.data.clone();
            let home = dirs::home_dir()
                .ok_or_else(|| OpError::new("worktree_failed", "Cannot find the home folder"))?;
            blocking(move || create_worktree(&service, &metadata, &data, &project, &branch, &home))
                .await?
        }
        "merge_worktree" => blocking(move || merge_worktree(&service, &project)).await?,
        "remove_worktree" => {
            let force = frame.get("force").and_then(Value::as_bool).unwrap_or(false);
            let agent = agent_dir()?;
            let (checker, folder) = (service.clone(), project.clone());
            let main = blocking(move || removable(&checker, &folder, &agent, force)).await?;
            stop_terminals(state, &project);
            let runtimes = state.runtimes.clone();
            let metadata = metadata(state)?;
            blocking(move || {
                remove_worktree(&service, &metadata, &runtimes, &main, &project, force)
            })
            .await?
        }
        _ => {
            return Err(OpError::new(
                "host_operation_unimplemented",
                "Host operation is not implemented on protocol v2",
            ))
        }
    };
    Ok(envelope(request_id, operation, body))
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, OpError> + Send + 'static,
) -> Result<T, OpError> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|error| OpError::new("host_operation_failed", error.to_string()))?
}

fn envelope(request_id: &str, operation: &str, body: Value) -> Value {
    let mut response = json!({
        "type": "host_response",
        "requestId": request_id,
        "operation": operation,
    });
    if let (Some(target), Some(source)) = (response.as_object_mut(), body.as_object()) {
        target.extend(source.clone());
    }
    response
}

fn create_worktree(
    service: &GitService,
    metadata: &Mutex<MetadataStore>,
    data: &HostDataPlane,
    project: &Path,
    branch: &str,
    home: &Path,
) -> Result<Value, OpError> {
    let listed = service
        .worktree_list(project)
        .map_err(|message| OpError::new("worktree_failed", message))?;
    let primary = listed
        .iter()
        .find(|entry| entry.primary)
        .ok_or_else(|| OpError::new("not_worktree", "This folder is not a git checkout"))?;
    let base = primary
        .branch
        .clone()
        .ok_or_else(|| OpError::new("primary_detached", "The main checkout is not on a branch"))?;
    let created = service
        .worktree_add(Path::new(&primary.path), branch, &base, home)
        .map_err(|message| OpError::new("worktree_failed", message))?;
    let mut store = lock(metadata).map_err(failed)?;
    let _ = store.unhide_workspace(&created.to_string_lossy());
    let id = store.workspace_id_for_path(&created).map_err(failed)?;
    drop(store);
    data.register_workspace(&id, created.clone())?;
    let path = canonical_path(&created).unwrap_or(created);
    Ok(json!({ "projectPath": path.to_string_lossy() }))
}

fn merge_worktree(service: &GitService, project: &Path) -> Result<Value, OpError> {
    let main = main_checkout_of(project)
        .ok_or_else(|| OpError::new("not_worktree", "This folder is not a linked worktree"))?;
    let branch = service
        .current_branch(project)
        .map_err(failed)?
        .ok_or_else(|| OpError::new("worktree_detached", "This worktree is not on a branch"))?;
    if service.current_branch(&main).map_err(failed)?.is_none() {
        return Err(OpError::new(
            "primary_detached",
            "The main checkout is not on a branch",
        ));
    }
    if !service.is_clean(&main, false).map_err(failed)? {
        return Err(OpError::new(
            "primary_dirty",
            "The main checkout has uncommitted changes",
        ));
    }
    if !service.is_clean(project, false).map_err(failed)? {
        return Err(OpError::new(
            "worktree_dirty",
            "This worktree has uncommitted changes",
        ));
    }
    let outcome = service.merge_branch(&main, &branch).map_err(failed)?;
    Ok(json!({
        "merged": outcome.merged,
        "into": outcome.into,
        "conflicts": outcome.conflicts,
    }))
}

/// The main checkout, when this worktree may be removed.
fn removable(
    service: &GitService,
    project: &Path,
    agent: &Path,
    force: bool,
) -> Result<PathBuf, OpError> {
    let main = main_checkout_of(project)
        .ok_or_else(|| OpError::new("not_worktree", "This folder is not a linked worktree"))?;
    let listed = service.worktree_list(&main).map_err(failed)?;
    let entry = listed
        .iter()
        .find(|item| same_path(Path::new(&item.path), project))
        .ok_or_else(|| {
            OpError::new(
                "not_worktree",
                "This folder is not a worktree of its checkout",
            )
        })?;
    if entry.locked {
        return Err(OpError::new("worktree_locked", "This worktree is locked"));
    }
    let chats = chats_inside(project, agent).map_err(failed)?;
    if chats > 0 {
        return Err(OpError::new(
            "worktree_has_chats",
            format!("This worktree stores {chats} chats inside its folder, so removing it would delete them"),
        ));
    }
    if !force && !service.is_clean(project, true).map_err(failed)? {
        return Err(OpError::new(
            "worktree_dirty",
            "This worktree has uncommitted changes",
        ));
    }
    Ok(main)
}

fn remove_worktree(
    service: &GitService,
    metadata: &Arc<Mutex<MetadataStore>>,
    runtimes: &PiRuntime,
    main: &Path,
    project: &Path,
    force: bool,
) -> Result<Value, OpError> {
    stop_runtimes(Some(metadata), runtimes, project);
    service
        .worktree_remove(main, project, force)
        .map_err(failed)?;
    let mut store = lock(metadata).map_err(failed)?;
    let id = store.workspace_id_for_path(project).unwrap_or_default();
    let _ = store.remember_hidden_workspace(&id, &project.to_string_lossy());
    Ok(json!({ "primaryPath": main.to_string_lossy() }))
}

fn chats_inside(worktree: &Path, agent: &Path) -> Result<usize, String> {
    let dir = session_dir_for(worktree, agent);
    let worktree = canonical_path(worktree).unwrap_or_else(|_| worktree.to_path_buf());
    let dir = canonical_path(&dir).unwrap_or(dir);
    if !dir.starts_with(&worktree) {
        return Ok(0);
    }
    let entries = match std::fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(error) => return Err(error.to_string()),
    };
    Ok(entries
        .flatten()
        .filter(|entry| entry.path().extension().and_then(|ext| ext.to_str()) == Some("jsonl"))
        .count())
}

fn same_path(left: &Path, right: &Path) -> bool {
    let left = canonical_path(left).unwrap_or_else(|_| left.to_path_buf());
    let right = canonical_path(right).unwrap_or_else(|_| right.to_path_buf());
    left == right
}

fn failed(message: String) -> OpError {
    OpError::new("worktree_failed", message)
}
