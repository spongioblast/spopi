// ABOUTME: Decides which pi runtimes are idle and stops them, sparing open or busy ones.
// ABOUTME: The sweep interval and timeout preference live in host/server/idle_reaper.rs.

use super::runtime::{is_dialog, PiRuntime};
use crate::pi::coordinator::{RuntimeState, RuntimeTarget};
use std::collections::HashSet;
use std::time::Duration;

impl PiRuntime {
    /// Remember which runtime a client is looking at. Its process is never
    /// reaped while any client has it in the foreground.
    pub fn set_foreground(&self, client_id: &str, target: &RuntimeTarget) {
        if let Ok(mut foreground) = self.inner.foreground.lock() {
            foreground.insert(client_id.to_owned(), target.instance_id.clone());
        }
        self.inner.touch(&target.instance_id);
    }

    pub fn clear_foreground(&self, client_id: &str) {
        if let Ok(mut foreground) = self.inner.foreground.lock() {
            foreground.remove(client_id);
        }
    }

    /// Runtimes nobody is looking at, not mid-turn, not waiting on a dialog,
    /// and untouched for at least `idle_for`. Empty when `idle_for` is zero
    /// (the "never" setting).
    pub fn idle_targets(&self, idle_for: Duration) -> Vec<RuntimeTarget> {
        if idle_for.is_zero() {
            return Vec::new();
        }
        self.reapable_targets(|target| {
            self.inner
                .last_used
                .lock()
                .ok()
                .and_then(|used| used.get(&target.instance_id).map(|at| at.elapsed()))
                .is_some_and(|elapsed| elapsed >= idle_for)
        })
    }

    /// Stop every idle runtime; returns what was stopped.
    pub fn reap_idle(&self, idle_for: Duration) -> Vec<RuntimeTarget> {
        let targets = self.idle_targets(idle_for);
        for target in &targets {
            let _ = self.stop(target);
        }
        targets
    }

    /// Stop a workspace's runtimes that are not busy or in the foreground.
    /// Used when a window navigates to another project; busy ones stay for the
    /// idle reaper.
    pub fn stop_idle_workspace(&self, workspace_id: &str) -> Vec<RuntimeTarget> {
        let mut targets = self.reapable_targets(|target| target.workspace_id == workspace_id);
        for target in &targets {
            let _ = self.stop(target);
        }
        if let Some(standby) = self.stop_standby(workspace_id) {
            if !targets
                .iter()
                .any(|target| target.instance_id == standby.instance_id)
            {
                targets.push(standby);
            }
        }
        targets
    }

    fn reapable_targets(&self, keep_if: impl Fn(&RuntimeTarget) -> bool) -> Vec<RuntimeTarget> {
        let foreground: HashSet<String> = self
            .inner
            .foreground
            .lock()
            .map(|map| map.values().cloned().collect())
            .unwrap_or_default();
        let waiting_on_dialog: HashSet<String> = self
            .inner
            .pending_ui
            .lock()
            .map(|pending| {
                pending
                    .iter()
                    .filter(|(_, events)| events.iter().any(|event| is_dialog(&event.event)))
                    .map(|(id, _)| id.clone())
                    .collect()
            })
            .unwrap_or_default();
        self.statuses()
            .unwrap_or_default()
            .into_iter()
            .filter(|status| status.state != RuntimeState::Working)
            .map(|status| status.target)
            .filter(|target| !foreground.contains(&target.instance_id))
            .filter(|target| !waiting_on_dialog.contains(&target.instance_id))
            .filter(|target| keep_if(target))
            .collect()
    }
}

#[cfg(test)]
#[path = "idle_tests.rs"]
mod tests;
