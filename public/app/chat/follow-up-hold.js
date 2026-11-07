// ABOUTME: Holds follow-up messages until the current run has settled, then releases one.
// ABOUTME: Steering still goes to Pi at once. Only Send now interrupts a running turn.

/**
 * @typedef {{ message: string, images?: unknown[] }} HeldFollowUp
 */

/** @type {Map<string, HeldFollowUp[]>} */
const bySession = new Map();
/** @type {Set<() => void>} */
const listeners = new Set();
/** @type {() => number} */
let piFollowUpCount = () => 0;

/** @param {() => number} read */
export function setPiFollowUpCount(read) {
  piFollowUpCount = typeof read === "function" ? read : () => 0;
}

export function currentPiFollowUpCount() {
  return piFollowUpCount();
}

function emit() {
  for (const listener of listeners) listener();
}

/**
 * @param {string} sessionId
 */
function bucket(sessionId) {
  const id = String(sessionId || "");
  let list = bySession.get(id);
  if (!list) {
    list = [];
    bySession.set(id, list);
  }
  return list;
}

/**
 * @param {() => void} listener
 */
export function onHeldFollowUps(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The held messages for display, newest last. Images are carried on delivery, not shown here.
 * @param {string} sessionId
 * @returns {string[]}
 */
export function heldFollowUps(sessionId) {
  return (bySession.get(String(sessionId || "")) ?? []).map((entry) => entry.message);
}

/**
 * @param {string} sessionId
 * @param {unknown} message
 * @param {unknown[] | null | undefined} [images]
 */
export function holdFollowUp(sessionId, message, images) {
  const text = String(message ?? "").trim();
  if (!text || !sessionId) return;
  const entry = /** @type {HeldFollowUp} */ ({ message: text });
  if (Array.isArray(images) && images.length) entry.images = images.slice();
  bucket(sessionId).push(entry);
  emit();
}

/**
 * @param {string} sessionId
 * @returns {HeldFollowUp | undefined}
 */
export function takeNextFollowUp(sessionId) {
  const list = bySession.get(String(sessionId || ""));
  if (!list?.length) return undefined;
  const next = list.shift();
  emit();
  return next;
}

/**
 * Take every held message for a session, clearing them. Used when a run is stopped.
 * @param {string | null | undefined} sessionId
 * @returns {HeldFollowUp[]}
 */
export function drainHeldFollowUps(sessionId) {
  const id = String(sessionId || "");
  const list = bySession.get(id);
  if (!list?.length) return [];
  bySession.set(id, []);
  emit();
  return list;
}

/**
 * Put an entry back at the front after a failed send.
 * @param {string} sessionId
 * @param {HeldFollowUp} entry
 */
export function restoreFollowUp(sessionId, entry) {
  if (!sessionId || !entry) return;
  bucket(sessionId).unshift(entry);
  emit();
}

/**
 * Send the next held follow-up. A failed send goes back to the front.
 * @param {string | null | undefined} sessionId
 * @param {(entry: HeldFollowUp) => Promise<unknown>} send
 */
export async function deliverNextFollowUp(sessionId, send) {
  const id = String(sessionId || "");
  const next = takeNextFollowUp(id);
  if (!next) return;
  try {
    await send(next);
  } catch (error) {
    restoreFollowUp(id, next);
    throw error;
  }
}

/**
 * @param {string} sessionId
 * @param {number} mergedIndex index in the combined follow-up list (Pi's, then held)
 * @param {number} piCount how many follow-ups Pi already holds
 * @param {unknown} message
 */
export function removeHeldFollowUp(sessionId, mergedIndex, piCount, message) {
  const list = bySession.get(String(sessionId || ""));
  if (!list) return false;
  const local = mergedIndex - piCount;
  if (local < 0 || local >= list.length || list[local].message !== message) return false;
  list.splice(local, 1);
  emit();
  return true;
}

/**
 * @param {string} sessionId
 * @param {number} mergedFrom
 * @param {number} mergedTo
 * @param {number} piCount
 * @param {unknown} message
 */
export function moveHeldFollowUp(sessionId, mergedFrom, mergedTo, piCount, message) {
  const list = bySession.get(String(sessionId || ""));
  if (!list) return false;
  const from = mergedFrom - piCount;
  const to = mergedTo - piCount;
  if (from < 0 || to < 0 || from >= list.length || to >= list.length || from === to) return false;
  if (list[from].message !== message) return false;
  const [moved] = list.splice(from, 1);
  list.splice(to, 0, moved);
  emit();
  return true;
}
