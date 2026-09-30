// ABOUTME: Declares the terminal manager, registry, profiles, and output store.
// ABOUTME: The PTY itself is owned by the manager.
//! PTY terminals: profiles, registry, output, and persisted tab state.
//!
//! The host creates terminals; the WebView only sends input and resize.

pub(crate) mod manager;
pub(crate) mod output;
pub(crate) mod profiles;
pub(crate) mod registry;
pub(crate) mod spawn;
pub(crate) mod state_store;
pub(crate) mod ws_dispatch;

use std::sync::{Mutex, MutexGuard};

/// A poisoned lock still holds the last value written. Keep serving it.
pub(in crate::terminal) fn recover_lock<T>(lock: &Mutex<T>) -> MutexGuard<'_, T> {
    lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}
