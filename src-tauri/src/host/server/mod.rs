// ABOUTME: Builds the host state, binds the loopback port, and serves HTTP and WebSocket.
// ABOUTME: The HTTP route table is http/mod.rs; shared error shapes are here.

mod auth;
pub(crate) mod http;
mod idle_reaper;
mod ops;
mod session_view;
pub(crate) mod ui_assets;
mod ui_fingerprint;
pub(crate) mod ws;

pub(crate) use crate::host::op_error::{host_ok, OpError};

use crate::data::metadata_store::MetadataStore;
use crate::data::{HostDataError, HostDataPlane};
use crate::editor::markitdown::MarkitdownPreviewService;
use crate::host::router::HostRouter;
use crate::pi::coordinator::RuntimeTarget;
use crate::pi::launch::PiLaunchResolver;
use crate::pi::runtime::PiRuntime;
use crate::platform::window_owner::OwnerId;
use crate::terminal::manager::TerminalManager;
use crate::terminal::registry::TerminalRegistry;
use crate::terminal::state_store::TerminalStateStore;
use axum::extract::ws::{Message, WebSocket};
use axum::extract::Json;
use axum::http::StatusCode;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tokio::sync::oneshot;

pub(super) const MAX_WS_MESSAGE_BYTES: usize = 16 * 1024 * 1024;

pub(crate) struct HostState {
    pub(super) router: Mutex<HostRouter>,
    pub(super) runtimes: PiRuntime,
    pub(super) session_owners: Mutex<std::collections::HashMap<RuntimeTarget, String>>,
    // Open websocket count per clientId. A client whose last socket closes and
    // does not reconnect within the grace period gets its PTYs reaped, so a
    // closed tab (or a headless e2e page) cannot pin the global live quota.
    pub(super) ws_clients: Mutex<std::collections::HashMap<String, usize>>,
    pub(super) data: HostDataPlane,
    pub(super) markitdown: MarkitdownPreviewService,
    pub(super) pi_launch: PiLaunchResolver,
    pub(super) terminal_manager: TerminalManager,
    pub(super) terminal_events: tokio::sync::broadcast::Sender<(OwnerId, Value)>,
    pub(super) git_service: Arc<crate::git::GitService>,
    pub(super) git_events: tokio::sync::broadcast::Sender<(String, Value)>,
    // Persistent per-session UI profile (provider/modelId/thinkingLevel).
    // Keyed by session id from the frontend; survives across sessions, used
    // to restore the composer's model + thinking level when a session is
    // reopened. Optional so the constructor stays infallible in tests.
    pub(super) session_ui_profiles:
        Arc<crate::data::session_ui_profile_store::SessionUiProfileStore>,
    /// Review comment drafts, one list per project folder.
    pub(super) review_drafts: Arc<crate::data::review_draft_store::ReviewDraftStore>,
    // Global display preferences (ui.* keys). None in tests and remote-only
    // setups, where preference operations degrade to a host error.
    pub(crate) metadata: Option<Arc<Mutex<MetadataStore>>>,
    pub(super) app_handle: Option<tauri::AppHandle>,
    pub(super) ui: std::sync::Arc<crate::host::ui_overlay::UiOverlay>,
    pub(crate) phone: std::sync::Arc<crate::host::phone::PhoneBook>,
    pub(crate) fanout: tokio::sync::broadcast::Sender<Value>,
    pub(crate) device_sockets: ws::DeviceSockets,
    pub(crate) dependency_jobs: crate::dependencies::jobs::DependencyJobs,
    /// New on every start. A client that sees it change knows its Pi instances are gone.
    pub(crate) host_id: String,
}

pub struct HostServer {
    origin: String,
    shutdown: Option<oneshot::Sender<()>>,
    state: Arc<HostState>,
}

impl HostServer {
    /// Exposes the metadata store to host preference operations (`ui.*` keys).
    /// Tests pass `None` when they do not need preferences.
    pub async fn start_with_workspaces(
        static_dir: PathBuf,
        runtimes: PiRuntime,
        workspace_roots: HashMap<String, PathBuf>,
        app_handle: Option<tauri::AppHandle>,
        metadata: Option<Arc<Mutex<MetadataStore>>>,
    ) -> Result<Self, String> {
        let mut data = HostDataPlane::new(workspace_roots)
            .map_err(|error| format!("Cannot initialize Host data plane: {error:?}"))?;
        if let Some(agent) = crate::pi::binary::pi_agent_dir() {
            data = data.with_session_root(agent.join("sessions"));
        }
        if let Some(store) = metadata.clone() {
            data.attach_metadata(store);
        }
        // Prefer 57620..57651, then an ephemeral port, so the WebView origin stays put.
        const PREFERRED_PORT_BASE: u16 = 57620;
        const PREFERRED_PORT_COUNT: u16 = 32;
        let mut listener = None;
        if let Some(forced) = host_port_override() {
            listener = Some(
                tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, forced))
                    .await
                    .map_err(|error| {
                        format!("SPOPI_HOST_PORT {forced} is not available: {error}")
                    })?,
            );
        }
        if listener.is_none() {
            for offset in 0..PREFERRED_PORT_COUNT {
                let candidate = PREFERRED_PORT_BASE + offset;
                if let Ok(bound) =
                    tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, candidate)).await
                {
                    listener = Some(bound);
                    break;
                }
            }
        }
        let listener = match listener {
            Some(listener) => listener,
            None => tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
                .await
                .map_err(|error| format!("Cannot bind SPOPI Host: {error}"))?,
        };
        let address = listener
            .local_addr()
            .map_err(|error| format!("Cannot read SPOPI Host address: {error}"))?;
        log::info!(
            "[spopi-host] host ready in {}ms",
            crate::pi::child_supervision::process_started()
                .elapsed()
                .as_millis()
        );
        // The host listens on loopback only. The WebView origin is that same address.
        let loopback_origin = format!("http://127.0.0.1:{}", address.port());
        let (terminal_events, _) = tokio::sync::broadcast::channel(256);
        let (git_events, _) = tokio::sync::broadcast::channel(256);
        let git_service = Arc::new(crate::git::GitService::new());
        // Persistent per-session UI profile (provider/modelId/thinkingLevel).
        // New writes go under ~/.config/spopi; leftover SPOPI files are copied.
        let profile_dir = crate::data::app_paths::config_dir();
        let session_ui_profiles = Arc::new(
            crate::data::session_ui_profile_store::SessionUiProfileStore::open(
                profile_dir.join("session-ui-profiles.json"),
            )?,
        );
        let review_drafts = Arc::new(crate::data::review_draft_store::ReviewDraftStore::open(
            profile_dir.join("review-drafts.json"),
        )?);
        let terminal_manager = TerminalManager::new(
            TerminalRegistry::new(15),
            TerminalStateStore::new(crate::data::app_paths::config_dir()),
        );
        let terminal_event_sender = terminal_events.clone();
        terminal_manager.set_event_sink(Arc::new(move |owner, event| {
            let _ = terminal_event_sender.send((owner.clone(), event));
        }));
        let state = Arc::new(HostState {
            router: Mutex::new(HostRouter::new()),
            runtimes,
            session_owners: Mutex::new(std::collections::HashMap::new()),
            ws_clients: Mutex::new(std::collections::HashMap::new()),
            data,
            markitdown: MarkitdownPreviewService::default(),
            pi_launch: PiLaunchResolver::new(static_dir.clone()),
            terminal_manager,
            terminal_events,
            git_service,
            git_events,
            session_ui_profiles,
            review_drafts,
            metadata,
            app_handle,
            ui: std::sync::Arc::new(crate::host::ui_overlay::UiOverlay::open(
                static_dir.clone(),
                crate::data::app_paths::config_dir().join("ui"),
                env!("CARGO_PKG_VERSION"),
                std::env::args().any(|arg| arg == "--safe"),
            )),
            phone: std::sync::Arc::new(crate::host::phone::PhoneBook::new()),
            fanout: tokio::sync::broadcast::channel(32).0,
            device_sockets: ws::DeviceSockets::default(),
            dependency_jobs: crate::dependencies::jobs::DependencyJobs::new(),
            host_id: crate::host::phone::new_token()[..16].to_string(),
        });
        // Prewarm the cost-metrics cache in the background: one full scan at
        // startup parses every file the Usage dashboard can need, so the first
        // Settings → Usage open answers from cache instead of parsing hundreds
        // of MB of session jsonl on the request path. Guarded off in test
        // builds: the suite starts real servers against the user's real
        // session root, and a background full scan there starves the
        // timing-sensitive spawn/route tests of CPU.
        if !cfg!(test) {
            let data = state.data.clone();
            std::thread::spawn(move || data.prewarm_cost_metrics());
            tokio::spawn(http::phone::restore(Arc::clone(&state)));
        }
        let app = http::router(Arc::clone(&state), static_dir.clone());
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        idle_reaper::spawn(Arc::clone(&state));
        // Plain drive paths: the permission recipes turn these into deny patterns, and a
        // `\\?\C:\...` form never matches the `C:\...` paths tools are called with.
        let plain =
            |path: &Path| crate::platform::open::strip_verbatim_prefix(&path.to_string_lossy());
        std::env::set_var("SPOPI_PUBLIC_DIR", plain(&static_dir));
        std::env::set_var("SPOPI_HOST_ORIGIN", &loopback_origin);
        let install_dir = if cfg!(debug_assertions) {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
        } else {
            static_dir
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| static_dir.clone())
        };
        std::env::set_var("SPOPI_INSTALL_DIR", plain(&install_dir));
        std::env::set_var("SPOPI_UI_OVERLAY", plain(&state.ui.root));
        if let Some(skill) = bundled_skill_dir(&static_dir, cfg!(debug_assertions)) {
            std::env::set_var("SPOPI_SKILL_DIR", plain(&skill));
        }
        let polled = Arc::clone(&state);
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(std::time::Duration::from_secs(1));
            loop {
                tick.tick().await;
                let ui = Arc::clone(&polled.ui);
                let _ = tokio::task::spawn_blocking(move || ui.poll()).await;
            }
        });
        tokio::spawn(async move {
            if let Err(error) = axum::serve(
                listener,
                app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
            )
            .with_graceful_shutdown(async {
                let _ = shutdown_rx.await;
            })
            .await
            {
                log::error!("[spopi-host] server stopped unexpectedly: {error}");
            }
        });
        Ok(Self {
            origin: loopback_origin,
            shutdown: Some(shutdown_tx),
            state,
        })
    }

    /// Register a workspace root at runtime so its files, sessions, and cost
    /// data become reachable over the data plane. Used when opening a new
    /// folder as a workspace after startup.
    pub fn register_workspace(&self, workspace_id: &str, root: PathBuf) -> Result<(), String> {
        self.state
            .data
            .register_workspace(workspace_id, root)
            .map_err(|error| format!("Cannot register workspace: {error:?}"))
    }

    #[cfg(test)]
    pub(crate) fn state(&self) -> Arc<HostState> {
        Arc::clone(&self.state)
    }

    pub fn workspace_root_path(&self, workspace_id: &str) -> Result<PathBuf, String> {
        self.state
            .data
            .workspace_root_path(workspace_id)
            .map_err(|error| format!("Cannot resolve workspace path: {error:?}"))
    }

    pub fn origin(&self) -> &str {
        &self.origin
    }
}

/// The spopi-customize skill. An installed app has it in `<resources>/skills/`, next to
/// `public/`; a dev build reads it from the source tree.
fn bundled_skill_dir(static_dir: &Path, debug_build: bool) -> Option<PathBuf> {
    let installed = static_dir
        .parent()
        .map(|resources| resources.join("skills").join("spopi-customize"));
    let source = debug_build.then(|| {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("skills")
            .join("spopi-customize")
    });
    installed
        .into_iter()
        .chain(source)
        .find(|dir| dir.join("SKILL.md").is_file())
}

impl Drop for HostServer {
    fn drop(&mut self) {
        self.state.terminal_manager.kill_all();
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
    }
}

pub(super) fn host_data_error(error: HostDataError) -> (&'static str, String) {
    let error = OpError::from(error);
    (error.code, error.message)
}

pub(super) fn host_data_http_error(error: HostDataError) -> (StatusCode, Json<Value>) {
    let (code, _) = host_data_error(error);
    let status = match code {
        "workspace_not_found" => StatusCode::NOT_FOUND,
        "file_access_failed" => StatusCode::INTERNAL_SERVER_ERROR,
        _ => StatusCode::BAD_REQUEST,
    };
    api_error(status, code)
}
pub(super) fn api_error(status: StatusCode, code: &'static str) -> (StatusCode, Json<Value>) {
    (status, Json(json!({ "error": { "code": code } })))
}

pub(super) fn api_error_with_detail(
    status: StatusCode,
    code: &'static str,
    message: &str,
) -> (StatusCode, Json<Value>) {
    (
        status,
        Json(json!({ "error": { "code": code, "message": message } })),
    )
}

pub(super) async fn send_error(
    socket: &mut WebSocket,
    request_id: Option<&str>,
    code: &'static str,
    message: &str,
) -> Result<(), axum::Error> {
    socket
        .send(Message::Text(
            structured_error(request_id, code, message)
                .to_string()
                .into(),
        ))
        .await
}

pub(super) fn structured_error(
    request_id: Option<&str>,
    code: &'static str,
    message: &str,
) -> Value {
    json!({
        "type": "error",
        "requestId": request_id,
        "error": { "code": code, "message": message },
    })
}

fn host_port_override() -> Option<u16> {
    // Unit tests must not steal the live host port when SPOPI_HOST_PORT is set.
    if cfg!(test) {
        return None;
    }
    parse_host_port_override(std::env::var("SPOPI_HOST_PORT").ok().as_deref())
}

fn parse_host_port_override(value: Option<&str>) -> Option<u16> {
    let trimmed = value?.trim();
    if trimmed.is_empty() {
        return None;
    }
    trimmed.parse().ok()
}

#[cfg(test)]
mod tests;
