// ABOUTME: WebView-side session registry for Codex OAuth operations.
// ABOUTME: Reuses the /spopi-config prompt round-trip; events stream as __spopiOauth frames.

import { createRequestIds } from "./request-id.js";

const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * @param {unknown} message
 * @returns {{ kind: "event", configId: string, event: { type?: string } | null } | { kind: "response", configId: string, payload: { ok?: unknown, data?: unknown, error?: unknown } } | null}
 */
function extractOauthEnvelope(message) {
  if (typeof message !== "string") return null;
  if (message.includes("__spopiOauth")) {
    try {
      /** @type {unknown} */
      const parsed = JSON.parse(message);
      if (!parsed || typeof parsed !== "object") return null;
      const payload = /** @type {{ __spopiOauth?: unknown, event?: unknown }} */ (parsed);
      if (payload.__spopiOauth === undefined) return null;
      return {
        kind: "event",
        configId: String(payload.__spopiOauth),
        event: /** @type {{ type?: string } | null} */ (payload.event ?? null),
      };
    } catch {
      return null;
    }
  }
  // This gateway's own synchronous responses arrive as regular __spopiConfig
  // frames tagged with the oa- id prefix; without settling them here they
  // would fall through to chat rendering.
  if (message.includes("__spopiConfig")) {
    try {
      /** @type {unknown} */
      const parsed = JSON.parse(message);
      const payload =
        parsed && typeof parsed === "object"
          ? /** @type {{ __spopiConfig?: unknown, ok?: unknown, data?: unknown, error?: unknown }} */ (
              parsed
            )
          : null;
      const configId = String(payload?.__spopiConfig ?? "");
      if (payload && configId.startsWith("oa-")) {
        return { kind: "response", configId, payload };
      }
    } catch {
      return null;
    }
  }
  return null;
}

const TERMINAL_EVENTS = new Set(["complete", "failed", "cancelled", "expired"]);

/**
 * Session registry for OAuth login flows over the config transport.
 *
 * `command(frame)` sends a command frame (`{ type, ...params }`) over the
 * /spopi-config channel and resolves with `{ success, data?, error? }`. Events for the active operation stream to
 * the single handler registered via `subscribe`; terminal events settle the
 * originating request and clear the subscription. Frames without an active
 * matching session are dropped — other windows subscribed to the same target
 * never render them (design §5 convergence rule).
 *
 * @param {{
 *   runtime: {
 *     request: (
 *       command: { type: string, message: string },
 *       target: unknown,
 *       options: { idempotencyKey: string },
 *     ) => Promise<unknown>,
 *   },
 *   getTarget: () => unknown | null,
 * }} options
 */
export function createOauthGateway({ runtime, getTarget }) {
  /**
   * @type {Map<
   *   string,
   *   {
   *     resolve: (value: { success: boolean, data?: unknown, error?: unknown }) => void,
   *     reject: (error: unknown) => void,
   *     timer: ReturnType<typeof setTimeout>,
   *   }
   * >}
   */
  const pending = new Map();
  /** @type {((event: { event: unknown }) => void) | null} */
  let activeHandler = null;
  const nextId = createRequestIds("oa");

  /**
   * @param {{ type?: string, [key: string]: unknown }} commandFrame
   * @param {{ timeoutMs?: number }} [options]
   */
  function send(commandFrame, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const target = getTarget();
    if (!target) return Promise.reject(new Error("No active session for OAuth request"));
    const type = commandFrame?.type;
    if (!type) return Promise.reject(new Error("OAuth command type is required"));
    const { type: _type, ...params } = commandFrame;
    const id = nextId();
    const message = `/spopi-config ${JSON.stringify({ id, op: type, params })}`;
    /** @type {Promise<{ success: boolean, data?: unknown, error?: unknown }>} */
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`OAuth request "${type}" timed out`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      runtime
        .request({ type: "prompt", message }, target, { idempotencyKey: id })
        .catch((/** @type {unknown} */ error) => {
          const entry = pending.get(id);
          if (!entry) return;
          clearTimeout(entry.timer);
          pending.delete(id);
          reject(error);
        });
    });
    return promise;
  }

  /**
   * Consume one runtime_event frame. Returns true when the frame was an
   * OAuth envelope (the caller must then NOT feed it to other consumers —
   * design §5 M3 mutual exclusion).
   *
   * Two gates, one per envelope kind (the bridge resolves start_oauth_login
   * immediately and streams later events under the same request id):
   * - `response` frames (`__spopiConfig:"oa-…"`) must match a live pending
   *   entry — a start command resolves exactly once from its response;
   *   unknown/stale ids are swallowed.
   * - `event` frames (`__spopiOauth`) dispatch whenever a subscription is
   *   active (session-level gate): they outlive the pending entry that
   *   started the flow. No subscription → swallow, never render (other
   *   windows subscribed to the same target drop them, design §5).
   *
   * @param {{ type?: string, event?: { type?: string, message?: string } } | null | undefined} frame
   */
  function consumeFrame(frame) {
    if (frame?.type !== "runtime_event") return false;
    if (frame.event?.type !== "extension_ui_request") return false;
    const envelope = extractOauthEnvelope(frame.event?.message);
    if (!envelope) return false;
    if (envelope.kind === "response") {
      const entry = pending.get(envelope.configId);
      if (!entry) return true; // ours but unknown/stale — swallow it
      clearTimeout(entry.timer);
      pending.delete(envelope.configId);
      const payload = envelope.payload ?? {};
      entry.resolve(
        payload.ok
          ? { success: true, data: payload.data ?? {} }
          : { success: false, error: payload.error },
      );
      return true;
    }
    const event = envelope.event;
    if (!event) return true;
    if (!activeHandler) return true; // ours but no active session — swallow it
    try {
      activeHandler({ event });
    } catch (error) {
      console.warn("[OauthGateway] event handler failed:", error);
    }
    // Terminal events complete the flow: settle the originating request if
    // still pending and drop the subscription so later frames are swallowed.
    if (event.type != null && TERMINAL_EVENTS.has(event.type)) {
      const entry = pending.get(envelope.configId);
      if (entry) {
        clearTimeout(entry.timer);
        pending.delete(envelope.configId);
        entry.resolve({ success: true, data: { state: event.type } });
      }
      activeHandler = null;
    }
    return true;
  }

  return {
    /** Send a command frame; resolves with `{ success, data?, error? }`. */
    command: send,
    /**
     * Consume one runtime_event frame. Returns true when the frame was an
     * OAuth envelope (M3 mutual exclusion: caller skips other consumers).
     */
    consumeFrame,
    /** Register the single active event handler; returns unsubscribe. */
    /**
     * @param {(event: { event: unknown }) => void} handler
     */
    subscribe(handler) {
      activeHandler = handler;
      return () => {
        if (activeHandler === handler) activeHandler = null;
      };
    },
    /** Test/diagnostic hook: number of in-flight requests. */
    size() {
      return pending.size;
    },
  };
}
