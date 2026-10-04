// ABOUTME: Declares package install, sources, and update checks.
// ABOUTME: The WebView asks the host to install; it does not run npm itself.
//! Adopted Pi packages: skill install, sources, and update checks.
//!
//! Package enablement that Pi itself reads stays in settings.json.

pub(crate) mod updates;
mod updates_git;
mod updates_npm;
