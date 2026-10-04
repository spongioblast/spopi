// ABOUTME: Reads and writes the Windows Firewall rule that lets paired phones reach SPOPI.
// ABOUTME: Writing goes through the Windows admin prompt; other systems report unsupported.

use serde::Serialize;

pub const RULE_NAME: &str = "SPOPI phone access";

#[derive(Serialize, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FirewallStatus {
    pub supported: bool,
    pub rule: bool,
    pub ports: Vec<String>,
    /// The rule's remote addresses as `a.b.c.d/bits`, or `Any`.
    pub remote: Vec<String>,
    pub blocked: u32,
}

/// Windows reports `192.168.80.0/255.255.255.0` or a bare address; the allowlist uses
/// `192.168.80.0/24`. Both become the masked network with a prefix length.
pub fn canonical_remote(entry: &str) -> Option<String> {
    let entry = entry.trim();
    if entry.eq_ignore_ascii_case("any") {
        return Some("Any".into());
    }
    let (base, suffix) = entry.split_once('/').unwrap_or((entry, "32"));
    let base = base.parse::<std::net::Ipv4Addr>().ok()?;
    let bits = match suffix.parse::<u32>() {
        Ok(bits) if bits <= 32 => bits,
        Ok(_) => return None,
        Err(_) => {
            let mask = u32::from(suffix.parse::<std::net::Ipv4Addr>().ok()?);
            if mask.leading_ones() + mask.trailing_zeros() != 32 {
                return None;
            }
            mask.leading_ones()
        }
    };
    let mask = if bits == 0 {
        0
    } else {
        u32::MAX << (32 - bits)
    };
    let network = std::net::Ipv4Addr::from(u32::from(base) & mask);
    Some(format!("{network}/{bits}"))
}

/// Each allowlist entry must be an IP or an IP with a prefix; anything else is refused.
/// An empty list is refused too, so a rule never opens the port to every address.
pub fn remote_addresses(allow: &[String]) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    for entry in allow
        .iter()
        .map(|entry| entry.trim())
        .filter(|e| !e.is_empty())
    {
        let (ip, prefix) = entry.split_once('/').unwrap_or((entry, ""));
        let ip = ip
            .parse::<std::net::IpAddr>()
            .map_err(|_| format!("not an address: {entry}"))?;
        if !prefix.is_empty() {
            let bits = prefix
                .parse::<u8>()
                .map_err(|_| format!("not a prefix: {entry}"))?;
            if bits > if ip.is_ipv4() { 32 } else { 128 } {
                return Err(format!("not a prefix: {entry}"));
            }
        }
        out.push(entry.to_string());
    }
    if out.is_empty() {
        return Err("no allowed sources".into());
    }
    Ok(out)
}

fn quoted(text: &str) -> String {
    format!("'{}'", text.replace('\'', "''"))
}

#[cfg(target_os = "windows")]
fn exe_path() -> String {
    std::env::current_exe()
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn blocked_rules_query(exe: &str) -> String {
    format!(
        "@(Get-NetFirewallApplicationFilter -Program {} -ErrorAction SilentlyContinue | Get-NetFirewallRule | Where-Object {{ $_.Direction -eq 'Inbound' -and $_.Action -eq 'Block' -and $_.Enabled -eq 'True' }})",
        quoted(exe)
    )
}

pub fn status_script(exe: &str) -> String {
    format!(
        "$rules = @(Get-NetFirewallRule -DisplayName {name} -ErrorAction SilentlyContinue | Where-Object {{ $_.Enabled -eq 'True' }})\n\
         $ports = @($rules | Get-NetFirewallPortFilter | ForEach-Object {{ \"$($_.LocalPort)\" }})\n\
         $remote = @($rules | Get-NetFirewallAddressFilter | ForEach-Object {{ $_.RemoteAddress }} | ForEach-Object {{ \"$_\" }})\n\
         $blocked = {blocked}.Count\n\
         [pscustomobject]@{{ rule = ($rules.Count -gt 0); ports = $ports; remote = $remote; blocked = $blocked }} | ConvertTo-Json -Compress",
        name = quoted(RULE_NAME),
        blocked = blocked_rules_query(exe),
    )
}

/// Replaces SPOPI's rule and removes inbound block rules Windows made for this exe,
/// because a block rule wins over any allow rule.
pub fn allow_script(port: u16, remote: &[String], exe: &str) -> String {
    let remote = remote
        .iter()
        .map(|entry| quoted(entry))
        .collect::<Vec<_>>()
        .join(",");
    format!(
        "$ErrorActionPreference = 'Stop'\n\
         Get-NetFirewallRule -DisplayName {name} -ErrorAction SilentlyContinue | Remove-NetFirewallRule\n\
         {blocked} | Remove-NetFirewallRule\n\
         New-NetFirewallRule -DisplayName {name} -Description 'Lets paired phones reach SPOPI phone access.' -Direction Inbound -Action Allow -Protocol TCP -LocalPort {port} -RemoteAddress @({remote}) -Profile Any | Out-Null",
        name = quoted(RULE_NAME),
        blocked = blocked_rules_query(exe),
    )
}

/// PowerShell's -EncodedCommand takes base64 of UTF-16LE, so no shell quoting is involved.
pub fn encode(script: &str) -> String {
    use base64::Engine;
    let bytes = script
        .encode_utf16()
        .flat_map(u16::to_le_bytes)
        .collect::<Vec<_>>();
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

#[cfg(target_os = "windows")]
fn powershell(encoded: &str) -> std::io::Result<std::process::Output> {
    let mut command = std::process::Command::new("powershell.exe");
    crate::platform::windows_child::hide_console(&mut command);
    command
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-EncodedCommand",
            encoded,
        ])
        .output()
}

#[cfg(target_os = "windows")]
pub fn status() -> FirewallStatus {
    let Ok(output) = powershell(&encode(&status_script(&exe_path()))) else {
        return FirewallStatus {
            supported: true,
            ..FirewallStatus::default()
        };
    };
    let value: serde_json::Value =
        serde_json::from_slice(&output.stdout).unwrap_or(serde_json::Value::Null);
    let strings = |value: &serde_json::Value| -> Vec<String> {
        match value {
            serde_json::Value::Array(items) => items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_owned))
                .collect(),
            serde_json::Value::String(one) => vec![one.clone()],
            _ => Vec::new(),
        }
    };
    let remote = strings(&value["remote"])
        .iter()
        .map(|entry| canonical_remote(entry).unwrap_or_else(|| entry.clone()))
        .collect();
    FirewallStatus {
        supported: true,
        rule: value["rule"].as_bool().unwrap_or(false),
        ports: strings(&value["ports"]),
        remote,
        blocked: value["blocked"].as_u64().unwrap_or(0) as u32,
    }
}

#[cfg(not(target_os = "windows"))]
pub fn status() -> FirewallStatus {
    FirewallStatus::default()
}

/// Asks Windows for admin rights and writes the rule. Err("cancelled") when the prompt is declined.
#[cfg(target_os = "windows")]
pub fn allow(port: u16, allow: &[String]) -> Result<(), String> {
    let remote = remote_addresses(allow)?;
    let inner = encode(&allow_script(port, &remote, &exe_path()));
    let outer = format!(
        "try {{ $p = Start-Process -FilePath powershell.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand','{inner}'); exit $p.ExitCode }} catch {{ exit 1223 }}"
    );
    let output = powershell(&encode(&outer)).map_err(|error| error.to_string())?;
    match output.status.code() {
        Some(0) => Ok(()),
        Some(1223) => Err("cancelled".into()),
        code => Err(format!(
            "the firewall rule was not written (exit {})",
            code.map_or_else(|| "?".into(), |code| code.to_string())
        )),
    }
}

#[cfg(not(target_os = "windows"))]
pub fn allow(_port: u16, _allow: &[String]) -> Result<(), String> {
    Err("unsupported".into())
}

#[cfg(test)]
mod tests {
    use super::{allow_script, canonical_remote, encode, remote_addresses};

    #[test]
    fn windows_and_allowlist_forms_compare_equal() {
        assert_eq!(
            canonical_remote("192.168.80.0/255.255.255.0").as_deref(),
            Some("192.168.80.0/24")
        );
        assert_eq!(
            canonical_remote("192.168.80.57/24").as_deref(),
            Some("192.168.80.0/24")
        );
        assert_eq!(
            canonical_remote("127.0.0.1").as_deref(),
            Some("127.0.0.1/32")
        );
        assert_eq!(
            canonical_remote("100.64.0.0/255.192.0.0").as_deref(),
            Some("100.64.0.0/10")
        );
        assert_eq!(canonical_remote("Any").as_deref(), Some("Any"));
        assert_eq!(canonical_remote("192.168.1.0/255.0.255.0"), None);
        assert_eq!(canonical_remote("10.0.0.1-10.0.0.9"), None);
    }

    #[test]
    fn only_addresses_and_prefixes_reach_the_rule() {
        let ok = remote_addresses(&["192.168.80.0/24".into(), " 100.64.0.0/10 ".into()]).unwrap();
        assert_eq!(ok, vec!["192.168.80.0/24", "100.64.0.0/10"]);
        assert!(remote_addresses(&[]).is_err());
        assert!(remote_addresses(&[" ".into()]).is_err());
        assert!(remote_addresses(&["192.168.1.0/33".into()]).is_err());
        assert!(remote_addresses(&["1.2.3.4'; Remove-Item C:\\".into()]).is_err());
        assert!(remote_addresses(&["LocalSubnet".into()]).is_err());
    }

    #[test]
    fn the_rule_is_for_the_port_and_quotes_the_exe() {
        let script = allow_script(
            57640,
            &["192.168.80.0/24".into()],
            r"C:\Users\O'Neil\spopi.exe",
        );
        assert!(script.contains("-LocalPort 57640"));
        assert!(script.contains("-RemoteAddress @('192.168.80.0/24')"));
        assert!(script.contains(r"-Program 'C:\Users\O''Neil\spopi.exe'"));
        assert!(script.contains("-DisplayName 'SPOPI phone access'"));
    }

    #[test]
    fn encoded_commands_are_utf16_base64() {
        assert_eq!(encode("ab"), "YQBiAA==");
    }
}
