// ABOUTME: Resolves the workspace and session to open when the app boots.
// ABOUTME: A missing session can spawn a temporary one.

/**
 * Resolve the runtime target for a session route.
 *
 * Temporary session ids are process-local: they are intentionally never
 * persisted. A route can therefore outlive the host process that created it
 * after an app update, crash, or a second SPOPI instance starts. In that case,
 * recover by creating a new temporary runtime for the same workspace.
 *
 * With `replaceMissing` (the page's own start), a saved id the host no longer
 * has is recovered the same way: Pi writes a session file only after the first
 * message, so an empty session whose runtime stopped leaves nothing to resume,
 * and a deleted session can still be in the address bar.
 */
/**
 * @param {{
 *   route: { workspaceId?: string, sessionId?: string },
 *   requestTarget: (route: { workspaceId?: string, sessionId?: string }) => Promise<unknown>,
 *   spawnTemporarySession: (workspaceId?: string) => Promise<unknown>,
 *   replaceMissing?: boolean,
 * }} options
 */
export async function resolveBootstrapTarget({
  route,
  requestTarget,
  spawnTemporarySession,
  replaceMissing = false,
}) {
  try {
    return await requestTarget(route);
  } catch (error) {
    const recover =
      isMissingTemporarySession(route, error) || (replaceMissing && isMissingSession(error));
    if (!recover) throw error;
    return spawnTemporarySession(route.workspaceId);
  }
}

/**
 * Only the session is gone; a missing workspace or a failed spawn still reports.
 * @param {unknown} error
 */
function isMissingSession(error) {
  if (!error || typeof error !== "object") return false;
  const record = /** @type {{ status?: unknown, code?: unknown }} */ (error);
  return record.status === 404 && record.code === "session_not_found";
}

/**
 * @param {{ sessionId?: string } | null | undefined} route
 * @param {unknown} error
 */
function isMissingTemporarySession(route, error) {
  const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
  return route?.sessionId?.startsWith("temporary-") && status === 404;
}
