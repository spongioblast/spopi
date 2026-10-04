// ABOUTME: One-shot callbacks for the next agent_settled of the open session.
// ABOUTME: Used to reload MCP after a change that arrived while Pi was busy.

/** @type {Array<() => void>} */
const waiters = [];

/** @param {() => void} fn */
export function onNextSettled(fn) {
  waiters.push(fn);
}

export function notifySettled() {
  const pending = waiters.splice(0);
  for (const fn of pending) fn();
}
