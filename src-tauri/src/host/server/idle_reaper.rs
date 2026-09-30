// ABOUTME: Stops Pi runtimes nobody is looking at after a configurable idle time.
// ABOUTME: Reads `ui.runtimeIdleTimeoutMinutes` on every sweep; 0 disables reaping.

use super::HostState;
use serde_json::Value;
use std::sync::Arc;
use std::time::Duration;

pub(super) const PREFERENCE_KEY: &str = "ui.runtimeIdleTimeoutMinutes";
pub(super) const DEFAULT_MINUTES: u64 = 30;
const SWEEP_INTERVAL: Duration = Duration::from_secs(60);

/// Minutes from a stored preference value; the default when unset or invalid.
pub(super) fn idle_timeout_minutes(stored: Option<&Value>) -> u64 {
    match stored {
        Some(Value::Number(number)) => number
            .as_f64()
            .filter(|minutes| minutes.is_finite() && *minutes >= 0.0)
            .map(|minutes| minutes.round() as u64)
            .unwrap_or(DEFAULT_MINUTES),
        Some(Value::String(text)) => text
            .trim()
            .parse::<f64>()
            .ok()
            .filter(|minutes| minutes.is_finite() && *minutes >= 0.0)
            .map(|minutes| minutes.round() as u64)
            .unwrap_or(DEFAULT_MINUTES),
        _ => DEFAULT_MINUTES,
    }
}

fn configured_timeout(state: &HostState) -> Duration {
    let stored = state
        .metadata
        .as_ref()
        .and_then(|store| store.lock().ok())
        .and_then(|store| store.preference_get(PREFERENCE_KEY).ok().flatten());
    Duration::from_secs(idle_timeout_minutes(stored.as_ref()) * 60)
}

pub(super) fn spawn(state: Arc<HostState>) {
    if !cfg!(test) {
        let warm = Arc::clone(&state);
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(2)).await;
            warm_standbys(&warm);
        });
    }
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(SWEEP_INTERVAL);
        ticker.tick().await;
        loop {
            ticker.tick().await;
            let idle_for = configured_timeout(&state);
            for target in state.runtimes.reap_idle(idle_for) {
                log::info!(
                    "[spopi-host] stopped idle Pi runtime for session {} after {} min",
                    target.session_id,
                    idle_for.as_secs() / 60
                );
            }
        }
    });
}

/// Start a replacement after a session takes the warm Pi. Test builds skip
/// the real process; the boot warmer uses the same guard.
pub(super) fn refill_standbys(state: &HostState) {
    if cfg!(test) {
        return;
    }
    warm_standbys(state);
}

fn warm_standbys(state: &HostState) {
    use crate::pi::coordinator::RuntimeTarget;
    // Pi writes the session file on the first assistant message, so an unused
    // standby does not appear in the session list and leaves nothing to delete.
    for (workspace_id, root) in state.data.workspace_ids() {
        if state.runtimes.standby_for(&workspace_id).is_some() {
            continue;
        }
        let session_id = format!("standby-{}", uuid::Uuid::new_v4().simple());
        let target = RuntimeTarget::new(
            workspace_id,
            session_id,
            format!("instance-{}", uuid::Uuid::new_v4().simple()),
        );
        let Ok(launch) = state
            .pi_launch
            .native_launch_spec(&root.to_string_lossy(), None)
        else {
            continue;
        };
        if state.runtimes.spawn(target.clone(), launch).is_err() {
            continue;
        }
        if state.runtimes.park_standby(&target).is_err() {
            let _ = state.runtimes.stop(&target);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{idle_timeout_minutes, DEFAULT_MINUTES};
    use serde_json::json;

    #[test]
    fn reads_minutes_from_numbers_and_strings_with_a_default() {
        assert_eq!(idle_timeout_minutes(None), DEFAULT_MINUTES);
        assert_eq!(idle_timeout_minutes(Some(&json!(45))), 45);
        assert_eq!(idle_timeout_minutes(Some(&json!("15"))), 15);
        assert_eq!(idle_timeout_minutes(Some(&json!(0))), 0);
        assert_eq!(idle_timeout_minutes(Some(&json!(-3))), DEFAULT_MINUTES);
        assert_eq!(idle_timeout_minutes(Some(&json!("soon"))), DEFAULT_MINUTES);
    }
}
