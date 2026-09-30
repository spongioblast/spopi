// ABOUTME: Finds the bundled extensions that are passed to pi on launch.
// ABOUTME: Extension paths are sanitized before they are put on the command line.
use crate::platform::open::strip_verbatim_prefix;
use std::path::{Path, PathBuf};

pub(super) fn resolve_bundled_extensions(
    static_dir: &Path,
    cwd: &Path,
    is_saved_session: bool,
) -> Result<Vec<PathBuf>, String> {
    bundled_extension_names_for_launch(cwd, is_saved_session)
        .into_iter()
        .map(|name| resolve_bundled_extension(static_dir, name))
        .collect()
}

fn bundled_extension_names_for_launch(_cwd: &Path, _is_saved_session: bool) -> Vec<&'static str> {
    extension_names(std::env::var("SPOPI_FAKE_PROVIDER").ok().as_deref() == Some("1"))
}

fn extension_names(fake_provider: bool) -> Vec<&'static str> {
    let mut names = vec![
        "spopi-bridge.mjs",
        "pi-permission-system.mjs",
        "spopi-verify.mjs",
        "spopi-tool-output.mjs",
    ];
    if fake_provider {
        names.push("testing/spopi-fake-provider.mjs");
    }
    let disabled = disabled_bundled();
    names.retain(|name| {
        !disabled
            .iter()
            .any(|item| name.trim_end_matches(".mjs").ends_with(item.as_str()))
    });
    names
}

fn disabled_bundled() -> Vec<String> {
    let path = crate::data::app_paths::config_dir()
        .join("ui")
        .join("overrides.json");
    let Ok(bytes) = std::fs::read(path) else {
        return Vec::new();
    };
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        return Vec::new();
    };
    value
        .get("disabled")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default()
}

fn resolve_bundled_extension(static_dir: &Path, extension_name: &str) -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    if let Some(resources) = static_dir.parent() {
        candidates.push(resources.join("extensions").join(extension_name));
    }
    if cfg!(debug_assertions) {
        candidates.push(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("..")
                .join("extensions")
                .join("dist")
                .join(extension_name),
        );
        if extension_name == "spopi-bridge.mjs" {
            candidates.push(
                PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("..")
                    .join("extensions")
                    .join("spopi-bridge.ts"),
            );
        } else if extension_name == "spopi-verify.mjs" {
            candidates.push(
                PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("..")
                    .join("extensions")
                    .join("spopi-verify.ts"),
            );
        } else if extension_name == "spopi-tool-output.mjs" {
            candidates.push(
                PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("..")
                    .join("extensions")
                    .join("spopi-tool-output.ts"),
            );
        } else if extension_name == "testing/spopi-fake-provider.mjs" {
            candidates.push(
                PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("..")
                    .join("extensions")
                    .join("testing")
                    .join("spopi-fake-provider.ts"),
            );
        }
    }
    let extension = candidates
        .iter()
        .find(|candidate| candidate.is_file())
        .cloned()
        .ok_or_else(|| {
            format!(
                "Could not find {extension_name} extension. Tried:\n{}",
                candidates
                    .iter()
                    .map(|path| format!("  - {}", path.display()))
                    .collect::<Vec<_>>()
                    .join("\n")
            )
        })?;
    Ok(PathBuf::from(sanitize_extension_path_for_pi(
        &strip_verbatim_prefix(&extension.to_string_lossy()),
        extension_name,
    )))
}

#[cfg(not(target_os = "windows"))]
fn sanitize_extension_path_for_pi(original: &str, _extension_name: &str) -> String {
    original.to_string()
}

/// A path with a space does not survive Pi's `--extension` argument on Windows
/// (`C:\Program Files\SPOPI`, or a user name with a space), so the bundled
/// extensions run from a space-free copy.
#[cfg(target_os = "windows")]
fn sanitize_extension_path_for_pi(original: &str, extension_name: &str) -> String {
    if !original.contains(' ') {
        return original.to_string();
    }
    let Some(dest_base) = space_free_mirror_base() else {
        log::warn!("[spopi-host] no space-free folder for extensions; using {original}");
        return original.to_string();
    };
    match mirror_extension(Path::new(original), extension_name, &dest_base) {
        Ok(mirrored) => {
            // Pi now loads the bundled extensions, the permission extension among them,
            // from here; the recipes deny writes to it like the install folder.
            std::env::set_var(MIRROR_ENV, &dest_base);
            mirrored.to_string_lossy().to_string()
        }
        Err(error) => {
            log::warn!(
                "[spopi-host] failed to mirror extension to a space-free path ({error}); using original"
            );
            original.to_string()
        }
    }
}

pub(crate) const MIRROR_ENV: &str = "SPOPI_EXTENSIONS_MIRROR";

#[cfg(target_os = "windows")]
fn space_free_mirror_base() -> Option<PathBuf> {
    let temp = std::env::temp_dir();
    let base = if temp.to_string_lossy().contains(' ') {
        PathBuf::from("C:\\ProgramData\\spopi")
    } else {
        temp
    };
    let dest = base.join("spopi-ext").join(env!("CARGO_PKG_VERSION"));
    (!dest.to_string_lossy().contains(' ')).then_some(dest)
}

/// The folder that holds the whole bundle: `<root>/<extension_name>`.
#[cfg_attr(not(windows), allow(dead_code))]
fn extension_root(path: &Path, extension_name: &str) -> Option<PathBuf> {
    let depth = Path::new(extension_name).components().count();
    let mut root = path.to_path_buf();
    for _ in 0..depth {
        root = root.parent()?.to_path_buf();
    }
    (root.join(extension_name) == path).then_some(root)
}

/// Copies the whole bundle folder, not only the entry file: the permission extension
/// loads its `.wasm` files and spopi-verify its `skills/` from next to themselves.
/// TypeScript sources (dev fallback) resolve imports from the repo and are left in place.
#[cfg_attr(not(windows), allow(dead_code))]
fn mirror_extension(
    path: &Path,
    extension_name: &str,
    dest_base: &Path,
) -> std::io::Result<PathBuf> {
    if path.extension().and_then(|ext| ext.to_str()) != Some("mjs") {
        return Ok(path.to_path_buf());
    }
    let root = extension_root(path, extension_name).ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "extension path does not end with its name",
        )
    })?;
    static MIRRORED: std::sync::Mutex<Vec<PathBuf>> = std::sync::Mutex::new(Vec::new());
    let mut done = MIRRORED
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if !done.contains(&root) {
        mirror_tree(&root, dest_base)?;
        done.push(root);
    }
    Ok(dest_base.join(extension_name))
}

/// Copies files that are missing or differ in size or time. A file another SPOPI
/// process holds open is kept when its size already matches.
#[cfg_attr(not(windows), allow(dead_code))]
fn mirror_tree(src: &Path, dest: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dest)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dest.join(entry.file_name());
        let kind = entry.file_type()?;
        if kind.is_dir() {
            mirror_tree(&from, &to)?;
            continue;
        }
        if !kind.is_file() {
            continue;
        }
        let source = entry.metadata()?;
        let same = std::fs::metadata(&to).is_ok_and(|existing| {
            existing.len() == source.len() && existing.modified().ok() >= source.modified().ok()
        });
        if same {
            continue;
        }
        if let Err(error) = std::fs::copy(&from, &to) {
            let size_matches =
                std::fs::metadata(&to).is_ok_and(|existing| existing.len() == source.len());
            if !size_matches {
                return Err(error);
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        bundled_extension_names_for_launch, extension_names, extension_root, mirror_extension,
    };
    use std::path::Path;

    #[test]
    fn the_bundle_root_is_the_path_minus_the_extension_name() {
        let root = Path::new("C:/Program Files/SPOPI/extensions");
        assert_eq!(
            extension_root(&root.join("spopi-verify.mjs"), "spopi-verify.mjs"),
            Some(root.to_path_buf())
        );
        assert_eq!(
            extension_root(
                &root.join("testing").join("spopi-fake-provider.mjs"),
                "testing/spopi-fake-provider.mjs"
            ),
            Some(root.to_path_buf())
        );
        assert_eq!(
            extension_root(&root.join("other.mjs"), "spopi-verify.mjs"),
            None
        );
    }

    #[test]
    fn mirroring_copies_the_files_next_to_the_entry() {
        let installed = tempfile::tempdir().unwrap();
        let root = installed.path().join("Program Files").join("extensions");
        let skills = root
            .join("spopi-verify")
            .join("skills")
            .join("browser-check");
        std::fs::create_dir_all(&skills).unwrap();
        std::fs::write(
            root.join("pi-permission-system.mjs"),
            "export default () => {}",
        )
        .unwrap();
        std::fs::write(root.join("web-tree-sitter.wasm"), [0u8, 97, 115, 109]).unwrap();
        std::fs::write(skills.join("SKILL.md"), "---\nname: browser-check\n---\n").unwrap();
        let dest = tempfile::tempdir().unwrap();

        let entry = mirror_extension(
            &root.join("pi-permission-system.mjs"),
            "pi-permission-system.mjs",
            dest.path(),
        )
        .unwrap();

        assert_eq!(entry, dest.path().join("pi-permission-system.mjs"));
        assert!(dest.path().join("web-tree-sitter.wasm").is_file());
        assert!(dest
            .path()
            .join("spopi-verify/skills/browser-check/SKILL.md")
            .is_file());
        let source = Path::new("D:/repo/extensions/spopi-verify.ts");
        assert_eq!(
            mirror_extension(source, "spopi-verify.mjs", dest.path()).unwrap(),
            source
        );
    }

    #[test]
    fn every_launch_loads_the_bridge_permission_system_verify_gate_and_tool_output() {
        assert_eq!(
            bundled_extension_names_for_launch(Path::new("/Users/me/code/project"), true),
            vec![
                "spopi-bridge.mjs",
                "pi-permission-system.mjs",
                "spopi-verify.mjs",
                "spopi-tool-output.mjs"
            ]
        );
    }

    #[test]
    fn fake_provider_is_loaded_only_when_requested() {
        assert_eq!(
            extension_names(true),
            vec![
                "spopi-bridge.mjs",
                "pi-permission-system.mjs",
                "spopi-verify.mjs",
                "spopi-tool-output.mjs",
                "testing/spopi-fake-provider.mjs"
            ]
        );
        assert!(!extension_names(false).contains(&"testing/spopi-fake-provider.mjs"));
    }
}
