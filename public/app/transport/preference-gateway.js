// ABOUTME: Reads and writes ui.* preferences on the host.
// ABOUTME: Each call goes through the control gateway and times out on its own.

import { createRequestIds } from "./request-id.js";

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * @typedef {import("./control-gateway.js").HostControlGateway} PreferenceControl
 * @typedef {import("./control-gateway.js").HostFrame} PreferenceFrame
 */

export class PreferenceGateway {
  /** @type {PreferenceControl["request"]} */
  #request;
  #ids = createRequestIds("preference");
  /** @type {number} */
  #timeoutMs;

  /**
   * @param {PreferenceControl} control
   * @param {{ timeoutMs?: number }} [options]
   */
  constructor(control, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    this.#request = (operation, parameters, requestId) =>
      control.request(operation, parameters, requestId);
    this.#timeoutMs = timeoutMs;
  }

  /** @param {string} key */
  get(key) {
    return this.#call("get_preference", { key }).then((frame) => frame?.value ?? null);
  }

  /**
   * @param {string} key
   * @param {unknown} value
   */
  set(key, value) {
    return this.#call("set_preference", { key, value }).then((frame) => frame?.value);
  }

  /** @param {string} key */
  remove(key) {
    return this.#call("remove_preference", { key }).then((frame) => Boolean(frame?.removed));
  }

  /** @param {string} prefix */
  async list(prefix) {
    const frame = await this.#call("list_preferences", { prefix });
    const entries = frame?.entries;
    return entries && typeof entries === "object" ? entries : {};
  }

  /** Read many ui.* keys. The host has one get per key, so these run together. */
  /**
   * @param {string[]} keys
   */
  async getMany(keys) {
    const entries = await Promise.all(
      keys.map(async (key) => [key, await this.get(key).catch(() => null)]),
    );
    return Object.fromEntries(entries.filter(([, value]) => value != null));
  }

  dispose() {}

  /**
   * @param {string} operation
   * @param {Record<string, unknown>} parameters
   * @returns {Promise<PreferenceFrame>}
   */
  #call(operation, parameters) {
    const pending = this.#request(operation, parameters, this.#ids());
    if (!Number.isFinite(this.#timeoutMs) || this.#timeoutMs <= 0) return pending;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error("Preference request timed out"));
      }, this.#timeoutMs);
    });
    return Promise.race([pending.finally(() => clearTimeout(timer)), timeout]);
  }
}
