// ABOUTME: Synchronous cookie read and write for the first-paint appearance cache.
// ABOUTME: The Cookie Store API is async, so first paint still uses document.cookie.

/**
 * @param {string} name
 * @returns {string | null}
 */
export function readCookie(name) {
  try {
    const cookies = document.cookie ? document.cookie.split("; ") : [];
    for (const entry of cookies) {
      const eq = entry.indexOf("=");
      if (eq === -1) continue;
      if (entry.slice(0, eq) !== name) continue;
      const raw = entry.slice(eq + 1);
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * @param {string} name
 * @param {unknown} value
 * @param {number} maxAgeSeconds
 */
export function writeCookie(name, value, maxAgeSeconds) {
  try {
    const encoded = encodeURIComponent(String(value ?? ""));
    // biome-ignore lint/suspicious/noDocumentCookie: first paint needs a synchronous cookie write
    document.cookie = `${name}=${encoded}; Max-Age=${maxAgeSeconds}; Path=/; SameSite=Lax`;
  } catch {
    // Sandboxed contexts have no cookie jar.
  }
}

/**
 * @param {string} name
 */
export function expireCookie(name) {
  writeCookie(name, "", 0);
}
