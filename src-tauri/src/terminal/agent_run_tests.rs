// ABOUTME: Exercises commands Pi runs in a terminal tab: label, output tail, exit, stop, and tab reuse.
// ABOUTME: The module under test is terminal::agent_run.

use super::*;
use crate::terminal::registry::TerminalRegistry;
use crate::terminal::state_store::TerminalStateStore;
use serde_json::Value;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tempfile::tempdir;

fn manager(state_dir: &Path) -> TerminalManager {
    TerminalManager::new(
        TerminalRegistry::new(15),
        TerminalStateStore::new(state_dir.to_path_buf()),
    )
}

fn wait_for_view(
    mgr: &TerminalManager,
    terminal_id: &str,
    done: impl Fn(&AgentRunView) -> bool,
) -> Option<AgentRunView> {
    let deadline = Instant::now() + Duration::from_secs(20);
    while Instant::now() < deadline {
        if let Some(view) = mgr.agent_run_view(terminal_id, AGENT_TAIL_BYTES) {
            if done(&view) {
                return Some(view);
            }
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    None
}

#[test]
fn label_uses_the_title_or_the_command_name_and_stays_short() {
    assert_eq!(agent_label(Some(" plan "), "python x.py"), "Pi: plan");
    assert_eq!(
        agent_label(None, "scripts/plan.py --workers 3"),
        "Pi: plan.py"
    );
    assert_eq!(agent_label(Some(""), "  "), "Pi: command");
    let long = agent_label(Some(&"x".repeat(80)), "true");
    assert_eq!(long.chars().count(), MAX_LABEL_CHARS);
}

#[test]
fn the_tail_keeps_the_newest_bytes_and_says_when_it_dropped_some() {
    let mut run = AgentRun {
        key: TerminalKey {
            owner: OwnerId::from_client_id("t-tail"),
            workspace_root: PathBuf::from("/ws"),
        },
        generation: 1,
        label: "Pi: x".into(),
        started: Instant::now(),
        ended: None,
        tail: VecDeque::new(),
        tail_dropped: false,
        stopped: false,
        cursor_answered: false,
    };
    run.push(&vec![b'a'; AGENT_TAIL_BYTES]);
    assert!(!run.tail_dropped);
    run.push(b"end");
    assert!(run.tail_dropped);
    assert_eq!(run.tail.len(), AGENT_TAIL_BYTES);
    assert!(run.tail.iter().rev().take(3).eq(b"dne".iter()));
}

#[test]
fn an_empty_command_is_refused() {
    let dir = tempdir().unwrap();
    let mgr = manager(dir.path());
    let owner = OwnerId::from_client_id("t-empty");
    let error = mgr
        .run_agent_command(&owner, dir.path(), dir.path(), "  ", None)
        .unwrap_err();
    assert_eq!(error, "command is empty");
}

#[test]
fn a_command_runs_in_a_tab_reports_its_exit_and_is_not_restored() {
    let dir = tempdir().unwrap();
    let state = tempdir().unwrap();
    let mgr = manager(state.path());
    let events: Arc<Mutex<Vec<Value>>> = Arc::new(Mutex::new(Vec::new()));
    let sink = events.clone();
    mgr.set_event_sink(Arc::new(move |_owner, event| {
        sink.lock().unwrap().push(event);
    }));
    let owner = OwnerId::from_client_id("t-agent-run");
    let Ok(started) = mgr.run_agent_command(
        &owner,
        dir.path(),
        dir.path(),
        "printf 'agent-%s\\n' ok; exit 3",
        Some("check"),
    ) else {
        return; // no bash on this host
    };
    assert_eq!(started.label, "Pi: check");
    let opened = events.lock().unwrap().iter().any(|event| {
        event.pointer("/payload/type").and_then(Value::as_str) == Some("terminal_opened")
            && event.pointer("/payload/terminalId").and_then(Value::as_str)
                == Some(started.terminal_id.as_str())
    });
    assert!(opened, "the window is told about the new tab");

    let view = wait_for_view(&mgr, &started.terminal_id, |view| view.status != "running")
        .expect("the command finishes");
    assert_eq!(view.status, "exited");
    assert_eq!(view.exit_code, Some(3));
    assert!(view.output.contains("agent-ok"), "{:?}", view.output);
    let banner = view
        .output
        .find("$ printf 'agent-%s\\n' ok; exit 3")
        .expect("the tab starts with the command line");
    assert!(banner < view.output.find("agent-ok").unwrap());
    std::thread::sleep(Duration::from_millis(300));
    let later = mgr
        .agent_run_view(&started.terminal_id, AGENT_TAIL_BYTES)
        .unwrap();
    assert_eq!(
        later.elapsed_ms, view.elapsed_ms,
        "the time stops at the exit"
    );

    let metadata = TerminalStateStore::new(state.path().to_path_buf())
        .load_for_workspace(dir.path())
        .unwrap()
        .expect("metadata persisted");
    assert!(
        metadata.tabs.is_empty(),
        "a Pi command is not run again on the next start"
    );
}

#[test]
fn stop_ends_a_running_command_and_keeps_its_tab() {
    let dir = tempdir().unwrap();
    let mgr = manager(dir.path());
    let owner = OwnerId::from_client_id("t-agent-stop");
    let Ok(started) = mgr.run_agent_command(
        &owner,
        dir.path(),
        dir.path(),
        "echo started; sleep 30",
        None,
    ) else {
        return;
    };
    wait_for_view(&mgr, &started.terminal_id, |view| {
        view.output.contains("started")
    })
    .expect("the command starts");
    mgr.stop_agent_run(&started.terminal_id).unwrap();
    let view = wait_for_view(&mgr, &started.terminal_id, |view| view.status != "running")
        .expect("the stop is reported");
    assert_eq!(view.status, "stopped");
    assert!(mgr.stop_agent_run("unknown").is_err());
}

#[test]
fn a_full_project_closes_its_oldest_finished_pi_tab() {
    let dir = tempdir().unwrap();
    let mgr = manager(dir.path());
    let owner = OwnerId::from_client_id("t-agent-quota");
    let mut ids = Vec::new();
    for _ in 0..WORKSPACE_TAB_QUOTA {
        let Ok(started) = mgr.run_agent_command(&owner, dir.path(), dir.path(), "true", None)
        else {
            return;
        };
        wait_for_view(&mgr, &started.terminal_id, |view| view.status == "exited")
            .expect("the command finishes");
        ids.push(started.terminal_id);
    }
    let next = mgr
        .run_agent_command(&owner, dir.path(), dir.path(), "true", None)
        .expect("a finished Pi tab makes room");
    assert!(
        mgr.agent_run_view(&ids[0], 10).is_none(),
        "the oldest tab closed"
    );
    assert!(mgr.agent_run_view(&ids[1], 10).is_some());
    assert!(mgr.agent_run_view(&next.terminal_id, 10).is_some());
}
