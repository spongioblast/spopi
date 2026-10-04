// ABOUTME: Transcript history mount and snapshot hydration.
// ABOUTME: Hydrate feeds the session runtime, then reconciles the composer model and cost.

import { getLastModel } from "../composer/last-model-store.js";
import { registerQueueSendNow } from "../composer/queued-messages.js";
import { extractAssistantError } from "../session/assistant-error.js";
import { reconcileSnapshotTarget } from "../session/bootstrap-target.js";
import { findLatestAssistantUsage } from "../session/context-usage.js";
import {
  logMessagesDom as logMessagesDomFor,
  summarizeMessageRoles,
} from "../session/session-log.js";
import {
  captureExpandedProcessGroups,
  createProcessDetailsGroup,
  summarizeProcessGroup,
} from "../ui/process-group.js";
import { createHistoryRenderer } from "./history-render.js";
import { registerRetryAbort, registerRetryBanner } from "./retry-banner.js";

let transcriptMarked = false;

function markFirstTranscript() {
  if (transcriptMarked) return;
  transcriptMarked = true;
  try {
    performance.mark("spopi:first-transcript");
  } catch {
    // performance is absent in some non-browser hosts
  }
}

/**
 * @typedef {import("./history-render.js").HistoryMessageRenderer} HistoryMessageRenderer
 * @typedef {import("./history-render.js").HistoryToolRenderer} HistoryToolRenderer
 * @typedef {import("./history-render.js").ProcessDetailsGroup} ProcessDetailsGroup
 *
 * @param {{
 *   workbench: {
 *     refreshPackages?: (() => void) | null,
 *     setContextMessages?: (messages: import("./history-render.js").HistoryEntry[]) => void,
 *   },
 *   messagesElement: HTMLElement,
 *   extensionUi: {
 *     flushForegroundQueue: () => Promise<void> | void,
 *     requeueForegroundPrompt: () => boolean,
 *   },
 *   messageRenderer: HistoryMessageRenderer,
 *   toolRenderer: HistoryToolRenderer,
 *   t: (key: string, params?: Record<string, unknown>) => string,
 *   getTarget: () => {
 *     sessionId: string,
 *     workspaceId?: string,
 *     instanceId?: string,
 *   },
 *   applyActiveSearchHighlight: (options?: { scrollToFirst?: boolean }) => number,
 *   getLiveProcessGroup: () => ProcessDetailsGroup | null,
 *   setLiveProcessGroup: (group: ProcessDetailsGroup | null) => void,
 *   getDiskHistoryFallback: () => { sessionId?: string, messages: unknown[] } | null | undefined,
 *   todoMirrorPanel: { hydrateFromMessages: (messages: unknown[]) => void },
 *   cancelQueueItem: (item: unknown) => void,
 *   convNav: { rebuild: () => void },
 *   setStatus: (status: string, label?: string) => void,
 *   refreshPiPackages: () => Promise<unknown>,
 *   contextUsage: {
 *     setWorking: (working: boolean) => void,
 *     setCompacting: (compacting: boolean) => void,
 *     setUsage: (usage: unknown, contextWindow: unknown) => void,
 *   },
 *   composerModel: { contextWindow?: unknown },
 *   runtime: unknown,
 *   hydrateHeaderSessionStats: () => void,
 *   late: {
 *     adoptTarget: (target: unknown) => Promise<void> | void,
 *     dispatchSnapshot: (snapshot: {
 *       messages: import("./transcript-reducer.js").TranscriptMessage[],
 *       sequence?: number,
 *       streaming?: boolean,
 *     }) => void,
 *     updateComposerModel: (model: unknown) => void,
 *     updateComposerThinking: (level: unknown) => void,
 *     syncComposerWithPi: (options: { piModel?: unknown, inheritLastModel?: boolean }) => Promise<void> | void,
 *   },
 * }} options
 */
export function mountHistory({
  workbench,
  messagesElement,
  extensionUi,
  messageRenderer,
  toolRenderer,
  t,
  getTarget,
  applyActiveSearchHighlight,
  getLiveProcessGroup,
  setLiveProcessGroup,
  getDiskHistoryFallback,
  todoMirrorPanel,
  cancelQueueItem,
  convNav,
  setStatus,
  refreshPiPackages,
  contextUsage,
  composerModel,
  runtime,
  hydrateHeaderSessionStats,
  late,
}) {
  /**
   * @param {string} label
   * @param {Record<string, unknown>} [extra]
   */
  function logMessagesDom(label, extra = {}) {
    logMessagesDomFor(messagesElement, label, extra);
  }

  const historyRenderer = createHistoryRenderer({
    workbench,
    messagesElement,
    extensionUi,
    messageRenderer,
    toolRenderer,
    captureExpandedProcessGroups,
    createProcessDetailsGroup,
    summarizeProcessGroup,
    logMessagesDom,
    t,
    getSessionId: () => getTarget().sessionId,
    applyActiveSearchHighlight,
    extractAssistantError,
    getLiveProcessGroup,
    setLiveProcessGroup,
  });
  const retryRoot = document.createElement("div");
  // The chat column is a two-row grid; a sibling of the messages would land in
  // an extra row under the composer.
  const inputArea = messagesElement.parentElement?.querySelector(":scope > .input-area");
  if (inputArea) inputArea.prepend(retryRoot);
  else messagesElement.before(retryRoot);
  registerRetryBanner(retryRoot, t);
  registerQueueSendNow((item) => {
    void sendQueuedNow(runtime, getTarget, cancelQueueItem, item);
  });
  registerRetryAbort(() => {
    const request =
      /** @type {{ request?: (payload: object, target?: unknown) => Promise<unknown> }} */ (runtime)
        .request;
    if (request) void request({ type: "abort_retry" }, getTarget());
  });
  const {
    renderHistory,
    showLiveProcessIndicator,
    streamHost,
    releaseAnswer,
    adoptStreamingMessage,
    foldStepIntoLiveTurn,
    continueLiveTurnBelow,
    setLiveStep,
    finishLiveTurn,
  } = historyRenderer;

  /**
   * @param {unknown} snapshotMessages
   * @param {string} reason
   * @returns {unknown[]}
   */
  function chooseHydrationMessages(snapshotMessages, reason) {
    const target = getTarget();
    const diskHistoryFallback = getDiskHistoryFallback();
    const messages = Array.isArray(snapshotMessages) ? snapshotMessages : [];
    const fallbackMatches =
      diskHistoryFallback != null && diskHistoryFallback.sessionId === target.sessionId;
    const fallbackCount = fallbackMatches ? diskHistoryFallback.messages.length : 0;
    const source =
      fallbackMatches && messages.length < fallbackCount ? "disk-fallback" : "snapshot";
    console.info("[spopi] session load: hydrate message source", {
      reason,
      currentSessionId: target.sessionId,
      snapshotCount: messages.length,
      snapshotRoles: summarizeMessageRoles(messages),
      fallbackSessionId: diskHistoryFallback?.sessionId ?? null,
      fallbackCount,
      fallbackMatches,
      source,
    });
    return source === "disk-fallback" && diskHistoryFallback != null
      ? diskHistoryFallback.messages
      : messages;
  }

  /**
   * @param {{
   *   target?: { sessionId?: string, workspaceId?: string, instanceId?: string, [key: string]: unknown } | null,
   *   sequence?: number,
   *   state: {
   *     messages?: unknown,
   *     pi?: { isStreaming?: boolean, model?: unknown, thinkingLevel?: string, [key: string]: unknown } | null,
   *     compaction?: { status?: string, [key: string]: unknown } | null,
   *     [key: string]: unknown,
   *   },
   *   [key: string]: unknown,
   * }} snapshot
   */
  const hydrateFromSnapshot = async (snapshot) => {
    const target = getTarget();
    console.info("[spopi] session load: hydrate snapshot received", {
      currentSessionId: target.sessionId,
      snapshotTarget: snapshot?.target ?? null,
      snapshotCount: Array.isArray(snapshot?.state?.messages)
        ? snapshot.state.messages.length
        : null,
    });
    await late.adoptTarget(reconcileSnapshotTarget(target, snapshot.target));
    const messages = chooseHydrationMessages(snapshot.state.messages, "snapshot");
    const pi = snapshot.state.pi ?? {};
    late.dispatchSnapshot({
      messages: /** @type {import("./transcript-reducer.js").TranscriptMessage[]} */ (messages),
      sequence: typeof snapshot.sequence === "number" ? snapshot.sequence : 0,
      streaming: pi.isStreaming === true,
    });
    markFirstTranscript();
    todoMirrorPanel.hydrateFromMessages(messages);
    convNav.rebuild();
    setStatus(pi.isStreaming ? "working" : "connected");
    void refreshPiPackages().then(() => workbench.refreshPackages?.());
    contextUsage.setWorking(Boolean(pi.isStreaming));
    if (pi.isStreaming) showLiveProcessIndicator();
    contextUsage.setCompacting(snapshot.state.compaction?.status === "running");
    // Fresh sessions (no history) show the stored last model straight away so the
    // composer never flashes pi's built-in default; the sync then switches Pi to it
    // and repaints from what Pi reports. Sessions with history keep Pi's own model.
    const fresh = messages.length === 0;
    const storedModel = fresh ? getLastModel() : null;
    late.updateComposerModel(
      storedModel
        ? { provider: storedModel.provider, id: storedModel.modelId }
        : (pi.model ?? null),
    );
    late.updateComposerThinking(pi.thinkingLevel ?? "off");
    void late.syncComposerWithPi({ piModel: pi.model ?? null, inheritLastModel: fresh });
    contextUsage.setUsage(findLatestAssistantUsage(messages), composerModel.contextWindow);
    hydrateHeaderSessionStats();
    // Flush queued extension prompts after rendering is settled so inline cards
    // are not immediately destroyed by a subsequent renderHistory() clear.
    await extensionUi.flushForegroundQueue();
    logMessagesDom("hydrate snapshot rendered", {
      sessionId: target.sessionId,
      renderedCount: messages.length,
    });
    requestAnimationFrame(() => {
      logMessagesDom("hydrate snapshot rendered after frame", {
        sessionId: target.sessionId,
        renderedCount: messages.length,
      });
    });
  };

  return {
    renderHistory,
    showLiveProcessIndicator,
    streamHost,
    releaseAnswer,
    adoptStreamingMessage,
    foldStepIntoLiveTurn,
    continueLiveTurnBelow,
    setLiveStep,
    finishLiveTurn,
    hydrateFromSnapshot,
    logMessagesDom,
  };
}

/**
 * Drop the pill, then steer that text so it runs on the next turn.
 *
 * @param {unknown} runtime
 * @param {() => unknown} getTarget
 * @param {(item: unknown) => unknown} cancelQueueItem
 * @param {{ message?: string }} item
 */
async function sendQueuedNow(runtime, getTarget, cancelQueueItem, item) {
  await cancelQueueItem(item);
  const request =
    /** @type {{ request?: (payload: object, target?: unknown) => Promise<unknown> }} */ (runtime)
      .request;
  if (!request || !item.message) return;
  await request({ type: "steer", message: item.message }, getTarget());
}
