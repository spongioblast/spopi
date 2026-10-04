// ABOUTME: Allowed sources for phone access: parsing, checking, and the default for an interface.
// ABOUTME: Pure rules with no DOM; the host checks the same IPv4 address-or-range format.

/** @param {string} text @returns {string[]} */
export function parseAllowText(text) {
  return String(text)
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

const OCTET = "(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const ALLOW_ENTRY = new RegExp(`^${OCTET}(\\.${OCTET}){3}(/(?<bits>\\d{1,2}))?$`);

/**
 * Same rule as the host: an IPv4 address with an optional /0–/32 prefix.
 * @param {string} entry
 */
export function isAllowEntry(entry) {
  const match = ALLOW_ENTRY.exec(entry);
  if (!match) return false;
  const bits = match.groups?.bits;
  return bits === undefined || Number(bits) <= 32;
}

/**
 * @param {string} text
 * @returns {{ key: string, entry?: string } | null}
 */
export function allowProblem(text) {
  const entries = parseAllowText(text);
  if (!entries.length) return { key: "settings.phone.allowEmpty" };
  const bad = entries.find((entry) => !isAllowEntry(entry));
  return bad ? { key: "settings.phone.allowInvalid", entry: bad } : null;
}

/**
 * `192.168.80.57/24` and `192.168.80.0/24` are the same range; the host reports the masked form.
 * @param {string} entry a valid entry (see isAllowEntry)
 */
export function canonicalCidr(entry) {
  const [base, bits = "32"] = entry.split("/");
  const prefix = Number(bits);
  const value = base.split(".").reduce((sum, part) => sum * 256 + Number(part), 0);
  const mask = prefix === 0 ? 0 : (0xffffffff * 2 ** (32 - prefix)) % 2 ** 32;
  const network = Number((BigInt(value) & BigInt(mask)).toString());
  const octets = [24, 16, 8, 0].map((shift) => Math.floor(network / 2 ** shift) % 256);
  return `${octets.join(".")}/${prefix}`;
}

/**
 * Default allowlist for one interface address.
 * @param {string} ip
 * @returns {string[]}
 */
export function defaultAllowCidrs(ip) {
  const parts = String(ip).split(".").map(Number);
  const [a, b] = parts;
  if (a === 127) return ["127.0.0.1/32"];
  if (a === 100 && b >= 64 && b <= 127) return ["100.64.0.0/10"];
  const privateNet = a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
  if (privateNet && parts.length === 4) return [`${parts[0]}.${parts[1]}.${parts[2]}.0/24`];
  return [`${ip}/32`];
}

/**
 * True when the list is what SPOPI filled in for one of these addresses, so it
 * may follow the interface. A list the user typed is kept.
 * @param {string[]} allow
 * @param {string[]} ips
 */
export function isDefaultAllow(allow, ips) {
  if (!allow.length) return true;
  const text = allow.join(",");
  return [...ips, "127.0.0.1"].some((ip) => defaultAllowCidrs(ip).join(",") === text);
}
