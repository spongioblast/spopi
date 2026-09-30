// ABOUTME: Sends configuration operations to the host and matches their responses.
// ABOUTME: Callers pass an operation name and a parameter object.

// Client for the SPOPI Configuration data plane.
//
// pi's native RPC command set is fixed and cannot be extended, so Configuration
// operations (model catalog, API keys, agent-config / models.json files) are
// served by the `spopi-config` command registered in the spopi-bridge
// extension. We invoke it by sending a native RPC `prompt` of the form
// `/spopi-config <json>` — extension commands execute immediately without
// hitting the LLM or session history. The handler returns its result through
// `ctx.ui.notify(JSON)`, which arrives here as a `notify` extension-UI event.
// We correlate requests and responses by a per-call id.
//
// `consumeNotify(request)` must be called for every incoming `notify` event; it
// returns true when the notification was a config response (and should NOT be
// rendered as a chat message), false otherwise.

import { randomId } from "../utils/random-id.js";

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * @typedef {{ consumeNotify: (request: { message?: string } | null | undefined) => boolean }} ConfigGatewayLike
 * @typedef {{
 *   type?: string,
 *   event?: { type?: string, message?: string },
 * }} ConfigFrame
 * @typedef {{
 *   request: (command: { type: string, message: string }, target: unknown, options: { idempotencyKey: string }) => Promise<unknown>,
 * }} ConfigRuntime
 * @typedef {{ workspaceId?: string, sessionId?: string, instanceId?: string }} ConfigTarget
 * @typedef {{
 *   resolve: (result: Record<string, unknown>) => void,
 *   reject: (error: Error) => void,
 *   timer: ReturnType<typeof setTimeout>,
 * }} ConfigPending
 */

/**
 * @param {ConfigGatewayLike} gateway
 * @param {ConfigFrame | null | undefined} frame
 */
export function consumeConfigResponseFrame(gateway, frame) {
  return Boolean(
    frame?.type === "runtime_event" &&
      frame.event?.type === "extension_ui_request" &&
      gateway.consumeNotify(frame.event),
  );
}

export class ConfigGateway {
  /** @type {ConfigRuntime} */
  #runtime;
  /** @type {() => ConfigTarget | null | undefined} */
  #getTarget;
  /** @type {Map<string, ConfigPending>} */
  #pending = new Map();
  /** @type {(() => Promise<void>) | null} */
  #waitUntilReady = null;

  /**
   * @param {{
   *   runtime: ConfigRuntime,
   *   getTarget: () => ConfigTarget | null | undefined,
   *   waitUntilReady?: (() => Promise<void>) | null,
   * }} options
   */
  constructor({ runtime, getTarget, waitUntilReady = null }) {
    this.#runtime = runtime;
    this.#getTarget = getTarget;
    this.#waitUntilReady = waitUntilReady;
  }

  // Invoke a configuration operation. Resolves with the handler payload
  // `{ ok: boolean, data?, error? }`. Rejects only on transport/timeout errors.
  /**
   * @param {string} op
   * @param {Record<string, unknown>} [params]
   * @param {{ timeoutMs?: number, target?: ConfigTarget | null }} [options]
   */
  call(op, params = {}, options = {}) {
    if (this.#waitUntilReady) {
      return this.#waitUntilReady().then(() => this.#send(op, params, options));
    }
    return this.#send(op, params, options);
  }

  /**
   * @param {string} op
   * @param {Record<string, unknown>} params
   * @param {{ timeoutMs?: number, target?: ConfigTarget | null }} [options]
   */
  #send(op, params, { timeoutMs = DEFAULT_TIMEOUT_MS, target: targetOverride } = {}) {
    const target = targetOverride ?? this.#getTarget();
    if (!target) return Promise.reject(new Error("No active session for configuration request"));
    const id = `cfg-${randomId()}`;
    const message = `/spopi-config ${JSON.stringify({ id, op, params })}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Configuration request "${op}" timed out`));
      }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      this.#runtime
        .request({ type: "prompt", message }, target, { idempotencyKey: id })
        .catch((/** @type {unknown} */ error) => {
          const pending = this.#pending.get(id);
          if (!pending) return;
          clearTimeout(pending.timer);
          this.#pending.delete(id);
          reject(error);
        });
    });
  }

  // Returns true if the notification was a config response (consumed).
  /**
   * @param {{ message?: string } | null | undefined} request
   */
  consumeNotify(request) {
    const message = request?.message;
    if (typeof message !== "string" || !message.includes("__spopiConfig")) return false;
    let payload;
    try {
      payload = JSON.parse(message);
    } catch {
      return false;
    }
    const id = payload?.__spopiConfig;
    if (typeof id !== "string") return false;
    const pending = this.#pending.get(id);
    if (!pending) return true; // ours, but already settled/timed out — still swallow it
    clearTimeout(pending.timer);
    this.#pending.delete(id);
    const { __spopiConfig, ...result } = payload;
    pending.resolve(result);
    return true;
  }
}
