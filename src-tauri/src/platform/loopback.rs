// ABOUTME: One loopback host check for HTTP trust and metrics scrape.
// ABOUTME: Localhost names and the two loopback addresses count; nothing else does.

pub(crate) fn is_loopback_host(host: &str) -> bool {
    let host = host.trim().trim_matches(['[', ']']).to_ascii_lowercase();
    host == "localhost" || host == "127.0.0.1" || host == "::1" || host.ends_with(".localhost")
}

#[cfg(test)]
mod tests {
    use super::is_loopback_host;

    #[test]
    fn accepts_loopback_names_only() {
        assert!(is_loopback_host("localhost"));
        assert!(is_loopback_host("LOCALHOST"));
        assert!(is_loopback_host("127.0.0.1"));
        assert!(is_loopback_host("::1"));
        assert!(is_loopback_host("[::1]"));
        assert!(is_loopback_host("app.localhost"));
        assert!(!is_loopback_host("example.com"));
        assert!(!is_loopback_host("192.168.1.10"));
    }
}
