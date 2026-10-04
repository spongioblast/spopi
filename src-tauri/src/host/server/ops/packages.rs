// ABOUTME: Handles package list, update check, install, and catalog host operations.
// ABOUTME: The catalog is fetched here so the webview never opens the registry.

use super::super::{HostState, OpError};
use serde_json::{json, Value};

pub(crate) async fn dispatch(
    state: &HostState,
    request_id: &str,
    operation: &str,
    frame: &Value,
) -> Result<Value, OpError> {
    match operation {
        "list_pi_packages" => {
            let resolver = state.pi_launch.clone();
            let packages = tokio::task::spawn_blocking(move || resolver.list_pi_packages())
                .await
                .map_err(|error| ("host_operation_failed", error.to_string()))?
                .map_err(|message| ("list_pi_packages_failed", message))?;
            Ok(json!({
                "type": "host_response",
                "requestId": request_id,
                "operation": "list_pi_packages",
                "packages": packages,
            }))
        }
        "check_pi_package_updates" => {
            let workspace_root = frame
                .get("workspaceId")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .and_then(|id| state.data.workspace_root_path(id).ok());
            let resolver = state.pi_launch.clone();
            let packages = tokio::task::spawn_blocking(move || resolver.list_pi_packages())
                .await
                .map_err(|error| ("host_operation_failed", error.to_string()))?
                .map_err(|message| ("list_pi_packages_failed", message))?;
            // npm probes run with the workspace as cwd so project-local npmCommand
            // settings and .npmrc files are honored; failures degrade to no updates.
            let updates = crate::packages::updates::check_available_updates(
                &packages,
                workspace_root.as_deref(),
            )
            .await;
            Ok(json!({
                "type": "host_response",
                "requestId": request_id,
                "operation": "check_pi_package_updates",
                "updates": updates,
            }))
        }
        "browse_pi_packages" => {
            let catalog = fetch_package_catalog()
                .await
                .map_err(|message| ("browse_pi_packages_failed", message))?;
            Ok(json!({
                "type": "host_response",
                "requestId": request_id,
                "operation": "browse_pi_packages",
                "packages": catalog.packages,
                "stale": catalog.stale,
                "cachedAt": catalog.cached_at,
            }))
        }
        "install_pi_package" | "remove_pi_package" | "update_pi_package" => {
            let source = frame
                .get("source")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or(("invalid_source", "Package source cannot be empty".into()))?
                .to_owned();
            let local = frame.get("local").and_then(Value::as_bool).unwrap_or(false);
            let resolver = state.pi_launch.clone();
            let operation = operation.to_string();
            let operation_ref = operation.clone();
            tokio::task::spawn_blocking(move || match operation_ref.as_str() {
                "install_pi_package" => resolver.install_pi_package(&source, local),
                "remove_pi_package" => resolver.remove_pi_package(&source, local),
                "update_pi_package" => resolver.update_pi_package(&source),
                _ => unreachable!(),
            })
            .await
            .map_err(|error| ("host_operation_failed", error.to_string()))?
            .map_err(|message| ("package_operation_failed", message))?;
            Ok(json!({
                "type": "host_response",
                "requestId": request_id,
                "operation": operation,
                "ok": true,
            }))
        }
        _ => Err(OpError::new(
            "host_operation_unimplemented",
            "Host operation is not implemented on protocol v2",
        )),
    }
}

const PACKAGE_CATALOG: &str = "https://pi-packages-api.shixin.workers.dev/packages";
const CATALOG_PAGE_SIZE: u32 = 250;
const CATALOG_PAGE_CAP: u32 = 20;

fn catalog_page_packages(body: &Value) -> Vec<Value> {
    body.get("packages")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn catalog_total_pages(body: &Value) -> u32 {
    let pages = body.get("totalPages").and_then(Value::as_u64).unwrap_or(1);
    u32::try_from(pages).unwrap_or(1).clamp(1, CATALOG_PAGE_CAP)
}

struct PackageCatalog {
    packages: Vec<Value>,
    stale: bool,
    cached_at: u64,
}

fn format_error_chain(error: &dyn std::error::Error) -> String {
    let mut parts = vec![error.to_string()];
    let mut source = error.source();
    while let Some(err) = source {
        let text = err.to_string();
        if parts.last().is_none_or(|last| last != &text) {
            parts.push(text);
        }
        source = err.source();
    }
    parts.join(": ")
}

fn catalog_cache_path() -> std::path::PathBuf {
    crate::data::app_paths::config_dir().join("package-catalog.json")
}

fn read_catalog_cache(path: &std::path::Path) -> Option<(Vec<Value>, u64)> {
    let text = std::fs::read_to_string(path).ok()?;
    let body: Value = serde_json::from_str(&text).ok()?;
    let packages = body.get("packages")?.as_array()?.clone();
    let cached_at = body.get("cachedAt")?.as_u64()?;
    if packages.is_empty() {
        return None;
    }
    Some((packages, cached_at))
}

fn write_catalog_cache(path: &std::path::Path, packages: &[Value], cached_at: u64) {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let body = json!({ "cachedAt": cached_at, "packages": packages });
    let _ = std::fs::write(path, body.to_string());
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

async fn fetch_catalog_page(client: &reqwest::Client, page: u32) -> Result<Value, String> {
    let url = format!("{PACKAGE_CATALOG}?page={page}&pageSize={CATALOG_PAGE_SIZE}");
    let response = client.get(&url).send().await.map_err(|error| {
        format!(
            "Package registry request failed: {}",
            format_error_chain(&error)
        )
    })?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("Package registry returned {status}"));
    }
    response.json().await.map_err(|error| {
        format!(
            "Package registry returned invalid JSON: {}",
            format_error_chain(&error)
        )
    })
}

async fn fetch_live_catalog(client: &reqwest::Client) -> Result<Vec<Value>, String> {
    let first = fetch_catalog_page(client, 1).await?;
    let total_pages = catalog_total_pages(&first);
    let mut packages = catalog_page_packages(&first);
    let mut page = 2u32;
    while page <= total_pages {
        let end = (page + 3).min(total_pages);
        let mut tasks = Vec::new();
        for current in page..=end {
            let client = client.clone();
            tasks.push(async move { fetch_catalog_page(&client, current).await });
        }
        let bodies = futures_util::future::try_join_all(tasks).await?;
        for body in bodies {
            packages.extend(catalog_page_packages(&body));
        }
        page = end + 1;
    }
    Ok(packages)
}

fn catalog_from_fetch(
    fetched: Result<Vec<Value>, String>,
    cache_path: &std::path::Path,
) -> Result<PackageCatalog, String> {
    match fetched {
        Ok(packages) => {
            let cached_at = now_millis();
            write_catalog_cache(cache_path, &packages, cached_at);
            Ok(PackageCatalog {
                packages,
                stale: false,
                cached_at,
            })
        }
        Err(message) => match read_catalog_cache(cache_path) {
            Some((packages, cached_at)) => Ok(PackageCatalog {
                packages,
                stale: true,
                cached_at,
            }),
            None => Err(message),
        },
    }
}

async fn fetch_package_catalog() -> Result<PackageCatalog, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .user_agent("spopi")
        .build()
        .map_err(|error| format_error_chain(&error))?;
    let cache_path = catalog_cache_path();
    catalog_from_fetch(fetch_live_catalog(&client).await, &cache_path)
}

#[cfg(test)]
mod tests {
    use super::{
        catalog_from_fetch, catalog_page_packages, catalog_total_pages, format_error_chain,
        read_catalog_cache,
    };
    use serde_json::json;
    use std::io::Write;

    #[derive(Debug)]
    struct ChainError {
        message: &'static str,
        source: Option<std::io::Error>,
    }

    impl std::fmt::Display for ChainError {
        fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            write!(formatter, "{}", self.message)
        }
    }

    impl std::error::Error for ChainError {
        fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
            self.source
                .as_ref()
                .map(|error| error as &(dyn std::error::Error + 'static))
        }
    }

    #[test]
    fn error_chain_includes_the_source() {
        let error = ChainError {
            message: "error sending request",
            source: Some(std::io::Error::other("revocation offline")),
        };
        let text = format_error_chain(&error);
        assert!(text.contains("error sending request"));
        assert!(text.contains("revocation offline"));
    }

    #[test]
    fn failed_fetch_uses_the_cached_catalog() {
        let dir = std::env::temp_dir().join(format!("spopi-catalog-test-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("package-catalog.json");
        let mut file = std::fs::File::create(&path).unwrap();
        write!(
            file,
            "{}",
            json!({ "cachedAt": 10, "packages": [{ "name": "pi-lens" }] })
        )
        .unwrap();
        let catalog = catalog_from_fetch(Err("offline".into()), &path).unwrap();
        assert!(catalog.stale);
        assert_eq!(catalog.cached_at, 10);
        assert_eq!(catalog.packages.len(), 1);

        let saved = catalog_from_fetch(Ok(vec![json!({ "name": "fresh" })]), &path).unwrap();
        assert!(!saved.stale);
        let (packages, _) = read_catalog_cache(&path).unwrap();
        assert_eq!(packages[0]["name"], "fresh");
        assert!(catalog_from_fetch(Err("offline".into()), &dir.join("missing.json")).is_err());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    #[ignore]
    async fn live_catalog_reaches_the_registry() {
        let catalog = super::fetch_package_catalog().await.unwrap();
        assert!(!catalog.packages.is_empty());
    }

    #[test]
    fn catalog_page_reads_packages_and_total_pages() {
        let body = json!({
            "packages": [{ "name": "pi-lens" }],
            "totalPages": 3
        });
        assert_eq!(catalog_page_packages(&body).len(), 1);
        assert_eq!(catalog_total_pages(&body), 3);
        assert_eq!(catalog_total_pages(&json!({})), 1);
        assert_eq!(catalog_total_pages(&json!({ "totalPages": 500 })), 20);
    }
}
