// ABOUTME: Reads a model server's Prometheus /metrics for the Cockpit dock tab.
// ABOUTME: The URL is the user's override or `<model server>/metrics`; the webview never fetches it.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::platform::loopback::is_loopback_host;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EngineSnapshot {
    pub metrics_url: String,
    pub raw: Value,
}

/// The user's metrics URL when set, otherwise `/metrics` at the model
/// server's origin (vLLM, SGLang and llama.cpp serve Prometheus there).
pub fn metrics_url_for(base_url: &str, override_url: Option<&str>) -> String {
    if let Some(url) = override_url
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return url.to_string();
    }
    let trimmed = base_url.trim().trim_end_matches('/');
    let (scheme, rest) = trimmed.split_once("://").unwrap_or(("http", trimmed));
    let authority = rest.split('/').next().unwrap_or(rest);
    format!("{scheme}://{authority}/metrics")
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScrapeRequest {
    pub base_url: Option<String>,
    pub metrics_url: Option<String>,
}

pub fn decode_scrape_request(value: &Value) -> Result<(String, Option<String>), String> {
    let parsed: ScrapeRequest = serde_json::from_value(value.clone()).map_err(|e| e.to_string())?;
    let base = parsed
        .base_url
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .ok_or("baseUrl is required")?;
    if !(base.starts_with("http://") || base.starts_with("https://")) {
        return Err("baseUrl must be http(s)".into());
    }
    Ok((base, parsed.metrics_url))
}

pub fn host_from_url(url: &str) -> Option<(String, String)> {
    let (scheme, rest) = if let Some(rest) = url.strip_prefix("https://") {
        ("https", rest)
    } else {
        ("http", url.strip_prefix("http://")?)
    };
    let authority = rest.split('/').next().unwrap_or("");
    let host = authority
        .rsplit_once('@')
        .map(|(_, host)| host)
        .unwrap_or(authority);
    let host = host
        .split_once(']')
        .map(|(ipv6, _)| ipv6.trim_start_matches('['))
        .unwrap_or(host)
        .split(':')
        .next()
        .unwrap_or(host);
    if host.is_empty() {
        return None;
    }
    Some((scheme.to_string(), host.to_string()))
}

/// Loopback, a private IPv4 range, or a single-label / `.local` / `.lan` name.
pub fn is_local_network_url(url: &str) -> bool {
    let Some((_scheme, host)) = host_from_url(url) else {
        return false;
    };
    if is_loopback_host(&host) {
        return true;
    }
    if let Ok(ip) = host.parse::<std::net::Ipv4Addr>() {
        return ip.is_private() && !ip.is_link_local();
    }
    let host = host.to_ascii_lowercase();
    !host.contains('.') || host.ends_with(".local") || host.ends_with(".lan")
}

pub fn scrape_url_allowed(url: &str, catalog_origins: &[String]) -> bool {
    let Some((_scheme, host)) = host_from_url(url) else {
        return false;
    };
    if host == "169.254.169.254" || host.starts_with("169.254.") {
        return false;
    }
    if is_loopback_host(&host) {
        return true;
    }
    catalog_origins.iter().any(|origin| {
        host_from_url(origin)
            .map(|(_, catalog_host)| catalog_host.eq_ignore_ascii_case(&host))
            .unwrap_or(false)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn the_metrics_url_is_the_override_or_the_servers_origin() {
        assert_eq!(
            metrics_url_for("http://127.0.0.1:8000/v1", None),
            "http://127.0.0.1:8000/metrics"
        );
        assert_eq!(
            metrics_url_for("http://127.0.0.1:1234/api/v0/", Some("  ")),
            "http://127.0.0.1:1234/metrics"
        );
        assert_eq!(
            metrics_url_for("http://127.0.0.1:8000/v1", Some("http://host/custom")),
            "http://host/custom"
        );
    }

    #[test]
    fn rejects_missing_or_non_http_base_urls() {
        assert!(decode_scrape_request(&json!({ "baseUrl": "file:///tmp" })).is_err());
        assert!(decode_scrape_request(&json!({})).is_err());
        let (base, _) =
            decode_scrape_request(&json!({ "baseUrl": "http://127.0.0.1:8000/v1" })).unwrap();
        assert!(base.starts_with("http://"));
    }

    #[test]
    fn only_local_model_servers_are_read_without_asking() {
        assert!(is_local_network_url("http://127.0.0.1:8000/v1"));
        assert!(is_local_network_url("http://192.168.1.20:1234/v1"));
        assert!(is_local_network_url("http://gpu:8000/v1"));
        assert!(is_local_network_url("http://gpu.lan:8000/v1"));
        assert!(!is_local_network_url("https://api.openai.com/v1"));
        assert!(!is_local_network_url("http://169.254.169.254/latest"));
        assert!(!is_local_network_url("http://8.8.8.8/v1"));
    }

    #[test]
    fn rejects_ssrf_targets() {
        assert!(!scrape_url_allowed("file:///etc/passwd", &[]));
        assert!(!scrape_url_allowed("http://169.254.169.254/latest", &[]));
        assert!(!scrape_url_allowed("http://evil.example/metrics", &[]));
        assert!(scrape_url_allowed("http://127.0.0.1:8000/metrics", &[]));
        assert!(scrape_url_allowed(
            "http://gpu.lab:8000/metrics",
            &["http://gpu.lab:8000/v1".into()]
        ));
    }
}
