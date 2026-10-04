// ABOUTME: Parses npm package specs and `npm view <spec> version --json` output for the update check.
// ABOUTME: Pure parsing; running npm and deciding whether to probe at all stays in updates.rs.

use semver::{Version, VersionReq};
use serde_json::Value;

pub(super) fn npm_package_spec(spec: &str) -> Result<(String, Option<String>), String> {
    let spec = spec.trim();
    if spec.is_empty() {
        return Err("npm package name cannot be empty".to_string());
    }
    let name = if let Some(rest) = spec.strip_prefix('@') {
        let slash = rest
            .find('/')
            .ok_or_else(|| format!("invalid scoped npm package: {spec}"))?;
        format!("@{}", &rest[..slash + 1]) + rest[slash + 1..].split('@').next().unwrap_or_default()
    } else {
        spec.split('@').next().unwrap_or_default().to_string()
    };
    if name == "@" || name.ends_with('/') || name.contains('/') && name.split('/').count() != 2 {
        return Err(format!("invalid npm package name: {spec}"));
    }
    let version = spec
        .strip_prefix(&name)
        .and_then(|value| value.strip_prefix('@'))
        .map(ToOwned::to_owned);
    Ok((name, version))
}

pub(super) fn latest_npm_version(output: &str, range: Option<&VersionReq>) -> Option<String> {
    let value: Value = serde_json::from_str(output.trim()).ok()?;
    let mut versions = match value {
        Value::String(version) => vec![version],
        Value::Array(values) => values
            .into_iter()
            .filter_map(|value| value.as_str().map(ToOwned::to_owned))
            .collect(),
        _ => return None,
    };
    versions.retain(|version| Version::parse(version).is_ok());
    if let Some(range) = range {
        versions
            .into_iter()
            .filter_map(|version| {
                let parsed = Version::parse(&version).ok()?;
                range.matches(&parsed).then_some((parsed, version))
            })
            .max_by(|left, right| left.0.cmp(&right.0))
            .map(|(_, version)| version)
    } else {
        versions
            .into_iter()
            .filter_map(|version| Some((Version::parse(&version).ok()?, version)))
            .max_by(|left, right| left.0.cmp(&right.0))
            .map(|(_, version)| version)
    }
}

#[cfg(test)]
mod tests {
    use super::{latest_npm_version, npm_package_spec};

    #[test]
    fn npm_package_spec_parses_scoped_pinned_and_range_specs() {
        assert_eq!(npm_package_spec("foo").unwrap(), ("foo".to_string(), None));
        assert_eq!(
            npm_package_spec("foo@1.2.3").unwrap(),
            ("foo".to_string(), Some("1.2.3".to_string()))
        );
        assert_eq!(
            npm_package_spec("foo@^1.0.0").unwrap(),
            ("foo".to_string(), Some("^1.0.0".to_string()))
        );
        assert_eq!(
            npm_package_spec("@scope/name").unwrap(),
            ("@scope/name".to_string(), None)
        );
        assert_eq!(
            npm_package_spec("@scope/name@2.0.0").unwrap(),
            ("@scope/name".to_string(), Some("2.0.0".to_string()))
        );
        assert!(npm_package_spec("").is_err());
        assert!(npm_package_spec("@missing-slash").is_err());
    }

    #[test]
    fn latest_npm_version_handles_string_and_array_shapes() {
        assert_eq!(
            latest_npm_version("\"1.2.3\"", None).as_deref(),
            Some("1.2.3")
        );
        assert_eq!(
            latest_npm_version("[\"1.5.0\", \"2.0.0\", \"1.0.0\"]", None).as_deref(),
            Some("2.0.0")
        );
        assert_eq!(latest_npm_version("not json", None), None);
        assert_eq!(latest_npm_version("null", None), None);
    }

    #[test]
    fn latest_npm_version_filters_invalid_versions_and_applies_range() {
        assert_eq!(
            latest_npm_version("[\"latest\", \"1.0.0\", \"not-semver\"]", None).as_deref(),
            Some("1.0.0")
        );
        let range = semver::VersionReq::parse("^1.0.0").unwrap();
        assert_eq!(
            latest_npm_version("[\"3.0.0\", \"2.0.0\", \"1.5.0\", \"1.0.0\"]", Some(&range))
                .as_deref(),
            Some("1.5.0")
        );
    }
}
