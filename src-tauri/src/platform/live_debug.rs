// ABOUTME: "Live debugging by the model": WebView2 remote debugging on one loopback port, chosen at startup.
// ABOUTME: Off unless the `ui.modelLiveDebug` preference is true; every window of the process gets the same arguments.

use std::sync::OnceLock;

pub const LIVE_DEBUG_PREF: &str = "ui.modelLiveDebug";
pub const CDP_PORT_ENV: &str = "SPOPI_CDP_PORT";

/// wry's own defaults, which a custom argument string would otherwise drop.
const WRY_DEFAULT_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection";

static PORT: OnceLock<Option<u16>> = OnceLock::new();

/// Decides once per process. WebView2 fixes its arguments when the first window
/// opens, and windows that share a data folder must all use the same ones.
pub fn configure(enabled: bool) -> Option<u16> {
    *PORT.get_or_init(|| {
        if !enabled || !cfg!(windows) {
            std::env::remove_var(CDP_PORT_ENV);
            return None;
        }
        let port = free_loopback_port()?;
        std::env::set_var(CDP_PORT_ENV, port.to_string());
        log::warn!("[spopi-host] live debugging by the model is on: WebView2 debugging on 127.0.0.1:{port}");
        Some(port)
    })
}

pub fn port() -> Option<u16> {
    PORT.get().copied().flatten()
}

pub fn browser_args(port: Option<u16>) -> Option<String> {
    port.map(|port| format!("{WRY_DEFAULT_ARGS} --remote-debugging-port={port}"))
}

pub fn apply<'a, R: tauri::Runtime, M: tauri::Manager<R>>(
    builder: tauri::WebviewWindowBuilder<'a, R, M>,
) -> tauri::WebviewWindowBuilder<'a, R, M> {
    match browser_args(port()) {
        Some(args) => builder.additional_browser_args(&args),
        None => builder,
    }
}

pub fn preference_enabled(value: Option<&serde_json::Value>) -> bool {
    matches!(value, Some(serde_json::Value::Bool(true)))
        || matches!(value, Some(serde_json::Value::String(text)) if text == "true")
}

fn free_loopback_port() -> Option<u16> {
    let listener = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).ok()?;
    listener.local_addr().ok().map(|address| address.port())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debugging_args_keep_wry_defaults() {
        assert_eq!(browser_args(None), None);
        assert_eq!(
            browser_args(Some(9340)).as_deref(),
            Some("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --remote-debugging-port=9340")
        );
    }

    #[test]
    fn only_a_true_preference_turns_it_on() {
        assert!(preference_enabled(Some(&serde_json::json!(true))));
        assert!(preference_enabled(Some(&serde_json::json!("true"))));
        assert!(!preference_enabled(Some(&serde_json::json!(false))));
        assert!(!preference_enabled(Some(&serde_json::json!("yes"))));
        assert!(!preference_enabled(None));
    }

    #[test]
    fn a_free_port_is_found_on_loopback() {
        assert!(free_loopback_port().is_some_and(|port| port > 0));
    }
}
