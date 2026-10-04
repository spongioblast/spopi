// ABOUTME: Lets a page hear extension notify messages that also go to the chat.
// ABOUTME: Observers see only notices that were not swallowed as data.

/** @type {Set<(notice: { message?: string, notifyType?: string }) => void>} */
const observers = new Set();

/**
 * @param {(notice: { message?: string, notifyType?: string }) => void} fn
 * @returns {() => void}
 */
export function observeExtensionNotify(fn) {
  observers.add(fn);
  return () => observers.delete(fn);
}

/** @param {{ message?: string, notifyType?: string }} notice */
export function emitExtensionNotify(notice) {
  for (const fn of observers) fn(notice);
}
