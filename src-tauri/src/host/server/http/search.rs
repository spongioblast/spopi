// ABOUTME: HTTP workspace search on the loopback host.
// ABOUTME: /api/search stays off the websocket engine scrape.

use super::super::{api_error, host_data_http_error, HostState};
use crate::data::workspace_search::search_workspace;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;
use serde_json::Value;
use std::sync::Arc;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchQuery {
    pub workspace_id: String,
    pub q: String,
}

pub async fn search_handler(
    State(state): State<Arc<HostState>>,
    Query(query): Query<SearchQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let root = state
        .data
        .workspace_root_path(&query.workspace_id)
        .map_err(host_data_http_error)?;
    let needle = query.q;
    let result = tokio::task::spawn_blocking(move || search_workspace(&root, &needle))
        .await
        .map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "search_join_failed"))?
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "search_failed"))?;
    serde_json::to_value(result)
        .map(Json)
        .map_err(|_| api_error(StatusCode::INTERNAL_SERVER_ERROR, "serialization_failed"))
}
