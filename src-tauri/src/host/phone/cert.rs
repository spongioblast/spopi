// ABOUTME: Creates the SPOPI local CA and the server certificate for the phone listener.
// ABOUTME: The CA private key stays in the app-data tls directory.

use rcgen::{BasicConstraints, CertificateParams, IsCa, KeyPair, SanType};
use std::fs;
use std::net::IpAddr;
use std::path::Path;
use std::time::{Duration, SystemTime};

pub struct CertPaths {
    pub ca_pem: std::path::PathBuf,
    pub cert_pem: std::path::PathBuf,
    pub key_pem: std::path::PathBuf,
}

pub fn paths(dir: &Path) -> CertPaths {
    CertPaths {
        ca_pem: dir.join("spopi-ca.crt"),
        cert_pem: dir.join("phone.crt"),
        key_pem: dir.join("phone.key"),
    }
}

pub fn needs_renewal(not_after: SystemTime, now: SystemTime) -> bool {
    not_after.duration_since(now).unwrap_or(Duration::ZERO) < Duration::from_secs(14 * 24 * 60 * 60)
}

/// Writes a CA and a server certificate when the server cert is missing or due.
pub fn ensure(dir: &Path, hostname: &str, ip: Option<IpAddr>) -> Result<CertPaths, String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let files = paths(dir);
    if files.cert_pem.exists() && files.key_pem.exists() && files.ca_pem.exists() {
        let modified = fs::metadata(&files.cert_pem)
            .and_then(|meta| meta.modified())
            .unwrap_or(SystemTime::now());
        let not_after = modified + Duration::from_secs(365 * 24 * 60 * 60);
        if !needs_renewal(not_after, SystemTime::now()) {
            return Ok(files);
        }
    }
    let ca_key = KeyPair::generate().map_err(|e| e.to_string())?;
    let mut ca_params = CertificateParams::new(Vec::<String>::new()).map_err(|e| e.to_string())?;
    ca_params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
    ca_params
        .distinguished_name
        .push(rcgen::DnType::CommonName, "SPOPI Local CA");
    let ca = ca_params.self_signed(&ca_key).map_err(|e| e.to_string())?;
    let server_key = KeyPair::generate().map_err(|e| e.to_string())?;
    let mut alt =
        vec![SanType::DnsName(hostname.try_into().map_err(|_| {
            "hostname is not a valid DNS name".to_string()
        })?)];
    if let Some(IpAddr::V4(v4)) = ip {
        alt.push(SanType::IpAddress(std::net::IpAddr::V4(v4)));
    }
    let mut server =
        CertificateParams::new(vec![hostname.to_string()]).map_err(|e| e.to_string())?;
    server.subject_alt_names = alt;
    server
        .distinguished_name
        .push(rcgen::DnType::CommonName, hostname);
    let cert = server
        .signed_by(&server_key, &ca, &ca_key)
        .map_err(|e| e.to_string())?;
    fs::write(&files.ca_pem, ca.pem()).map_err(|e| e.to_string())?;
    fs::write(&files.cert_pem, cert.pem()).map_err(|e| e.to_string())?;
    fs::write(&files.key_pem, server_key.serialize_pem()).map_err(|e| e.to_string())?;
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renewal_is_due_inside_fourteen_days() {
        let now = SystemTime::now();
        let soon = now + Duration::from_secs(3 * 24 * 60 * 60);
        let later = now + Duration::from_secs(40 * 24 * 60 * 60);
        assert!(needs_renewal(soon, now));
        assert!(!needs_renewal(later, now));
    }
}
