// ABOUTME: Lowercase hex encoding shared by owner ids and terminal ids.
// ABOUTME: One helper so those call sites cannot drift apart.

pub(crate) fn hex_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::hex_encode;

    #[test]
    fn encodes_lowercase_hex() {
        assert_eq!(hex_encode(&[0x0a, 0xff]), "0aff");
        assert_eq!(hex_encode(&[]), "");
    }
}
