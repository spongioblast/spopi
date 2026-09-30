// ABOUTME: Serves file and workspace HTTP routes on the loopback host.
// ABOUTME: Workspace registration from a path stays on this machine.
use super::super::auth::trusted_loopback_request;
use super::super::{api_error, host_data_http_error, HostState};
use crate::data::{HostDataError, WriteFileResult};
use crate::editor::markitdown::{ConversionOutcome, DependencyReason, INPUT_BYTE_CAP};
use crate::pi::coordinator::RuntimeTarget;
use axum::body::Body;
use axum::extract::{ConnectInfo, Json, Query, State};
use axum::http::header::{CONTENT_LENGTH, CONTENT_SECURITY_POLICY, CONTENT_TYPE};
use axum::http::{HeaderMap, HeaderValue, StatusCode, Uri};
use axum::response::Response;
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FilePreviewQuery {
    workspace_id: String,
    path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileMentionQuery {
    workspace_id: String,
    query: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WriteFileContentRequest {
    workspace_id: String,
    path: String,
    content: String,
    expected_mtime_ms: Option<f64>,
    force: Option<bool>,
}

pub(crate) async fn read_file_content(
    State(state): State<Arc<HostState>>,
    Query(query): Query<FilePreviewQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if let Some(source) = state
        .data
        .read_convertible_file(&query.workspace_id, &query.path)
        .map_err(host_data_http_error)?
    {
        let mut response = json!({
            "path": source.path,
            "content": "",
            "size": source.size,
            "mtimeMs": source.mtime_ms,
            "mimeType": source.mime_type,
            "isBinary": false,
            "truncated": false,
            "editable": false,
        });
        let outcome = if source.size > INPUT_BYTE_CAP || source.bytes.len() as u64 > INPUT_BYTE_CAP
        {
            ConversionOutcome::Failed
        } else {
            state.markitdown.convert(&source.suffix, source.bytes).await
        };
        match outcome {
            ConversionOutcome::Ready(markdown) => {
                response["content"] = Value::String(markdown);
                response["previewStatus"] = Value::String("ready".into());
                response["renderAs"] = Value::String("markdown".into());
            }
            ConversionOutcome::DependencyUnavailable {
                reason,
                display_command,
            } => {
                response["previewStatus"] = Value::String("dependencyUnavailable".into());
                let (reason, python_version) = match reason {
                    DependencyReason::PythonMissing => ("pythonMissing", None),
                    DependencyReason::PythonTooOld { version } => ("pythonTooOld", Some(version)),
                    DependencyReason::MarkitdownMissing => ("markitdownMissing", None),
                    DependencyReason::MarkitdownIncompatible => ("markitdownIncompatible", None),
                };
                response["dependencyReason"] = Value::String(reason.into());
                if let Some(version) = python_version {
                    response["pythonVersion"] = Value::String(version);
                }
                if let Some(command) = display_command {
                    response["displayCommand"] = Value::String(command);
                }
            }
            ConversionOutcome::Failed => {
                response["previewStatus"] = Value::String("conversionFailed".into());
            }
        }
        return Ok(Json(response));
    }
    let content = state
        .data
        .read_file_content(&query.workspace_id, &query.path)
        .map_err(host_data_http_error)?;
    serde_json::to_value(content)
        .map(Json)
        .map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "serialization_failed"))
}

pub(crate) async fn raw_file_content(
    State(state): State<Arc<HostState>>,
    Query(query): Query<FilePreviewQuery>,
) -> Result<Response, (StatusCode, Json<Value>)> {
    let raw = state
        .data
        .raw_file_content(&query.workspace_id, &query.path)
        .map_err(host_data_http_error)?;
    let mut response = Response::new(Body::from(raw.bytes));
    *response.status_mut() = StatusCode::OK;
    let headers = response.headers_mut();
    headers.insert(
        CONTENT_TYPE,
        HeaderValue::from_str(&raw.mime_type)
            .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
    );
    headers.insert(
        CONTENT_LENGTH,
        HeaderValue::from_str(&raw.size.to_string())
            .unwrap_or_else(|_| HeaderValue::from_static("0")),
    );
    headers.insert(
        CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("sandbox; default-src 'none'; style-src 'unsafe-inline'"),
    );
    Ok(response)
}

pub(crate) async fn file_mentions(
    State(state): State<Arc<HostState>>,
    Query(query): Query<FileMentionQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let result = state
        .data
        .search_file_mentions(&query.workspace_id, &query.query)
        .map_err(host_data_http_error)?;
    serde_json::to_value(result)
        .map(Json)
        .map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "serialization_failed"))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceInfoQuery {
    workspace_id: Option<String>,
    workspace_path: Option<String>,
}

pub(crate) async fn workspace_info_handler(
    State(state): State<Arc<HostState>>,
    Query(query): Query<WorkspaceInfoQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    // The sidebar passes the workspace's on-disk path (projectPath), not
    // the internal workspace ID. Try both: first by workspace_id (when
    // available), then fall back to treating workspace_path as the root.
    let result = if let Some(ws_id) = &query.workspace_id {
        state.data.workspace_info(ws_id)
    } else if let Some(ws_path) = &query.workspace_path {
        state.data.workspace_info_by_path(ws_path)
    } else {
        Err(HostDataError::UnknownWorkspace)
    }
    .map_err(host_data_http_error)?;
    serde_json::to_value(result)
        .map(Json)
        .map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "serialization_failed"))
}

pub(crate) async fn write_file_content(
    State(state): State<Arc<HostState>>,
    Json(body): Json<WriteFileContentRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let force = body.force.unwrap_or(false);
    let Some(expected_mtime_ms) = body.expected_mtime_ms.or(force.then_some(0.0)) else {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "expected_mtime_ms_required",
        ));
    };
    match state
        .data
        .write_file_content(
            &body.workspace_id,
            &body.path,
            &body.content,
            expected_mtime_ms,
            force,
        )
        .map_err(host_data_http_error)?
    {
        WriteFileResult::Saved { size, mtime_ms } => Ok(Json(json!({
            "path": body.path,
            "size": size,
            "mtimeMs": mtime_ms,
        }))),
        WriteFileResult::Conflict => Err(api_error(StatusCode::CONFLICT, "conflict")),
        WriteFileResult::Invalid => Err(api_error(StatusCode::BAD_REQUEST, "invalid_file")),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NewSessionRequest {
    workspace_id: String,
}

/// POST /v2/new-session — spawn a fresh temporary runtime for `workspaceId`.
/// Used by LAN/remote clients that cannot invoke Tauri native commands.
pub(crate) async fn new_session(
    State(state): State<Arc<HostState>>,
    Json(body): Json<NewSessionRequest>,
) -> Result<Json<RuntimeTarget>, (StatusCode, Json<Value>)> {
    let cwd = state
        .data
        .workspace_root_path(&body.workspace_id)
        .map_err(|_| api_error(StatusCode::NOT_FOUND, "workspace_not_found"))?;
    if let Some(parked) = state.runtimes.standby_for(&body.workspace_id) {
        let from_pi = state.runtimes.host_session_id(&parked).await.ok().flatten();
        let session_id =
            from_pi.unwrap_or_else(|| format!("temporary-{}", uuid::Uuid::new_v4().simple()));
        if let Some(adopted) = state
            .runtimes
            .adopt_standby(&body.workspace_id, &session_id)
            .map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "standby_adopt_failed"))?
        {
            super::super::idle_reaper::refill_standbys(&state);
            return Ok(Json(adopted));
        }
    }
    let session_id = format!("temporary-{}", uuid::Uuid::new_v4().simple());
    let instance_id = format!("instance-{}", uuid::Uuid::new_v4().simple());
    let target = RuntimeTarget::new(body.workspace_id.clone(), session_id, instance_id);
    let cwd_str = cwd.to_string_lossy().into_owned();
    let launch = state
        .pi_launch
        .native_launch_spec(&cwd_str, None)
        .map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "launch_spec_failed"))?;
    state
        .runtimes
        .spawn(target.clone(), launch)
        .map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "runtime_spawn_failed"))?;
    Ok(Json(target))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResolveWorkspaceRequest {
    project_path: String,
}

pub(crate) fn resolve_workspace_path(
    state: &HostState,
    project_path: &str,
    allow_register: bool,
) -> Result<String, &'static str> {
    let path = PathBuf::from(project_path);
    if !path.is_dir() {
        return Err("project_not_found");
    }
    let workspace_id = {
        let mut store = state
            .metadata
            .as_ref()
            .ok_or("metadata_unavailable")?
            .lock()
            .map_err(|_| "metadata_unavailable")?;
        let _ = store.unhide_workspace(project_path);
        store
            .workspace_id_for_path(&path)
            .map_err(|_| "workspace_resolve_failed")?
    };
    if state.data.workspace_root_path(&workspace_id).is_ok() {
        return Ok(workspace_id);
    }
    if !allow_register {
        return Err("loopback_required");
    }
    state
        .data
        .register_workspace(&workspace_id, path)
        .map_err(|_| "workspace_register_failed")?;
    Ok(workspace_id)
}

/// POST /v2/resolve-workspace — map a project path to its stable workspace id
/// and register the workspace root so a later bootstrap can resume its sessions.
pub(crate) async fn resolve_workspace(
    State(state): State<Arc<HostState>>,
    peer: ConnectInfo<std::net::SocketAddr>,
    headers: HeaderMap,
    uri: Uri,
    Json(body): Json<ResolveWorkspaceRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let allow_register = trusted_loopback_request(peer, &headers, &uri);
    let workspace_id =
        resolve_workspace_path(&state, &body.project_path, allow_register).map_err(|code| {
            let status = match code {
                "project_not_found" => StatusCode::NOT_FOUND,
                "loopback_required" => StatusCode::FORBIDDEN,
                _ => StatusCode::INTERNAL_SERVER_ERROR,
            };
            api_error(status, code)
        })?;
    Ok(Json(json!({ "workspaceId": workspace_id })))
}
