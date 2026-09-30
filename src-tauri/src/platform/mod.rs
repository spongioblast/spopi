// ABOUTME: Declares OS helpers: hex, loopback, window ownership, file openers, and WebView capture.
// ABOUTME: Windows-only child setup lives in windows_child.
//! OS-specific process and window helpers.
//!
//! Windows job objects, AppImage environment repair, the WebView owner,
//! WebView screenshots, and the model's live-debugging port.

pub(crate) mod appimage_env;
pub(crate) mod hex;
pub(crate) mod live_debug;
pub(crate) mod loopback;
pub(crate) mod open;
pub(crate) mod webview_capture;
pub(crate) mod window_owner;
pub(crate) mod windows_child;
