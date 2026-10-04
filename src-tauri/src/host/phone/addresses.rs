// ABOUTME: Lists the IPv4 addresses a phone could reach, best first, with the adapter name.
// ABOUTME: The main network is the one the default route uses; virtual and VPN adapters go last.

use serde::Serialize;
use std::net::{Ipv4Addr, SocketAddr, UdpSocket};

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct LocalAddress {
    pub ip: String,
    pub name: String,
    pub kind: &'static str,
}

const VIRTUAL_NAMES: &[&str] = &[
    "vethernet",
    "wsl",
    "hyper-v",
    "default switch",
    "virtualbox",
    "vmware",
    "docker",
    "vbox",
    "virbr",
    "br-",
    "veth",
];

const VPN_NAMES: &[&str] = &[
    "nordlynx",
    "openvpn",
    "tap-windows",
    "wintun",
    "wireguard",
    "wg",
    "tun",
    "utun",
    "ppp",
    "zerotier",
    "proton",
    "mullvad",
];

pub fn local_addresses() -> Vec<LocalAddress> {
    let interfaces = if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|iface| match iface.ip() {
            std::net::IpAddr::V4(addr) => Some((addr, iface.name)),
            _ => None,
        })
        .collect::<Vec<_>>();
    rank(interfaces, default_route_address())
}

/// The source address the OS would use for traffic leaving the machine.
/// Connecting a UDP socket picks a route without sending anything.
fn default_route_address() -> Option<Ipv4Addr> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:53").ok()?;
    match socket.local_addr().ok()? {
        SocketAddr::V4(addr) if !addr.ip().is_unspecified() => Some(*addr.ip()),
        _ => None,
    }
}

fn rank(interfaces: Vec<(Ipv4Addr, String)>, main: Option<Ipv4Addr>) -> Vec<LocalAddress> {
    let mut out = interfaces
        .into_iter()
        .filter(|(ip, _)| !ip.is_loopback() && !ip.is_unspecified() && !ip.is_link_local())
        .map(|(ip, name)| {
            let kind = kind_of(ip, &name, main);
            LocalAddress {
                ip: ip.to_string(),
                name,
                kind,
            }
        })
        .collect::<Vec<_>>();
    out.sort_by_key(|address| order(address.kind));
    let mut seen = std::collections::HashSet::new();
    out.retain(|address| seen.insert(address.ip.clone()));
    out
}

fn kind_of(ip: Ipv4Addr, name: &str, main: Option<Ipv4Addr>) -> &'static str {
    let [first, second, _, _] = ip.octets();
    if first == 100 && (64..128).contains(&second) {
        return "tailscale";
    }
    let lower = name.to_ascii_lowercase();
    if VIRTUAL_NAMES.iter().any(|word| lower.contains(word)) {
        return "virtual";
    }
    if VPN_NAMES
        .iter()
        .any(|word| lower.starts_with(word) || lower.contains(&format!(" {word}")))
    {
        return "vpn";
    }
    if main == Some(ip) {
        return "main";
    }
    "lan"
}

fn order(kind: &str) -> u8 {
    match kind {
        "tailscale" => 0,
        "main" => 1,
        "lan" => 2,
        "vpn" => 3,
        _ => 4,
    }
}

#[cfg(test)]
mod tests {
    use super::rank;
    use std::net::Ipv4Addr;

    fn at(ip: &str, name: &str) -> (Ipv4Addr, String) {
        (ip.parse().unwrap(), name.to_string())
    }

    #[test]
    fn the_main_network_comes_first_and_internal_adapters_last() {
        let ranked = rank(
            vec![
                at("172.26.112.1", "vEthernet (WSL (Hyper-V firewall))"),
                at("169.254.145.127", "Local Area Connection 2"),
                at("10.5.0.2", "NordLynx"),
                at("172.26.160.1", "vEthernet (Default Switch)"),
                at("192.168.80.14", "Ethernet 2"),
                at("192.168.80.57", "Ethernet"),
                at("127.0.0.1", "Loopback Pseudo-Interface 1"),
            ],
            Some("192.168.80.57".parse().unwrap()),
        );
        let shown = ranked
            .iter()
            .map(|address| (address.ip.as_str(), address.kind))
            .collect::<Vec<_>>();
        assert_eq!(
            shown,
            vec![
                ("192.168.80.57", "main"),
                ("192.168.80.14", "lan"),
                ("10.5.0.2", "vpn"),
                ("172.26.112.1", "virtual"),
                ("172.26.160.1", "virtual"),
            ]
        );
    }

    #[test]
    fn tailscale_stays_first_even_when_it_carries_the_default_route() {
        let ranked = rank(
            vec![at("192.168.1.8", "Wi-Fi"), at("100.101.1.2", "Tailscale")],
            Some("100.101.1.2".parse().unwrap()),
        );
        assert_eq!(ranked[0].kind, "tailscale");
        assert_eq!(ranked[1].kind, "lan");
    }
}
