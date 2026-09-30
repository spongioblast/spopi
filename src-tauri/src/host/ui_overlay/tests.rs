// ABOUTME: Overlay serving order, stale detection, traversal, and safe mode.
// ABOUTME: Exercises host/ui_overlay against a temp shipped tree and overlay.

use super::{relative_ui_path, UiOverlay};
use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

fn temp() -> std::path::PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = std::env::temp_dir().join(format!("spopi-ui-{nonce}"));
    fs::create_dir_all(root.join("shipped").join("app")).unwrap();
    fs::create_dir_all(root.join("shipped").join("locales")).unwrap();
    fs::write(root.join("shipped").join("app").join("a.js"), "shipped").unwrap();
    fs::write(
        root.join("shipped").join("locales").join("en.json"),
        r#"{"settings":{"general":"General"}}"#,
    )
    .unwrap();
    root
}

fn open(root: &std::path::Path, version: &str, safe: bool) -> UiOverlay {
    UiOverlay::open(root.join("shipped"), root.join("ui"), version, safe)
}

#[test]
fn overlay_wins_and_traversal_is_rejected() {
    let root = temp();
    let ui = open(&root, "0.7.0", false);
    fs::create_dir_all(root.join("ui").join("app")).unwrap();
    fs::write(root.join("ui").join("app").join("a.js"), "mine").unwrap();
    ui.poll();
    let served = ui.try_serve("/v/abc/app/a.js").unwrap();
    assert_eq!(served.body, b"mine");
    assert!(ui.try_serve("/app/../../secret").is_none());
    assert!(relative_ui_path("/../x").is_none());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn added_file_and_user_css_empty() {
    let root = temp();
    let ui = open(&root, "0.7.0", false);
    fs::create_dir_all(root.join("ui")).unwrap();
    fs::write(root.join("ui").join("extra.js"), "new").unwrap();
    ui.poll();
    assert_eq!(ui.try_serve("/extra.js").unwrap().body, b"new");
    let list = ui.list_json();
    let status = list["entries"][0]["status"].as_str().unwrap();
    assert_eq!(status, "added");
    assert!(ui.try_serve("/user.css").unwrap().body.is_empty());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn user_js_is_answered_present_or_not_and_silenced_by_safe_mode() {
    let root = temp();
    let ui = open(&root, "0.7.0", false);
    // The page links it unconditionally, so an absent file is empty, not a 404.
    let empty = ui.try_serve("/user.js").unwrap();
    assert!(empty.body.is_empty());
    assert_eq!(empty.content_type, "text/javascript; charset=utf-8");

    fs::create_dir_all(root.join("ui")).unwrap();
    fs::write(root.join("ui").join("user.js"), "export const mine = 1;").unwrap();
    ui.poll();
    assert_eq!(
        ui.try_serve("/user.js").unwrap().body,
        b"export const mine = 1;"
    );

    let safe = open(&root, "0.7.0", true);
    assert!(safe.try_serve("/user.js").unwrap().body.is_empty());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn only_a_user_css_change_reloads_in_place() {
    let root = temp();
    let ui = open(&root, "0.7.0", false);
    assert_eq!(ui.poll(), None);
    fs::write(root.join("ui").join("user.css"), "body{background:pink}").unwrap();
    assert_eq!(ui.poll(), Some("css"));
    assert_eq!(ui.poll(), None);
    fs::create_dir_all(root.join("ui").join("app")).unwrap();
    fs::write(root.join("ui").join("app").join("a.js"), "mine").unwrap();
    assert_eq!(ui.poll(), Some("full"));
    assert!(ui.revert("user.css"));
    assert_eq!(ui.poll(), Some("css"));
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn first_write_snapshots_the_shipped_base() {
    let root = temp();
    let ui = open(&root, "0.7.0", false);
    fs::create_dir_all(root.join("ui").join("app")).unwrap();
    fs::write(root.join("ui").join("app").join("a.js"), "mine").unwrap();
    ui.poll();
    let base = fs::read_to_string(root.join("ui").join(".base").join("app").join("a.js")).unwrap();
    assert_eq!(base, "shipped");
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn stale_override_is_not_served_after_a_version_change() {
    let root = temp();
    let ui = open(&root, "0.7.0", false);
    fs::create_dir_all(root.join("ui").join("app")).unwrap();
    fs::write(root.join("ui").join("app").join("a.js"), "mine").unwrap();
    ui.poll();
    drop(ui);
    fs::write(root.join("shipped").join("app").join("a.js"), "shipped-2").unwrap();
    let next = open(&root, "0.8.0", false);
    assert!(next.try_serve("/app/a.js").is_none());
    let list = next.list_json();
    let status = list["entries"][0]["status"].as_str().unwrap();
    assert_eq!(status, "stale");
    assert_eq!(next.poll(), None);
    fs::write(root.join("ui").join("app").join("a.js"), "mine, merged").unwrap();
    next.poll();
    assert_eq!(next.try_serve("/app/a.js").unwrap().body, b"mine, merged");
    assert_eq!(next.list_json()["entries"][0]["status"], "ok");
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn safe_mode_serves_nothing_from_the_overlay() {
    let root = temp();
    let ui = open(&root, "0.7.0", true);
    fs::write(root.join("ui").join("user.css"), "body{}").unwrap();
    fs::create_dir_all(root.join("ui").join("app")).unwrap();
    fs::write(root.join("ui").join("app").join("a.js"), "mine").unwrap();
    ui.poll();
    assert!(ui.try_serve("/user.css").unwrap().body.is_empty());
    assert!(ui.try_serve("/app/a.js").is_none());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn two_missed_ready_signals_force_the_next_start_safe() {
    let root = temp();
    fs::create_dir_all(root.join("ui").join("app")).unwrap();
    fs::write(root.join("ui").join("app").join("a.js"), "mine").unwrap();
    drop(open(&root, "0.7.0", false));
    drop(open(&root, "0.7.0", false));
    let third = open(&root, "0.7.0", false);
    assert!(third.is_safe());
    third.note_ready();
    assert!(!third.is_safe());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn missed_ready_without_overlay_files_stays_off() {
    let root = temp();
    drop(open(&root, "0.7.0", false));
    drop(open(&root, "0.7.0", false));
    let third = open(&root, "0.7.0", false);
    assert!(!third.is_safe());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn old_safe_flag_with_no_entries_clears_on_ready() {
    let root = temp();
    fs::create_dir_all(root.join("ui")).unwrap();
    fs::write(
        root.join("ui").join("overrides.json"),
        r#"{"safe":true,"failures":0,"entries":[],"disabled":[]}"#,
    )
    .unwrap();
    let ui = open(&root, "0.7.0", false);
    assert!(ui.is_safe());
    ui.note_ready();
    assert!(!ui.is_safe());
    let saved = fs::read_to_string(root.join("ui").join("overrides.json")).unwrap();
    assert!(saved.contains("\"safe\": false"));
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn user_safe_survives_a_ready_signal() {
    let root = temp();
    fs::create_dir_all(root.join("ui").join("app")).unwrap();
    fs::write(root.join("ui").join("app").join("a.js"), "mine").unwrap();
    let ui = open(&root, "0.7.0", false);
    ui.set_safe(true);
    ui.note_ready();
    assert!(ui.is_safe());
    let _ = fs::remove_dir_all(&root);
}
