// ABOUTME: A new session target is a store action, not a window event.
// ABOUTME: The window adopts it in place when the workspace stays the same, else navigates.

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

/**
 * Same workspace: clear the chat, adopt the session, and hydrate it. Another workspace
 * belongs to another window, so the page navigates there.
 * @param {{
 *   getWorkspaceId: () => string | undefined,
 *   clearChat: () => void,
 *   adoptTarget: (target: { workspaceId: string, sessionId: string, instanceId: string }) => Promise<unknown>,
 *   input: HTMLTextAreaElement | null,
 *   composerAutoResize: { sync: () => void },
 *   hydrateSnapshot: () => Promise<unknown>,
 *   showError: (error: unknown) => void,
 * }} deps
 */
export function adoptCreatedSessions({
  getWorkspaceId,
  clearChat,
  adoptTarget,
  input,
  composerAutoResize,
  hydrateSnapshot,
  showError,
}) {
  return onSessionCreated((detail) => {
    if (!detail?.sessionId || !detail?.workspaceId) return;
    const next = {
      workspaceId: detail.workspaceId,
      sessionId: detail.sessionId,
      instanceId: detail.instanceId || `pending-${detail.sessionId.slice(0, 8)}`,
    };
    if (next.workspaceId !== getWorkspaceId()) {
      // Built from encoded ids against this origin, so it cannot leave it.
      const url = new URL(
        `/app/workspaces/${encodeURIComponent(next.workspaceId)}/sessions/${encodeURIComponent(next.sessionId)}`,
        window.location.origin,
      );
      if (url.origin === window.location.origin) window.location.assign(url.toString());
      return;
    }
    clearChat();
    void adoptTarget(next).then(() => {
      if (!input) return;
      input.value = "";
      composerAutoResize.sync();
      input.focus();
      hydrateSnapshot().catch(showError);
    });
  });
}
