// ABOUTME: Stable owner id derived from a desktop client id.
// ABOUTME: The id is a hash prefix, not a secret and not a capability token.

use crate::platform::hex::hex_encode;

const OWNER_ID_LEN: usize = 16;

/// Opaque per-window owner identity. Distinct from the WebView client id.
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct OwnerId(String);

impl OwnerId {
    /// Derive a non-secret, stable owner partition from a desktop window's
    /// session-scoped client id. The Host keeps the raw client id private.
    pub(crate) fn from_client_id(client_id: &str) -> Self {
        use sha2::{Digest, Sha256};
        let digest = Sha256::digest(client_id.as_bytes());
        Self(hex_encode(&digest[..OWNER_ID_LEN]))
    }
}
