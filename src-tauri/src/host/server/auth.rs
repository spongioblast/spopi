// ABOUTME: HTTP auth helpers for loopback trust and the public-route allowlist.
// ABOUTME: Split out of host_server/mod.rs so the facade can stay a composition root.

use axum::extract::connect_info::ConnectInfo;
use axum::http::{HeaderMap, Method, Uri};
use std::str::FromStr;

pub(crate) fn is_public_http_request(method: &Method, path: &str) -> bool {
    if !path.starts_with("/v2/") && !path.starts_with("/api/") && !path.starts_with("/health/") {
        return true;
    }
    method == Method::GET && matches!(path, "/health" | "/v2/ws")
}

fn loopback_peer(peer: ConnectInfo<std::net::SocketAddr>) -> bool {
    peer.0.ip().is_loopback()
}

fn loopback_authority(headers: &HeaderMap, uri: &Uri) -> bool {
    let authority = headers
        .get(axum::http::header::HOST)
        .and_then(|value| value.to_str().ok())
        .or_else(|| uri.authority().map(|authority| authority.as_str()));
    let Some(authority) = authority else {
        return false;
    };
    let Ok(authority) = axum::http::uri::Authority::from_str(authority) else {
        return false;
    };
    let host = authority.host().trim_matches(['[', ']']);
    crate::platform::loopback::is_loopback_host(host)
}

pub(crate) fn trusted_loopback_request(
    peer: ConnectInfo<std::net::SocketAddr>,
    headers: &HeaderMap,
    uri: &Uri,
) -> bool {
    loopback_peer(peer) && loopback_authority(headers, uri)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{HeaderValue, Method};

    #[test]
    fn health_and_static_paths_are_public() {
        assert!(is_public_http_request(&Method::GET, "/health"));
        assert!(is_public_http_request(&Method::GET, "/app"));
        assert!(!is_public_http_request(&Method::GET, "/api/files/content"));
    }

    #[test]
    fn loopback_host_header_is_required() {
        let peer = ConnectInfo("127.0.0.1:1".parse().unwrap());
        let uri = Uri::from_static("/health");
        let mut headers = HeaderMap::new();
        headers.insert("host", HeaderValue::from_static("127.0.0.1:57620"));
        assert!(trusted_loopback_request(peer, &headers, &uri));
        assert!(!trusted_loopback_request(peer, &HeaderMap::new(), &uri));
    }
}
