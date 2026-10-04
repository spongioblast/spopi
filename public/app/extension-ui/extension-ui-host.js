// ABOUTME: Routes extension UI requests to the dialog, select, or custom panel.
// ABOUTME: A response is returned once for each request id.

/**
 * @typedef {{
 *   workspaceId?: string,
 *   sessionId: string,
 *   instanceId?: string,
 * }} ExtensionUiTarget
 *
 * @typedef {{
 *   type?: string,
 *   id?: string,
 *   method?: string,
 *   message?: string,
 *   [key: string]: unknown,
 * }} ExtensionUiRequest
 *
 * @typedef {{
 *   request: (
 *     command: Record<string, unknown>,
 *     target: ExtensionUiTarget,
 *   ) => Promise<unknown>,
 * }} ExtensionUiRuntime
 *
 * @typedef {{
 *   notify?: (request: ExtensionUiRequest) => void,
 *   status?: (request: ExtensionUiRequest) => void,
 *   widget?: (request: ExtensionUiRequest) => void,
 *   title?: (request: ExtensionUiRequest) => void,
 *   editorText?: (request: ExtensionUiRequest) => void,
 * }} ExtensionUiHooks
 *
 * @typedef {{ dismissSignal: Promise<void> }} ExtensionUiPromptOptions
 *
 * @typedef {Record<string, unknown>} ExtensionUiPromptResult
 *
 * @typedef {(
 *   request: ExtensionUiRequest,
 *   options: ExtensionUiPromptOptions,
 * ) => (
 *   | Promise<ExtensionUiPromptResult | null | undefined>
 *   | ExtensionUiPromptResult
 *   | null
 *   | undefined
 * )} ShowDialogFn
 *
 * @typedef {(
 *   request: ExtensionUiRequest,
 *   options: ExtensionUiPromptOptions,
 * ) => (
 *   | Promise<ExtensionUiPromptResult | null | undefined>
 *   | ExtensionUiPromptResult
 *   | null
 *   | undefined
 * )} ShowInlinePromptFn
 *
 * @typedef {{ cancel?: boolean, requeuedNow?: boolean, resolved?: boolean }} InFlightAbortOptions
 *
 * @typedef {{
 *   target: ExtensionUiTarget,
 *   request: ExtensionUiRequest,
 *   abort: (options?: InFlightAbortOptions) => void,
 * }} InFlightEntry
 *
 * @typedef {{
 *   target: ExtensionUiTarget,
 *   request: ExtensionUiRequest,
 * }} QueuedPrompt
 */

const BLOCKING_METHODS = new Set(["select", "confirm", "input", "editor"]);

export class ExtensionUiHost {
  /** @type {string | null} */
  #foregroundSessionId = null;
  /** @type {ExtensionUiHooks} */
  #hooks;
  /** @type {Map<string, QueuedPrompt[]>} */
  #queues = new Map();
  /** @type {Map<string, InFlightEntry>} */
  #inFlight = new Map(); // sessionId → { abort(), target, request }
  /** @type {ExtensionUiRuntime} */
  #runtime;
  /** @type {ShowDialogFn} */
  #showDialog;
  /** @type {ShowInlinePromptFn} */
  #showInlinePrompt;

  /**
   * @param {object} options
   * @param {ExtensionUiRuntime} options.runtime
   * @param {ShowDialogFn} [options.showDialog]
   * @param {ShowInlinePromptFn} [options.showInlinePrompt]
   * @param {ExtensionUiHooks} [options.hooks]
   */
  constructor({
    runtime,
    showDialog = async () => ({ cancelled: true }),
    showInlinePrompt = () => null,
    hooks = {},
  }) {
    this.#runtime = runtime;
    this.#showDialog = showDialog;
    this.#showInlinePrompt = showInlinePrompt;
    this.#hooks = hooks;
  }

  /**
   * @param {string} sessionId
   */
  pendingCount(sessionId) {
    return this.#queues.get(sessionId)?.length ?? 0;
  }

  /**
   * Another client already answered. Close the prompt and do not respond again.
   * @param {string} id
   */
  resolveFromHost(id) {
    for (const inFlight of this.#inFlight.values()) {
      if (inFlight.request.id !== id) continue;
      inFlight.abort({ resolved: true });
    }
  }

  /**
   * True when there is a blocking dialog either queued (background session)
   * or actively shown (foreground session) for the given session id. Used to
   * keep the Stop/Abort control visible even if a status frame lags behind
   * an open extension question.
   *
   * @param {string} sessionId
   */
  hasPending(sessionId) {
    return this.pendingCount(sessionId) > 0 || this.#inFlight.has(sessionId);
  }

  /**
   * Force-resolve the currently shown foreground dialog as cancelled — used
   * when the user hits Stop/Abort so a blocked tool call actually receives a
   * response instead of hanging forever. Unlike setForegroundSession()'s
   * abort (which re-queues the dialog for later), this finalizes it.
   */
  cancelForeground() {
    const sessionId = this.#foregroundSessionId;
    if (sessionId === null) return;
    const inFlight = this.#inFlight.get(sessionId);
    if (inFlight) inFlight.abort({ cancel: true });

    const queue = this.#queues.get(sessionId) ?? [];
    this.#queues.delete(sessionId);
    for (const pending of queue) {
      this.#runtime
        .request(
          { type: "extension_ui_response", id: pending.request.id, cancelled: true },
          pending.target,
        )
        .catch(() => {});
    }
  }

  /**
   * Cancel the shown foreground dialog only when `test` accepts its request.
   * @param {(request: ExtensionUiRequest) => boolean} test
   */
  cancelForegroundWhere(test) {
    const sessionId = this.#foregroundSessionId;
    const inFlight = sessionId === null ? undefined : this.#inFlight.get(sessionId);
    if (inFlight && test(inFlight.request)) inFlight.abort({ cancel: true });
  }

  /**
   * Move the currently displayed foreground prompt back into the foreground
   * queue without answering it. Call this before a full chat history re-render:
   * renderHistory() clears the messages container, so an inline prompt that is
   * still in-flight would otherwise lose its clickable DOM while the tool call
   * stays blocked forever.
   *
   * @returns {boolean} true when an in-flight prompt was asked to re-queue.
   */
  requeueForegroundPrompt() {
    const sessionId = this.#foregroundSessionId;
    if (sessionId === null) return false;
    const inFlight = this.#inFlight.get(sessionId);
    if (!inFlight) return false;
    this.#requeueInFlight(sessionId, inFlight);
    return true;
  }

  /**
   * Switch the foreground session and abort any in-flight dialog for the
   * previous session (re-queuing it).
   *
   * @param {string} sessionId
   * @param {object} [options]
   * @param {boolean} [options.flush]
   *   flush (default true) — drain the new session’s queue immediately.
   *   Pass { flush: false } from adoptTarget() so that renderHistory() can
   *   clear the messages container before the inline card is inserted; then
   *   call flushForegroundQueue() after the final render pass.
   */
  async setForegroundSession(sessionId, { flush = true } = {}) {
    const oldId = this.#foregroundSessionId;
    this.#foregroundSessionId = sessionId;
    // Abort any in-flight dialog for the previous session so it gets re-queued
    // and shown again when the user returns to that session.
    if (oldId && oldId !== sessionId) {
      const inFlight = this.#inFlight.get(oldId);
      if (inFlight) this.#requeueInFlight(oldId, inFlight);
    }
    if (flush) await this.flushForegroundQueue();
  }

  /**
   * @param {string} sessionId
   * @param {InFlightEntry} inFlight
   */
  #requeueInFlight(sessionId, inFlight) {
    const queue = this.#queues.get(sessionId) ?? [];
    queue.unshift({
      target: structuredClone(inFlight.target),
      request: structuredClone(inFlight.request),
    });
    this.#queues.set(sessionId, queue);
    // Queue synchronously before dismissing the old DOM. The prompt's dismiss
    // path can settle asynchronously; waiting for it used to let a rapid
    // switch back flush an empty queue and strand the request afterward.
    inFlight.abort({ cancel: false, requeuedNow: true });
  }

  /**
   * Drain queued prompts for the current foreground session.
   * Call this AFTER the final renderHistory() so inline cards are not
   * immediately destroyed by a subsequent clear().
   */
  async flushForegroundQueue() {
    // Yield a microtask so any abort-triggered re-queues can land first.
    await Promise.resolve();
    const sessionId = this.#foregroundSessionId;
    if (!sessionId) return;
    const queue = this.#queues.get(sessionId) ?? [];
    this.#queues.delete(sessionId);
    for (const pending of queue) await this.#showAndRespond(pending.target, pending.request);
  }

  /**
   * @param {ExtensionUiTarget} target
   * @param {ExtensionUiRequest} request
   */
  async handle(target, request) {
    if (request?.type !== "extension_ui_request" || !request.id || !request.method) return;
    if (BLOCKING_METHODS.has(request.method)) {
      // The host replays open dialogs on every subscribe; one id gets one card.
      if (this.#isOpen(target.sessionId, request.id)) return;
      if (target.sessionId !== this.#foregroundSessionId) {
        const queue = this.#queues.get(target.sessionId) ?? [];
        queue.push({ target: structuredClone(target), request: structuredClone(request) });
        this.#queues.set(target.sessionId, queue);
        return;
      }
      await this.#showAndRespond(target, request);
      return;
    }
    switch (request.method) {
      case "notify":
        this.#hooks.notify?.(request);
        break;
      case "setStatus":
        this.#hooks.status?.(request);
        break;
      case "setWidget":
        this.#hooks.widget?.(request);
        break;
      case "setTitle":
        this.#hooks.title?.(request);
        break;
      case "set_editor_text":
        this.#hooks.editorText?.(request);
        break;
      default:
        await this.#runtime.request(
          {
            type: "extension_ui_response",
            id: request.id,
            cancelled: true,
            error: "unsupported",
          },
          target,
        );
    }
  }

  /**
   * @param {string} sessionId
   * @param {string} id
   */
  #isOpen(sessionId, id) {
    if (this.#inFlight.get(sessionId)?.request.id === id) return true;
    return (this.#queues.get(sessionId) ?? []).some((pending) => pending.request.id === id);
  }

  /**
   * @param {ExtensionUiTarget} target
   */
  async cancelSession(target) {
    const queue = this.#queues.get(target.sessionId) ?? [];
    this.#queues.delete(target.sessionId);
    for (const pending of queue) {
      await this.#runtime.request(
        { type: "extension_ui_response", id: pending.request.id, cancelled: true },
        pending.target,
      );
    }
  }

  /**
   * @param {ExtensionUiTarget} target
   * @param {ExtensionUiRequest} request
   */
  async #showAndRespond(target, request) {
    // Create a dismiss signal so an external abort can resolve the dialog.
    /** @type {(() => void) | undefined} */
    let triggerDismiss;
    /** @type {Promise<void>} */
    const dismissSignal = new Promise((resolve) => {
      triggerDismiss = resolve;
    });
    // Track whether this dialog was aborted because the session switched
    // away (re-queue for later) or explicitly cancelled (finalize now — e.g.
    // the user hit Stop/Abort).
    let disposition = "respond";
    /** @type {InFlightEntry} */
    const inFlight = {
      target: structuredClone(target),
      request: structuredClone(request),
      /**
       * @param {object} [options]
       * @param {boolean} [options.cancel]
       * @param {boolean} [options.requeuedNow]
       * @param {boolean} [options.resolved]
       */
      abort: ({ cancel = false, requeuedNow = false, resolved = false } = {}) => {
        disposition = resolved
          ? "alreadyResolved"
          : requeuedNow
            ? "requeuedNow"
            : cancel
              ? "respond"
              : "requeueAfter";
        const dismiss = triggerDismiss;
        if (dismiss) dismiss();
      },
    };
    this.#inFlight.set(target.sessionId, inFlight);
    /** @type {ExtensionUiPromptResult | null | undefined} */
    let result;
    try {
      const inlineResult = this.#showInlinePrompt(structuredClone(request), { dismissSignal });
      result = inlineResult
        ? await inlineResult
        : await this.#showDialog(structuredClone(request), { dismissSignal });
    } catch {
      result = { cancelled: true };
    }
    if (this.#inFlight.get(target.sessionId) === inFlight) {
      this.#inFlight.delete(target.sessionId);
    }
    if (disposition === "alreadyResolved" || disposition === "requeuedNow") return;
    if (disposition === "requeueAfter") {
      // Re-queue the request; it will be shown when the session regains focus.
      const queue = this.#queues.get(target.sessionId) ?? [];
      queue.unshift({ target: structuredClone(target), request: structuredClone(request) });
      this.#queues.set(target.sessionId, queue);
      return;
    }
    const response = {
      type: "extension_ui_response",
      id: request.id,
      ...(result && typeof result === "object" ? result : { cancelled: true }),
    };
    await this.#runtime.request(response, target);
  }
}
