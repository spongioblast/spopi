// ABOUTME: Pure grouping and labels for the Settings MCP page.
// ABOUTME: Pi's list is the only source; this file does not call Pi.

/**
 * @param {{ servers?: unknown, errors?: unknown, note?: unknown } | null | undefined} list
 */
export function groupServers(list) {
  const servers = Array.isArray(list?.servers) ? list.servers : [];
  return {
    global: servers.filter((server) => server?.scope === "global"),
    project: servers.filter((server) => server?.scope === "project"),
    extension: servers.filter((server) => server?.scope === "extension"),
    errors: Array.isArray(list?.errors) ? list.errors.map(String) : [],
    note: typeof list?.note === "string" ? list.note : "",
  };
}

/** @param {{ state?: string } | null | undefined} server */
export function rowState(server) {
  switch (server?.state) {
    case "connected":
      return { dot: "ok", labelKey: "settings.mcp.state.connected" };
    case "needs-auth":
      return { dot: "warn", labelKey: "settings.mcp.state.needsAuth" };
    case "failed":
      return { dot: "error", labelKey: "settings.mcp.state.failed" };
    case "disabled":
      return { dot: "off", labelKey: "settings.mcp.state.disabled" };
    default:
      return { dot: "off", labelKey: "settings.mcp.state.disconnected" };
  }
}

/** @param {{ transport?: string } | null | undefined} server */
export function isHttp(server) {
  return String(server?.transport ?? "").startsWith("http");
}

const NAME_RE = /^[A-Za-z0-9_-]+$/;

/** @param {string} name */
export function validServerName(name) {
  return NAME_RE.test(name) && name.length <= 64;
}

/**
 * A name that differs from an existing one only in `-` and `_`.
 * @param {string} name
 * @param {string[]} existing
 */
export function clashingName(name, existing) {
  /** @param {string} value */
  const fold = (value) => value.replaceAll("-", "_");
  const folded = fold(name);
  return existing.find((other) => other !== name && fold(other) === folded) ?? "";
}

/**
 * Warn, do not block. Longer than 20, no spaces, not ${...} or !..., and
 * either a known prefix or a long token-like run.
 * @param {unknown} value
 */
export function looksLikeToken(value) {
  const text = String(value ?? "");
  if (text.length <= 20 || /\s/.test(text) || text.startsWith("${") || text.startsWith("!")) {
    return false;
  }
  if (/^(sk-|ghp_|xox)/i.test(text)) return true;
  return /[A-Za-z0-9_-]{24,}/.test(text);
}
