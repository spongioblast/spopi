// ABOUTME: Parses git package refs (`#ref`, `repo@ref`) and `git ls-remote` lines for the update check.
// ABOUTME: Pure parsing; running git and deciding whether to probe at all stays in updates.rs.

pub(super) fn split_git_ref(value: &str) -> (&str, Option<&str>) {
    if let Some((repo, reference)) = value.split_once('#') {
        return (repo, Some(reference));
    }
    if let Some((prefix, _)) = value.split_once("://") {
        let scheme_len = prefix.len() + 3;
        let path_start = value[scheme_len..]
            .find('/')
            .map_or(value.len(), |index| scheme_len + index + 1);
        if let Some(at) = value[path_start..].find('@') {
            let at = path_start + at;
            return (&value[..at], Some(&value[at + 1..]));
        }
    } else if let Some(slash) = value.find('/') {
        if let Some(at) = value[slash + 1..].find('@') {
            let at = slash + 1 + at;
            return (&value[..at], Some(&value[at + 1..]));
        }
    }
    (value, None)
}

/// Parse a `git ls-remote <ref>` line into its resolved 40-hex-char commit SHA.
/// Returns None for advert entries that are not the named ref we care about.
pub(super) fn parse_ls_remote_reference(line: &str) -> Option<String> {
    let mut fields = line.split_whitespace();
    let head = fields.next()?;
    let reference = fields.next()?;
    (head.len() == 40
        && head.bytes().all(|byte| byte.is_ascii_hexdigit())
        && (reference == "HEAD" || reference.starts_with("refs/heads/")))
    .then(|| head.to_string())
}

#[cfg(test)]
mod tests {
    use super::{parse_ls_remote_reference, split_git_ref};

    #[test]
    fn split_git_ref_extracts_hash_and_at_references() {
        assert_eq!(split_git_ref("a/b"), ("a/b", None));
        assert_eq!(split_git_ref("a/b#v1"), ("a/b", Some("v1")));
        assert_eq!(
            split_git_ref("https://host/a/b@main"),
            ("https://host/a/b", Some("main"))
        );
        assert_eq!(split_git_ref("host:a/b@main"), ("host:a/b", Some("main")));
    }

    #[test]
    fn parse_ls_remote_selects_only_matching_reference_heads() {
        let sha = "0123456789abcdef0123456789abcdef01234567"; // 40 hex chars
        assert_eq!(
            parse_ls_remote_reference(&format!("{sha}\tHEAD")).as_deref(),
            Some(sha)
        );
        assert_eq!(
            parse_ls_remote_reference(&format!("{sha}\trefs/heads/main")).as_deref(),
            Some(sha)
        );
        assert_eq!(
            parse_ls_remote_reference(&format!("{sha}\trefs/tags/v1.0.0")),
            None
        );
        assert_eq!(parse_ls_remote_reference("deadbeef\tHEAD"), None);
        assert_eq!(
            parse_ls_remote_reference(&format!("{sha}\tHEAD\textra")),
            Some(sha.to_string())
        );
        assert_eq!(parse_ls_remote_reference(""), None);
    }
}
