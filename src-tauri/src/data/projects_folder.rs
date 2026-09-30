// ABOUTME: Where chats without a project live: `<projects folder>/<date-time>`.
// ABOUTME: The folder is the `ui.projectsFolder` preference, else `<home>/SPOPI`, per OS user.

use std::fs;
use std::path::{Path, PathBuf};

pub const PROJECTS_FOLDER_PREF: &str = "ui.projectsFolder";
/// Set when startup could not use the chosen folder; the window shows it once.
pub const PROJECTS_FOLDER_FALLBACK_PREF: &str = "ui.projectsFolderFallback";

/// The user's choice when it is an absolute path, otherwise `<home>/SPOPI`.
/// Resolved at run time, so every OS user gets a folder in their own home.
pub fn resolve_projects_folder(preference: Option<&str>, home: &Path) -> PathBuf {
    preference
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .unwrap_or_else(|| home.join("SPOPI"))
}

/// `2026-09-27_11-35-07`, or with a `-N` suffix when that second is taken.
/// The older `2026-09-27-1135` form still counts, so an empty folder from
/// before the seconds stamp can be reused.
fn digits(text: &str, len: usize) -> bool {
    text.len() == len && text.bytes().all(|b| b.is_ascii_digit())
}

fn is_chat_folder_name(name: &str) -> bool {
    let parts: Vec<&str> = name.split(['-', '_']).collect();
    let new_stamp = parts.len() == 6
        && [4, 2, 2, 2, 2, 2]
            .iter()
            .zip(&parts)
            .all(|(len, part)| digits(part, *len));
    let with_counter = parts.len() == 7
        && [4, 2, 2, 2, 2, 2]
            .iter()
            .zip(&parts)
            .all(|(len, part)| digits(part, *len))
        && digits(parts[6], parts[6].len())
        && parts[6].len() <= 2;
    let old_stamp = parts.len() >= 4
        && parts.len() <= 5
        && [4, 2, 2, 4]
            .iter()
            .zip(&parts)
            .all(|(len, part)| digits(part, *len))
        && parts.get(4).is_none_or(|part| digits(part, part.len()));
    new_stamp || with_counter || old_stamp
}

fn is_empty_dir(path: &Path) -> bool {
    fs::read_dir(path).is_ok_and(|mut entries| entries.next().is_none())
}

/// A fresh folder for a chat that has no project. Startup only asks for one when
/// no saved session points at an existing folder, so an empty chat folder left
/// by an earlier chat that wrote nothing is reused instead of piling up.
pub fn fresh_chat_folder(root: &Path, stamp: &str) -> Result<PathBuf, String> {
    fs::create_dir_all(root)
        .map_err(|error| format!("Cannot create projects folder {}: {error}", root.display()))?;
    let mut reusable: Vec<PathBuf> = fs::read_dir(root)
        .map_err(|error| format!("Cannot read projects folder {}: {error}", root.display()))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_dir()
                && path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(is_chat_folder_name)
                && is_empty_dir(path)
        })
        .collect();
    reusable.sort();
    if let Some(latest) = reusable.pop() {
        return Ok(latest);
    }
    let mut candidate = root.join(stamp);
    let mut suffix = 2;
    while candidate.exists() {
        candidate = root.join(format!("{stamp}-{suffix}"));
        suffix += 1;
    }
    fs::create_dir_all(&candidate)
        .map_err(|error| format!("Cannot create {}: {error}", candidate.display()))?;
    Ok(candidate)
}

/// What a project created by SPOPI holds before the user adds anything:
/// the Pi settings that keep chats inside the folder, and a gitignore that
/// hides every dot folder. Nothing else may be added without updating
/// `is_scaffold_only`, which decides whether an unused project is removed.
const PROJECT_SETTINGS: &str = "{\n  \"sessionDir\": \".pi/sessions\"\n}\n";
const ROOT_GITIGNORE: &str = ".*\n!.gitignore\n";

pub fn scaffold_project(project: &Path) -> Result<(), String> {
    let pi = project.join(".pi");
    fs::create_dir_all(&pi).map_err(|error| format!("Cannot create {}: {error}", pi.display()))?;
    let settings = pi.join("settings.json");
    crate::data::settings_lock::with_settings_lock(&settings, || {
        fs::write(&settings, PROJECT_SETTINGS)
            .map_err(|error| format!("Cannot write Pi settings: {error}"))
    })??;
    fs::write(project.join(".gitignore"), ROOT_GITIGNORE)
        .map_err(|error| format!("Cannot write .gitignore: {error}"))?;
    Ok(())
}

/// Held for the life of the first SPOPI on this app data folder. A second
/// SPOPI cannot take it and leaves unused projects alone, since the first one
/// may have one open.
pub fn claim_sweep_lock(data_dir: &Path) -> Option<fs::File> {
    fs::create_dir_all(data_dir).ok()?;
    let file = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(data_dir.join("sweep.lock"))
        .ok()?;
    file.try_lock().ok()?;
    Some(file)
}

/// Remove dated projects the user created and left without adding anything.
/// Returns how many were removed.
pub fn sweep_untouched_projects(projects_folder: &Path, keep: &Path) -> usize {
    let entries = match fs::read_dir(projects_folder) {
        Ok(entries) => entries,
        Err(_) => return 0,
    };
    let mut removed = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        if path == keep || !is_untouched_dated_project(&path, projects_folder) {
            continue;
        }
        if fs::remove_dir_all(&path).is_ok() {
            removed += 1;
        }
    }
    removed
}

/// A dated folder the user never touched: safe to remove when it is left.
pub fn is_untouched_dated_project(project: &Path, projects_folder: &Path) -> bool {
    let name = project
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    if !is_chat_folder_name(name) {
        return false;
    }
    // A link or junction with a dated name points at someone else's folder.
    if !fs::symlink_metadata(project)
        .is_ok_and(|meta| meta.is_dir() && !meta.file_type().is_symlink())
    {
        return false;
    }
    let comparable = |path: &Path| {
        crate::data::paths::strip_verbatim_prefix(&path.to_string_lossy())
            .trim_end_matches(['/', '\\'])
            .to_lowercase()
    };
    let inside = project
        .parent()
        .is_some_and(|parent| comparable(parent) == comparable(projects_folder));
    inside && scaffold_only(project)
}

/// The folder holds the scaffold and nothing the user added.
fn scaffold_only(project: &Path) -> bool {
    let names = |dir: &Path| -> Option<Vec<String>> {
        let mut names: Vec<String> = fs::read_dir(dir)
            .ok()?
            .filter_map(Result::ok)
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        Some(names)
    };
    let root_ok = names(project).is_some_and(|names| names == [".gitignore", ".pi"]);
    let pi = project.join(".pi");
    let pi_ok = names(&pi)
        .is_some_and(|names| names == ["settings.json"] || names == ["sessions", "settings.json"]);
    let sessions = pi.join("sessions");
    let sessions_ok = !sessions.exists()
        || (sessions.is_dir() && names(&sessions).is_some_and(|names| names.is_empty()));
    root_ok
        && pi_ok
        && sessions_ok
        && fs::read_to_string(project.join(".gitignore")).is_ok_and(|text| text == ROOT_GITIGNORE)
        && fs::read_to_string(pi.join("settings.json")).is_ok_and(|text| text == PROJECT_SETTINGS)
}

/// Local date and time as a folder name, down to the second so two clicks
/// close together never share a name.
pub fn chat_folder_stamp() -> String {
    chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn projects_folder_is_the_absolute_preference_or_home_spopi() {
        let home = Path::new(if cfg!(windows) {
            r"C:\Users\ana"
        } else {
            "/home/ana"
        });
        assert_eq!(resolve_projects_folder(None, home), home.join("SPOPI"));
        assert_eq!(
            resolve_projects_folder(Some("  "), home),
            home.join("SPOPI")
        );
        assert_eq!(
            resolve_projects_folder(Some("relative/dir"), home),
            home.join("SPOPI")
        );
        let chosen = if cfg!(windows) {
            r"D:\Work\Chats"
        } else {
            "/srv/chats"
        };
        assert_eq!(
            resolve_projects_folder(Some(chosen), home),
            PathBuf::from(chosen)
        );
    }

    #[test]
    fn chat_folder_names_are_date_time_with_an_optional_counter() {
        assert!(is_chat_folder_name("2026-09-27_11-35-07"));
        assert!(is_chat_folder_name("2026-09-27_11-35-07-2"));
        assert!(is_chat_folder_name("2026-09-27-1135"));
        assert!(is_chat_folder_name("2026-09-27-1135-2"));
        assert!(!is_chat_folder_name("todo-app"));
        assert!(!is_chat_folder_name("2026-09-27"));
        assert!(!is_chat_folder_name("2026-09-27-11a5"));
    }

    #[test]
    fn a_fresh_chat_folder_is_created_then_reused_while_empty() {
        let root = tempfile::tempdir().unwrap();
        let first = fresh_chat_folder(root.path(), "2026-09-27_11-35-07").unwrap();
        assert_eq!(first, root.path().join("2026-09-27_11-35-07"));
        assert!(first.is_dir());

        let again = fresh_chat_folder(root.path(), "2026-09-27_11-40-00").unwrap();
        assert_eq!(again, first, "an empty chat folder is reused");

        fs::write(first.join("notes.md"), "kept").unwrap();
        let next = fresh_chat_folder(root.path(), "2026-09-27_11-35-07").unwrap();
        assert_eq!(next, root.path().join("2026-09-27_11-35-07-2"));
    }

    #[test]
    fn an_untouched_dated_project_is_only_the_scaffold() {
        let root = tempfile::tempdir().unwrap();
        let project = fresh_chat_folder(root.path(), "2026-09-27_11-35-07").unwrap();
        scaffold_project(&project).unwrap();
        assert!(is_untouched_dated_project(&project, root.path()));
        assert!(!project.join(".pi").join("settings.json.lock").exists());

        fs::write(project.join("notes.md"), "mine").unwrap();
        assert!(!is_untouched_dated_project(&project, root.path()));
        fs::remove_file(project.join("notes.md")).unwrap();
        assert!(is_untouched_dated_project(&project, root.path()));

        let sessions = project.join(".pi").join("sessions");
        fs::create_dir(&sessions).unwrap();
        assert!(is_untouched_dated_project(&project, root.path()));
        fs::write(sessions.join("chat.jsonl"), "{}\n").unwrap();
        assert!(!is_untouched_dated_project(&project, root.path()));
        fs::remove_file(sessions.join("chat.jsonl")).unwrap();
        fs::create_dir(project.join(".pi").join("tmp")).unwrap();
        assert!(!is_untouched_dated_project(&project, root.path()));
        fs::remove_dir(project.join(".pi").join("tmp")).unwrap();

        let renamed = root.path().join("my-project");
        fs::rename(&project, &renamed).unwrap();
        assert!(!is_untouched_dated_project(&renamed, root.path()));
    }

    #[test]
    fn a_second_holder_cannot_take_the_sweep_lock() {
        let data = tempfile::tempdir().unwrap();
        let first = claim_sweep_lock(data.path());
        assert!(first.is_some());
        assert!(claim_sweep_lock(data.path()).is_none());
        drop(first);
        assert!(claim_sweep_lock(data.path()).is_some());
    }

    #[test]
    fn other_folders_in_the_projects_folder_are_never_reused() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join("my-project")).unwrap();
        let fresh = fresh_chat_folder(root.path(), "2026-09-27_11-35-07").unwrap();
        assert_eq!(fresh, root.path().join("2026-09-27_11-35-07"));
    }
}
