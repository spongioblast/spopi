// ABOUTME: In-window session switch paints from one get_tree call.
// ABOUTME: A newer navigationGeneration must abort a stale paint.

import { appRoutePath } from "../utils/router.js";
import { bindSessionTreeModel, branchMessages, sessionTreeModel } from "./session-tree-host.js";

/**
 * @typedef {{
 *   getTarget: () => { workspaceId: string, sessionId: string },
 *   nextGeneration: () => number,
 *   getGeneration: () => number,
 *   setStatus: (kind: string) => void,
 *   loadBootstrapTarget: (route: { name: string, workspaceId: string, sessionId: string }) => Promise<object>,
 *   setDiskHistoryFallback: (value: null) => void,
 *   renderHistory: (messages: Array<object>) => boolean,
 *   convNav: { rebuild: () => void },
 *   adoptTarget: (target: object, opts?: { updateRoute?: boolean }) => Promise<void>,
 *   history: { pushState: (state: null, title: string, url: string) => void },
 *   extensionUi: { flushForegroundQueue: () => Promise<void> },
 *   runtime: { request: (cmd: object, target?: object) => Promise<unknown> },
 * }} SwitchSessionContext
 */

/**
 * @param {string} sessionId
 * @param {SwitchSessionContext} ctx
 * @returns {Promise<void>}
 */
export async function switchSessionTo(sessionId, ctx) {
  if (!sessionId || sessionId === ctx.getTarget().sessionId) return;
  const generation = ctx.nextGeneration();
  ctx.setStatus("loading");
  const workspaceId = ctx.getTarget().workspaceId;
  const nextTarget = await ctx.loadBootstrapTarget({ name: "session", workspaceId, sessionId });
  if (generation !== ctx.getGeneration()) return;
  ctx.setDiskHistoryFallback(null);
  await ctx.adoptTarget(nextTarget, { updateRoute: false });
  const target = ctx.getTarget();
  ctx.history.pushState(
    null,
    "",
    appRoutePath({ name: "session", workspaceId: target.workspaceId, sessionId: target.sessionId }),
  );
  ctx.setStatus("connected");
  try {
    const treeModel =
      sessionTreeModel() ||
      bindSessionTreeModel({
        request: (cmd, next) => ctx.runtime.request(cmd, /** @type {object} */ (next)),
        getTarget: () => ctx.getTarget(),
      });
    await treeModel.load();
    if (generation !== ctx.getGeneration()) return;
    const hadInFlightPrompt = ctx.renderHistory(branchMessages());
    ctx.convNav.rebuild();
    if (hadInFlightPrompt) await ctx.extensionUi.flushForegroundQueue();
  } catch (error) {
    if (generation !== ctx.getGeneration()) return;
    console.warn("[switchSession] get_tree failed:", error);
    ctx.setStatus("connected");
  }
}
