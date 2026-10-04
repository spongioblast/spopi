// ABOUTME: Runs one install at a time for the browser, Node, or Surf.
// ABOUTME: Each job keeps the last 200 output lines and can be cancelled.

use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::Notify;

use super::agent_browser::bundled_agent_browser;
use super::exec::resolve_executable;
use crate::pi::launch::PiLaunchResolver;

const LINE_CAP: usize = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum JobKind {
    Browser,
    Node,
    Surf,
}

impl JobKind {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "browser" => Some(Self::Browser),
            "node" => Some(Self::Node),
            "surf" => Some(Self::Surf),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Browser => "browser",
            Self::Node => "node",
            Self::Surf => "surf",
        }
    }
}

#[derive(Debug, Clone)]
pub struct JobCommand {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub timeout: Duration,
    pub path_env: Option<String>,
}

#[derive(Debug, Clone)]
pub enum JobWork {
    Command(JobCommand),
    /// Node.js from nodejs.org into this folder, where no package manager can install it without sudo.
    DownloadNode(PathBuf),
}

impl From<JobCommand> for JobWork {
    fn from(command: JobCommand) -> Self {
        Self::Command(command)
    }
}

const NODE_DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(20 * 60);

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JobSnapshot {
    pub kind: String,
    pub state: String,
    pub lines: Vec<String>,
    pub started_ms: u64,
    pub finished_ms: Option<u64>,
    pub exit_code: Option<i32>,
}

struct JobRecord {
    state: String,
    lines: VecDeque<String>,
    started_ms: u64,
    finished_ms: Option<u64>,
    exit_code: Option<i32>,
    cancel: Arc<Notify>,
}

#[derive(Clone)]
pub struct DependencyJobs {
    inner: Arc<Mutex<HashMap<JobKind, JobRecord>>>,
}

impl Default for DependencyJobs {
    fn default() -> Self {
        Self::new()
    }
}

impl DependencyJobs {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn snapshot(&self, kind: JobKind) -> Option<JobSnapshot> {
        let guard = self.inner.lock().unwrap_or_else(|error| error.into_inner());
        guard.get(&kind).map(|record| snapshot(kind, record))
    }

    pub fn cancel(&self, kind: JobKind) -> bool {
        let guard = self.inner.lock().unwrap_or_else(|error| error.into_inner());
        let Some(record) = guard.get(&kind) else {
            return false;
        };
        if record.state != "running" {
            return false;
        }
        record.cancel.notify_one();
        true
    }

    pub async fn start(&self, kind: JobKind, work: impl Into<JobWork>) -> JobSnapshot {
        let work = work.into();
        let cancel = Arc::new(Notify::new());
        {
            let mut guard = self.inner.lock().unwrap_or_else(|error| error.into_inner());
            if let Some(existing) = guard.get(&kind) {
                if existing.state == "running" {
                    return snapshot(kind, existing);
                }
            }
            guard.insert(
                kind,
                JobRecord {
                    state: "running".into(),
                    lines: VecDeque::new(),
                    started_ms: now_ms(),
                    finished_ms: None,
                    exit_code: None,
                    cancel: Arc::clone(&cancel),
                },
            );
        }
        let jobs = self.clone();
        tokio::spawn(async move {
            match work {
                JobWork::Command(command) => run_job(jobs, kind, command, cancel).await,
                JobWork::DownloadNode(dest) => run_node_download(jobs, kind, dest, cancel).await,
            }
        });
        self.snapshot(kind).expect("job was inserted")
    }

    fn push_line(&self, kind: JobKind, line: String) {
        let mut guard = self.inner.lock().unwrap_or_else(|error| error.into_inner());
        let Some(record) = guard.get_mut(&kind) else {
            return;
        };
        record.lines.push_back(line);
        while record.lines.len() > LINE_CAP {
            record.lines.pop_front();
        }
    }

    fn finish(&self, kind: JobKind, state: &str, exit_code: Option<i32>) {
        let mut guard = self.inner.lock().unwrap_or_else(|error| error.into_inner());
        let Some(record) = guard.get_mut(&kind) else {
            return;
        };
        if record.state != "running" {
            return;
        }
        record.state = state.to_string();
        record.exit_code = exit_code;
        record.finished_ms = Some(now_ms());
    }
}

pub fn command_for(kind: JobKind, static_dir: &Path) -> Result<JobWork, String> {
    if cfg!(debug_assertions)
        && std::env::var("SPOPI_DEPENDENCY_FAKE_JOB").ok().as_deref() == Some("1")
    {
        return Ok(fake_command().into());
    }
    let path_env = crate::pi::binary::build_augmented_path();
    match kind {
        JobKind::Browser => {
            let program = bundled_agent_browser(static_dir)
                .ok_or_else(|| "agent-browser is not in this installation".to_string())?;
            Ok(JobCommand {
                program,
                args: vec!["install".into()],
                timeout: Duration::from_secs(15 * 60),
                path_env: Some(path_env),
            }
            .into())
        }
        JobKind::Node => node_work(&path_env),
        JobKind::Surf => {
            let program = PiLaunchResolver::new(static_dir.to_path_buf()).resolve_bundled_pi()?;
            Ok(JobCommand {
                program,
                args: vec!["install".into(), "npm:surf-cli".into()],
                timeout: Duration::from_secs(5 * 60),
                path_env: Some(path_env),
            }
            .into())
        }
    }
}

/// winget on Windows, Homebrew on macOS when it is there, otherwise the nodejs.org download.
fn node_work(path_env: &str) -> Result<JobWork, String> {
    if let Some(command) = node_command(path_env) {
        return Ok(command.into());
    }
    if cfg!(windows) {
        return Err("not_supported".into());
    }
    super::node_download::platform_suffix(std::env::consts::OS, std::env::consts::ARCH)
        .ok_or_else(|| "not_supported".to_string())?;
    super::node_download::install_dir()
        .map(JobWork::DownloadNode)
        .ok_or_else(|| "not_supported".to_string())
}

fn node_command(path_env: &str) -> Option<JobCommand> {
    if cfg!(windows) {
        let program = resolve_executable("winget", path_env)?;
        return Some(JobCommand {
            program,
            args: vec![
                "install".into(),
                "--id".into(),
                "OpenJS.NodeJS.LTS".into(),
                "-e".into(),
                "--silent".into(),
                "--accept-package-agreements".into(),
                "--accept-source-agreements".into(),
            ],
            timeout: Duration::from_secs(20 * 60),
            path_env: Some(path_env.to_string()),
        });
    }
    if cfg!(target_os = "macos") {
        let program = ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"]
            .into_iter()
            .map(PathBuf::from)
            .find(|path| path.is_file())?;
        return Some(JobCommand {
            program,
            args: vec!["install".into(), "node".into()],
            timeout: Duration::from_secs(20 * 60),
            path_env: Some(path_env.to_string()),
        });
    }
    None
}

fn fake_command() -> JobCommand {
    #[cfg(windows)]
    {
        JobCommand {
            program: PathBuf::from("cmd"),
            args: vec![
                "/C".into(),
                "echo fake-dependency-job& echo fake-dependency-job-2".into(),
            ],
            timeout: Duration::from_secs(30),
            path_env: None,
        }
    }
    #[cfg(not(windows))]
    {
        JobCommand {
            program: PathBuf::from("echo"),
            args: vec!["fake-dependency-job".into()],
            timeout: Duration::from_secs(30),
            path_env: None,
        }
    }
}

async fn run_job(jobs: DependencyJobs, kind: JobKind, command: JobCommand, cancel: Arc<Notify>) {
    let mut child = Command::new(&command.program);
    crate::platform::windows_child::hide_console_tokio(&mut child);
    scrub_tokio(&mut child);
    child
        .args(&command.args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(path_env) = &command.path_env {
        child.env("PATH", path_env);
    }
    let mut child = match child.spawn() {
        Ok(child) => child,
        Err(error) => {
            jobs.push_line(kind, format!("failed to start: {error}"));
            jobs.finish(kind, "failed", None);
            return;
        }
    };
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let jobs_out = jobs.clone();
    let stdout_task = tokio::spawn(async move {
        if let Some(stdout) = stdout {
            pump(stdout, jobs_out, kind).await;
        }
    });
    let jobs_err = jobs.clone();
    let stderr_task = tokio::spawn(async move {
        if let Some(stderr) = stderr {
            pump(stderr, jobs_err, kind).await;
        }
    });
    let status = tokio::select! {
        status = child.wait() => status,
        _ = cancel.notified() => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            jobs.finish(kind, "cancelled", None);
            let _ = stdout_task.await;
            let _ = stderr_task.await;
            return;
        }
        _ = tokio::time::sleep(command.timeout) => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            jobs.push_line(kind, "timed out".into());
            jobs.finish(kind, "timed_out", None);
            let _ = stdout_task.await;
            let _ = stderr_task.await;
            return;
        }
    };
    let _ = stdout_task.await;
    let _ = stderr_task.await;
    match status {
        Ok(status) if status.success() => jobs.finish(kind, "succeeded", status.code()),
        Ok(status) => jobs.finish(kind, "failed", status.code()),
        Err(error) => {
            jobs.push_line(kind, error.to_string());
            jobs.finish(kind, "failed", None);
        }
    }
}

async fn run_node_download(
    jobs: DependencyJobs,
    kind: JobKind,
    dest: PathBuf,
    cancel: Arc<Notify>,
) {
    let log_jobs = jobs.clone();
    // The install future is dropped at the end of this block, which kills a running
    // `tar`, before its partial files are removed.
    let timed_out = {
        let install =
            super::node_download::install(&dest, move |line| log_jobs.push_line(kind, line));
        tokio::select! {
            result = install => {
                match result {
                    Ok(()) => jobs.finish(kind, "succeeded", Some(0)),
                    Err(error) => {
                        jobs.push_line(kind, error);
                        jobs.finish(kind, "failed", None);
                    }
                }
                return;
            }
            _ = cancel.notified() => false,
            _ = tokio::time::sleep(NODE_DOWNLOAD_TIMEOUT) => true,
        }
    };
    super::node_download::discard_partial(&dest).await;
    if timed_out {
        jobs.push_line(kind, "timed out".into());
        jobs.finish(kind, "timed_out", None);
    } else {
        jobs.finish(kind, "cancelled", None);
    }
}

async fn pump<R>(reader: R, jobs: DependencyJobs, kind: JobKind)
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut lines = BufReader::new(reader).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let text = line.rsplit('\r').next().unwrap_or("").trim().to_string();
        if text.is_empty() {
            continue;
        }
        jobs.push_line(kind, text);
    }
}

pub(super) fn scrub_tokio(command: &mut Command) {
    use crate::platform::appimage_env::{plan, EnvAction};
    for (key, action) in plan() {
        match action {
            EnvAction::Set(value) => {
                command.env(key, value);
            }
            EnvAction::Unset => {
                command.env_remove(key);
            }
        }
    }
}

fn snapshot(kind: JobKind, record: &JobRecord) -> JobSnapshot {
    JobSnapshot {
        kind: kind.as_str().to_string(),
        state: record.state.clone(),
        lines: record.lines.iter().cloned().collect(),
        started_ms: record.started_ms,
        finished_ms: record.finished_ms,
        exit_code: record.exit_code,
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn echo_lines(count: u32) -> JobCommand {
        #[cfg(windows)]
        {
            JobCommand {
                program: PathBuf::from("cmd"),
                args: vec![
                    "/C".into(),
                    format!("for /L %i in (1,1,{count}) do @echo line%i"),
                ],
                timeout: Duration::from_secs(30),
                path_env: None,
            }
        }
        #[cfg(not(windows))]
        {
            JobCommand {
                program: PathBuf::from("sh"),
                args: vec![
                    "-c".into(),
                    format!("i=1; while [ $i -le {count} ]; do echo line$i; i=$((i+1)); done"),
                ],
                timeout: Duration::from_secs(30),
                path_env: None,
            }
        }
    }

    fn slow_command() -> JobCommand {
        #[cfg(windows)]
        {
            JobCommand {
                program: PathBuf::from("cmd"),
                args: vec!["/C".into(), "ping -n 30 127.0.0.1".into()],
                timeout: Duration::from_secs(60),
                path_env: None,
            }
        }
        #[cfg(not(windows))]
        {
            JobCommand {
                program: PathBuf::from("sleep"),
                args: vec!["30".into()],
                timeout: Duration::from_secs(60),
                path_env: None,
            }
        }
    }

    async fn wait_until<F>(mut done: F) -> JobSnapshot
    where
        F: FnMut() -> Option<JobSnapshot>,
    {
        for _ in 0..100 {
            if let Some(job) = done() {
                if job.state != "running" {
                    return job;
                }
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        panic!("job did not finish");
    }

    #[tokio::test]
    async fn lines_are_capped_at_200() {
        let jobs = DependencyJobs::new();
        jobs.start(JobKind::Browser, echo_lines(250)).await;
        let job = wait_until(|| jobs.snapshot(JobKind::Browser)).await;
        assert_eq!(job.state, "succeeded");
        assert_eq!(job.lines.len(), LINE_CAP);
        assert_eq!(job.lines.last().map(String::as_str), Some("line250"));
    }

    #[tokio::test]
    async fn cancel_stops_the_child() {
        let jobs = DependencyJobs::new();
        jobs.start(JobKind::Node, slow_command()).await;
        assert!(jobs.cancel(JobKind::Node));
        let job = wait_until(|| jobs.snapshot(JobKind::Node)).await;
        assert_eq!(job.state, "cancelled");
    }

    #[tokio::test]
    async fn a_second_start_returns_the_running_job() {
        let jobs = DependencyJobs::new();
        let first = jobs.start(JobKind::Surf, slow_command()).await;
        let second = jobs.start(JobKind::Surf, slow_command()).await;
        assert_eq!(first.started_ms, second.started_ms);
        assert_eq!(second.state, "running");
        assert!(jobs.cancel(JobKind::Surf));
        let _ = wait_until(|| jobs.snapshot(JobKind::Surf)).await;
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn node_installs_on_linux_by_download() {
        let work = command_for(JobKind::Node, Path::new(".")).unwrap();
        let JobWork::DownloadNode(dest) = work else {
            panic!("expected the nodejs.org download, got {work:?}");
        };
        assert!(dest.ends_with("spopi/node"), "{}", dest.display());
    }
}
