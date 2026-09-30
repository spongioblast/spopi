// ABOUTME: Declares the host modules: server, router, phone listener, and TLS.
// ABOUTME: The embedded Pi process lives under pi, not here.
//! Host process: HTTP and WebSocket server, routing, and the phone listener.
//!
//! The embedded Pi runtime lives in `pi`. This folder only accepts connections
//! and forwards them.

pub(crate) mod capabilities;
pub(crate) mod phone;
pub(crate) mod router;
pub(crate) mod server;
pub(crate) mod tls;
pub(crate) mod ui_overlay;
