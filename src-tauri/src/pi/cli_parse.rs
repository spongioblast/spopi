// ABOUTME: Parses `pi list` text into package sources, scopes, and install paths.
// ABOUTME: Pi has no JSON list option; the fixture is real command output.

use super::launch::{PackageResourceCounts, PiPackageInfo};

/// ` (filtered)` is Pi's marker for an object-form package entry. It is not
/// SPOPI's disabled flag, which means every resource array is empty.
const FILTERED_SUFFIX: &str = " (filtered)";

pub(in crate::pi) fn parse_pi_list(output: &str) -> Vec<PiPackageInfo> {
    let mut packages: Vec<PiPackageInfo> = Vec::new();
    let mut scope = "global";
    for line in output.lines() {
        let line = line.trim_end_matches('\r');
        let leading = line.len() - line.trim_start().len();
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("No packages installed.") {
            continue;
        }
        if trimmed.ends_with(':') {
            let lower = trimmed.to_ascii_lowercase();
            if lower.starts_with("project") {
                scope = "project";
            } else if lower.starts_with("user") || lower.starts_with("global") {
                scope = "global";
            }
            continue;
        }
        if leading >= 4 {
            if let Some(pkg) = packages.last_mut() {
                if pkg.installed_path.is_none() {
                    let value = strip_marker(trimmed).0;
                    if !value.is_empty() {
                        pkg.installed_path = Some(value);
                    }
                }
            }
            continue;
        }
        let (source, _filtered) = strip_marker(trimmed);
        if source.is_empty() {
            continue;
        }
        packages.push(PiPackageInfo {
            source,
            scope: scope.to_string(),
            installed_path: None,
            disabled: false,
            package_name: None,
            version: None,
            description: None,
            counts: PackageResourceCounts::default(),
            resources: Vec::new(),
        });
    }
    packages
}

/// Drop a leading `-` and a trailing ` (filtered)` marker. The bool is true
/// when Pi printed the filtered marker.
fn strip_marker(raw: &str) -> (String, bool) {
    let raw = raw.strip_prefix('-').map(str::trim).unwrap_or(raw);
    if let Some(source) = raw.strip_suffix(FILTERED_SUFFIX) {
        (source.to_string(), true)
    } else {
        (raw.to_string(), false)
    }
}

#[cfg(test)]
mod tests {
    use super::parse_pi_list;

    fn fixture() -> String {
        let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../tests/fixtures/pi-cli/list.txt");
        std::fs::read_to_string(path).expect("pi list fixture")
    }

    #[test]
    fn real_pi_list_output_keeps_source_scope_and_path() {
        let packages = parse_pi_list(&fixture());
        let sources: Vec<_> = packages
            .iter()
            .map(|pkg| {
                (
                    pkg.source.as_str(),
                    pkg.scope.as_str(),
                    pkg.installed_path.is_some(),
                )
            })
            .collect();
        assert_eq!(
            sources,
            vec![
                ("npm:pi-localllm-provider", "global", true),
                ("npm:surf-cli", "global", true),
                ("npm:pi-workspace-history", "global", true),
                ("npm:pi-lens", "global", true),
                ("npm:pi-mcp-adapter", "global", true),
                ("npm:pi-context-view", "global", true),
                ("npm:@ff-labs/pi-fff", "global", true),
                ("npm:pi-web-access", "global", true),
                ("npm:pi-subagents", "global", true),
                ("npm:example-local", "project", false),
                ("npm:example-filtered", "project", false),
            ]
        );
        assert!(packages.iter().all(|pkg| !pkg.disabled));
        assert!(packages
            .iter()
            .all(|pkg| !pkg.source.contains("(filtered)")));
        assert_eq!(
            packages[3].installed_path.as_deref(),
            Some(r"C:\Users\me\.pi\agent\npm\node_modules\pi-lens")
        );
    }

    #[test]
    fn empty_list_and_a_leading_dash_are_sources_without_paths() {
        assert!(parse_pi_list("No packages installed.\n").is_empty());
        let packages = parse_pi_list("User packages:\n  - npm:disabled-pkg (filtered)\n");
        assert_eq!(packages.len(), 1);
        assert_eq!(packages[0].source, "npm:disabled-pkg");
        assert_eq!(packages[0].scope, "global");
        assert!(packages[0].installed_path.is_none());
    }
}
