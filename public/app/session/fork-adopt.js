// ABOUTME: Adopts the session Pi switched to after a fork, before Pi has written its file.
// ABOUTME: Rebinds the host registry first, then the window, and adds a sidebar row for it.

/**
 * @typedef {import("../transport/runtime-gateway.js").RuntimeTarget} RuntimeTarget
 * @typedef {{
 *   id?: string,
 *   name?: string,
 *   firstMessage?: string | null,
 *   filePath?: string,
 *   timestamp?: string,
 *   modifiedAtMs?: number,
 *   isCurrentWorkspace?: boolean,
 * }} ForkSidebarSession
 * @typedef {{
 *   sessions?: ForkSidebarSession[],
 *   load?: (opts?: { quiet?: boolean }) => Promise<unknown>,
 *   upsertSession?: (session: ForkSidebarSession) => void,
 * }} ForkSidebar
 */

/**
 * @param {{
 *   runtime: import("../transport/runtime-gateway.js").RuntimeGateway,
 *   getTarget: () => RuntimeTarget,
 *   getSidebar: () => ForkSidebar | null,
 *   adoptTarget: (next: RuntimeTarget, opts?: { updateRoute?: boolean }) => Promise<unknown> | unknown,
 *   hydrateSnapshot: () => Promise<unknown>,
 *   showError: (error: unknown) => void,
 * }} deps
 */
export function createForkAdopt({
  runtime,
  getTarget,
  getSidebar,
  adoptTarget,
  hydrateSnapshot,
  showError,
}) {
  // Pi switches to the forked session as soon as `fork` returns but writes its
  // file only with the first prompt. The settle-time check refreshes from disk.
  /** @type {RuntimeTarget | null} */
  let pendingCheck = null;

  /** @param {{ fromSessionId?: string | null }} [options] */
  async function adopt({ fromSessionId = null } = {}) {
    try {
      const target = getTarget();
      const sidebar = getSidebar();
      const statsResult = /** @type {{ response?: { data?: unknown } } | null | undefined} */ (
        await runtime.request({ type: "get_session_stats" }, target)
      );
      const statsData = /** @type {{ sessionId?: string, sessionFile?: string }} */ (
        statsResult?.response?.data ?? {}
      );
      if (!statsData.sessionId) return;
      if (statsData.sessionId === target.sessionId) {
        await sidebar?.load?.({ quiet: true });
        return;
      }
      // The registry must learn the new id before the window resubscribes to
      // it, or events tagged with the old id stop reaching this window.
      const rebound = await runtime.rebindSession(target, statsData.sessionId);
      if (!rebound) return;
      const parent = sidebar?.sessions?.find((session) => session.id === fromSessionId);
      await adoptTarget(rebound, { updateRoute: true });
      if (fromSessionId) {
        sidebar?.upsertSession?.({
          id: rebound.sessionId,
          filePath: statsData.sessionFile ?? "",
          firstMessage: parent?.name || parent?.firstMessage || null,
          timestamp: new Date().toISOString(),
          modifiedAtMs: Date.now(),
          isCurrentWorkspace: true,
        });
        pendingCheck = { ...getTarget() };
      } else {
        await sidebar?.load?.({ quiet: true });
      }
      await hydrateSnapshot();
    } catch (error) {
      showError(error);
    }
  }

  return {
    adopt,
    getPending: () => pendingCheck,
    /** @param {RuntimeTarget | null} value */
    setPending: (value) => {
      pendingCheck = value;
    },
  };
}
