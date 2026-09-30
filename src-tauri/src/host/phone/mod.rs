// ABOUTME: Phone pairing codes, device tokens, and the accepted UI fingerprint.
// ABOUTME: The loopback listener stays unchanged. The HTTPS listener is opt-in.

pub(crate) mod cert;
mod fingerprint;
pub(crate) mod listen;

use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet, VecDeque};
use std::net::IpAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub(crate) use fingerprint::{changes, effective, hash_tree, Change};

const CLAIM_TTL: Duration = Duration::from_secs(5 * 60);
const ANSWERED_CAP: usize = 64;

pub struct PhoneBook {
    named: Mutex<HashMap<String, NamedClaim>>,
    ca_open: Mutex<bool>,
    allow: Mutex<Vec<String>>,
    answered: Mutex<Answered>,
    ui_current: Mutex<bool>,
    tls_dir: Mutex<PathBuf>,
}

struct NamedClaim {
    name: String,
    source: IpAddr,
    created: Instant,
    outcome: StoredOutcome,
}

enum StoredOutcome {
    Pending,
    Approved(String),
    Denied,
    Expired,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum NamedOutcome {
    Pending,
    Approved(String),
    Denied,
    Expired,
    Missing,
}

#[derive(Default)]
struct Answered {
    ids: HashSet<String>,
    order: VecDeque<String>,
}

impl Answered {
    fn insert(&mut self, id: &str) -> bool {
        if !self.ids.insert(id.to_string()) {
            return false;
        }
        self.order.push_back(id.to_string());
        while self.order.len() > ANSWERED_CAP {
            if let Some(old) = self.order.pop_front() {
                self.ids.remove(&old);
            }
        }
        true
    }

    fn remove(&mut self, id: &str) {
        self.ids.remove(id);
        self.order.retain(|item| item != id);
    }
}

impl PhoneBook {
    pub fn new() -> Self {
        Self {
            named: Mutex::new(HashMap::new()),
            ca_open: Mutex::new(false),
            allow: Mutex::new(Vec::new()),
            answered: Mutex::new(Answered::default()),
            ui_current: Mutex::new(true),
            tls_dir: Mutex::new(PathBuf::new()),
        }
    }

    pub fn set_tls_dir(&self, dir: PathBuf) {
        *self.tls_dir.lock().expect("tls dir") = dir;
    }

    pub fn tls_dir(&self) -> PathBuf {
        self.tls_dir.lock().expect("tls dir").clone()
    }

    pub fn set_ui_current(&self, current: bool) {
        *self.ui_current.lock().expect("ui fingerprint") = current;
    }

    pub fn ui_current(&self) -> bool {
        *self.ui_current.lock().expect("ui fingerprint")
    }

    /// First caller wins. Later callers are told the prompt was already answered.
    pub fn claim_answer(&self, id: &str) -> bool {
        if id.is_empty() {
            return false;
        }
        let mut answered = self.answered.lock().expect("answered prompts");
        answered.insert(id)
    }

    pub fn release_answer(&self, id: &str) {
        self.answered.lock().expect("answered prompts").remove(id);
    }

    #[cfg(test)]
    pub fn answered_len(&self) -> usize {
        self.answered.lock().expect("answered prompts").order.len()
    }

    pub fn set_allow(&self, cidrs: Vec<String>) {
        *self.allow.lock().expect("allowlist") = cidrs;
    }

    pub fn allows(&self, ip: IpAddr) -> bool {
        let allow = self.allow.lock().expect("allowlist");
        allow.is_empty() || allow.iter().any(|cidr| cidr_contains(cidr, ip))
    }

    pub fn open_named_claim(&self, source: IpAddr, name: &str) -> String {
        self.insert_named(source, name, Instant::now())
    }

    fn insert_named(&self, source: IpAddr, name: &str, created: Instant) -> String {
        static NEXT: AtomicU64 = AtomicU64::new(1);
        let id = format!("claim-{}", NEXT.fetch_add(1, Ordering::Relaxed));
        self.named.lock().expect("named claims").insert(
            id.clone(),
            NamedClaim {
                name: name.to_string(),
                source,
                created,
                outcome: StoredOutcome::Pending,
            },
        );
        id
    }

    pub fn named_claim(&self, id: &str) -> Option<(String, IpAddr)> {
        let named = self.named.lock().expect("named claims");
        named
            .get(id)
            .map(|claim| (claim.name.clone(), claim.source))
    }

    pub fn named_outcome(&self, id: &str) -> NamedOutcome {
        let mut named = self.named.lock().expect("named claims");
        let Some(claim) = named.get_mut(id) else {
            return NamedOutcome::Missing;
        };
        if matches!(claim.outcome, StoredOutcome::Pending) && claim.created.elapsed() > CLAIM_TTL {
            claim.outcome = StoredOutcome::Expired;
            return NamedOutcome::Expired;
        }
        match &claim.outcome {
            StoredOutcome::Pending => NamedOutcome::Pending,
            StoredOutcome::Approved(token) => NamedOutcome::Approved(token.clone()),
            StoredOutcome::Denied => NamedOutcome::Denied,
            StoredOutcome::Expired => NamedOutcome::Expired,
        }
    }

    fn resolve_named(&self, id: &str, outcome: StoredOutcome) -> bool {
        let mut named = self.named.lock().expect("named claims");
        let Some(claim) = named.get_mut(id) else {
            return false;
        };
        if !matches!(claim.outcome, StoredOutcome::Pending) {
            return false;
        }
        if claim.created.elapsed() > CLAIM_TTL {
            claim.outcome = StoredOutcome::Expired;
            return false;
        }
        claim.outcome = outcome;
        true
    }

    pub fn approve_named(&self, id: &str, token: String) -> bool {
        self.resolve_named(id, StoredOutcome::Approved(token))
    }

    pub fn deny_named(&self, id: &str) -> bool {
        self.resolve_named(id, StoredOutcome::Denied)
    }

    #[cfg(test)]
    fn open_named_claim_aged(&self, source: IpAddr, name: &str, age: Duration) -> String {
        self.insert_named(source, name, Instant::now() - age)
    }

    pub fn set_ca_open(&self, open: bool) {
        *self.ca_open.lock().expect("ca flag") = open;
    }

    pub fn ca_is_open(&self) -> bool {
        *self.ca_open.lock().expect("ca flag")
    }
}

pub fn token_hash(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}

pub fn new_token() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    hex::encode(bytes)
}

pub fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// IPv4 CIDR. A missing prefix is a single host.
pub fn cidr_contains(cidr: &str, ip: IpAddr) -> bool {
    let IpAddr::V4(addr) = ip else {
        return false;
    };
    let (base, bits) = cidr.split_once('/').unwrap_or((cidr, "32"));
    let Ok(network) = base.parse::<std::net::Ipv4Addr>() else {
        return false;
    };
    let Ok(bits) = bits.parse::<u32>() else {
        return false;
    };
    if bits > 32 {
        return false;
    }
    let mask = if bits == 0 {
        0
    } else {
        u32::MAX << (32 - bits)
    };
    (u32::from(addr) & mask) == (u32::from(network) & mask)
}

pub fn origin_matches(expected: &str, header: Option<&str>) -> bool {
    header.is_some_and(|value| value == expected)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;
    use std::time::Duration;

    #[test]
    fn effective_overlay_replaces_shipped_bytes() {
        let mut shipped = std::collections::BTreeMap::new();
        shipped.insert("a.js".into(), "1".into());
        let mut overlay = std::collections::BTreeMap::new();
        overlay.insert("a.js".into(), "2".into());
        let map = effective(&shipped, &overlay);
        assert_eq!(map.get("a.js").map(String::as_str), Some("2"));
        assert!(changes(&map, &shipped).iter().any(|c| c.kind == "modified"));
        assert!(hash_tree(std::path::Path::new("this-dir-is-absent")).is_empty());
    }

    #[test]
    fn the_first_answer_wins() {
        let book = PhoneBook::new();
        assert!(book.claim_answer("prompt-1"));
        assert!(!book.claim_answer("prompt-1"));
        assert!(book.claim_answer("prompt-2"));
        book.release_answer("prompt-1");
        assert!(book.claim_answer("prompt-1"));
        assert_eq!(book.answered_len(), 2);
        for index in 0..80 {
            assert!(book.claim_answer(&format!("extra-{index}")));
        }
        assert!(book.answered_len() <= 64);
    }

    #[test]
    fn allowlist_and_origin() {
        let ip = IpAddr::V4(Ipv4Addr::new(192, 168, 1, 20));
        assert!(cidr_contains("192.168.1.0/24", ip));
        assert!(!cidr_contains(
            "192.168.1.0/24",
            IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1))
        ));
        assert!(origin_matches("https://a:57640", Some("https://a:57640")));
        assert!(!origin_matches("https://a:57640", Some("https://evil")));
        assert!(!origin_matches("https://a:57640", None));
    }

    #[test]
    fn a_named_claim_expires_after_five_minutes() {
        let book = PhoneBook::new();
        let ip = IpAddr::V4(Ipv4Addr::LOCALHOST);
        let id = book.open_named_claim_aged(ip, "Pixel", Duration::from_secs(5 * 60 + 1));
        assert_eq!(book.named_outcome(&id), NamedOutcome::Expired);
        assert!(!book.approve_named(&id, "token".into()));
    }
}
