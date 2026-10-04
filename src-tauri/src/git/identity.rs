// ABOUTME: Reads and writes the name and email Git records with each commit.
// ABOUTME: The values live in Git's own config, for one repository or for the whole computer.

use super::{assert_workspace_root, git_command, run_git, GIT_READ_DEADLINE, GIT_WRITE_DEADLINE};
use serde::Serialize;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

const MAX_NAME_CHARS: usize = 200;
const MAX_EMAIL_CHARS: usize = 254;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub(crate) struct Identity {
    pub name: String,
    pub email: String,
}

/// `name` and `email` are what the next commit in `root` would use. `repository`
/// is set only when `root` is a repository; its fields are empty where it falls
/// back to the computer-wide value.
#[derive(Debug, PartialEq, Eq, Serialize)]
pub(crate) struct IdentityReport {
    pub name: String,
    pub email: String,
    pub global: Identity,
    pub repository: Option<Identity>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum IdentityScope {
    Global,
    Repository,
}

impl IdentityScope {
    pub(crate) fn parse(value: &str) -> Result<Self, String> {
        match value {
            "global" => Ok(Self::Global),
            "repository" => Ok(Self::Repository),
            _ => Err("scope must be global or repository".into()),
        }
    }
}

/// Where `--global` reads and writes. `None` is the user's own `~/.gitconfig`;
/// tests pass a temporary file so they never touch it.
#[derive(Clone, Debug, Default)]
pub(crate) struct GlobalConfig(Option<PathBuf>);

impl GlobalConfig {
    #[cfg(test)]
    pub(crate) fn at(path: PathBuf) -> Self {
        Self(Some(path))
    }

    fn run(&self, cwd: &Path, args: &[&str], write: bool) -> Result<Option<String>, String> {
        let mut command = git_command(cwd, args.iter().map(OsString::from));
        if let Some(path) = &self.0 {
            command
                .env("GIT_CONFIG_GLOBAL", path)
                .env("GIT_CONFIG_NOSYSTEM", "1");
        }
        let deadline = if write {
            GIT_WRITE_DEADLINE
        } else {
            GIT_READ_DEADLINE
        };
        let (stdout, stderr, success) = run_git(command, deadline)?;
        if success {
            return Ok(Some(String::from_utf8_lossy(&stdout).trim().to_string()));
        }
        if write {
            return Err(String::from_utf8_lossy(&stderr).trim().to_string());
        }
        // `git config --get` exits 1 for a key that is not set.
        Ok(None)
    }

    fn get(&self, cwd: &Path, scope: Option<&str>, key: &str) -> String {
        let mut args = vec!["config"];
        args.extend(scope);
        args.extend(["--get", key]);
        self.run(cwd, &args, false)
            .ok()
            .flatten()
            .unwrap_or_default()
    }

    fn read_pair(&self, cwd: &Path, scope: Option<&str>) -> Identity {
        Identity {
            name: self.get(cwd, scope, "user.name"),
            email: self.get(cwd, scope, "user.email"),
        }
    }
}

fn neutral_dir() -> PathBuf {
    std::env::temp_dir()
}

pub(crate) fn read_identity(root: Option<&Path>, config: &GlobalConfig) -> IdentityReport {
    let neutral = neutral_dir();
    let global = config.read_pair(&neutral, Some("--global"));
    let repository = root
        .filter(|root| assert_workspace_root(root).is_ok())
        .map(|root| config.read_pair(root, Some("--local")));
    let effective = match root {
        Some(root) if repository.is_some() => config.read_pair(root, None),
        _ => config.read_pair(&neutral, None),
    };
    IdentityReport {
        name: effective.name,
        email: effective.email,
        global,
        repository,
    }
}

fn clean(value: &str, label: &str, max: usize) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(format!("{label} is required"));
    }
    if value.chars().count() > max {
        return Err(format!("{label} is too long"));
    }
    if value.chars().any(char::is_control) {
        return Err(format!("{label} cannot contain line breaks"));
    }
    if value.starts_with('-') {
        return Err(format!("{label} cannot start with -"));
    }
    Ok(value.to_string())
}

pub(crate) fn validate_identity(name: &str, email: &str) -> Result<Identity, String> {
    let name = clean(name, "name", MAX_NAME_CHARS)?;
    let email = clean(email, "email", MAX_EMAIL_CHARS)?;
    if !email.contains('@') || email.contains(['<', '>']) || email.contains(char::is_whitespace) {
        return Err("email is not valid".into());
    }
    Ok(Identity { name, email })
}

pub(crate) fn write_identity(
    root: Option<&Path>,
    scope: IdentityScope,
    name: &str,
    email: &str,
    config: &GlobalConfig,
) -> Result<IdentityReport, String> {
    let identity = validate_identity(name, email)?;
    let neutral = neutral_dir();
    let (cwd, flag) = match scope {
        IdentityScope::Global => (neutral.as_path(), "--global"),
        IdentityScope::Repository => {
            let root = root.ok_or("this project has no repository")?;
            // A project inside another repository would write the parent's config.
            assert_workspace_root(root)?;
            (root, "--local")
        }
    };
    config.run(cwd, &["config", flag, "user.name", &identity.name], true)?;
    config.run(cwd, &["config", flag, "user.email", &identity.email], true)?;
    Ok(read_identity(root, config))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn repo() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        Command::new("git")
            .current_dir(dir.path())
            .args(["init", "-q"])
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .output()
            .unwrap();
        dir
    }

    fn global() -> (tempfile::TempDir, GlobalConfig) {
        let dir = tempfile::tempdir().unwrap();
        let config = GlobalConfig::at(dir.path().join("gitconfig"));
        (dir, config)
    }

    #[test]
    fn an_empty_config_reports_no_identity() {
        let (_home, config) = global();
        let project = repo();
        let report = read_identity(Some(project.path()), &config);
        assert_eq!(report.name, "");
        assert_eq!(report.email, "");
        assert_eq!(report.global, Identity::default());
        assert_eq!(report.repository, Some(Identity::default()));
    }

    #[test]
    fn a_global_identity_applies_to_every_repository() {
        let (home, config) = global();
        let project = repo();
        write_identity(
            None,
            IdentityScope::Global,
            "Ada Lovelace",
            "ada@example.com",
            &config,
        )
        .unwrap();
        let report = read_identity(Some(project.path()), &config);
        assert_eq!(report.name, "Ada Lovelace");
        assert_eq!(report.email, "ada@example.com");
        assert_eq!(report.repository, Some(Identity::default()));
        let written = std::fs::read_to_string(home.path().join("gitconfig")).unwrap();
        assert!(written.contains("ada@example.com"));
    }

    #[test]
    fn a_repository_identity_overrides_the_global_one_only_there() {
        let (_home, config) = global();
        let project = repo();
        let other = repo();
        write_identity(
            None,
            IdentityScope::Global,
            "Home",
            "home@example.com",
            &config,
        )
        .unwrap();
        let report = write_identity(
            Some(project.path()),
            IdentityScope::Repository,
            "Work",
            "work@example.com",
            &config,
        )
        .unwrap();
        assert_eq!(report.name, "Work");
        assert_eq!(report.global.name, "Home");
        assert_eq!(report.repository.unwrap().email, "work@example.com");
        assert_eq!(read_identity(Some(other.path()), &config).name, "Home");
    }

    #[test]
    fn a_folder_without_a_repository_reads_the_global_identity() {
        let (_home, config) = global();
        let folder = tempfile::tempdir().unwrap();
        write_identity(
            None,
            IdentityScope::Global,
            "Ada",
            "ada@example.com",
            &config,
        )
        .unwrap();
        let report = read_identity(Some(folder.path()), &config);
        assert_eq!(report.name, "Ada");
        assert_eq!(report.repository, None);
        let error = write_identity(
            Some(folder.path()),
            IdentityScope::Repository,
            "Ada",
            "ada@example.com",
            &config,
        )
        .unwrap_err();
        assert!(!error.is_empty());
    }

    #[test]
    fn a_nested_project_never_writes_the_parent_repository() {
        let (_home, config) = global();
        let parent = repo();
        let nested = parent.path().join("sub");
        std::fs::create_dir(&nested).unwrap();
        let result = write_identity(
            Some(&nested),
            IdentityScope::Repository,
            "Ada",
            "ada@example.com",
            &config,
        );
        assert!(result.is_err());
        let parent_config = std::fs::read_to_string(parent.path().join(".git/config")).unwrap();
        assert!(!parent_config.contains("ada@example.com"));
    }

    #[test]
    fn rejects_values_git_would_misread() {
        assert!(validate_identity("", "a@b.c").is_err());
        assert!(validate_identity("Ada", "").is_err());
        assert!(validate_identity("Ada\nEvil", "a@b.c").is_err());
        assert!(validate_identity("--global", "a@b.c").is_err());
        assert!(validate_identity("Ada", "not-an-email").is_err());
        assert!(validate_identity("Ada", "a b@c.d").is_err());
        assert!(validate_identity("Ada", "<a@b.c>").is_err());
        assert_eq!(
            validate_identity("  Ada  ", " ada@example.com ").unwrap(),
            Identity {
                name: "Ada".into(),
                email: "ada@example.com".into()
            }
        );
    }
}
