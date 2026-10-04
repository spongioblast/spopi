// ABOUTME: Opens the host WebSocket and sends the desktop hello.
// ABOUTME: The URL is the page host plus /v2/ws.

import { answerPhoneClaim, closePhoneClaim } from "../pair/phone-claim.js";
import { resyncSessionTree } from "../session/session-tree-host.js";
import { applyCapabilities } from "../shell/capabilities.js";

/**
 * @typedef {{ location?: { protocol?: string, host?: string } }} HostWebSocketEnv
 * @typedef {new (url: string) => WebSocket} HostWebSocketConstructor
 * @typedef {{ workspaceId: string, sessionId: string, instanceId: string }} HostRuntimeSubscriptionTarget
 */

/**
 * @param {HostWebSocketEnv} [env]
 */
export function resolveHostWebSocketUrl(
  env = /** @type {HostWebSocketEnv} */ (globalThis.window || globalThis),
) {
  const location = env?.location || globalThis.location;
  const protocol = location?.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location?.host}/v2/ws`;
}

export class HostRuntimeAdapter {
  /** @type {HostWebSocketConstructor} */
  #WebSocketImpl;
  /** @type {string} */
  #clientId;
  #connected = false;
  /** @type {Set<(connected: boolean) => void>} */
  #connectionListeners = new Set();
  #nextSubscriptionId = 1;
  /** @type {Set<(frame: unknown) => void>} */
  #receivers = new Set();
  /** @type {Array<() => void>} */
  #readyWaiters = [];
  #reconnectAttempts = 0;
  /** The host run this window last connected to; a different one means SPOPI restarted. */
  #hostId = "";
  /** @type {number} */
  #reconnectBaseDelayMs;
  /** @type {number} */
  #reconnectMaxDelayMs;
  /** @type {ReturnType<typeof setTimeout> | null} */
  #reconnectTimer = null;
  #shouldReconnect = false;
  /** @type {Map<string, HostRuntimeSubscriptionTarget>} */
  #subscriptions = new Map();
  /** @type {string} */
  #url;
  /** @type {WebSocket | null} */
  #socket = null;
  /** @type {Set<(frame: { kind?: string }) => void>} */
  #uiListeners = new Set();

  /**
   * @param {{
   *   url: string,
   *   WebSocketImpl?: HostWebSocketConstructor,
   *   clientId: string,
   *   reconnectBaseDelayMs?: number,
   *   reconnectMaxDelayMs?: number,
   * }} options
   */
  constructor({
    url,
    WebSocketImpl = globalThis.WebSocket,
    clientId,
    reconnectBaseDelayMs = 250,
    reconnectMaxDelayMs = 5000,
  }) {
    if (!url || !clientId) throw new Error("HostRuntimeAdapter requires url and clientId");
    if (!WebSocketImpl) throw new Error("WebSocket is unavailable");
    this.#url = url;
    this.#WebSocketImpl = WebSocketImpl;
    this.#clientId = clientId;
    this.#reconnectBaseDelayMs = reconnectBaseDelayMs;
    this.#reconnectMaxDelayMs = reconnectMaxDelayMs;
  }

  /** @param {(frame: unknown) => void} listener */
  setReceiver(listener) {
    this.#receivers.add(listener);
    return () => this.#receivers.delete(listener);
  }

  /** @param {(connected: boolean) => void} listener */
  setConnectionListener(listener) {
    this.#connectionListeners.add(listener);
    return () => this.#connectionListeners.delete(listener);
  }

  connect() {
    this.#shouldReconnect = true;
    this.#clearReconnectTimer();
    if (this.#socket && this.#socket.readyState < 2) return;
    const socket = new this.#WebSocketImpl(this.#url);
    this.#socket = socket;
    socket.onopen = () => {
      try {
        performance.mark("spopi:ws-open");
      } catch {
        // performance is absent in some non-browser hosts
      }
      socket.send(
        JSON.stringify({
          type: "hello",
          protocolVersion: 2,
          clientType: "desktop",
          clientId: this.#clientId,
        }),
      );
    };
    socket.onmessage = (event) => {
      const data = /** @type {unknown} */ (event.data);
      let frame;
      try {
        frame = JSON.parse(typeof data === "string" ? data : String(data));
      } catch {
        this.#receive({
          type: "error",
          error: { code: "invalid_json", message: "Host returned invalid JSON" },
        });
        return;
      }
      if (frame.type === "hello_ack") {
        if (typeof document !== "undefined") {
          document.documentElement.dataset.hostConnected = "1";
        }
        try {
          performance.mark("spopi:hello-ack");
        } catch {
          // performance is absent in some non-browser hosts
        }
        if (Array.isArray(frame.capabilities)) applyCapabilities(frame.capabilities);
        if (frame.protocolVersion !== 2) {
          socket.close();
          return;
        }
        this.#connected = true;
        const resumed = this.#reconnectAttempts > 0;
        this.#reconnectAttempts = 0;
        const hostId = typeof frame.hostId === "string" ? frame.hostId : "";
        const restarted = Boolean(this.#hostId && hostId && hostId !== this.#hostId);
        if (hostId) this.#hostId = hostId;
        for (const target of this.#subscriptions.values()) this.#sendSubscription(target);
        for (const listener of this.#connectionListeners) listener(true);
        for (const resolve of this.#readyWaiters.splice(0)) resolve();
        if (resumed) {
          void resyncSessionTree();
          if (typeof document !== "undefined") {
            document.dispatchEvent(
              new CustomEvent("spopi-host-reconnected", { detail: { restarted } }),
            );
          }
        }
        return;
      }
      if (frame.type === "runtime_subscribed") return;
      if (frame.type === "extension_ui_resolved") {
        document.dispatchEvent(new CustomEvent("spopi-ui-resolved", { detail: frame }));
        this.#receive(frame);
        return;
      }
      if (frame.type === "phone_claim_pending") {
        void answerPhoneClaim(frame);
        return;
      }
      if (frame.type === "phone_claim_settled") {
        closePhoneClaim(frame);
        document.dispatchEvent(new CustomEvent("spopi-phone-claim-settled"));
        return;
      }
      if (frame.type === "ui_reload") {
        for (const listener of this.#uiListeners) listener(frame);
        return;
      }
      if (frame.type === "mcp_config_changed") {
        document.dispatchEvent(new CustomEvent("spopi-pi-config-changed"));
        return;
      }
      this.#receive(frame);
    };
    socket.onclose = () => {
      if (this.#socket !== socket) return;
      this.#connected = false;
      for (const listener of this.#connectionListeners) listener(false);
      this.#scheduleReconnect();
    };
    socket.onerror = () => {};
  }

  /** @param {(frame: { kind?: string }) => void} listener */
  onUiReload(listener) {
    this.#uiListeners.add(listener);
    return () => this.#uiListeners.delete(listener);
  }

  disconnect() {
    this.#shouldReconnect = false;
    this.#clearReconnectTimer();
    this.#socket?.close();
  }

  ready() {
    if (this.#connected) return Promise.resolve();
    /** @type {Promise<void>} */
    return new Promise((resolve) => this.#readyWaiters.push(resolve));
  }

  /** @param {unknown} frame */
  send(frame) {
    const socket = this.#socket;
    if (!this.#connected || !this.#isSocketOpen() || !socket) {
      this.#scheduleReconnect();
      throw new Error("SPOPI Host runtime is disconnected");
    }
    socket.send(JSON.stringify(frame));
  }

  /** @param {HostRuntimeSubscriptionTarget} target */
  subscribeTarget(target) {
    const key = `${target.workspaceId}\u0000${target.sessionId}\u0000${target.instanceId}`;
    if (this.#subscriptions.has(key)) return;
    this.#subscriptions.set(key, structuredClone(target));
    if (this.#connected) this.#sendSubscription(target);
  }

  /** @param {HostRuntimeSubscriptionTarget} target */
  #sendSubscription(target) {
    const socket = this.#socket;
    if (!this.#isSocketOpen() || !socket) return;
    socket.send(
      JSON.stringify({
        type: "runtime_subscribe",
        requestId: `subscribe-${this.#nextSubscriptionId++}`,
        target,
      }),
    );
  }

  #isSocketOpen() {
    return this.#socket?.readyState === 1;
  }

  #scheduleReconnect() {
    if (!this.#shouldReconnect || this.#reconnectTimer) return;
    const delay = Math.min(
      this.#reconnectBaseDelayMs * 2 ** this.#reconnectAttempts,
      this.#reconnectMaxDelayMs,
    );
    this.#reconnectAttempts += 1;
    this.#reconnectTimer = globalThis.setTimeout(() => {
      this.#reconnectTimer = null;
      this.connect();
    }, delay);
  }

  #clearReconnectTimer() {
    if (!this.#reconnectTimer) return;
    globalThis.clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = null;
  }

  /** @param {unknown} frame */
  #receive(frame) {
    for (const receiver of this.#receivers) receiver(frame);
  }
}
