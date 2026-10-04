// ABOUTME: Phone pairing codes, device tokens, and the HTTPS listener's state.
// ABOUTME: listen.rs serves the phone and pair.rs its pair routes; the desktop's routes are in server/http/phone.rs.

pub(crate) mod addresses;
pub(crate) mod cert;
pub(crate) mod listen;
mod page;
mod pair;

use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet, VecDeque};
use std::net::IpAddr;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const CLAIM_TTL: Duration = Duration::from_secs(5 * 60);
pub const PAIR_CODE_TTL: Duration = Duration::from_secs(5 * 60);
const ANSWERED_CAP: usize = 64;

pub struct PhoneBook {
    named: Mutex<HashMap<String, NamedClaim>>,
    enabled: Mutex<bool>,
    allow: Mutex<Vec<String>>,
    answered: Mutex<Answered>,
    tls_dir: Mutex<PathBuf>,
    pair_code: Mutex<Option<PairCode>>,
    listener: Mutex<Option<RunningListener>>,
}

/// The secret behind the QR code. Only its hash is kept; one claim uses it up.
struct PairCode {
    hash: String,
    created: Instant,
}

pub struct RunningListener {
    pub addr: std::net::SocketAddr,
    pub handle: axum_server::Handle,
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
    /// Approved; the token waits for the phone's page navigation.
    Ready,
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
            enabled: Mutex::new(false),
            allow: Mutex::new(Vec::new()),
            answered: Mutex::new(Answered::default()),
            tls_dir: Mutex::new(PathBuf::new()),
            pair_code: Mutex::new(None),
            listener: Mutex::new(None),
        }
    }

    /// A new pairing secret for the QR code. It replaces the previous one.
    pub fn issue_pair_code(&self) -> String {
        let secret = new_token();
        *self.pair_code.lock().unwrap_or_else(|e| e.into_inner()) = Some(PairCode {
            hash: token_hash(&secret),
            created: Instant::now(),
        });
        secret
    }

    /// True once for the current secret while it is fresh; the secret is gone afterwards.
    pub fn consume_pair_code(&self, secret: &str) -> bool {
        let mut slot = self.pair_code.lock().unwrap_or_else(|e| e.into_inner());
        let fresh = slot.as_ref().is_some_and(|code| {
            !secret.is_empty()
                && code.created.elapsed() <= PAIR_CODE_TTL
                && code.hash == token_hash(secret)
        });
        if fresh {
            *slot = None;
        }
        fresh
    }

    pub fn forget_pair_code(&self) {
        *self.pair_code.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }

    #[cfg(test)]
    fn age_pair_code(&self, age: Duration) {
        if let Some(code) = self
            .pair_code
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_mut()
        {
            code.created = Instant::now() - age;
        }
    }

    /// Swap the running HTTPS listener. Returns the previous one so the caller can stop it.
    pub fn replace_listener(&self, next: Option<RunningListener>) -> Option<RunningListener> {
        std::mem::replace(
            &mut *self.listener.lock().unwrap_or_else(|e| e.into_inner()),
            next,
        )
    }

    pub fn listener_addr(&self) -> Option<std::net::SocketAddr> {
        self.listener
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .map(|running| running.addr)
    }

    pub fn set_tls_dir(&self, dir: PathBuf) {
        *self.tls_dir.lock().unwrap_or_else(|e| e.into_inner()) = dir;
    }

    pub fn tls_dir(&self) -> PathBuf {
        self.tls_dir
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    /// First caller wins. Later callers are told the prompt was already answered.
    pub fn claim_answer(&self, id: &str) -> bool {
        if id.is_empty() {
            return false;
        }
        let mut answered = self.answered.lock().unwrap_or_else(|e| e.into_inner());
        answered.insert(id)
    }

    pub fn release_answer(&self, id: &str) {
        self.answered
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(id);
    }

    #[cfg(test)]
    pub fn answered_len(&self) -> usize {
        self.answered
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .order
            .len()
    }

    pub fn set_allow(&self, cidrs: Vec<String>) {
        *self.allow.lock().unwrap_or_else(|e| e.into_inner()) = cidrs;
    }

    /// An empty list lets nobody in.
    pub fn allows(&self, ip: IpAddr) -> bool {
        let allow = self.allow.lock().unwrap_or_else(|e| e.into_inner());
        allow.iter().any(|cidr| cidr_contains(cidr, ip))
    }

    pub fn open_named_claim(&self, source: IpAddr, name: &str) -> String {
        self.insert_named(source, name, Instant::now())
    }

    fn insert_named(&self, source: IpAddr, name: &str, created: Instant) -> String {
        let id = format!("claim-{}", new_token());
        let mut named = self.named.lock().unwrap_or_else(|e| e.into_inner());
        named.retain(|_, claim| claim.created.elapsed() <= CLAIM_TTL);
        named.insert(
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
        let named = self.named.lock().unwrap_or_else(|e| e.into_inner());
        named
            .get(id)
            .map(|claim| (claim.name.clone(), claim.source))
    }

    /// The claim as seen by the phone's poll: an approved claim is `Ready` and keeps its token.
    pub fn named_status(&self, id: &str, source: IpAddr) -> NamedOutcome {
        self.named(id, source, false)
    }

    /// The claim as seen by the phone that opened it. An approved token is handed out once.
    pub fn named_outcome(&self, id: &str, source: IpAddr) -> NamedOutcome {
        self.named(id, source, true)
    }

    fn named(&self, id: &str, source: IpAddr, take: bool) -> NamedOutcome {
        let mut named = self.named.lock().unwrap_or_else(|e| e.into_inner());
        let Some(claim) = named.get_mut(id) else {
            return NamedOutcome::Missing;
        };
        if claim.source != source {
            return NamedOutcome::Missing;
        }
        if matches!(claim.outcome, StoredOutcome::Pending) && claim.created.elapsed() > CLAIM_TTL {
            claim.outcome = StoredOutcome::Expired;
            return NamedOutcome::Expired;
        }
        match &claim.outcome {
            StoredOutcome::Pending => return NamedOutcome::Pending,
            StoredOutcome::Denied => return NamedOutcome::Denied,
            StoredOutcome::Expired => return NamedOutcome::Expired,
            StoredOutcome::Approved(_) if !take => return NamedOutcome::Ready,
            StoredOutcome::Approved(_) => {}
        }
        match named.remove(id).map(|claim| claim.outcome) {
            Some(StoredOutcome::Approved(token)) => NamedOutcome::Approved(token),
            _ => NamedOutcome::Missing,
        }
    }

    fn resolve_named(&self, id: &str, outcome: StoredOutcome) -> bool {
        let mut named = self.named.lock().unwrap_or_else(|e| e.into_inner());
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

    pub fn set_enabled(&self, enabled: bool) {
        *self.enabled.lock().unwrap_or_else(|e| e.into_inner()) = enabled;
    }

    pub fn is_enabled(&self) -> bool {
        *self.enabled.lock().unwrap_or_else(|e| e.into_inner())
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

/// An allowed-sources entry: an IPv4 address with an optional `/0`–`/32` prefix.
pub fn allow_entry_valid(entry: &str) -> bool {
    let (base, bits) = match entry.split_once('/') {
        Some((base, bits)) => (base, Some(bits)),
        None => (entry, None),
    };
    let base_ok = base.parse::<std::net::Ipv4Addr>().is_ok();
    let bits_ok = bits.is_none_or(|bits| {
        !bits.is_empty()
            && bits.len() <= 2
            && bits.bytes().all(|b| b.is_ascii_digit())
            && bits.parse::<u32>().is_ok_and(|n| n <= 32)
    });
    base_ok && bits_ok
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
        assert_eq!(book.named_outcome(&id, ip), NamedOutcome::Expired);
        assert!(!book.approve_named(&id, "token".into()));
    }

    #[test]
    fn a_pair_code_works_once_and_a_new_one_replaces_it() {
        let book = PhoneBook::new();
        assert!(!book.consume_pair_code(""));
        let first = book.issue_pair_code();
        let second = book.issue_pair_code();
        assert_ne!(first, second);
        assert!(!book.consume_pair_code(&first));
        assert!(book.consume_pair_code(&second));
        assert!(!book.consume_pair_code(&second));

        let stale = book.issue_pair_code();
        book.age_pair_code(PAIR_CODE_TTL + Duration::from_secs(1));
        assert!(!book.consume_pair_code(&stale));

        let forgotten = book.issue_pair_code();
        book.forget_pair_code();
        assert!(!book.consume_pair_code(&forgotten));
    }

    #[test]
    fn only_the_claiming_address_gets_the_token_and_only_once() {
        let book = PhoneBook::new();
        let phone = IpAddr::V4(Ipv4Addr::new(192, 168, 1, 20));
        let other = IpAddr::V4(Ipv4Addr::new(192, 168, 1, 99));
        let id = book.open_named_claim(phone, "Pixel");
        let next = book.open_named_claim(phone, "Pixel");
        assert!(id.len() > 40, "claim ids are random: {id}");
        assert_ne!(id, next);
        assert!(book.approve_named(&id, "token".into()));
        assert_eq!(book.named_status(&id, phone), NamedOutcome::Ready);
        assert_eq!(book.named_status(&id, phone), NamedOutcome::Ready);
        assert_eq!(book.named_status(&id, other), NamedOutcome::Missing);
        assert_eq!(book.named_outcome(&id, other), NamedOutcome::Missing);
        assert_eq!(
            book.named_outcome(&id, phone),
            NamedOutcome::Approved("token".into())
        );
        assert_eq!(book.named_outcome(&id, phone), NamedOutcome::Missing);
    }

    #[test]
    fn allowed_sources_are_ipv4_with_an_optional_prefix() {
        for good in ["192.168.80.0/24", "10.0.0.5", "0.0.0.0/0", "100.64.0.0/10"] {
            assert!(allow_entry_valid(good), "{good}");
        }
        for bad in [
            "192.168.8g0.1/32",
            "192.168.1.0/33",
            "192.168.1.0/",
            "192.168.1.0/+8",
            "01.2.3.4",
            "fe80::1",
            "",
        ] {
            assert!(!allow_entry_valid(bad), "{bad}");
        }
        let book = PhoneBook::new();
        assert!(!book.allows(IpAddr::V4(Ipv4Addr::LOCALHOST)));
    }
}
