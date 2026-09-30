// ABOUTME: Serves git diff and shortstat on the loopback host.
// ABOUTME: Both handlers resolve the workspace and return JSON.

use super::super::{api_error, host_data_http_error, HostState};
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;
use serde_json::Value;
use std::sync::Arc;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitPathQuery {
    workspace_id: String,
    path: String,
}

pub(crate) async fn git_file_diff(
    State(state): State<Arc<HostState>>,
    Query(query): Query<GitPathQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let result = state
        .data
        .git_file_diff(&query.workspace_id, &query.path)
        .map_err(host_data_http_error)?;
    serde_json::to_value(result)
        .map(Json)
        .map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "serialization_failed"))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitStatQuery {
    workspace_id: String,
}

pub(crate) async fn git_stat_handler(
    State(state): State<Arc<HostState>>,
    Query(query): Query<GitStatQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let result = state
        .data
        .git_stat(&query.workspace_id)
        .map_err(host_data_http_error)?;
    serde_json::to_value(result)
        .map(Json)
        .map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "serialization_failed"))
}
