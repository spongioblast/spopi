// ABOUTME: Handles terminal stream commands on a running PTY: input, resize, checkpoint, and output ack.
// ABOUTME: Every command is bound to a running generation; tab creation and teardown are in lifecycle.rs.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use portable_pty::PtySize;
use serde_json::{json, Value};
use std::path::Path;

use crate::platform::window_owner::OwnerId;
use crate::terminal::manager::{err_str_owned, TerminalManager};
use crate::terminal::output::{TerminalLimits, TerminalOutputStore};
use crate::terminal::recover_lock;
use crate::terminal::registry::TerminalError;

const INPUT_MAX_BYTES: usize = 64 * 1024;
const CHECKPOINT_MAX_BYTES: usize = 2 * 1024 * 1024;

impl TerminalManager {
    pub(super) fn create_input(
        &self,
        owner: &OwnerId,
        workspace_root: &Path,
        payload: &Value,
    ) -> Result<Value, String> {
        let (terminal_id, generation, bytes) = decode_target_bytes(payload, INPUT_MAX_BYTES)?;
        let key = self.key(owner, workspace_root);
        self.inner
            .registry
            .require_running(&key, &terminal_id, generation)
            .map_err(err_str_owned)?;
        let mut live = recover_lock(&self.inner.live);
        let lt = live
            .get_mut(&terminal_id)
            .ok_or_else(|| "terminal is not running".to_string())?;
        if lt.generation != generation {
            return Err(err_str_owned(TerminalError::StaleGeneration));
        }
        lt.writer
            .write_all(&bytes)
            .map_err(|e| format!("terminal write failed: {e}"))?;
        lt.writer
            .flush()
            .map_err(|e| format!("terminal flush failed: {e}"))?;
        Ok(json!({ "type": "terminal_input_acked", "terminalId": terminal_id }))
    }

    pub(super) fn resize(
        &self,
        owner: &OwnerId,
        workspace_root: &Path,
        payload: &Value,
    ) -> Result<Value, String> {
        let terminal_id = payload
            .get("terminalId")
            .and_then(Value::as_str)
            .ok_or_else(|| "terminalId is required".to_string())?
            .to_string();
        let generation = payload
            .get("generation")
            .and_then(Value::as_u64)
            .ok_or_else(|| "generation is required".to_string())?;
        let cols_raw = payload
            .get("cols")
            .and_then(Value::as_u64)
            .ok_or_else(|| "cols is required".to_string())?;
        let rows_raw = payload
            .get("rows")
            .and_then(Value::as_u64)
            .ok_or_else(|| "rows is required".to_string())?;
        // Validate the full range before truncating to u16: `as u16` would
        // silently wrap oversized values (e.g. 65536 -> 0).
        if cols_raw == 0
            || rows_raw == 0
            || cols_raw > u16::MAX as u64
            || rows_raw > u16::MAX as u64
        {
            return Err("terminal dimensions out of range".to_string());
        }
        let cols = cols_raw as u16;
        let rows = rows_raw as u16;
        let key = self.key(owner, workspace_root);
        self.inner
            .registry
            .require_running(&key, &terminal_id, generation)
            .map_err(err_str_owned)?;
        let mut live = recover_lock(&self.inner.live);
        let lt = live
            .get_mut(&terminal_id)
            .ok_or_else(|| "terminal is not running".to_string())?;
        if lt.generation != generation {
            return Err(err_str_owned(TerminalError::StaleGeneration));
        }
        lt.master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("terminal resize failed: {e}"))?;
        Ok(json!({ "type": "terminal_resized", "terminalId": terminal_id }))
    }

    pub(super) fn checkpoint(
        &self,
        owner: &OwnerId,
        workspace_root: &Path,
        payload: &Value,
    ) -> Result<Value, String> {
        let (terminal_id, generation, snapshot) =
            decode_target_bytes(payload, CHECKPOINT_MAX_BYTES)?;
        let watermark = payload
            .get("watermark")
            .and_then(Value::as_u64)
            .ok_or_else(|| "watermark is required".to_string())?;
        let key = self.key(owner, workspace_root);
        self.inner
            .registry
            .require_running(&key, &terminal_id, generation)
            .map_err(err_str_owned)?;
        let mut outputs = recover_lock(&self.inner.outputs);
        let output = outputs
            .entry(terminal_id.clone())
            .or_insert_with(|| TerminalOutputStore::new(TerminalLimits::default()));
        output
            .accept_checkpoint(watermark, snapshot)
            .map_err(|e| format!("checkpoint rejected: {e:?}"))?;
        Ok(json!({ "type": "terminal_checkpoint_acked", "terminalId": terminal_id }))
    }

    pub(super) fn ack(
        &self,
        owner: &OwnerId,
        workspace_root: &Path,
        payload: &Value,
    ) -> Result<Value, String> {
        let terminal_id = payload
            .get("terminalId")
            .and_then(Value::as_str)
            .ok_or_else(|| "terminalId is required".to_string())?
            .to_string();
        let generation = payload
            .get("generation")
            .and_then(Value::as_u64)
            .ok_or_else(|| "generation is required".to_string())?;
        let sequence = payload
            .get("sequence")
            .and_then(Value::as_u64)
            .ok_or_else(|| "sequence is required".to_string())?;
        let key = self.key(owner, workspace_root);
        self.inner
            .registry
            .require_running(&key, &terminal_id, generation)
            .map_err(err_str_owned)?;
        let mut outputs = recover_lock(&self.inner.outputs);
        if let Some(output) = outputs.get_mut(&terminal_id) {
            output.ack(sequence);
        }
        Ok(json!({ "type": "terminal_ack_acked", "terminalId": terminal_id }))
    }
}

fn decode_target_bytes(
    payload: &Value,
    max_bytes: usize,
) -> Result<(String, u64, Vec<u8>), String> {
    let terminal_id = payload
        .get("terminalId")
        .and_then(Value::as_str)
        .ok_or_else(|| "terminalId is required".to_string())?
        .to_string();
    let generation = payload
        .get("generation")
        .and_then(Value::as_u64)
        .ok_or_else(|| "generation is required".to_string())?;
    let data_b64 = payload
        .get("dataBase64")
        .and_then(Value::as_str)
        .ok_or_else(|| "dataBase64 is required".to_string())?;
    let bytes = BASE64
        .decode(data_b64)
        .map_err(|e| format!("invalid base64: {e}"))?;
    if bytes.len() > max_bytes {
        return Err(format!("payload exceeds {max_bytes} bytes"));
    }
    Ok((terminal_id, generation, bytes))
}
