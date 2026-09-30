// ABOUTME: Canonical project paths without the Windows \\?\ prefix.
// ABOUTME: One helper so sqlite, session summaries, and tooltips agree.

use std::path::{Path, PathBuf};

/// The existing path in the form tools and users expect. On Windows
/// `std::fs::canonicalize` returns `\\?\C:\...`, which leaks into tooltips
/// and the workspace table. `dunce` drops that prefix when it is safe.
pub(crate) fn canonical_path(path: &Path) -> std::io::Result<PathBuf> {
    dunce::canonicalize(path)
}

/// Drop a `\\?\` prefix from a stored path string. Used by the schema
/// migration on paths that were saved before canonical_path existed.
/// `\\?\UNC\server\share` becomes `\\server\share`.
pub(crate) fn strip_verbatim_prefix(path: &str) -> String {
    if let Some(unc) = path.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{unc}");
    }
    path.strip_prefix(r"\\?\").unwrap_or(path).to_owned()
}

#[cfg(test)]
mod tests {
    use super::strip_verbatim_prefix;

    #[test]
    fn strips_only_a_leading_verbatim_prefix() {
        assert_eq!(
            strip_verbatim_prefix(r"\\?\C:\Users\me\SPOPI"),
            r"C:\Users\me\SPOPI"
        );
        assert_eq!(strip_verbatim_prefix("/home/me/proj"), "/home/me/proj");
        assert_eq!(strip_verbatim_prefix(r"C:\plain"), r"C:\plain");
        assert_eq!(
            strip_verbatim_prefix(r"\\?\UNC\server\share\proj"),
            r"\\server\share\proj"
        );
    }
}
