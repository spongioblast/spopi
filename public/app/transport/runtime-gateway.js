// ABOUTME: Sends runtime mutations such as prompt and abort, and subscribes to events.
// ABOUTME: Mutations require an idempotency key.

import { createRequestIds } from "./request-id.js";

/**
 * @typedef {{ workspaceId: string, sessionId: string, instanceId: string }} RuntimeTarget
 * @typedef {{ workspaceId?: string, sessionId?: string, instanceId?: string }} RuntimeTargetInput
 * @typedef {{ type?: string, requestId?: string } & Record<string, unknown>} RuntimeCommand
 * @typedef {{
 *   requestId?: string,
 *   error?: { message?: string } | null,
 *   response?: { data?: { target?: RuntimeTarget | null } },
 * }} Frame
 * @typedef {{
 *   send: (frame: Record<string, unknown>) => void,
 *   setReceiver: (listener: (frame: Frame) => void) => void,
 *   setConnectionListener: (listener: (connected: boolean) => void) => void,
 *   subscribeTarget?: (target: RuntimeTarget) => void,
 * }} RuntimeAdapter
 * @typedef {{
 *   resolve: (frame: Frame) => void,
 *   reject: (error: unknown) => void,
 *   generation: number,
 * }} RuntimePending
 * @typedef {(frame: Frame) => void} RuntimeListener
 */

/** @type {Set<string | undefined>} */
const MUTATION_TYPES = new Set([
  "prompt",
  "steer",
  "follow_up",
  "compact",
  "bash",
  "fork",
  "clone",
  "set_model",
  "set_thinking_level",
  "set_auto_compaction",
  "set_auto_retry",
  "set_steering_mode",
  "set_follow_up_mode",
]);

/**
 * @param {RuntimeTargetInput | null | undefined} target
 * @returns {asserts target is RuntimeTarget}
 */
function assertTarget(target) {
  if (!target?.workspaceId || !target?.sessionId || !target?.instanceId) {
    throw new Error("Runtime target requires workspaceId, sessionId, and instanceId");
  }
}

export class RuntimeGateway {
  /** @type {RuntimeAdapter} */
  #adapter;
  #generation = 0;
  /** @type {Set<RuntimeListener>} */
  #listeners = new Set();
  #ids = createRequestIds("client");
  /** @type {Map<string, RuntimePending>} */
  #pending = new Map();

  /**
   * @param {RuntimeAdapter} adapter
   */
  constructor(adapter) {
    this.#adapter = adapter;
    adapter.setReceiver((frame) => this.#receive(frame));
    adapter.setConnectionListener((connected) => this.#connectionChanged(connected));
  }

  /**
   * @param {RuntimeCommand} command
   * @param {RuntimeTargetInput | null | undefined} target
   * @param {{ idempotencyKey?: string }} [options]
   */
  request(command, target, options = {}) {
    try {
      assertTarget(target);
      if (MUTATION_TYPES.has(command?.type) && !options.idempotencyKey) {
        throw new Error(`Runtime mutation ${command.type} requires idempotencyKey`);
      }
      this.#adapter.subscribeTarget?.(target);
      return this.#send({
        type: "runtime_request",
        target,
        command,
        ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /**
   * @param {string} sessionId
   */
  snapshot(sessionId) {
    if (!sessionId) return Promise.reject(new Error("snapshot requires sessionId"));
    return this.#send({ type: "runtime_snapshot_request", sessionId });
  }

  // Tell the host registry that `target`'s instance is now actually serving
  // `newSessionId` (e.g. after pi forks a new session file in place for the
  // same instance). Without this, the registry keeps the old session id
  // forever: snapshot lookups by session id fail, and the per-client event
  // subscription (matched on the full target tuple) silently stops
  // delivering events once the frontend adopts the new id on its own.
  // Resolves with the confirmed `{workspaceId, sessionId, instanceId}`.
  /**
   * @param {RuntimeTargetInput | null | undefined} target
   * @param {string} newSessionId
   */
  rebindSession(target, newSessionId) {
    try {
      assertTarget(target);
      if (!newSessionId) throw new Error("rebindSession requires newSessionId");
      return this.#send({ type: "runtime_rebind_session_request", target, newSessionId }).then(
        (frame) => frame?.response?.data?.target ?? null,
      );
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /**
   * @param {RuntimeCommand} command
   * @param {RuntimeTargetInput | null | undefined} target
   */
  git(command, target) {
    try {
      assertTarget(target);
      this.#adapter.subscribeTarget?.(target);
      return this.#send(
        {
          type: command?.type === "git_ai_commit_message" ? "git_ai_commit_message" : "git_command",
          workspaceId: target.workspaceId,
          command: command?.type === "git_ai_commit_message" ? undefined : command,
        },
        command?.requestId,
      );
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /**
   * @param {string} instanceId
   */
  capabilities(instanceId) {
    if (!instanceId) return Promise.reject(new Error("capabilities requires instanceId"));
    return this.#send({ type: "runtime_capabilities_request", instanceId });
  }

  /**
   * @param {RuntimeListener} listener
   */
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * @param {Record<string, unknown>} frame
   * @param {string | null | undefined} [requestIdOverride]
   * @returns {Promise<Frame>}
   */
  #send(frame, requestIdOverride = null) {
    const requestId = requestIdOverride || this.#ids();
    const generation = this.#generation;
    /** @type {Promise<Frame>} */
    return new Promise((resolve, reject) => {
      this.#pending.set(requestId, { resolve, reject, generation });
      try {
        this.#adapter.send({ ...frame, requestId });
      } catch (error) {
        this.#pending.delete(requestId);
        reject(error);
      }
    });
  }

  /**
   * @param {Frame} frame
   */
  #receive(frame) {
    if (frame?.requestId) {
      const pending = this.#pending.get(frame.requestId);
      if (pending && pending.generation === this.#generation) {
        this.#pending.delete(frame.requestId);
        if (frame.error) pending.reject(new Error(frame.error.message ?? String(frame.error)));
        else pending.resolve(frame);
        return;
      }
    }
    for (const listener of this.#listeners) listener(frame);
  }

  /**
   * @param {boolean} connected
   */
  #connectionChanged(connected) {
    if (connected) return;
    this.#generation += 1;
    for (const pending of this.#pending.values()) {
      pending.reject(new Error("Runtime disconnected before the request completed"));
    }
    this.#pending.clear();
  }
}

export function createInMemoryRuntimeAdapter() {
  let connected = true;
  /** @type {Set<RuntimeListener>} */
  const receivers = new Set();
  /** @type {Set<(connected: boolean) => void>} */
  const connectionListeners = new Set();
  /** @type {Record<string, unknown>[]} */
  const sent = [];
  return {
    /**
     * @param {Record<string, unknown>} frame
     */
    send(frame) {
      if (!connected) throw new Error("Runtime adapter is disconnected");
      sent.push(structuredClone(frame));
    },
    /**
     * @param {RuntimeListener} listener
     */
    setReceiver(listener) {
      receivers.add(listener);
      return () => receivers.delete(listener);
    },
    /**
     * @param {(connected: boolean) => void} listener
     */
    setConnectionListener(listener) {
      connectionListeners.add(listener);
      return () => connectionListeners.delete(listener);
    },
    takeSent() {
      return sent.shift();
    },
    /**
     * @param {Frame} frame
     */
    receive(frame) {
      for (const receiver of receivers) receiver(structuredClone(frame));
    },
    disconnect() {
      connected = false;
      for (const listener of connectionListeners) listener(false);
    },
    reconnect() {
      connected = true;
      for (const listener of connectionListeners) listener(true);
    },
  };
}
