// ABOUTME: Finds the main checkout of a linked git worktree by reading its .git file.
// ABOUTME: No git process. A normal checkout, whose .git is a directory, is not a link.

use std::fs;
use std::path::{Component, Path, PathBuf};

/// The main checkout this folder is linked to, or `None` when it is not a linked worktree.
pub(crate) fn main_checkout_of(path: &Path) -> Option<PathBuf> {
    let text = fs::read_to_string(path.join(".git")).ok()?;
    let gitdir = text.trim().strip_prefix("gitdir:")?.trim();
    if gitdir.is_empty() {
        return None;
    }
    let git_dir = path.join(gitdir);
    let common = fs::read_to_string(git_dir.join("commondir")).ok()?;
    let common = common.trim();
    if common.is_empty() {
        return None;
    }
    let common_dir = normalize(git_dir.join(common));
    if common_dir.file_name()? != ".git" {
        return None;
    }
    common_dir.parent().map(Path::to_path_buf)
}

/// `a/b/../c` stays `a/b/../c` to `file_name`, so collapse `.` and `..` first.
fn normalize(path: PathBuf) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::main_checkout_of;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn reads_the_main_checkout_from_the_git_link() {
        let dir = tempdir().unwrap();
        let main = dir.path().join("repo");
        let link = dir.path().join("linked");
        let git_dir = main.join(".git").join("worktrees").join("linked");
        fs::create_dir_all(&git_dir).unwrap();
        fs::create_dir_all(&link).unwrap();
        fs::write(
            link.join(".git"),
            format!("gitdir: {}\n", git_dir.display()),
        )
        .unwrap();
        fs::write(git_dir.join("commondir"), "../..\n").unwrap();
        let found = main_checkout_of(&link).unwrap();
        assert_eq!(found, main);
    }

    #[test]
    fn a_real_checkout_and_a_plain_folder_are_not_links() {
        let dir = tempdir().unwrap();
        let repo = dir.path().join("repo");
        fs::create_dir_all(repo.join(".git")).unwrap();
        assert!(main_checkout_of(&repo).is_none());
        assert!(main_checkout_of(dir.path()).is_none());
    }
}
