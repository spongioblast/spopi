// ABOUTME: Resolves a project's session directory the way Pi does.
// ABOUTME: Project setting, then global setting, then the encoded default folder.

use super::paths::canonical_path;
use serde_json::Value;
use std::path::{Path, PathBuf};

/// Where a project's chats are stored, following Pi's order:
/// the project's `.pi/settings.json` `sessionDir`, then the global
/// `settings.json` `sessionDir`, then `sessions/<encoded cwd>`.
pub(crate) fn session_dir_for(project: &Path, agent_dir: &Path) -> PathBuf {
    if let Some(dir) = read_session_dir(&project.join(".pi").join("settings.json")) {
        return resolve_relative(project, &dir);
    }
    global_session_dir(agent_dir).unwrap_or_else(|| default_session_dir(project, agent_dir))
}

/// The global `settings.json` `sessionDir`, when the user set one.
pub(crate) fn global_session_dir(agent_dir: &Path) -> Option<PathBuf> {
    read_session_dir(&agent_dir.join("settings.json")).map(|dir| expand_home(&dir))
}

/// Pi's default: `sessions/--<cwd with separators replaced by dashes>--`.
pub(crate) fn default_session_dir(project: &Path, agent_dir: &Path) -> PathBuf {
    agent_dir
        .join("sessions")
        .join(format!("--{}--", encode_cwd(project)))
}

/// Pi's encoding: drop the leading separator, then replace `/`, `\` and `:`.
pub(crate) fn encode_cwd(project: &Path) -> String {
    let resolved = canonical_path(project).unwrap_or_else(|_| project.to_path_buf());
    let text = resolved.to_string_lossy();
    let trimmed = text
        .strip_prefix('/')
        .or_else(|| text.strip_prefix('\\'))
        .unwrap_or(&text);
    trimmed.replace(['/', '\\', ':'], "-")
}

fn read_session_dir(settings: &Path) -> Option<String> {
    let text = std::fs::read_to_string(settings).ok()?;
    let value: Value = serde_json::from_str(&text).ok()?;
    let dir = value.get("sessionDir")?.as_str()?.trim();
    (!dir.is_empty()).then(|| dir.to_owned())
}

fn resolve_relative(project: &Path, dir: &str) -> PathBuf {
    let path = expand_home(dir);
    if path.is_absolute() {
        path
    } else {
        project.join(path)
    }
}

fn expand_home(dir: &str) -> PathBuf {
    let home = dirs::home_dir().unwrap_or_default();
    if dir == "~" {
        return home;
    }
    dir.strip_prefix("~/")
        .or_else(|| dir.strip_prefix("~\\"))
        .map(|rest| home.join(rest))
        .unwrap_or_else(|| PathBuf::from(dir))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write_settings(dir: &Path, body: &str) {
        fs::create_dir_all(dir.join(".pi")).unwrap();
        fs::write(dir.join(".pi").join("settings.json"), body).unwrap();
    }

    #[test]
    fn encodes_a_windows_path_the_way_pi_does() {
        let project = std::env::temp_dir().join(format!(
            "spopi-encode-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&project).unwrap();
        let canonical = canonical_path(&project).unwrap();
        let expected = canonical
            .to_string_lossy()
            .trim_start_matches(['/', '\\'])
            .replace(['/', '\\', ':'], "-");
        assert_eq!(encode_cwd(&project), expected);
        fs::remove_dir_all(project).ok();
    }

    #[test]
    fn project_setting_wins_over_the_global_one() {
        let temp = std::env::temp_dir().join(format!(
            "spopi-session-dirs-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let project = temp.join("proj");
        let agent = temp.join("agent");
        fs::create_dir_all(&agent).unwrap();
        write_settings(&project, r#"{ "sessionDir": ".pi/sessions" }"#);
        fs::write(
            agent.join("settings.json"),
            r#"{ "sessionDir": "/global/sessions" }"#,
        )
        .unwrap();

        let dir = session_dir_for(&project, &agent);
        assert_eq!(dir, project.join(".pi").join("sessions"));

        fs::remove_dir_all(temp).ok();
    }

    #[test]
    fn global_setting_and_home_are_used_without_a_project_setting() {
        let temp = std::env::temp_dir().join(format!(
            "spopi-session-dirs-global-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let project = temp.join("proj");
        let agent = temp.join("agent");
        fs::create_dir_all(&project).unwrap();
        fs::create_dir_all(&agent).unwrap();
        fs::write(
            agent.join("settings.json"),
            r#"{ "sessionDir": "~/chats" }"#,
        )
        .unwrap();

        let dir = session_dir_for(&project, &agent);
        assert_eq!(dir, dirs::home_dir().unwrap().join("chats"));

        fs::remove_file(agent.join("settings.json")).unwrap();
        let fallback = session_dir_for(&project, &agent);
        assert!(fallback.starts_with(agent.join("sessions")));
        assert!(fallback
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("--"));

        fs::remove_dir_all(temp).ok();
    }
}
