// ABOUTME: A new session target is a store action, not a window event.
// ABOUTME: The shell adopts it in place when the workspace stays the same.

/** @type {Set<(detail: { workspaceId?: string, sessionId?: string, instanceId?: string }) => void>} */
const handlers = new Set();

/** @param {(detail: { workspaceId?: string, sessionId?: string, instanceId?: string }) => void} handler */
export function onSessionCreated(handler) {
  if (typeof handler !== "function") return () => {};
  handlers.add(handler);
  return () => handlers.delete(handler);
}

/** @param {{ workspaceId?: string, sessionId?: string, instanceId?: string }} detail */
export function emitSessionCreated(detail) {
  for (const handler of handlers) handler(detail);
}
