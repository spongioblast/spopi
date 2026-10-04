// ABOUTME: Moves a project's chats and rewrites the folder they record.
// ABOUTME: Pi refuses a chat whose header cwd is missing; subagent chats sit in a folder beside it.

use super::session_dirs::{default_session_dir, global_session_dir, session_dir_for};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

/// What a move or rewrite did. A failed move puts every chat back; a header
/// that cannot be rewritten is listed in `failed` and its chat stays moved.
#[derive(Debug, Default)]
pub struct Relocation {
    pub moved: usize,
    pub rewritten: usize,
    pub failed: Vec<String>,
}

/// The folder each chat in the project's own session folder records, for
/// every chat that records another folder than the project.
pub fn foreign_chats(project: &Path, agent_dir: &Path) -> Vec<String> {
    let dir = session_dir_for(project, agent_dir);
    if !dir.starts_with(project) {
        return Vec::new();
    }
    top_level_chats(&dir)
        .into_iter()
        .filter_map(|path| header_field(&path, "cwd"))
        .filter(|recorded| !is_within(recorded, project))
        .collect()
}

/// Point chats found in the project's own folder at the project. Used after
/// the folder was moved or renamed outside SPOPI.
pub fn relink_chats(project: &Path, agent_dir: &Path) -> Result<Relocation, String> {
    let mut report = Relocation::default();
    let mut olds = foreign_chats(project, agent_dir);
    olds.sort();
    olds.dedup();
    for old in olds {
        let next = relocate_project(Path::new(&old), project, agent_dir)?;
        report.moved += next.moved;
        report.rewritten += next.rewritten;
        report.failed.extend(next.failed);
    }
    Ok(report)
}

/// The project now lives at `to`; its chats were recorded at `from`. Chats in
/// Pi's folder for `from` move to the folder Pi uses for `to`, and every
/// header (subagent chats included) is pointed at `to`.
pub fn relocate_project(from: &Path, to: &Path, agent_dir: &Path) -> Result<Relocation, String> {
    let destination = session_dir_for(to, agent_dir);
    let mut sources = vec![default_session_dir(from, agent_dir)];
    if let Some(global) = global_session_dir(agent_dir) {
        sources.push(global);
    }
    sources.push(destination.clone());
    sources.sort();
    sources.dedup();

    let mut report = Relocation::default();
    let mut prefixes = vec![(from.to_path_buf(), to.to_path_buf())];
    let mut touched = Vec::new();
    let mut moves = Vec::new();
    for source in sources {
        let chats: Vec<PathBuf> = top_level_chats(&source)
            .into_iter()
            .filter(|path| header_field(path, "cwd").is_some_and(|cwd| is_within(&cwd, from)))
            .collect();
        if chats.is_empty() {
            continue;
        }
        if source == destination {
            touched.extend(chats);
            continue;
        }
        let moved = move_chats(&chats, &destination).inspect_err(|_| undo_moves(&moves))?;
        report.moved += moved_chats(&moved).len();
        prefixes.push((source.clone(), destination.clone()));
        touched.extend(moved_chats(&moved));
        moves.extend(moved);
    }
    rewrite_all(&touched, &prefixes, &mut report);
    Ok(report)
}

/// A project found again at `to` after it went missing from `from`: bring its
/// chats and records along. Returns the workspace id for `to`.
pub fn relocate_missing_project(
    metadata: &std::sync::Mutex<super::metadata_store::MetadataStore>,
    from: &str,
    to: &Path,
    agent_dir: &Path,
) -> Result<String, String> {
    let to = super::paths::canonical_path(to)
        .map_err(|error| format!("Cannot find {}: {error}", to.display()))?;
    relocate_project(Path::new(from), &to, agent_dir)?;
    let mut store = metadata
        .lock()
        .map_err(|_| "Preference store is busy".to_owned())?;
    let new_path = to.to_string_lossy().into_owned();
    store.unhide_workspace(from)?;
    store.unhide_workspace(&new_path)?;
    let old_id = store.workspace_id_for_stored_path(from)?;
    let new_id = store.workspace_id_for_stored_path(&new_path)?;
    match (old_id, new_id) {
        (Some(old_id), None) => {
            store.retarget_workspace(&old_id, &new_path)?;
            Ok(old_id)
        }
        (_, Some(id)) => Ok(id),
        (None, None) => store.workspace_id_for_path(&to),
    }
}

/// Move a project's chats from Pi's folder into `<project>/.pi/sessions` and
/// record that in `.pi/settings.json`.
pub fn keep_chats_in_project(project: &Path, agent_dir: &Path) -> Result<Relocation, String> {
    let destination = project.join(".pi").join("sessions");
    let mut sources = vec![default_session_dir(project, agent_dir)];
    if let Some(global) = global_session_dir(agent_dir) {
        sources.push(global);
    }
    let settings = project.join(".pi").join("settings.json");
    let previous = fs::read(&settings).ok();
    merge_session_dir_setting(project)?;
    let restore = || match &previous {
        Some(bytes) => {
            let _ = fs::write(&settings, bytes);
        }
        None => {
            let _ = fs::remove_file(&settings);
        }
    };
    if let Err(error) = ensure_folder_ignored(&destination) {
        restore();
        return Err(error);
    }
    let mut report = Relocation::default();
    let mut prefixes = Vec::new();
    let mut touched = Vec::new();
    let mut moves = Vec::new();
    for source in sources {
        if source == destination {
            continue;
        }
        let chats: Vec<PathBuf> = top_level_chats(&source)
            .into_iter()
            .filter(|path| header_field(path, "cwd").is_some_and(|cwd| is_within(&cwd, project)))
            .collect();
        if chats.is_empty() {
            continue;
        }
        let moved = match move_chats(&chats, &destination) {
            Ok(moved) => moved,
            Err(error) => {
                undo_moves(&moves);
                restore();
                return Err(error);
            }
        };
        report.moved += moved_chats(&moved).len();
        prefixes.push((source, destination.clone()));
        touched.extend(moved_chats(&moved));
        moves.extend(moved);
    }
    rewrite_all(&touched, &prefixes, &mut report);
    Ok(report)
}

/// Keep a folder SPOPI writes out of git without touching the repo's own
/// ignore rules. An existing `.gitignore` is left as it is.
pub fn ensure_folder_ignored(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|error| format!("Cannot create {}: {error}", dir.display()))?;
    let ignore = dir.join(".gitignore");
    if ignore.exists() {
        return Ok(());
    }
    fs::write(&ignore, "*\n!.gitignore\n")
        .map_err(|error| format!("Cannot write {}: {error}", ignore.display()))
}

/// Every `(from, to)` rename of a move, chats and subagent folders alike.
type Moves = Vec<(PathBuf, PathBuf)>;

fn undo_moves(done: &[(PathBuf, PathBuf)]) {
    for (source, target) in done.iter().rev() {
        let _ = move_path(target, source);
    }
}

/// A rename, or a copy and delete when `to` is on another drive (Pi's folder
/// on C:, the project on D:). The source goes only after the copy is complete.
fn move_path(from: &Path, to: &Path) -> std::io::Result<()> {
    match fs::rename(from, to) {
        Err(error) if error.kind() == std::io::ErrorKind::CrossesDevices => {
            copy_then_remove(from, to)
        }
        other => other,
    }
}

fn copy_then_remove(from: &Path, to: &Path) -> std::io::Result<()> {
    if to.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            format!("{} already exists", to.display()),
        ));
    }
    if from.is_dir() {
        if let Err(error) = copy_tree(from, to) {
            let _ = fs::remove_dir_all(to);
            return Err(error);
        }
        // A partly removed source keeps its copy; leftovers in Pi's folder are harmless.
        if let Err(error) = fs::remove_dir_all(from) {
            log::warn!(
                "[spopi] moved {} but could not remove it: {error}",
                from.display()
            );
        }
        return Ok(());
    }
    if let Err(error) = fs::copy(from, to) {
        let _ = fs::remove_file(to);
        return Err(error);
    }
    fs::remove_file(from).inspect_err(|_| {
        let _ = fs::remove_file(to);
    })
}

fn copy_tree(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_tree(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

fn moved_chats(moves: &[(PathBuf, PathBuf)]) -> Vec<PathBuf> {
    moves
        .iter()
        .filter(|(_, target)| target.extension().and_then(|ext| ext.to_str()) == Some("jsonl"))
        .map(|(_, target)| target.clone())
        .collect()
}

/// Move each chat and the folder of subagent chats beside it. On a failure
/// everything moved so far goes back.
fn move_chats(chats: &[PathBuf], destination: &Path) -> Result<Moves, String> {
    fs::create_dir_all(destination)
        .map_err(|error| format!("Cannot create {}: {error}", destination.display()))?;
    let mut done: Moves = Vec::new();
    for chat in chats {
        let Some(name) = chat.file_name() else {
            continue;
        };
        let target = destination.join(name);
        if target.exists() {
            undo_moves(&done);
            return Err(format!("{} already exists", target.display()));
        }
        if let Err(error) = move_path(chat, &target) {
            undo_moves(&done);
            return Err(format!("Cannot move {}: {error}", chat.display()));
        }
        done.push((chat.clone(), target.clone()));
        let children = chat.with_extension("");
        if children.is_dir() {
            let child_target = target.with_extension("");
            if let Err(error) = move_path(&children, &child_target) {
                undo_moves(&done);
                return Err(format!("Cannot move {}: {error}", children.display()));
            }
            done.push((children, child_target));
        }
    }
    Ok(done)
}

/// Rewrite the header of each chat and of every subagent chat under it.
fn rewrite_all(chats: &[PathBuf], prefixes: &[(PathBuf, PathBuf)], report: &mut Relocation) {
    for chat in chats {
        let mut files = vec![chat.clone()];
        let children = chat.with_extension("");
        if children.is_dir() {
            collect_jsonl(&children, &mut files);
        }
        for file in files {
            match rewrite_header(&file, prefixes) {
                Ok(true) => report.rewritten += 1,
                Ok(false) => {}
                Err(error) => report.failed.push(error),
            }
        }
    }
}

fn collect_jsonl(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_jsonl(&path, out);
        } else if path.extension().and_then(|ext| ext.to_str()) == Some("jsonl") {
            out.push(path);
        }
    }
}

/// Swap the old prefix for the new one in `cwd` and `parentSession`. Every
/// line after the header stays byte for byte. Returns whether it changed.
fn rewrite_header(path: &Path, prefixes: &[(PathBuf, PathBuf)]) -> Result<bool, String> {
    let text = fs::read_to_string(path)
        .map_err(|error| format!("Cannot read {}: {error}", path.display()))?;
    let (header, rest) = match text.split_once('\n') {
        Some((header, rest)) => (header, Some(rest)),
        None => (text.as_str(), None),
    };
    let Ok(mut value) = serde_json::from_str::<Value>(header) else {
        return Ok(false);
    };
    if value.get("type").and_then(Value::as_str) != Some("session") {
        return Ok(false);
    }
    let mut changed = false;
    for field in ["cwd", "parentSession"] {
        let Some(current) = value.get(field).and_then(Value::as_str).map(str::to_owned) else {
            continue;
        };
        if let Some(next) = swap_prefix(&current, prefixes) {
            value[field] = json!(next);
            changed = true;
        }
    }
    if !changed {
        return Ok(false);
    }
    let rewritten = match rest {
        Some(rest) => format!("{value}\n{rest}"),
        None => value.to_string(),
    };
    let temp = path.with_extension("jsonl.rewriting");
    fs::write(&temp, rewritten)
        .map_err(|error| format!("Cannot write {}: {error}", temp.display()))?;
    fs::rename(&temp, path).map_err(|error| {
        let _ = fs::remove_file(&temp);
        format!("Cannot replace {}: {error}", path.display())
    })?;
    Ok(true)
}

/// The part of `value` after `prefix`, when `value` is `prefix` or a path
/// inside it. Windows paths compare without case.
fn strip_path_prefix<'a>(value: &'a str, prefix: &Path) -> Option<&'a str> {
    let prefix = prefix.to_string_lossy();
    let prefix = prefix.trim_end_matches(['/', '\\']);
    if prefix.is_empty() || value.len() < prefix.len() || !value.is_char_boundary(prefix.len()) {
        return None;
    }
    let (head, tail) = value.split_at(prefix.len());
    let boundary = tail.is_empty() || tail.starts_with(['/', '\\']);
    (boundary && head.eq_ignore_ascii_case(prefix)).then_some(tail)
}

fn swap_prefix(value: &str, prefixes: &[(PathBuf, PathBuf)]) -> Option<String> {
    for (old, new) in prefixes {
        let Some(tail) = strip_path_prefix(value, old) else {
            continue;
        };
        let new_text = new.to_string_lossy();
        let next = format!("{}{tail}", new_text.trim_end_matches(['/', '\\']));
        return (next != value).then_some(next);
    }
    None
}

fn header_field(path: &Path, field: &str) -> Option<String> {
    let file = fs::File::open(path).ok()?;
    let reader = std::io::BufReader::new(file);
    for line in std::io::BufRead::lines(reader).take(20).flatten() {
        let Ok(value) = serde_json::from_str::<Value>(line.trim()) else {
            continue;
        };
        if value.get("type").and_then(Value::as_str) == Some("session") {
            return value.get(field).and_then(Value::as_str).map(str::to_owned);
        }
    }
    None
}

fn merge_session_dir_setting(project: &Path) -> Result<(), String> {
    let settings = project.join(".pi").join("settings.json");
    crate::data::settings_lock::with_settings_lock(&settings, || {
        let mut value = match fs::read_to_string(&settings) {
            Ok(text) => serde_json::from_str::<Value>(&text)
                .map_err(|error| format!("{} is not valid JSON: {error}", settings.display()))?,
            Err(_) => json!({}),
        };
        let Some(object) = value.as_object_mut() else {
            return Err(format!("{} is not a JSON object", settings.display()));
        };
        object.insert("sessionDir".to_owned(), json!(".pi/sessions"));
        crate::data::atomic_json::write_pretty_atomic(&settings, &value)
    })??;
    Ok(())
}

fn top_level_chats(dir: &Path) -> Vec<PathBuf> {
    fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .map(|entry| entry.path())
                .filter(|path| {
                    path.is_file() && path.extension().and_then(|ext| ext.to_str()) == Some("jsonl")
                })
                .collect()
        })
        .unwrap_or_default()
}

/// `recorded` is the project folder or a folder inside it.
fn is_within(recorded: &str, project: &Path) -> bool {
    strip_path_prefix(recorded, project).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "spopi-relocate-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&path).unwrap();
        crate::data::paths::canonical_path(&path).unwrap()
    }

    fn chat(path: &Path, cwd: &Path, parent: Option<&Path>) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut header = json!({ "type": "session", "id": "s", "cwd": cwd.to_string_lossy() });
        if let Some(parent) = parent {
            header["parentSession"] = json!(parent.to_string_lossy());
        }
        fs::write(
            path,
            format!("{header}\n{{\"type\":\"message\",\"text\":\"kept\"}}\n"),
        )
        .unwrap();
    }

    fn header(path: &Path) -> Value {
        let text = fs::read_to_string(path).unwrap();
        serde_json::from_str(text.lines().next().unwrap()).unwrap()
    }

    fn in_project(project: &Path) {
        fs::create_dir_all(project.join(".pi")).unwrap();
        fs::write(
            project.join(".pi").join("settings.json"),
            "{ \"sessionDir\": \".pi/sessions\" }\n",
        )
        .unwrap();
    }

    #[test]
    fn a_renamed_project_rewrites_its_chats_and_subagent_chats() {
        let root = temp();
        let agent = root.join("agent");
        let from = root.join("alpha");
        let to = root.join("beta");
        in_project(&from);
        let sessions = from.join(".pi").join("sessions");
        chat(&sessions.join("one.jsonl"), &from, None);
        chat(
            &sessions
                .join("one")
                .join("run1")
                .join("run-0")
                .join("session.jsonl"),
            &from.join("sub"),
            Some(&sessions.join("one.jsonl")),
        );
        fs::rename(&from, &to).unwrap();

        let report = relocate_project(&from, &to, &agent).unwrap();
        assert_eq!(report.moved, 0);
        assert_eq!(report.rewritten, 2);
        let moved = to.join(".pi").join("sessions");
        assert_eq!(
            header(&moved.join("one.jsonl"))["cwd"],
            json!(to.to_string_lossy())
        );
        let child = header(
            &moved
                .join("one")
                .join("run1")
                .join("run-0")
                .join("session.jsonl"),
        );
        assert_eq!(child["cwd"], json!(to.join("sub").to_string_lossy()));
        assert_eq!(
            child["parentSession"],
            json!(moved.join("one.jsonl").to_string_lossy())
        );
        let text = fs::read_to_string(moved.join("one.jsonl")).unwrap();
        assert!(text.ends_with("\n{\"type\":\"message\",\"text\":\"kept\"}\n"));
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn chats_in_pis_folder_move_to_the_new_encoded_folder() {
        let root = temp();
        let agent = root.join("agent");
        let from = root.join("alpha");
        let to = root.join("beta");
        fs::create_dir_all(&from).unwrap();
        let old_dir = default_session_dir(&from, &agent);
        chat(&old_dir.join("one.jsonl"), &from, None);
        chat(
            &old_dir.join("one").join("r").join("session.jsonl"),
            &from,
            None,
        );
        fs::rename(&from, &to).unwrap();

        let report = relocate_project(&from, &to, &agent).unwrap();
        let new_dir = default_session_dir(&to, &agent);
        assert_eq!(report.moved, 1);
        assert!(new_dir.join("one.jsonl").is_file());
        assert!(new_dir
            .join("one")
            .join("r")
            .join("session.jsonl")
            .is_file());
        assert!(!old_dir.join("one.jsonl").exists());
        assert_eq!(
            header(&new_dir.join("one.jsonl"))["cwd"],
            json!(to.to_string_lossy())
        );
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn a_shared_global_folder_only_changes_this_projects_chats() {
        let root = temp();
        let agent = root.join("agent");
        let shared = root.join("shared");
        fs::create_dir_all(&agent).unwrap();
        fs::write(
            agent.join("settings.json"),
            json!({ "sessionDir": shared.to_string_lossy() }).to_string(),
        )
        .unwrap();
        let from = root.join("alpha");
        let other = root.join("other");
        let to = root.join("beta");
        fs::create_dir_all(&to).unwrap();
        chat(&shared.join("mine.jsonl"), &from, None);
        chat(&shared.join("theirs.jsonl"), &other, None);

        let report = relocate_project(&from, &to, &agent).unwrap();
        assert_eq!(report.moved, 0);
        assert_eq!(
            header(&shared.join("mine.jsonl"))["cwd"],
            json!(to.to_string_lossy())
        );
        assert_eq!(
            header(&shared.join("theirs.jsonl"))["cwd"],
            json!(other.to_string_lossy())
        );
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn relink_points_copied_chats_at_the_folder_they_are_in() {
        let root = temp();
        let project = root.join("proj");
        in_project(&project);
        chat(
            &project.join(".pi").join("sessions").join("one.jsonl"),
            Path::new("D:\\old\\place"),
            None,
        );
        assert_eq!(foreign_chats(&project, &root.join("agent")).len(), 1);

        relink_chats(&project, &root.join("agent")).unwrap();
        let value = header(&project.join(".pi").join("sessions").join("one.jsonl"));
        assert_eq!(value["cwd"], json!(project.to_string_lossy()));
        assert!(foreign_chats(&project, &root.join("agent")).is_empty());
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn keep_moves_chats_and_their_subagent_folder_into_the_project() {
        let root = temp();
        let project = root.join("proj");
        let agent = root.join("agent");
        fs::create_dir_all(project.join(".pi")).unwrap();
        fs::write(
            project.join(".pi").join("settings.json"),
            "{ \"theme\": \"dark\" }",
        )
        .unwrap();
        let source = default_session_dir(&project, &agent);
        chat(&source.join("one.jsonl"), &project, None);
        chat(
            &source.join("one").join("r").join("session.jsonl"),
            &project,
            Some(&source.join("one.jsonl")),
        );

        let report = keep_chats_in_project(&project, &agent).unwrap();
        let sessions = project.join(".pi").join("sessions");
        assert_eq!(report.moved, 1);
        assert!(sessions.join("one.jsonl").is_file());
        let child = header(&sessions.join("one").join("r").join("session.jsonl"));
        assert_eq!(
            child["parentSession"],
            json!(sessions.join("one.jsonl").to_string_lossy())
        );
        let settings: Value = serde_json::from_str(
            &fs::read_to_string(project.join(".pi").join("settings.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(settings["sessionDir"], json!(".pi/sessions"));
        assert_eq!(settings["theme"], json!("dark"));
        assert!(!project.join(".pi").join("settings.json.lock").exists());
        assert!(sessions.join(".gitignore").is_file());
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn a_failed_keep_puts_every_chat_and_the_settings_back() {
        let root = temp();
        let project = root.join("proj");
        let agent = root.join("agent");
        let shared = root.join("shared");
        fs::create_dir_all(project.join(".pi")).unwrap();
        fs::write(project.join(".pi").join("settings.json"), "{}").unwrap();
        fs::create_dir_all(&agent).unwrap();
        fs::write(
            agent.join("settings.json"),
            json!({ "sessionDir": shared.to_string_lossy() }).to_string(),
        )
        .unwrap();
        let first = default_session_dir(&project, &agent);
        chat(&first.join("a.jsonl"), &project, None);
        chat(&shared.join("b.jsonl"), &project, None);
        let sessions = project.join(".pi").join("sessions");
        chat(&sessions.join("b.jsonl"), &project, None);

        assert!(keep_chats_in_project(&project, &agent).is_err());
        assert!(first.join("a.jsonl").is_file());
        assert!(!sessions.join("a.jsonl").exists());
        assert!(shared.join("b.jsonl").is_file());
        assert_eq!(
            fs::read_to_string(project.join(".pi").join("settings.json")).unwrap(),
            "{}"
        );
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn keep_moves_chats_onto_another_drive() {
        // Temp is on C: and the crate on D: here and on the Windows runner.
        let agent = temp().join("agent");
        let project = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join(agent.parent().unwrap().file_name().unwrap())
            .join("proj");
        fs::create_dir_all(&project).unwrap();
        let project = crate::data::paths::canonical_path(&project).unwrap();
        let source = default_session_dir(&project, &agent);
        chat(&source.join("one.jsonl"), &project, None);
        chat(
            &source.join("one").join("r").join("session.jsonl"),
            &project,
            None,
        );

        let report = keep_chats_in_project(&project, &agent).unwrap();
        let sessions = project.join(".pi").join("sessions");
        assert_eq!(report.moved, 1);
        assert!(sessions
            .join("one")
            .join("r")
            .join("session.jsonl")
            .is_file());
        assert!(!source.join("one.jsonl").exists());
        assert!(!source.join("one").exists());
        fs::remove_dir_all(agent.parent().unwrap()).ok();
        fs::remove_dir_all(project.parent().unwrap()).ok();
    }

    #[test]
    fn the_copy_fallback_moves_files_and_folders_and_keeps_an_existing_target() {
        let root = temp();
        fs::write(root.join("a.jsonl"), "a").unwrap();
        copy_then_remove(&root.join("a.jsonl"), &root.join("b.jsonl")).unwrap();
        assert_eq!(fs::read_to_string(root.join("b.jsonl")).unwrap(), "a");
        assert!(!root.join("a.jsonl").exists());

        fs::create_dir_all(root.join("dir").join("deep")).unwrap();
        fs::write(root.join("dir").join("deep").join("x.jsonl"), "x").unwrap();
        copy_then_remove(&root.join("dir"), &root.join("moved")).unwrap();
        assert!(root.join("moved").join("deep").join("x.jsonl").is_file());
        assert!(!root.join("dir").exists());

        fs::write(root.join("c.jsonl"), "c").unwrap();
        assert!(copy_then_remove(&root.join("c.jsonl"), &root.join("b.jsonl")).is_err());
        assert_eq!(fs::read_to_string(root.join("b.jsonl")).unwrap(), "a");
        assert!(root.join("c.jsonl").is_file());
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn an_existing_gitignore_is_not_overwritten() {
        let root = temp();
        fs::write(root.join(".gitignore"), "mine\n").unwrap();
        ensure_folder_ignored(&root).unwrap();
        assert_eq!(
            fs::read_to_string(root.join(".gitignore")).unwrap(),
            "mine\n"
        );
        fs::remove_dir_all(root).ok();
    }
}
