// ABOUTME: What happens once the foreground run settles: status, panels, review card, errors.
// ABOUTME: The review card gets Pi's user entry id from the shadow history once it is written.

import { extractRuntimeEventError } from "../session/assistant-error.js";
import { mountReviewCard } from "./turn-block.js";
import { mergeTurnFiles } from "./turn-files.js";

/**
 * @typedef {{ path: string, add: number, del: number }} TurnFile
 */

/**
 * @param {{
 *   setStatus: (kind: string) => void,
 *   contextUsage: { setWorking: (on: boolean) => void },
 *   getSidebar: () => { setStreaming?: (sessionId: string | undefined, streaming: boolean) => void } | null,
 *   getTarget: () => { workspaceId?: string, sessionId?: string },
 *   getTurns: () => { files?: TurnFile[] }[],
 *   finishLiveTurn: (options: { markDone: boolean }) => void,
 *   gitPanel: { panel?: { notGitRepo?: boolean, refresh: () => unknown } | null } | null | undefined,
 *   files: { hooks: { onSettled: () => void } },
 *   modelConfigRefresh: { onSettled: () => void },
 *   control: { shadowHistoryFiles: (workspaceId: string, sessionId?: string, scope?: string) => Promise<unknown> },
 *   messageRenderer: { renderError: (message: string) => void },
 *   messagesElement: HTMLElement | null,
 *   t: (key: string, params?: Record<string, unknown>) => string,
 * }} deps
 */
export function createForegroundSettle(deps) {
  const { messagesElement, t } = deps;
  let promptTurnStart = 0;
  /** @type {string | null} */
  let lastShownProviderError = null;

  function promptUserEntryId() {
    const nodes = messagesElement?.querySelectorAll(".message.user[data-entry-id]");
    const last = nodes && nodes.length > 0 ? nodes[nodes.length - 1] : null;
    return last instanceof HTMLElement ? last.dataset.entryId || "" : "";
  }

  /** @param {unknown} frame */
  function turnIdOf(frame) {
    const id = /** @type {{ turn?: { userEntryId?: string } }} */ (frame)?.turn?.userEntryId;
    return typeof id === "string" ? id : "";
  }

  async function readSettledTurnId() {
    const load = () => {
      const target = deps.getTarget();
      return deps.control.shadowHistoryFiles(
        target.workspaceId || "",
        target.sessionId || "",
        "turn",
      );
    };
    const ready = turnIdOf(await load().catch(() => null));
    if (ready) return ready;
    await new Promise((resolve) => setTimeout(resolve, 750));
    return turnIdOf(await load().catch(() => null));
  }

  /**
   * @param {TurnFile[]} files
   * @param {string} pending
   */
  async function rekeyTurnReviewCard(files, pending) {
    const id = await readSettledTurnId();
    if (!id || pending !== `turn:pending-${promptTurnStart}`) return;
    const key = `turn:${id}`;
    const placed = messagesElement?.querySelector(`[data-review-key="${CSS.escape(key)}"]`);
    if (placed) {
      const stale = messagesElement?.querySelector(`[data-review-key="${CSS.escape(pending)}"]`);
      stale?.closest(".turn-block-files")?.remove();
      return;
    }
    mountReviewCard(messagesElement, { files, userEntryId: id, key, pendingKey: pending }, t);
  }

  function mountTurnReviewCard() {
    const files = mergeTurnFiles(deps.getTurns().slice(promptTurnStart));
    if (files.length === 0) return;
    const known = promptUserEntryId();
    const pending = `turn:pending-${promptTurnStart}`;
    const key = known ? `turn:${known}` : pending;
    if (messagesElement?.querySelector(`[data-review-key="${CSS.escape(key)}"]`)) return;
    mountReviewCard(messagesElement, { files, userEntryId: known, key, pendingKey: pending }, t);
    if (!known) void rekeyTurnReviewCard(files, pending);
  }

  /** @param {unknown} [event] */
  function showProviderErrorIfNeeded(event) {
    const error = extractRuntimeEventError(
      /** @type {Parameters<typeof extractRuntimeEventError>[0]} */ (event),
      { fallback: t("messages.providerError") },
    );
    if (!error || error === lastShownProviderError) return;
    lastShownProviderError = error;
    deps.messageRenderer.renderError(error);
  }

  /** @param {unknown} [event] */
  function settle(event) {
    deps.setStatus("connected");
    deps.contextUsage.setWorking(false);
    deps.getSidebar()?.setStreaming?.(deps.getTarget().sessionId, false);
    deps.finishLiveTurn({ markDone: true });
    // The Changes dock follows git status; refresh it once per settled turn.
    const gitPanel = deps.gitPanel?.panel;
    if (gitPanel && !gitPanel.notGitRepo) void gitPanel.refresh();
    deps.files.hooks.onSettled();
    mountTurnReviewCard();
    showProviderErrorIfNeeded(event);
    deps.modelConfigRefresh.onSettled();
  }

  return {
    settle,
    showProviderErrorIfNeeded,
    /** @param {string | null} value */
    setLastShownProviderError: (value) => {
      lastShownProviderError = value;
    },
    markTurnStart: () => {
      promptTurnStart = deps.getTurns().length;
    },
  };
}
