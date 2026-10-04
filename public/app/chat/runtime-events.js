// ABOUTME: Foreground Pi runtime events: stream, tools, settle, fork consume.
// ABOUTME: Deferred start queues connect-time events so app.js never hits a TDZ handler.

import { applyThinkingLevelChanged } from "../composer/model-controls.js";
import { t } from "../i18n/i18n.js";
import { phaseLabel } from "../metrics/metrics-overlay.js";
import { noteExtensionError } from "../packages/extension-errors.js";
import {
  applyTreeAppend,
  refreshSessionTree,
  sessionTreeModel,
  startSessionTreeModel,
} from "../session/session-tree-host.js";
import { customMessageNote } from "./custom-message-note.js";
import { liveLabel } from "./live-label.js";
import { notifySettled } from "./on-next-settled.js";

/**
 * @typedef {{
 *   role?: string,
 *   content?: unknown,
 *   usage?: { output?: number, cacheRead?: number, cost?: { total?: number } },
 *   stopReason?: string,
 *   stop_reason?: string,
 * }} RuntimeEventMessage
 *
 * @typedef {{
 *   type?: string,
 *   toolName?: string,
 *   name?: string,
 *   tool?: string,
 *   result?: unknown,
 *   data?: unknown,
 *   message?: RuntimeEventMessage | string,
 *   errorMessage?: string,
 *   error?: string,
 *   aborted?: boolean,
 *   partialResult?: unknown,
 *   toolCallId?: string,
 *   parentToolCallId?: string,
 *   args?: unknown,
 *   method?: string,
 *   id?: string,
 *   level?: string,
 *   entry?: unknown,
 *   isError?: boolean,
 *   sessionId?: string,
 *   reason?: string,
 *   willRetry?: boolean,
 * }} RuntimeEventFrame
 *
 * @typedef {{
 *   workspaceId?: string,
 *   sessionId?: string,
 *   instanceId?: string,
 * }} RuntimeEventTarget
 *
 * @typedef {{
 *   sessionRuntime?: {
 *     dispatch?: (action: { type: string, event: RuntimeEventFrame }) => void,
 *     getState?: () => import("./live-label.js").LiveState | null | undefined,
 *   },
 *   metricsOverlay: {
 *     onRuntimeEvent: (event: RuntimeEventFrame) => void,
 *     phase?: () => string | null | undefined,
 *   },
 *   workbench: {
 *     noteLensResult: (name: unknown, result: unknown) => void,
 *     live?: { hide: () => void, show: (label: string) => void },
 *     noteTurnMeta?: (element: unknown, meta: Record<string, unknown>) => void,
 *     noteUserTurnActions?: (element: unknown, send: (command: string) => void) => void,
 *     refreshPackageHealth?: (target?: RuntimeEventTarget | null) => void,
 *     refreshHistory?: () => Promise<void> | void,
 *   },
 *   getTarget: () => RuntimeEventTarget,
 *   setLastShownProviderError: (value: unknown) => void,
 *   assistantMessageStream: {
 *     reset: () => void,
 *     start: (message: unknown) => RuntimeEventMessage,
 *     update: (event: RuntimeEventFrame) => RuntimeEventMessage,
 *     finish: (message: unknown) => RuntimeEventMessage,
 *   },
 *   contextUsage: {
 *     setWorking: (working: boolean) => void,
 *     setUsage: (usage: unknown, contextWindow: unknown) => void,
 *   },
 *   getSidebar: () => {
 *     setStreaming: (sessionId: string | undefined, streaming: boolean) => void,
 *     setSessionName: (sessionId: string | undefined, name: unknown) => void,
 *     load: (opts: { quiet?: boolean }) => Promise<unknown>,
 *   } | null | undefined,
 *   setTurnWrittenPaths: (paths: unknown[]) => void,
 *   settleForegroundAgent: (event: RuntimeEventFrame) => void,
 *   getPendingForkSwitchCheck: () => RuntimeEventTarget | null | undefined,
 *   setPendingForkSwitchCheck: (value: null) => void,
 *   checkAndAdoptForkedSession: () => unknown,
 *   compactCoordinator: {
 *     started: () => void,
 *     ended: (info: { success: boolean, error: unknown }) => void,
 *   },
 *   showError: (error: Error) => void,
 *   hydrateSnapshotOnce: () => Promise<void> | void,
 *   hydrateHeaderSessionStats: () => void,
 *   setLastUserElement: (el: unknown) => void,
 *   messageRenderer: {
 *     renderUserMessage: (message: unknown) => unknown,
 *     renderAssistantMessage: (
 *       message: unknown,
 *       streaming: boolean,
 *       history?: boolean,
 *       targetContainer?: HTMLElement | null,
 *     ) => unknown,
 *     updateStreamingMessage: (element: unknown, content: unknown) => void,
 *     finalizeStreamingMessage: (
 *       element: unknown,
 *       usage: unknown,
 *       text: string,
 *       durationMs: number | null,
 *     ) => void,
 *     renderSystemMessage?: (text: string) => void,
 *   },
 *   upsertActiveSessionFromUserMessage: (message?: unknown) => void,
 *   showLiveProcessIndicator: () => void,
 *   liveTurn?: {
 *     host: () => HTMLElement | null,
 *     release: (element: HTMLElement) => void,
 *     adopt: (element: HTMLElement) => void,
 *     fold: (element: HTMLElement) => void,
 *     step: (text: string) => void,
 *   },
 *   setStreaming: (startedAt: number | null, element: unknown) => void,
 *   getStreaming: () => { element?: unknown, startedAt?: number | null },
 *   getCurrentModelContextWindow: () => unknown,
 *   getCurrentModelId: () => unknown,
 *   getCurrentModelProvider: () => unknown,
 *   convNav: { notifyNewMessage: () => void },
 *   showProviderErrorIfNeeded: (event: RuntimeEventFrame) => void,
 *   getInfoSidebar: () => { classList: { contains: (name: string) => boolean } } | null | undefined,
 *   refreshInfoPanel: () => unknown,
 *   getLastUserElement: () => unknown,
 *   runtime: {
 *     request: (
 *       cmd: Record<string, unknown>,
 *       target: RuntimeEventTarget,
 *       opts?: Record<string, unknown>,
 *     ) => unknown,
 *   },
 *   randomId: () => string,
 *   toolRenderer: {
 *     createToolCard: (card: Record<string, unknown>) => void,
 *     updateToolCard: (card: Record<string, unknown>) => void,
 *     finalizeToolCard: (toolCallId: unknown, result: unknown, isError: unknown) => void,
 *     upsertNestedCall?: (parentId: string, call: Record<string, unknown>) => void,
 *   },
 *   filePreviewFollow: {
 *     onToolStart: (event: RuntimeEventFrame) => void,
 *     onToolEnd: (event: RuntimeEventFrame) => Promise<unknown>,
 *   },
 *   textFromResult: (result: unknown) => string,
 *   todoMirrorPanel: { applyToolResult: (result: unknown) => boolean },
 *   extensionUi: {
 *     handle: (target: RuntimeEventTarget, event: RuntimeEventFrame) => Promise<void> | void,
 *     resolveFromHost?: (id: string) => void,
 *   },
 *   adoptTarget: (target: RuntimeEventTarget) => Promise<void> | void,
 *   sessionStatus?: {
 *     setWaiting: (waiting: boolean) => void,
 *     isWaiting: () => boolean,
 *   },
 *   updateComposerThinking?: (level: unknown) => void,
 *   t: (key: string, params?: Record<string, unknown>) => string,
 *   messagesElement?: { append: (...nodes: Node[]) => void } | null,
 *   setStatus: (status: string, label?: string) => void,
 * }} RuntimeEventHandlerCtx
 */

const seenUnknownTypes = new Set();
const WAITING_UI_METHODS = new Set(["select", "confirm", "input", "editor"]);

/** @param {unknown} value @returns {Record<string, unknown> | null} */
function asRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return /** @type {Record<string, unknown>} */ (value);
}

/** @param {RuntimeEventFrame} event */
function lensToolPayload(event) {
  const result = event.result ?? event.data ?? null;
  if (!event.isError) return result;
  const record = asRecord(result);
  if (record) return { ...record, isError: true };
  return { isError: true, message: typeof result === "string" ? result : "" };
}

/**
 * A call a tool made (codemode). It is drawn on the parent card, not as its own card.
 * @param {RuntimeEventHandlerCtx} ctx
 * @param {RuntimeEventFrame} event
 * @param {string} status
 */
function showNestedCall(ctx, event, status) {
  ctx.toolRenderer.upsertNestedCall?.(String(event.parentToolCallId), {
    id: String(event.toolCallId ?? ""),
    name: String(event.toolName ?? ""),
    status,
    isError: Boolean(event.isError),
    args: event.args,
  });
}

/**
 * A new assistant step: the turn's work row exists first, the message renders below it,
 * and its thinking streams into the row.
 * @param {RuntimeEventHandlerCtx} ctx
 * @param {{ content?: unknown }} message
 */
function startStreamingStep(ctx, message) {
  ctx.showLiveProcessIndicator();
  const host = ctx.liveTurn?.host() ?? null;
  const element = ctx.messageRenderer.renderAssistantMessage(message, true, false, host);
  ctx.liveTurn?.adopt(/** @type {HTMLElement} */ (element));
  if (element) ctx.messageRenderer.updateStreamingMessage(element, message.content);
  ctx.setStreaming(Date.now(), element);
}

/**
 * @param {string} key
 * @param {string} fallback
 * @param {(key: string, params?: Record<string, unknown>) => string} t
 * @param {string} [target]
 */
function say(key, fallback, t, target = "") {
  const value = t(key, { target });
  const text = value && value !== key ? value : fallback;
  return text.replace("{target}", target);
}

/**
 * @param {unknown} content
 * @param {(key: string, params?: Record<string, unknown>) => string} t
 */
function streamingPhaseLabel(content, t) {
  const blocks = Array.isArray(content) ? content : [];
  const hasText = blocks.some(
    (block) => block?.type === "text" && String(block.text || "").trim().length > 0,
  );
  if (hasText || typeof content === "string") {
    return say("chat.live.answering", "Writing the answer", t);
  }
  return say("chat.live.thinking", "Thinking", t);
}

/**
 * @param {RuntimeEventFrame} event
 * @param {(key: string, params?: Record<string, unknown>) => string} t
 */
function toolStepLabel(event, t) {
  const name = String(event.toolName || "");
  const args = asRecord(/** @type {{ args?: unknown }} */ (event).args) || {};
  const path = String(args.path || args.file_path || args.filePath || "");
  const file = path.split(/[\\/]/).pop() || path;
  const lower = name.toLowerCase();
  if (lower === "read") return say("chat.live.reading", "Reading {target}", t, file);
  if (lower === "write") return say("chat.live.writing", "Writing {target}", t, file);
  if (lower === "edit") return say("chat.live.editing", "Editing {target}", t, file);
  if (lower === "bash") {
    const command = String(args.command || "")
      .split("\n")[0]
      .slice(0, 48);
    return say("chat.live.running", "Running {target}", t, command);
  }
  return say("chat.live.tool", "Using {target}", t, name);
}

/** Queue events until start() so adapter.connect cannot hit a TDZ handler. */
export function createDeferredRuntimeHandler() {
  /** @type {((event: RuntimeEventFrame) => void | Promise<void>) | null} */
  let impl = null;
  /** @type {RuntimeEventFrame[]} */
  const pending = [];
  /** @param {RuntimeEventFrame} event */
  async function handle(event) {
    if (!impl) {
      pending.push(event);
      return;
    }
    return impl(event);
  }
  /** @param {(event: RuntimeEventFrame) => void | Promise<void>} nextImpl */
  handle.start = (nextImpl) => {
    impl = nextImpl;
    for (const event of pending.splice(0)) handle(event);
  };
  return handle;
}

/** @param {RuntimeEventHandlerCtx} ctx */
export function createRuntimeEventHandler(ctx) {
  if (!sessionTreeModel() && ctx.runtime?.request && ctx.getTarget) {
    startSessionTreeModel({
      request: (cmd, target) =>
        Promise.resolve(ctx.runtime.request(cmd, target ?? ctx.getTarget())),
      getTarget: () => ctx.getTarget(),
    });
  }
  // Pi's assistant message_start arrives once the response opens, so TTFT is measured from
  // turn_start (the model call going out) to the first message_update.
  /** @type {number | null} */
  let callSentAt = null;
  /** @type {number | null} */
  let firstTokenAt = null;
  /** @param {RuntimeEventFrame} event */
  return async function handleRuntimeEvent(event) {
    ctx.sessionRuntime?.dispatch?.({ type: "rpc", event });
    ctx.metricsOverlay.onRuntimeEvent(event);
    const target = ctx.getTarget();
    switch (event.type) {
      case "turn_start":
        callSentAt = Date.now();
        firstTokenAt = null;
        break;
      case "agent_start":
        ctx.setLastShownProviderError(null);
        ctx.assistantMessageStream.reset();
        ctx.contextUsage.setWorking(true);
        ctx.getSidebar()?.setStreaming(target.sessionId, true);
        ctx.setTurnWrittenPaths([]);
        break;
      case "agent_settled": {
        notifySettled();
        ctx.workbench.live?.hide();
        ctx.settleForegroundAgent(event);
        const pending = ctx.getPendingForkSwitchCheck();
        if (
          pending &&
          pending.workspaceId === target.workspaceId &&
          pending.sessionId === target.sessionId &&
          pending.instanceId === target.instanceId
        ) {
          ctx.setPendingForkSwitchCheck(null);
          void ctx.checkAndAdoptForkedSession();
        }
        void refreshSessionTree(ctx);
        break;
      }
      case "agent_end":
        ctx.settleForegroundAgent(event);
        break;
      case "session_info_changed":
        ctx.getSidebar()?.setSessionName(target.sessionId, event.name);
        void refreshSessionTree(ctx);
        break;
      case "compaction_start":
        ctx.compactCoordinator.started();
        break;
      case "compaction_end": {
        const succeeded =
          !event.errorMessage && !event.error && !event.aborted && event.result !== null;
        ctx.compactCoordinator.ended({
          success: succeeded,
          error: event.errorMessage || event.error,
        });
        if (!succeeded) {
          const error = event.errorMessage || event.error;
          if (error) ctx.showError(new Error(error));
        } else {
          await ctx.hydrateSnapshotOnce();
          ctx.hydrateHeaderSessionStats();
        }
        break;
      }
      case "message_start": {
        const startMessage = event.message;
        if (startMessage && typeof startMessage === "object" && startMessage.role === "user") {
          ctx.setLastUserElement(ctx.messageRenderer.renderUserMessage(startMessage));
          ctx.upsertActiveSessionFromUserMessage(startMessage);
        } else if (
          startMessage &&
          typeof startMessage === "object" &&
          startMessage.role === "assistant"
        ) {
          const message = ctx.assistantMessageStream.start(startMessage);
          startStreamingStep(ctx, message);
        }
        break;
      }
      case "message_update": {
        const message = ctx.assistantMessageStream.update(event);
        firstTokenAt ??= Date.now();
        const streaming = ctx.getStreaming();
        if (!streaming.element) startStreamingStep(ctx, message);
        else ctx.messageRenderer.updateStreamingMessage(streaming.element, message.content);
        ctx.liveTurn?.step(streamingPhaseLabel(message.content, ctx.t));
        break;
      }
      case "message_end": {
        const endMessage = event.message;
        if (endMessage && typeof endMessage === "object" && endMessage.role === "assistant") {
          const message = ctx.assistantMessageStream.finish(endMessage);
          const streaming = ctx.getStreaming();
          if (streaming.element) {
            const durationMs =
              streaming.startedAt != null ? Date.now() - streaming.startedAt : null;
            ctx.messageRenderer.updateStreamingMessage(streaming.element, message.content);
            ctx.messageRenderer.finalizeStreamingMessage(
              streaming.element,
              message.usage ?? null,
              "",
              durationMs,
            );
            ctx.contextUsage.setUsage(message.usage ?? null, ctx.getCurrentModelContextWindow());
            ctx.hydrateHeaderSessionStats();
            const stopReason = String(endMessage.stopReason || endMessage.stop_reason || "");
            const toolStep = /tool/i.test(stopReason);
            if (toolStep) ctx.liveTurn?.fold(/** @type {HTMLElement} */ (streaming.element));
            else ctx.liveTurn?.release(/** @type {HTMLElement} */ (streaming.element));
            const ttftMs =
              callSentAt != null && firstTokenAt != null ? firstTokenAt - callSentAt : undefined;
            const decodeMs = firstTokenAt != null ? Date.now() - firstTokenAt : durationMs;
            callSentAt = null;
            firstTokenAt = null;
            if (!toolStep)
              ctx.workbench.noteTurnMeta?.(streaming.element, {
                ttftMs,
                outputTokens: message.usage?.output,
                tokensPerSec:
                  message.usage?.output && decodeMs
                    ? message.usage.output / (decodeMs / 1000)
                    : null,
                model: ctx.getCurrentModelId(),
                // Pi reports cached prompt tokens for every provider that has them.
                cacheHit:
                  typeof message.usage?.cacheRead === "number"
                    ? message.usage.cacheRead > 0
                    : undefined,
              });
            ctx.setStreaming(null, null);
            ctx.convNav.notifyNewMessage();
          }
          ctx.showProviderErrorIfNeeded(event);
          const infoSidebar = ctx.getInfoSidebar();
          if (infoSidebar && !infoSidebar.classList.contains("collapsed")) {
            void ctx.refreshInfoPanel();
          }
        } else if (endMessage && typeof endMessage === "object" && endMessage.role === "user") {
          ctx.workbench.noteUserTurnActions?.(ctx.getLastUserElement(), (command) => {
            ctx.runtime.request({ type: "prompt", message: command }, ctx.getTarget(), {
              idempotencyKey: ctx.randomId(),
            });
          });
          const infoSidebar = ctx.getInfoSidebar();
          if (infoSidebar && !infoSidebar.classList.contains("collapsed")) {
            void ctx.refreshInfoPanel();
          }
        }
        break;
      }
      case "tool_execution_start":
        if (event.parentToolCallId) {
          showNestedCall(ctx, event, "pending");
          ctx.filePreviewFollow.onToolStart(event);
          break;
        }
        ctx.liveTurn?.step(toolStepLabel(event, ctx.t));
        ctx.toolRenderer.createToolCard({ ...event, status: "pending" });
        ctx.filePreviewFollow.onToolStart(event);
        break;
      case "tool_execution_update":
        if (event.parentToolCallId) {
          showNestedCall(ctx, event, "streaming");
          break;
        }
        ctx.toolRenderer.updateToolCard({
          ...event,
          status: "streaming",
          output: ctx.textFromResult(event.partialResult),
        });
        break;
      case "tool_execution_end": {
        if (event.parentToolCallId) {
          showNestedCall(ctx, event, "done");
          void ctx.filePreviewFollow.onToolEnd(event).catch(ctx.showError);
          break;
        }
        ctx.toolRenderer.finalizeToolCard(event.toolCallId, event.result, event.isError);
        const lensName = String(event.toolName || event.name || event.tool || "");
        if (lensName.startsWith("lens_")) {
          ctx.workbench.noteLensResult(lensName, lensToolPayload(event));
        }
        if (event.toolName === "todo" && !event.isError) {
          ctx.todoMirrorPanel.applyToolResult(event.result);
        }
        void ctx.filePreviewFollow.onToolEnd(event).catch(ctx.showError);
        break;
      }
      case "extension_ui_request": {
        const method = typeof event.method === "string" ? event.method : "";
        const blocking = WAITING_UI_METHODS.has(method);
        if (blocking) ctx.sessionStatus?.setWaiting(true);
        try {
          await ctx.extensionUi.handle(ctx.getTarget(), event);
        } finally {
          if (blocking) {
            ctx.sessionStatus?.setWaiting(false);
            ctx.sessionRuntime?.dispatch?.({
              type: "rpc",
              event: { type: "extension_ui_resolved", id: event.id },
            });
          }
        }
        break;
      }
      case "extension_ui_resolved":
        ctx.sessionStatus?.setWaiting(false);
        if (typeof event.id === "string") ctx.extensionUi?.resolveFromHost?.(event.id);
        break;
      case "thinking_level_changed":
        applyThinkingLevelChanged(event, (level) => ctx.updateComposerThinking?.(level));
        break;
      case "entry_appended": {
        void applyTreeAppend(event.entry);
        const note = customMessageNote(event.entry);
        if (note) ctx.messageRenderer.renderSystemMessage?.(note);
        break;
      }
      case "extension_error":
        noteExtensionError(event, ctx.getTarget());
        ctx.workbench.refreshPackageHealth?.(ctx.getTarget());
        ctx.showError(new Error(event.error || t("chat.notice.extensionFailed")));
        break;
      case "session_bound":
        await ctx.adoptTarget({ ...ctx.getTarget(), sessionId: event.sessionId });
        ctx.workbench.refreshPackageHealth?.(ctx.getTarget());
        void ctx.workbench.refreshHistory?.();
        ctx.upsertActiveSessionFromUserMessage();
        await ctx.hydrateSnapshotOnce();
        ctx.getSidebar()?.load({ quiet: true }).catch(ctx.showError);
        break;
      default: {
        const type = typeof event?.type === "string" ? event.type : "";
        if (type && !seenUnknownTypes.has(type)) {
          seenUnknownTypes.add(type);
          console.debug("[spopi] ignoring unknown runtime event", type);
        }
        break;
      }
    }
    if (ctx.sessionStatus?.isWaiting?.()) return;
    const phase = ctx.metricsOverlay?.phase?.();
    if (phase && phase !== "idle") {
      ctx.setStatus("working", phaseLabel(phase));
      ctx.workbench.live?.show(liveLabel(ctx.sessionRuntime?.getState?.(), phase, t));
    }
  };
}
