// ABOUTME: Shared static UI router for the loopback host and the phone listener.
// ABOUTME: The phone copy injects the web manifest; the loopback copy does not.

use super::HostState;
use axum::body::Body;
use axum::http::header::{CACHE_CONTROL, CONTENT_TYPE, PRAGMA};
use axum::http::HeaderValue;
use axum::response::Response;
use axum::Router;
use std::convert::Infallible;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tower::ServiceBuilder;
use tower_http::services::ServeDir;
use tower_http::set_header::SetResponseHeaderLayer;

pub(crate) fn index_html(
    static_dir: &Path,
    overlay_dir: Option<&Path>,
    inject_manifest: bool,
) -> String {
    let versioned_prefix = format!("/v/{}", fingerprint_static_dir(static_dir, overlay_dir));
    let mut html = fs::read_to_string(static_dir.join("index.html"))
        .unwrap_or_default()
        .replacen(
            "<base href=\"/\" />",
            &format!("<base href=\"{versioned_prefix}/\" />"),
            1,
        );
    if inject_manifest {
        html = html.replacen(
            "</head>",
            "<link rel=\"manifest\" href=\"/manifest.webmanifest\" />\n</head>",
            1,
        );
    }
    let links = preload_links(static_dir, &versioned_prefix);
    html.replacen(
        "<link rel=\"stylesheet\" href=\"style.css\" />",
        &format!("{links}<link rel=\"stylesheet\" href=\"style.css\" />"),
        1,
    )
}

fn preload_links(static_dir: &Path, prefix: &str) -> String {
    let Ok(text) = fs::read_to_string(static_dir.join("preload-graph.json")) else {
        return String::new();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
        return String::new();
    };
    let mut out = String::new();
    let mut push = |rel: &str, kind: &str| {
        out.push_str(&format!(
            "<link rel=\"{kind}\" href=\"{prefix}/{rel}\" />\n    "
        ));
    };
    if let Some(modules) = value.get("modules").and_then(|item| item.as_array()) {
        for item in modules {
            if let Some(href) = item.as_str() {
                push(href, "modulepreload");
            }
        }
    }
    if let Some(sheets) = value.get("stylesheets").and_then(|item| item.as_array()) {
        for item in sheets {
            if let Some(href) = item.as_str() {
                push(href, "stylesheet");
            }
        }
    }
    out
}

pub(crate) fn router(
    static_dir: PathBuf,
    overlay_dir: Option<PathBuf>,
    inject_manifest: bool,
) -> Router<Arc<HostState>> {
    // `/v/<fingerprint>/` changes on every rebuild, so a WebView that ignores
    // Cache-Control still misses stale assets after an update. The segment
    // itself is a cache buster: every `/v/<id>/` maps to the same files.
    let index_static = static_dir.clone();
    let index_overlay = overlay_dir.clone();
    let index_fallback = tower::service_fn(move |_req: axum::extract::Request| {
        let html = index_html(&index_static, index_overlay.as_deref(), inject_manifest);
        std::future::ready(Ok::<_, Infallible>(
            Response::builder()
                .header(CONTENT_TYPE, "text/html; charset=utf-8")
                .header(CACHE_CONTROL, HeaderValue::from_static("no-store"))
                .body(Body::from(html))
                .expect("static index.html response is well-formed"),
        ))
    });
    let static_service = ServeDir::new(static_dir.clone()).fallback(index_fallback);
    let static_service = ServiceBuilder::new()
        .layer(SetResponseHeaderLayer::overriding(
            CACHE_CONTROL,
            HeaderValue::from_static("no-store, no-cache, must-revalidate, max-age=0"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            PRAGMA,
            HeaderValue::from_static("no-cache"),
        ))
        .service(static_service);
    let versioned_service = ServiceBuilder::new()
        .map_request(strip_version_segment)
        .layer(SetResponseHeaderLayer::overriding(
            CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=31536000, immutable"),
        ))
        .service(ServeDir::new(static_dir));
    Router::new()
        .fallback_service(static_service)
        .nest_service("/v", versioned_service)
        .layer(axum::middleware::from_fn(hide_dev_assets))
}

async fn hide_dev_assets(
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> Response {
    if cfg!(not(debug_assertions)) {
        let path = request.uri().path();
        if path.ends_with(".test.js") || path.split('/').any(|part| part == "fixtures") {
            return Response::builder()
                .status(404)
                .body(Body::empty())
                .expect("not-found response is well-formed");
        }
    }
    next.run(request).await
}

fn strip_version_segment(mut request: axum::extract::Request) -> axum::extract::Request {
    let path = request.uri().path();
    let rest = path
        .trim_start_matches('/')
        .split_once('/')
        .map(|(_, rest)| rest)
        .unwrap_or("");
    let rewritten = if rest.is_empty() {
        "/".to_string()
    } else {
        format!("/{rest}")
    };
    let query = request
        .uri()
        .query()
        .map(|query| format!("?{query}"))
        .unwrap_or_default();
    if let Ok(uri) = format!("{rewritten}{query}").parse() {
        *request.uri_mut() = uri;
    }
    request
}

fn fingerprint_static_dir(static_dir: &Path, overlay_dir: Option<&Path>) -> String {
    use sha2::{Digest, Sha256};
    fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if path.file_name().and_then(|name| name.to_str()) == Some("fixtures") {
                    continue;
                }
                walk(&path, out);
            } else if path.extension().and_then(|ext| ext.to_str()) == Some("js")
                && path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.ends_with(".test.js"))
            {
                continue;
            } else {
                out.push(path);
            }
        }
    }
    let mut files = Vec::new();
    walk(static_dir, &mut files);
    files.sort();
    let mut hasher = Sha256::new();
    for path in &files {
        let Ok(meta) = fs::metadata(path) else {
            continue;
        };
        if let Ok(relative) = path.strip_prefix(static_dir) {
            hasher.update(relative.to_string_lossy().as_bytes());
        }
        hasher.update(meta.len().to_le_bytes());
        if let Ok(modified) = meta.modified() {
            if let Ok(since_epoch) = modified.duration_since(std::time::UNIX_EPOCH) {
                hasher.update(since_epoch.as_millis().to_le_bytes());
            }
        }
    }
    if let Some(overlay) = overlay_dir {
        for (path, digest) in crate::host::phone::hash_tree(overlay) {
            hasher.update(path.as_bytes());
            hasher.update(digest.as_bytes());
        }
    }
    hex::encode(&hasher.finalize()[..8])
}

#[cfg(test)]
mod tests {
    use super::fingerprint_static_dir;
    use std::fs;

    #[test]
    fn overlay_bytes_change_the_static_fingerprint() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("spopi-fp-{nonce}"));
        let public = root.join("public");
        let overlay = root.join("overlay");
        fs::create_dir_all(&public).unwrap();
        fs::create_dir_all(&overlay).unwrap();
        fs::write(public.join("index.html"), "<html></html>").unwrap();
        let before = fingerprint_static_dir(&public, Some(&overlay));
        fs::write(overlay.join("app.js"), "export const changed = 1;\n").unwrap();
        let after = fingerprint_static_dir(&public, Some(&overlay));
        assert_ne!(before, after);
        let _ = fs::remove_dir_all(root);
    }
}
