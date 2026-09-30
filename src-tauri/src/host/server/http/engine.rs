// ABOUTME: Websocket engine_scrape for the Cockpit dock.
// ABOUTME: The scrape target must be loopback or the model server's own host.

use super::super::HostState;
use crate::metrics::engine_scrape::{
    decode_scrape_request, is_local_network_url, metrics_url_for, scrape_url_allowed,
    EngineSnapshot,
};
use serde_json::{json, Value};

pub async fn dispatch_extra(
    _state: &HostState,
    request_id: &str,
    operation: &str,
    frame: &Value,
) -> Result<Value, (&'static str, String)> {
    match operation {
        "engine_scrape" => {
            let snapshot = scrape_engine(frame.clone())
                .await
                .map_err(|message| ("engine_scrape_failed", message))?;
            Ok(json!({
                "type": "host_response",
                "requestId": request_id,
                "operation": operation,
                "snapshot": snapshot,
            }))
        }
        _ => Err((
            "host_operation_unimplemented",
            "Host operation is not implemented on protocol v2".into(),
        )),
    }
}

async fn scrape_engine(body: Value) -> Result<Value, String> {
    let (base_url, override_url) = decode_scrape_request(&body)?;
    let metrics_url = metrics_url_for(&base_url, override_url.as_deref());
    // A local or LAN model server is read without asking; a cloud API is never
    // polled unless the user typed its metrics URL themselves.
    let mut allowed = Vec::new();
    if is_local_network_url(&base_url) {
        allowed.push(base_url.clone());
    }
    if let Some(url) = override_url.as_deref().filter(|url| !url.trim().is_empty()) {
        allowed.push(url.to_owned());
    }
    if !scrape_url_allowed(&metrics_url, &allowed) {
        return Err("scrape target is not allowlisted".into());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(2500))
        .build()
        .map_err(|error| error.to_string())?;
    let raw = match client.get(&metrics_url).send().await {
        Ok(response) if response.status().is_success() => {
            json!({ "text": response.text().await.unwrap_or_default() })
        }
        Ok(response) => json!({ "error": format!("HTTP {}", response.status().as_u16()) }),
        Err(_) => json!({ "error": "unreachable" }),
    };
    serde_json::to_value(EngineSnapshot { metrics_url, raw }).map_err(|error| error.to_string())
}
