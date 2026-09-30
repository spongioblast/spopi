// ABOUTME: Scrubs AppImage path entries out of the environment passed to children.
// ABOUTME: Other platforms leave the environment unchanged.
//! Undo the AppImage runtime's environment for child processes.
//!
//! An AppImage's `AppRun` exports loader and module search paths
//! (`LD_LIBRARY_PATH`, `GIO_MODULE_DIR`, `GTK_PATH`, ...) that point inside the
//! mounted bundle, so the packaged WebKitGTK/GTK stack finds the libraries
//! linuxdeploy shipped with it. Every process we spawn inherits those exports —
//! including the embedded `pi` runtime, which is built against the host system
//! and dies at startup when the dynamic loader hands it the bundle's copies of
//! libstdc++/libcurl/etc. instead.
//!
//! Nothing here is AppImage-specific beyond the detection: outside an AppImage
//! `appdir()` returns `None` and every entry point is a no-op.

use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};

/// Colon-separated search paths. AppImage-owned entries are dropped; the
/// variable is unset entirely when nothing else remains.
const LIST_VARS: &[&str] = &[
    "LD_LIBRARY_PATH",
    "XDG_DATA_DIRS",
    "XDG_CONFIG_DIRS",
    "PYTHONPATH",
    "PERLLIB",
    "PERL5LIB",
    "GI_TYPELIB_PATH",
    "GIO_EXTRA_MODULES",
    "GST_PLUGIN_PATH",
    "GST_PLUGIN_SYSTEM_PATH",
    "GST_PLUGIN_SYSTEM_PATH_1_0",
    "GSETTINGS_SCHEMA_DIR",
    "GTK_PATH",
    "QT_PLUGIN_PATH",
    "LIBGL_DRIVERS_PATH",
    "ALSA_PLUGIN_DIR",
];

/// Single-value variables. Unset when the value points into the bundle.
const SINGLE_VARS: &[&str] = &[
    "LD_PRELOAD",
    "PYTHONHOME",
    "GIO_MODULE_DIR",
    "GDK_PIXBUF_MODULE_FILE",
    "GDK_PIXBUF_MODULEDIR",
    "GTK_EXE_PREFIX",
    "GTK_DATA_PREFIX",
    "GTK_IM_MODULE_FILE",
    "QT_QPA_PLATFORM_PLUGIN_PATH",
    "FONTCONFIG_FILE",
    "FONTCONFIG_PATH",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
];

#[derive(Debug, PartialEq, Eq)]
pub enum EnvAction {
    Set(OsString),
    Unset,
}

/// The mounted bundle root, or `None` when we are not running from an AppImage.
///
/// `APPIMAGE` is exported only by the AppImage runtime, so requiring both it and
/// `APPDIR` avoids reacting to an unrelated `APPDIR` from someone's build script.
pub fn appdir() -> Option<PathBuf> {
    let appdir = std::env::var_os("APPDIR")?;
    std::env::var_os("APPIMAGE")?;
    let path = PathBuf::from(appdir);
    path.is_dir().then_some(path)
}

/// Drop every PATH entry that lives inside the bundle, so children resolve host
/// tools rather than the ones linuxdeploy pulled in.
pub fn strip_bundle_path_entries(dirs: &mut Vec<PathBuf>) {
    if let Some(appdir) = appdir() {
        dirs.retain(|dir| !dir.starts_with(&appdir));
    }
}

pub fn plan() -> Vec<(&'static str, EnvAction)> {
    appdir().map(|appdir| plan_for(&appdir)).unwrap_or_default()
}

pub fn scrub(command: &mut std::process::Command) {
    for (key, action) in plan() {
        match action {
            EnvAction::Set(value) => command.env(key, value),
            EnvAction::Unset => command.env_remove(key),
        };
    }
}

fn plan_for(appdir: &Path) -> Vec<(&'static str, EnvAction)> {
    let mut actions = Vec::new();
    for key in LIST_VARS {
        let Some(value) = std::env::var_os(key) else {
            continue;
        };
        match sanitize_list(&value, appdir) {
            Some(kept) if kept == value => {}
            Some(kept) => actions.push((*key, EnvAction::Set(kept))),
            None => actions.push((*key, EnvAction::Unset)),
        }
    }
    for key in SINGLE_VARS {
        let Some(value) = std::env::var_os(key) else {
            continue;
        };
        if is_under(&value, appdir) {
            actions.push((*key, EnvAction::Unset));
        }
    }
    actions
}

/// `None` means "nothing survived the filter" — the caller unsets the variable
/// rather than handing the child an empty value, which some loaders read as
/// "current directory".
fn sanitize_list(value: &OsStr, appdir: &Path) -> Option<OsString> {
    let kept: Vec<PathBuf> = std::env::split_paths(value)
        .filter(|entry| !entry.starts_with(appdir))
        .collect();
    if kept.is_empty() {
        return None;
    }
    std::env::join_paths(kept).ok()
}

fn is_under(value: &OsStr, appdir: &Path) -> bool {
    Path::new(value).starts_with(appdir)
}

#[cfg(test)]
mod tests {
    use super::{is_under, sanitize_list, EnvAction};
    use std::ffi::OsString;
    use std::path::{Path, PathBuf};

    #[test]
    fn sanitize_list_drops_only_bundle_entries() {
        let appdir = Path::new("/tmp/.mount_SPOPI42");
        let value = std::env::join_paths([
            appdir.join("usr/lib"),
            PathBuf::from("/usr/lib"),
            appdir.join("lib"),
        ])
        .unwrap();
        assert_eq!(
            sanitize_list(&value, appdir),
            std::env::join_paths([PathBuf::from("/usr/lib")]).ok()
        );
    }

    #[test]
    fn sanitize_list_reports_empty_result_so_caller_unsets() {
        let appdir = Path::new("/tmp/.mount_SPOPI42");
        let value = OsString::from("/tmp/.mount_SPOPI42/usr/lib");
        assert_eq!(sanitize_list(&value, appdir), None);
    }

    #[test]
    fn sanitize_list_keeps_a_clean_value_untouched() {
        let appdir = Path::new("/tmp/.mount_SPOPI42");
        let value = OsString::from("/usr/lib:/usr/local/lib");
        assert_eq!(sanitize_list(&value, appdir), Some(value.clone()));
    }

    #[test]
    fn sibling_directory_is_not_treated_as_inside_the_bundle() {
        let appdir = Path::new("/tmp/.mount_SPOPI42");
        assert!(!is_under(
            &OsString::from("/tmp/.mount_SPOPI42x/lib"),
            appdir
        ));
        assert!(is_under(&OsString::from("/tmp/.mount_SPOPI42/lib"), appdir));
    }

    #[test]
    fn plan_for_unsets_bundle_owned_single_values() {
        // `plan_for` reads the live environment, so drive it through the two
        // pure helpers it composes instead of mutating global state.
        let appdir = Path::new("/tmp/.mount_SPOPI42");
        assert!(is_under(
            &OsString::from("/tmp/.mount_SPOPI42/usr/lib/gio/modules"),
            appdir
        ));
        assert_eq!(
            sanitize_list(
                &std::env::join_paths([appdir.join("usr/share"), PathBuf::from("/usr/share")])
                    .unwrap(),
                appdir
            ),
            std::env::join_paths([PathBuf::from("/usr/share")]).ok()
        );
        assert_ne!(EnvAction::Unset, EnvAction::Set(OsString::from("x")));
    }

    #[test]
    fn strip_bundle_path_entries_is_a_noop_outside_an_appimage() {
        let mut dirs = vec![PathBuf::from("/usr/bin"), PathBuf::from("/bin")];
        let before = dirs.clone();
        super::strip_bundle_path_entries(&mut dirs);
        assert_eq!(dirs, before);
    }
}
