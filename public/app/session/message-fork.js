// ABOUTME: Fork and Edit on user bubbles: resolve the Pi entry id, then fork or rewind.
// ABOUTME: A fork is adopted at once so the new session shows in the sidebar immediately.

import { setMessageActionDispatch } from "../chat/message-actions.js";
import { registerTreeEdit } from "./session-tree-host.js";

/**
 * @typedef {{ type: string, entryId?: string | null, text?: string, messageEl?: Element | null }} MessageAction
 * @typedef {{ workspaceId?: string, sessionId?: string, instanceId?: string }} RuntimeTarget
 * @typedef {{
 *   response?: {
 *     data?: {
 *       messages?: Array<{ entryId?: string }>,
 *       cancelled?: boolean,
 *       text?: string,
 *     },
 *   },
 * }} RuntimeRequestResult
 * @typedef {{
 *   request: (
 *     cmd: object,
 *     target?: RuntimeTarget,
 *     opts?: object,
 *   ) => Promise<RuntimeRequestResult>,
 * }} RuntimeClient
 */

/**
 * Entry id from the action, else the nth user bubble's id from get_fork_messages.
 * @param {MessageAction} action
 * @param {object} options
 * @param {Element} options.messagesElement
 * @param {RuntimeClient} options.runtime
 * @param {() => RuntimeTarget} options.getTarget
 */
async function resolveEntryId(action, { messagesElement, runtime, getTarget }) {
  const given = action.entryId;
  if (given) return given;
  const messageEl = action.messageEl?.closest?.(".message.user") ?? null;
  const index = messageEl
    ? [...messagesElement.querySelectorAll(".message.user")].indexOf(messageEl)
    : -1;
  if (index < 0) return null;
  const forkMessages = await runtime.request({ type: "get_fork_messages" }, getTarget());
  return forkMessages?.response?.data?.messages?.[index]?.entryId ?? null;
}

/**
 * @param {HTMLTextAreaElement | HTMLInputElement} input
 * @param {{ sync: () => void }} composerAutoResize
 * @param {unknown} text
 */
function prefill(input, composerAutoResize, text) {
  if (typeof text !== "string" || !text) return;
  input.value = text;
  composerAutoResize.sync();
  input.focus();
}

/**
 * @param {object} options
 * @param {Element} options.messagesElement
 * @param {() => { lifecycle?: string }} options.getStore
 * @param {() => RuntimeTarget & { sessionId?: string }} options.getTarget
 * @param {RuntimeClient} options.runtime
 * @param {() => string} options.randomId
 * @param {(error: unknown) => void} options.showError
 * @param {(key: string, params?: object) => string} options.t
 * @param {() => { sessionId?: string } | null | undefined} options.getDiskHistoryFallback
 * @param {(value: null) => void} options.setDiskHistoryFallback
 * @param {() => Promise<void> | void} options.hydrateSnapshotOnce
 * @param {((opts: { fromSessionId?: string }) => Promise<void> | void) | null | undefined} [options.adoptForkedSession]
 * @param {(entryId: string) => Promise<void> | void} options.navigateTree
 * @param {HTMLTextAreaElement | HTMLInputElement} options.input
 * @param {{ sync: () => void }} options.composerAutoResize
 */
export function mountMessageForkHandler({
  messagesElement,
  getStore,
  getTarget,
  runtime,
  randomId,
  showError,
  t,
  getDiskHistoryFallback,
  setDiskHistoryFallback,
  hydrateSnapshotOnce,
  adoptForkedSession,
  navigateTree,
  input,
  composerAutoResize,
}) {
  const invalid = () =>
    showError(new Error(t("errors.treeNavigateFailed", { error: "Invalid entry ID for forking" })));
  const busy = () => {
    if (getStore().lifecycle !== "working") return false;
    showError(new Error(t("infoPanel.actionWhileStreaming")));
    return true;
  };
  const deps = { messagesElement, runtime, getTarget };
  const unbind = setMessageActionDispatch(async (action) => {
    if (action?.type === "message.fork") {
      if (busy()) return;
      try {
        const entryId = await resolveEntryId(action, deps);
        if (!entryId) return invalid();
        const result = await runtime.request({ type: "fork", entryId }, getTarget(), {
          idempotencyKey: randomId(),
        });
        const data = result?.response?.data;
        if (data?.cancelled) return;
        const from = getTarget();
        if (getDiskHistoryFallback()?.sessionId === from.sessionId) setDiskHistoryFallback(null);
        if (adoptForkedSession) await adoptForkedSession({ fromSessionId: from.sessionId });
        else await hydrateSnapshotOnce();
        prefill(input, composerAutoResize, data?.text);
      } catch (error) {
        showError(error);
      }
      return;
    }
    if (action?.type !== "message.edit") return;
    if (busy()) return;
    try {
      const entryId = await resolveEntryId(action, deps);
      if (!entryId) return invalid();
      await navigateTree(entryId);
      prefill(input, composerAutoResize, action.text);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showError(new Error(t("errors.treeNavigateFailed", { error: message })));
    }
  });

  registerTreeEdit((entryId, text) => {
    if (busy()) return;
    runtime
      .request({ type: "fork", entryId }, getTarget(), { idempotencyKey: randomId() })
      .then(async (result) => {
        const data = result?.response?.data;
        if (data?.cancelled) return;
        const from = getTarget();
        if (getDiskHistoryFallback()?.sessionId === from.sessionId) setDiskHistoryFallback(null);
        if (adoptForkedSession) await adoptForkedSession({ fromSessionId: from.sessionId });
        else await hydrateSnapshotOnce();
        prefill(input, composerAutoResize, text || data?.text);
      })
      .catch((error) => showError(error));
  });

  return {
    destroy() {
      unbind();
    },
  };
}
