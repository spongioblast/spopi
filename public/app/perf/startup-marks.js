// ABOUTME: One-shot startup marks the workspace perf script reads.
// ABOUTME: Repeating a name is ignored so reloads and remounts stay comparable.

const seen = new Set();

/** @param {string} name */
export function markStartup(name) {
  if (seen.has(name)) return;
  seen.add(name);
  try {
    performance.mark(name);
  } catch {
    // performance is absent in some non-browser hosts
  }
}
