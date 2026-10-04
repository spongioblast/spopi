// ABOUTME: The only place the UI asks whether a client may show a control.
// ABOUTME: The host still refuses the action when the device tier does not allow it.

/** The list from the last hello reply; unknown until the host answers. */
let current = /** @type {{ capabilities?: string[] }} */ ({});

/**
 * @param {{ capabilities?: string[] } | null | undefined} state
 * @param {string} name
 */
export function can(state, name) {
  const list = state?.capabilities;
  if (!Array.isArray(list)) return true;
  return list.includes(name);
}

/** What this window's connection may do, as of the last hello reply. @param {string} name */
export function canHere(name) {
  return can(current, name);
}

/** @param {string[] | undefined} list */
export function applyCapabilities(list) {
  const state = { capabilities: Array.isArray(list) ? list : undefined };
  current = state;
  const root = document.body;
  if (!root) return state;
  root.dataset.capTerminal = can(state, "terminal") ? "1" : "0";
  root.dataset.capGitWrite = can(state, "git_write") ? "1" : "0";
  return state;
}
