// ABOUTME: Reads files, sessions, and usage through the host data operations.
// ABOUTME: Writes and prompts go through the other gateways.

import { createRequestIds } from "./request-id.js";

const READ_OPERATIONS = new Set([
  "list_files",
  "list_sessions",
  "list_all_sessions",
  "list_launcher_sessions",
  "search_sessions",
  "cost_dashboard",
  "workspace_info",
  "read_session_messages",
]);

const DEFAULT_SESSION_LIST_HTTP_TIMEOUT_MS = 1500;
const DEFAULT_HOST_READY_TIMEOUT_MS = 2000;
const DEFAULT_DATA_REQUEST_TIMEOUT_MS = 15000;

/**
 * @typedef {{
 *   send: (frame: Record<string, unknown>) => void,
 *   setReceiver: (listener: (frame: DataFrame) => void) => void,
 *   setConnectionListener?: (listener: (connected: boolean) => void) => void,
 *   ready?: () => Promise<void>,
 * }} DataAdapter
 * @typedef {{
 *   requestId?: string,
 *   error?: { message?: string } | null,
 *   messages?: { length: number },
 * }} DataFrame
 * @typedef {{
 *   resolve: (frame: DataFrame) => void,
 *   reject: (error: unknown) => void,
 *   generation: number,
 *   timeout: ReturnType<typeof setTimeout> | null,
 *   operation: string,
 *   sessionId: string | undefined,
 *   startedAt: number,
 * }} DataPending
 * @typedef {{
 *   sessionId?: string,
 *   [key: string]: unknown,
 * }} DataParameters
 */

export class HostDataGateway {
  /** @type {DataAdapter} */
  #adapter;
  /** @type {typeof fetch | null} */
  #fetch;
  #generation = 0;
  /** @type {number} */
  #hostReadyTimeoutMs;
  /** @type {{ origin?: string } | null | undefined} */
  #location;
  /** @type {number} */
  #dataRequestTimeoutMs;
  #ids = createRequestIds("data");
  /** @type {Map<string, DataPending>} */
  #pending = new Map();
  /** @type {number} */
  #sessionListHttpTimeoutMs;

  /**
   * @param {DataAdapter} adapter
   * @param {{
   *   fetchImpl?: typeof fetch | null,
   *   location?: { origin?: string } | null,
   *   sessionListHttpTimeoutMs?: number,
   *   hostReadyTimeoutMs?: number,
   *   dataRequestTimeoutMs?: number,
   * }} [options]
   */
  constructor(
    adapter,
    {
      fetchImpl = null,
      location = globalThis.location,
      sessionListHttpTimeoutMs = DEFAULT_SESSION_LIST_HTTP_TIMEOUT_MS,
      hostReadyTimeoutMs = DEFAULT_HOST_READY_TIMEOUT_MS,
      dataRequestTimeoutMs = DEFAULT_DATA_REQUEST_TIMEOUT_MS,
    } = {},
  ) {
    this.#adapter = adapter;
    this.#fetch = fetchImpl;
    this.#hostReadyTimeoutMs = hostReadyTimeoutMs;
    this.#location = location;
    this.#dataRequestTimeoutMs = dataRequestTimeoutMs;
    this.#sessionListHttpTimeoutMs = sessionListHttpTimeoutMs;
    adapter.setReceiver((frame) => this.#receive(frame));
    adapter.setConnectionListener?.((connected) => {
      if (!connected) this.#disconnect();
    });
  }

  /**
   * @param {string} operation
   * @param {DataParameters} [parameters]
   * @returns {Promise<DataFrame>}
   */
  async request(operation, parameters = {}) {
    if (!READ_OPERATIONS.has(operation)) {
      throw new Error(`Unsupported read-only data operation: ${operation}`);
    }
    const traceSessionLoad = operation === "read_session_messages";
    const startedAt = performance.now();
    if (traceSessionLoad) {
      console.info("[SESSION-LOAD] disk request waiting for Host connection", {
        sessionId: parameters.sessionId,
      });
    }
    if (typeof this.#adapter.ready === "function") {
      await this.#withTimeout(
        this.#adapter.ready(),
        this.#hostReadyTimeoutMs,
        "Host connection timed out before the data request could start",
      );
    }
    if (traceSessionLoad) {
      console.info("[SESSION-LOAD] Host ready; sending disk request", {
        sessionId: parameters.sessionId,
        elapsedMs: Math.round(performance.now() - startedAt),
      });
    }
    const requestId = this.#ids();
    const generation = this.#generation;
    /** @type {Promise<DataFrame>} */
    return new Promise((resolve, reject) => {
      /** @type {ReturnType<typeof setTimeout> | null} */
      let timeout = null;
      if (Number.isFinite(this.#dataRequestTimeoutMs) && this.#dataRequestTimeoutMs > 0) {
        timeout = setTimeout(() => {
          this.#pending.delete(requestId);
          reject(new Error("Host data request timed out"));
        }, this.#dataRequestTimeoutMs);
      }
      this.#pending.set(requestId, {
        resolve,
        reject,
        generation,
        timeout,
        operation,
        sessionId: parameters.sessionId,
        startedAt,
      });
      try {
        this.#adapter.send({
          type: "data_request",
          requestId,
          operation,
          ...parameters,
        });
      } catch (error) {
        this.#pending.delete(requestId);
        if (timeout) clearTimeout(timeout);
        reject(error);
      }
    });
  }

  /**
   * @param {string} workspaceId
   * @param {string} [path]
   * @param {boolean} [showHidden]
   */
  listFiles(workspaceId, path = "", showHidden = false) {
    return this.request("list_files", { workspaceId, path, showHidden });
  }

  /** @param {string} workspaceId */
  listSessions(workspaceId) {
    return this.request("list_sessions", { workspaceId });
  }

  // Sessions across every project, grouped by project in the sidebar. Sessions
  // belonging to `workspaceId` are tagged `isCurrentWorkspace: true`.
  /** @param {string} workspaceId */
  listAllSessions(workspaceId) {
    if (this.#fetch) {
      return this.#listAllSessionsHttp(workspaceId).catch(() =>
        this.request("list_all_sessions", { workspaceId }),
      );
    }
    return this.request("list_all_sessions", { workspaceId });
  }

  listLauncherSessions() {
    return this.request("list_launcher_sessions");
  }

  /**
   * @param {string} workspaceId
   * @param {string} query
   */
  searchSessions(workspaceId, query) {
    return this.request("search_sessions", { workspaceId, query });
  }

  /** @param {string} workspaceId */
  costDashboard(workspaceId) {
    return this.request("cost_dashboard", { workspaceId });
  }

  /** @param {string} workspaceId */
  workspaceInfo(workspaceId) {
    return this.request("workspace_info", { workspaceId });
  }

  /**
   * Read a saved session's messages when no Pi runtime is running.
   *
   * @param {string} workspaceId
   * @param {string} sessionId
   */
  readSessionMessages(workspaceId, sessionId) {
    return this.request("read_session_messages", { workspaceId, sessionId });
  }

  /** @param {string} workspaceId */
  async #listAllSessionsHttp(workspaceId) {
    const origin = this.#location?.origin ?? globalThis.location?.origin;
    if (typeof origin !== "string") {
      throw new TypeError("Invalid URL");
    }
    const url = new URL("/v2/sessions", origin);
    url.searchParams.set("workspaceId", workspaceId);
    const response = await this.#fetchWithTimeout(url, this.#sessionListHttpTimeoutMs);
    if (!response.ok) throw new Error("Session list request failed");
    return response.json();
  }

  /**
   * @param {URL | string} url
   * @param {number} timeoutMs
   * @returns {ReturnType<typeof fetch>}
   */
  #fetchWithTimeout(url, timeoutMs) {
    const fetchImpl = this.#fetch;
    if (!fetchImpl) {
      throw new TypeError("fetch is not available");
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return fetchImpl(url);
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let timeout = null;
    /** @type {Promise<never>} */
    const timeoutPromise = new Promise((_, reject) => {
      timeout = setTimeout(() => {
        controller?.abort();
        reject(new Error("Session list HTTP request timed out"));
      }, timeoutMs);
    });
    const init = {
      ...(controller ? { signal: controller.signal } : {}),
    };
    const fetchPromise = fetchImpl(url, init);
    return Promise.race([fetchPromise, timeoutPromise]).finally(() => {
      if (timeout) clearTimeout(timeout);
    });
  }

  /**
   * @template T
   * @param {Promise<T>} promise
   * @param {number} timeoutMs
   * @param {string} message
   * @returns {Promise<T>}
   */
  #withTimeout(promise, timeoutMs, message) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let timeout = null;
    /** @type {Promise<never>} */
    const timeoutPromise = new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => {
      if (timeout) clearTimeout(timeout);
    });
  }

  /**
   * @param {DataFrame | null | undefined} frame
   */
  #receive(frame) {
    const requestId = frame?.requestId;
    if (!frame || typeof requestId !== "string") return;
    const pending = this.#pending.get(requestId);
    if (!pending || pending.generation !== this.#generation) return;
    this.#pending.delete(requestId);
    if (pending.timeout) clearTimeout(pending.timeout);
    if (pending.operation === "read_session_messages") {
      console.info("[SESSION-LOAD] disk response received", {
        sessionId: pending.sessionId,
        messageCount: frame.messages?.length ?? 0,
        elapsedMs: Math.round(performance.now() - pending.startedAt),
        failed: Boolean(frame.error),
      });
    }
    if (frame.error) pending.reject(new Error(frame.error.message ?? String(frame.error)));
    else pending.resolve(frame);
  }

  #disconnect() {
    this.#generation += 1;
    for (const pending of this.#pending.values()) {
      if (pending.timeout) clearTimeout(pending.timeout);
      pending.reject(new Error("Host disconnected before the data request completed"));
    }
    this.#pending.clear();
  }
}
