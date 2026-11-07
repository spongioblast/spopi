// ABOUTME: Runs a command Pi asked for in a dock terminal tab and keeps its output tail for Pi to read.
// ABOUTME: The command runs in bash (Git Bash on Windows) like Pi's bash tool; tabs, PTYs, and exits stay with the manager.

use std::collections::VecDeque;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Instant;

use serde::Serialize;
use serde_json::json;

use crate::platform::window_owner::OwnerId;
use crate::terminal::manager::{err_str_owned, TerminalManager};
use crate::terminal::profiles::{
    resolve_macos_default, resolve_windows_profile, ProfileError, ResolvedShell, ShellProfileId,
};
use crate::terminal::recover_lock;
use crate::terminal::registry::{TerminalKey, TerminalStatus, WORKSPACE_TAB_QUOTA};

/// Output kept for Pi per run. The tab itself keeps the full scrollback.
pub const AGENT_TAIL_BYTES: usize = 512 * 1024;
const LABEL_PREFIX: &str = "Pi: ";
const MAX_LABEL_CHARS: usize = 32;
const CURSOR_QUERY: &[u8] = b"\x1b[6n";
const CURSOR_AT_TOP_LEFT: &[u8] = b"\x1b[1;1R";

pub(in crate::terminal) struct AgentRun {
    pub(in crate::terminal) key: TerminalKey,
    pub(in crate::terminal) generation: u64,
    label: String,
    started: Instant,
    ended: Option<Instant>,
    tail: VecDeque<u8>,
    tail_dropped: bool,
    stopped: bool,
    cursor_answered: bool,
}

impl AgentRun {
    fn push(&mut self, chunk: &[u8]) {
        self.tail.extend(chunk);
        let over = self.tail.len().saturating_sub(AGENT_TAIL_BYTES);
        if over > 0 {
            self.tail.drain(..over);
            self.tail_dropped = true;
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunStarted {
    pub terminal_id: String,
    pub label: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunView {
    pub terminal_id: String,
    pub label: String,
    /// `running`, `exited`, `stopped`, or `failed`.
    pub status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fail_reason: Option<String>,
    pub elapsed_ms: u64,
    /// The newest output, at most the requested number of bytes, ANSI included.
    pub output: String,
    /// True when older output is not included.
    pub output_truncated: bool,
}

/// The tab label: `Pi: ` plus the title, or the command's first word.
pub(in crate::terminal) fn agent_label(title: Option<&str>, command: &str) -> String {
    let name = title
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            let first = command.split_whitespace().next().unwrap_or("command");
            first
                .rsplit(['/', '\\'])
                .next()
                .unwrap_or(first)
                .to_string()
        });
    let room = MAX_LABEL_CHARS - LABEL_PREFIX.chars().count();
    format!(
        "{LABEL_PREFIX}{}",
        name.chars().take(room).collect::<String>()
    )
}

/// Bash prints the command line before running it. Text written into the tab before the shell
/// starts would scroll out of view: ConPTY opens by clearing the screen with line feeds.
pub(in crate::terminal) fn with_banner(command: &str) -> String {
    let quoted = command.replace('\'', r"'\''");
    format!("printf '\\033[2m$ %s\\033[0m\\n' '{quoted}'\n{command}")
}

impl TerminalManager {
    /// Bash runs the command and exits, so the tab ends with the command's exit code.
    fn agent_shell(&self, command: &str) -> Result<(&'static str, ResolvedShell), String> {
        let probe = self.inner.probe.as_ref();
        let guidance = |ProfileError::ProfileUnavailable { guidance, .. }| guidance;
        if cfg!(windows) {
            let bash = resolve_windows_profile(ShellProfileId::GitBash, probe).map_err(guidance)?;
            return Ok((
                "git-bash",
                ResolvedShell {
                    program: bash.program,
                    args: vec!["--login".into(), "-c".into(), command.into()],
                },
            ));
        }
        let bash = PathBuf::from("/bin/bash");
        let program = if probe.is_valid_executable(&bash) {
            bash
        } else {
            resolve_macos_default(&super::manager::default_preferred_shell(), probe)
                .map_err(guidance)?
                .program
        };
        Ok((
            "default",
            ResolvedShell {
                program,
                args: vec!["-l".into(), "-c".into(), command.into()],
            },
        ))
    }

    /// A full project closes its oldest finished Pi tab, so a long session keeps running commands.
    fn free_tab_for_agent(&self, key: &TerminalKey) {
        let descriptors = self.inner.registry.descriptors(key);
        let open = descriptors
            .iter()
            .filter(|d| d.status != TerminalStatus::Closing)
            .count();
        if open < WORKSPACE_TAB_QUOTA {
            return;
        }
        let finished = {
            let runs = recover_lock(&self.inner.agent_runs);
            descriptors.into_iter().find(|d| {
                matches!(d.status, TerminalStatus::Exited | TerminalStatus::Failed)
                    && runs
                        .get(&d.terminal_id)
                        .is_some_and(|run| run.generation == d.generation)
            })
        };
        if let Some(done) = finished {
            if let Ok(lease) =
                self.inner
                    .registry
                    .begin_close(key, &done.terminal_id, done.generation)
            {
                self.terminate_and_finish(key, &lease);
            }
        }
    }

    /// Start `command` in a new tab of `owner`'s project and tell that window to show it.
    pub fn run_agent_command(
        &self,
        owner: &OwnerId,
        workspace_root: &Path,
        cwd: &Path,
        command: &str,
        title: Option<&str>,
    ) -> Result<AgentRunStarted, String> {
        let command = command.trim();
        if command.is_empty() {
            return Err("command is empty".into());
        }
        let (profile_id, shell) = self.agent_shell(&with_banner(command))?;
        let key = self.key(owner, workspace_root);
        self.free_tab_for_agent(&key);
        let label = agent_label(title, command);
        let reservation = self
            .inner
            .registry
            .reserve_tab_with_profile(&key, profile_id, label.clone())
            .map_err(err_str_owned)?;
        let spawned = match self.spawn_pty(&shell, cwd) {
            Ok(spawned) => spawned,
            Err(reason) => {
                let _ = self.inner.registry.mark_failed(
                    &key,
                    &reservation.terminal_id,
                    reservation.generation,
                    reason.clone(),
                );
                return Err(reason);
            }
        };
        if let Err(err) = self.inner.registry.commit_running(
            &key,
            &reservation.terminal_id,
            reservation.generation,
        ) {
            let reason = err_str_owned(err);
            let _ = self.inner.registry.mark_failed(
                &key,
                &reservation.terminal_id,
                reservation.generation,
                reason.clone(),
            );
            self.detach_spawned(spawned);
            return Err(reason);
        }
        recover_lock(&self.inner.agent_runs).insert(
            reservation.terminal_id.clone(),
            AgentRun {
                key: key.clone(),
                generation: reservation.generation,
                label: label.clone(),
                started: Instant::now(),
                ended: None,
                tail: VecDeque::new(),
                tail_dropped: false,
                stopped: false,
                cursor_answered: false,
            },
        );
        self.attach_spawned(
            owner.clone(),
            workspace_root.to_path_buf(),
            reservation.terminal_id.clone(),
            reservation.generation,
            profile_id.to_string(),
            spawned,
        );
        self.persist(owner, workspace_root);
        self.emit(
            owner,
            json!({
                "type": "terminal_event",
                "payload": {
                    "type": "terminal_opened",
                    "terminalId": reservation.terminal_id,
                    "generation": reservation.generation,
                    "label": label,
                }
            }),
        );
        Ok(AgentRunStarted {
            terminal_id: reservation.terminal_id,
            label,
        })
    }

    /// ConPTY asks for the cursor position before it runs the command and waits for the answer.
    /// A window answers it from xterm, but Pi's command must start while no window shows the tab;
    /// xterm does not answer queries it replays, so the window never answers twice.
    pub(in crate::terminal) fn record_agent_output(
        &self,
        terminal_id: &str,
        generation: u64,
        chunk: &[u8],
    ) {
        let answer = {
            let mut runs = recover_lock(&self.inner.agent_runs);
            let Some(run) = runs
                .get_mut(terminal_id)
                .filter(|run| run.generation == generation)
            else {
                return;
            };
            run.push(chunk);
            let asked = !run.cursor_answered && chunk.windows(4).any(|w| w == CURSOR_QUERY);
            run.cursor_answered |= asked;
            asked
        };
        if !answer {
            return;
        }
        let mut live = recover_lock(&self.inner.live);
        if let Some(terminal) = live
            .get_mut(terminal_id)
            .filter(|terminal| terminal.generation == generation)
        {
            let _ = terminal.writer.write_all(CURSOR_AT_TOP_LEFT);
            let _ = terminal.writer.flush();
        }
    }

    pub(in crate::terminal) fn end_agent_run(&self, terminal_id: &str, generation: u64) {
        if let Some(run) = recover_lock(&self.inner.agent_runs)
            .get_mut(terminal_id)
            .filter(|run| run.generation == generation)
        {
            run.ended.get_or_insert_with(Instant::now);
        }
    }

    pub(in crate::terminal) fn forget_agent_run(&self, terminal_id: &str) {
        recover_lock(&self.inner.agent_runs).remove(terminal_id);
    }

    /// True for a tab whose current generation is a Pi command, which is not restored on the next start.
    pub(in crate::terminal) fn is_agent_tab(&self, terminal_id: &str, generation: u64) -> bool {
        recover_lock(&self.inner.agent_runs)
            .get(terminal_id)
            .is_some_and(|run| run.generation == generation)
    }

    /// The run's state and newest output. `None` when Pi did not start it or its tab was closed.
    pub fn agent_run_view(&self, terminal_id: &str, max_bytes: usize) -> Option<AgentRunView> {
        let (key, generation, label, elapsed, output, truncated, stopped) = {
            let runs = recover_lock(&self.inner.agent_runs);
            let run = runs.get(terminal_id)?;
            let skip = run.tail.len().saturating_sub(max_bytes);
            let bytes: Vec<u8> = run.tail.iter().skip(skip).copied().collect();
            (
                run.key.clone(),
                run.generation,
                run.label.clone(),
                run.ended
                    .unwrap_or_else(Instant::now)
                    .duration_since(run.started),
                String::from_utf8_lossy(&bytes).into_owned(),
                run.tail_dropped || skip > 0,
                run.stopped,
            )
        };
        let descriptor = self
            .inner
            .registry
            .descriptors(&key)
            .into_iter()
            .find(|d| d.terminal_id == terminal_id && d.generation == generation)?;
        let status = match descriptor.status {
            TerminalStatus::Creating | TerminalStatus::Running => "running",
            TerminalStatus::Exited if stopped => "stopped",
            TerminalStatus::Exited => "exited",
            TerminalStatus::Failed => "failed",
            TerminalStatus::Closing => return None,
        };
        Some(AgentRunView {
            terminal_id: terminal_id.to_string(),
            label,
            status,
            exit_code: descriptor.exit_code,
            fail_reason: descriptor.fail_reason,
            elapsed_ms: u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX),
            output,
            output_truncated: truncated,
        })
    }

    /// End the run's whole process tree. The tab stays, showing the output and the stop.
    pub fn stop_agent_run(&self, terminal_id: &str) -> Result<(), String> {
        let generation = recover_lock(&self.inner.agent_runs)
            .get(terminal_id)
            .map(|run| run.generation)
            .ok_or_else(|| "Pi did not start this terminal, or it was closed".to_string())?;
        let removed = {
            let mut live = recover_lock(&self.inner.live);
            if live
                .get(terminal_id)
                .is_some_and(|terminal| terminal.generation == generation)
            {
                live.remove(terminal_id)
            } else {
                None
            }
        };
        let Some(terminal) = removed else {
            return Ok(());
        };
        if let Some(run) = recover_lock(&self.inner.agent_runs)
            .get_mut(terminal_id)
            .filter(|run| run.generation == generation)
        {
            run.stopped = true;
        }
        super::spawn::kill_live_terminal(terminal);
        Ok(())
    }
}

#[cfg(test)]
#[path = "agent_run_tests.rs"]
mod tests;
