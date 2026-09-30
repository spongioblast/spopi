// ABOUTME: Resolves the bundled pi binary and the PATH given to that process.
// ABOUTME: Package install commands and OS openers are separate modules.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use super::launch::PiLaunchResolver;

const PI_VERSION_JSON: &str = include_str!("../../../scripts/pi-version.json");

pub fn locked_pi_version() -> &'static str {
    static CACHED: OnceLock<String> = OnceLock::new();
    CACHED.get_or_init(|| {
        let needle = "\"version\"";
        let bytes = PI_VERSION_JSON;
        let start = bytes
            .find(needle)
            .expect("pi-version.json: missing \"version\" key");
        let after_key = &bytes[start + needle.len()..];
        let colon = after_key
            .find(':')
            .expect("pi-version.json: malformed \"version\" entry");
        let after_colon = &after_key[colon + 1..];
        let first_quote = after_colon
            .find('"')
            .expect("pi-version.json: \"version\" value not quoted");
        let rest = &after_colon[first_quote + 1..];
        let end_quote = rest
            .find('"')
            .expect("pi-version.json: unterminated \"version\" value");
        rest[..end_quote].to_string()
    })
}

impl PiLaunchResolver {
    pub fn bundled_pi_bin(&self) -> Option<String> {
        self.resolve_bundled_pi().ok().map(|path| {
            crate::platform::open::strip_verbatim_prefix(&path.to_string_lossy()).to_string()
        })
    }

    pub(crate) fn resolve_bundled_pi(&self) -> Result<PathBuf, String> {
        let bin_name = if cfg!(target_os = "windows") {
            "pi.exe"
        } else {
            "pi"
        };

        if let Ok(explicit) = std::env::var("PI_BIN") {
            let candidate = PathBuf::from(explicit.trim());
            if candidate.is_file() {
                return Ok(candidate);
            }
        }

        let mut tried = Vec::new();
        if let Some(candidate) = self
            .static_dir
            .parent()
            .map(|parent| parent.join("pi").join(bin_name))
        {
            if candidate.is_file() {
                return Ok(candidate);
            }
            tried.push(candidate);
        }

        if cfg!(debug_assertions) {
            let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("resources")
                .join("pi")
                .join(bin_name);
            if dev_path.is_file() {
                return Ok(dev_path);
            }
            tried.push(dev_path);
        }

        Err(format!(
            "Could not find embedded pi binary. Tried:\n{}\n\n\
             For dev: run `bun run fetch:pi` from the repo root.\n\
             For release: the .app bundle is missing `resources/pi/{bin_name}`. \
             Reinstall SPOPI.",
            tried
                .iter()
                .map(|path| format!("  - {}", path.display()))
                .collect::<Vec<_>>()
                .join("\n")
        ))
    }
}

pub(crate) fn build_augmented_path() -> String {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|value| std::env::split_paths(&value).collect())
        .unwrap_or_default();
    crate::platform::appimage_env::strip_bundle_path_entries(&mut dirs);
    let agent_browser_dir = std::env::var_os("SPOPI_AGENT_BROWSER_DIR")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);
    let dirs = compose_path(
        dirs,
        crate::platform::appimage_env::appdir().as_deref(),
        agent_browser_dir.as_deref(),
        &path_extras(),
    );
    std::env::join_paths(dirs)
        .ok()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| std::env::var("PATH").unwrap_or_default())
}

/// PATH order for Pi: drop AppImage entries, put the bundled agent-browser
/// directory first (even when it lives inside the mount), then the extras.
pub(crate) fn compose_path(
    mut dirs: Vec<PathBuf>,
    appdir: Option<&Path>,
    agent_browser_dir: Option<&Path>,
    extras: &[PathBuf],
) -> Vec<PathBuf> {
    if let Some(appdir) = appdir {
        dirs.retain(|dir| !dir.starts_with(appdir));
    }
    if let Some(agent_dir) = agent_browser_dir.filter(|dir| !dir.as_os_str().is_empty()) {
        dirs.retain(|dir| dir != agent_dir);
        dirs.insert(0, agent_dir.to_path_buf());
    }
    for extra in extras {
        if !dirs.iter().any(|dir| dir == extra) {
            dirs.push(extra.clone());
        }
    }
    dirs
}

fn path_extras() -> Vec<PathBuf> {
    let mut extras = Vec::new();
    #[cfg(not(target_os = "windows"))]
    {
        extras.extend([
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/opt/homebrew/sbin"),
            PathBuf::from("/usr/local/bin"),
            PathBuf::from("/usr/local/sbin"),
            PathBuf::from("/usr/bin"),
            PathBuf::from("/bin"),
        ]);
        if let Ok(home) = std::env::var("HOME") {
            let home = Path::new(&home);
            extras.push(pi_extension_npm_bin_dir(home));
            extras.push(home.join(".local/bin"));
            extras.push(home.join(".bun/bin"));
            extras.push(home.join(".volta/bin"));
            extras.push(home.join(".cargo/bin"));
            extras.push(home.join(".local/share/mise/shims"));
            let nvm_root = home.join(".nvm/versions/node");
            if let Ok(entries) = std::fs::read_dir(nvm_root) {
                for entry in entries.flatten() {
                    let bin = entry.path().join("bin");
                    if bin.is_dir() {
                        extras.push(bin);
                    }
                }
            }
        }
    }
    #[cfg(target_os = "windows")]
    {
        if let Some(program_files) = std::env::var_os("ProgramFiles") {
            extras.push(PathBuf::from(program_files).join("nodejs"));
        }
        if let Ok(appdata) = std::env::var("APPDATA") {
            extras.push(Path::new(&appdata).join("npm"));
        }
        if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
            let home = Path::new(&home);
            extras.push(pi_extension_npm_bin_dir(home));
            extras.push(home.join(".cargo").join("bin"));
            extras.push(home.join(".bun").join("bin"));
            extras.push(home.join("scoop").join("shims"));
        }
    }
    extras
}

/// Pi agent directory. `PI_CODING_AGENT_DIR` when set, otherwise `~/.pi/agent`.
pub(crate) fn pi_agent_dir() -> Option<PathBuf> {
    resolve_pi_agent_dir(
        std::env::var("PI_CODING_AGENT_DIR").ok().as_deref(),
        dirs::home_dir().as_deref(),
    )
}

pub(crate) fn resolve_pi_agent_dir(
    override_dir: Option<&str>,
    home: Option<&Path>,
) -> Option<PathBuf> {
    if let Some(value) = override_dir
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Some(PathBuf::from(value));
    }
    home.map(|home| home.join(".pi").join("agent"))
}

fn pi_extension_npm_bin_dir(home: &Path) -> PathBuf {
    resolve_pi_agent_dir(
        std::env::var("PI_CODING_AGENT_DIR").ok().as_deref(),
        Some(home),
    )
    .unwrap_or_else(|| home.join(".pi").join("agent"))
    .join("npm")
    .join("node_modules")
    .join(".bin")
}

#[cfg(test)]
mod tests {
    use super::resolve_pi_agent_dir;
    use std::path::{Path, PathBuf};

    #[test]
    fn live_appdir_keeps_only_the_agent_browser_entry() {
        static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
        let _guard = LOCK.lock().unwrap_or_else(|error| error.into_inner());
        let appdir = std::env::temp_dir().join(format!("spopi-appdir-{}", std::process::id()));
        let agent = appdir.join("agent-browser");
        std::fs::create_dir_all(&agent).unwrap();
        let previous = ["APPDIR", "APPIMAGE", "PATH", "SPOPI_AGENT_BROWSER_DIR"]
            .map(|key| (key, std::env::var_os(key)));
        std::env::set_var("APPDIR", &appdir);
        std::env::set_var("APPIMAGE", "spopi-test");
        std::env::set_var(
            "PATH",
            std::env::join_paths([appdir.join("usr/bin"), PathBuf::from("/usr/bin")]).unwrap(),
        );
        std::env::set_var("SPOPI_AGENT_BROWSER_DIR", &agent);
        let path = super::build_augmented_path();
        for (key, value) in previous {
            match value {
                Some(value) => std::env::set_var(key, value),
                None => std::env::remove_var(key),
            }
        }
        let _ = std::fs::remove_dir_all(&appdir);
        let dirs: Vec<_> = std::env::split_paths(&path).collect();
        assert_eq!(dirs.first(), Some(&agent));
        assert!(!dirs
            .iter()
            .any(|dir| dir.starts_with(&appdir) && dir != &agent));
    }

    #[test]
    fn agent_browser_dir_stays_first_after_the_appimage_strip() {
        let appdir = Path::new("/tmp/.mount_SPOPI");
        let agent = appdir.join("agent-browser");
        let dirs = vec![
            appdir.join("usr/bin"),
            PathBuf::from("/usr/bin"),
            agent.clone(),
        ];
        let extras = vec![PathBuf::from("C:/Program Files/nodejs")];
        let with_agent = super::compose_path(dirs, Some(appdir), Some(&agent), &extras);
        assert_eq!(with_agent[0], agent);
        assert!(!with_agent
            .iter()
            .any(|dir| dir.ends_with("usr/bin") && dir.starts_with(appdir)));
        assert!(with_agent.iter().any(|dir| dir == Path::new("/usr/bin")));
        assert_eq!(
            with_agent.last(),
            Some(&PathBuf::from("C:/Program Files/nodejs"))
        );

        let without = super::compose_path(vec![PathBuf::from("/usr/bin")], None, None, &[]);
        assert_eq!(without, vec![PathBuf::from("/usr/bin")]);
    }

    #[test]
    fn agent_dir_prefers_the_override_and_trims_it() {
        let home = Path::new("/home/user");
        assert_eq!(
            resolve_pi_agent_dir(Some("  D:/scratch/pi-agent  "), Some(home)),
            Some(PathBuf::from("D:/scratch/pi-agent"))
        );
        assert_eq!(
            resolve_pi_agent_dir(Some("   "), Some(home)),
            Some(home.join(".pi").join("agent"))
        );
        assert_eq!(resolve_pi_agent_dir(None, None), None);
    }
}
