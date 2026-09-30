// ABOUTME: Tabs drawn before the file tabs, keyed by owner: Review and a subagent's transcript.
// ABOUTME: Showing a file, or another of these tabs, asks the one in front to step aside.

/**
 * @typedef {{
 *   label: string,
 *   icon?: string,
 *   active: boolean,
 *   onSelect: () => void,
 *   onClose: () => void,
 *   onLeave: () => void,
 * }} LeadTab
 */

/** @type {Map<string, LeadTab>} */
const tabs = new Map();
/** @type {Set<() => void>} */
const listeners = new Set();

/**
 * @param {LeadTab | undefined} a
 * @param {LeadTab | null} b
 */
function same(a, b) {
  if (!a || !b) return a == null && b == null;
  return (
    a.label === b.label &&
    a.icon === b.icon &&
    a.active === b.active &&
    a.onSelect === b.onSelect &&
    a.onClose === b.onClose &&
    a.onLeave === b.onLeave
  );
}

/**
 * @param {string} id
 * @param {LeadTab | null} next
 */
export function setLeadTab(id, next) {
  if (same(tabs.get(id), next)) return;
  if (next) tabs.set(id, next);
  else tabs.delete(id);
  for (const listener of listeners) listener();
}

/** @param {string} id */
export function leadTab(id) {
  return tabs.get(id) || null;
}

export function leadTabs() {
  return [...tabs.entries()];
}

export function leadTabActive() {
  return [...tabs.values()].some((tab) => tab.active);
}

/**
 * Everything in front steps aside, except the owner that is about to show itself.
 * @param {string} [except]
 */
export function leaveLeadTab(except) {
  for (const [id, tab] of [...tabs.entries()]) {
    if (id !== except && tab.active) tab.onLeave();
  }
}

/** @param {() => void} listener */
export function onLeadTabChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
