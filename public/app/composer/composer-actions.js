// ABOUTME: Selection-to-chat and inline edit are composer store actions.
// ABOUTME: The editor and the terminal emit them; the shell subscribes.

/** @type {Set<(detail: Record<string, unknown>) => void>} */
const inserts = new Set();
/** @type {Set<(detail: Record<string, unknown>) => void>} */
const edits = new Set();

/** @param {(detail: Record<string, unknown>) => void} handler */
export function setComposerInsert(handler) {
  if (typeof handler !== "function") return () => {};
  inserts.add(handler);
  return () => inserts.delete(handler);
}

/** @param {(detail: Record<string, unknown>) => void} handler */
export function setInlineEdit(handler) {
  if (typeof handler !== "function") return () => {};
  edits.add(handler);
  return () => edits.delete(handler);
}

/** @param {Record<string, unknown>} detail */
export function insertSelection(detail) {
  if (!detail?.text) return false;
  for (const handler of inserts) handler(detail);
  return true;
}

/** @param {Record<string, unknown>} detail */
export function requestInlineEdit(detail) {
  if (!detail) return false;
  for (const handler of edits) handler(detail);
  return true;
}
