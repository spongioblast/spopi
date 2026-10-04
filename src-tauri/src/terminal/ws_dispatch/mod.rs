// ABOUTME: Routes terminal WebSocket commands to the tab, lifecycle, and stream handlers.
// ABOUTME: It only matches the command name; the handlers parse arguments and touch the PTY manager.

mod lifecycle;
mod stream;
mod tabs;

use serde_json::{json, Value};
use std::path::Path;

use crate::platform::window_owner::OwnerId;
use crate::terminal::manager::TerminalManager;

impl TerminalManager {
    pub fn dispatch(
        &self,
        owner: &OwnerId,
        workspace_root: &Path,
        payload: &Value,
    ) -> Result<Value, String> {
        let kind = payload.get("type").and_then(Value::as_str).unwrap_or("");
        match kind {
            "terminal_list" => self.list(owner, workspace_root),
            "terminal_profiles" => self.profiles(),
            "terminal_create" => self.create(owner, workspace_root, payload),
            "terminal_input" => self.create_input(owner, workspace_root, payload),
            "terminal_resize" => self.resize(owner, workspace_root, payload),
            "terminal_checkpoint" => self.checkpoint(owner, workspace_root, payload),
            "terminal_ack" => self.ack(owner, workspace_root, payload),
            "terminal_close" => self.close(owner, workspace_root, payload),
            "terminal_restart" => self.restart(owner, workspace_root, payload),
            "terminal_activate" => self.activate(owner, workspace_root, payload),
            "terminal_reorder" => self.reorder(owner, workspace_root, payload),
            "terminal_set_panel_height" => {
                let height = payload
                    .get("heightPx")
                    .and_then(Value::as_u64)
                    .ok_or_else(|| "heightPx is required".to_string())?;
                let height =
                    u32::try_from(height).map_err(|_| "heightPx is out of range".to_string())?;
                self.set_panel_height(owner, workspace_root, height);
                Ok(json!({ "type": "terminal_command_acked" }))
            }
            other => Err(format!("unknown terminal command: {other}")),
        }
    }
}
