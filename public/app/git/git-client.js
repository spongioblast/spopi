// ABOUTME: Sends owner-scoped Git broker commands with workspace-generation binding.
// ABOUTME: Correlates replies and clears pending requests when the workspace changes.

/**
 * @typedef {{
 *   matcher: (message: unknown) => boolean,
 *   resolve: (value: unknown) => void,
 * }} GitPendingEntry
 */

export class GitClient {
  /** @type {((frame: Record<string, unknown>) => void) | undefined} */
  send;
  /** @type {number} */
  timeoutMs;
  /** @type {number | null} */
  generation;
  /** @type {number} */
  counter;
  /** @type {Map<string, GitPendingEntry>} */
  pending;
  /** @type {Set<string>} */
  pendingWrites;

  /**
   * @param {{
   *   send?: (frame: Record<string, unknown>) => void,
   *   timeoutMs?: number,
   * }} [options]
   */
  constructor({ send, timeoutMs = 10000 } = {}) {
    this.send = send;
    this.timeoutMs = timeoutMs;
    this.generation = null;
    this.counter = 0;
    this.pending = new Map();
    this.pendingWrites = new Set();
  }

  /** @param {unknown} value @returns {boolean} */
  setWorkspaceGeneration(value) {
    const generation = Number(value);
    if (!Number.isSafeInteger(generation) || generation < 0) return false;
    if (this.generation !== null && this.generation !== generation) this.reset();
    this.generation = generation;
    return true;
  }

  /**
   * @param {Record<string, unknown>} [payload]
   * @param {string} [frameType]
   * @returns {string | null}
   */
  command(payload = {}, frameType = "git_command") {
    if (this.generation === null) return null;
    const requestId = `git-${++this.counter}`;
    this.send?.({
      type: frameType,
      requestId,
      workspaceGeneration: this.generation,
      command: payload,
    });
    return requestId;
  }

  /**
   * @param {unknown} snapshotId
   * @param {unknown} group
   * @param {unknown} pathBytesBase64
   * @param {unknown} comparison
   * @returns {string | null}
   */
  diff(snapshotId, group, pathBytesBase64, comparison) {
    return this.command({ type: "diff", snapshotId, group, pathBytesBase64, comparison });
  }

  /**
   * @param {number} [limit]
   * @param {unknown} [before]
   * @returns {string | null}
   */
  log(limit = 50, before = null) {
    return this.command({ type: "log", limit, before });
  }

  /** @param {unknown} oid @returns {string | null} */
  logDetail(oid) {
    return this.command({ type: "log_detail", oid });
  }

  /**
   * @param {unknown} commitOid
   * @param {unknown} pathBytesBase64
   * @returns {string | null}
   */
  commitDiff(commitOid, pathBytesBase64) {
    return this.command({ type: "commit_diff", commitOid, pathBytesBase64 });
  }

  /**
   * @param {string} pathBytesBase64
   * @returns {Promise<{ content: string, exists: boolean, binary: boolean }>}
   */
  fileAtHeadText(pathBytesBase64) {
    if (this.generation === null) return Promise.reject(new Error("git_timeout"));
    const requestId = `git-${++this.counter}`;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("git_timeout"));
      }, this.timeoutMs);
      this.pending.set(requestId, {
        matcher: (message) => {
          if (!message || typeof message !== "object") return false;
          return /** @type {{ requestId?: unknown }} */ (message).requestId === requestId;
        },
        resolve: (value) => {
          clearTimeout(timer);
          const frame =
            /** @type {{ type?: string, error?: { message?: string }, content?: unknown, exists?: unknown, binary?: unknown } | null} */ (
              value
            );
          if (!frame || frame.type === "error" || frame.error) {
            reject(new Error(frame?.error?.message || "git_command_failed"));
            return;
          }
          resolve({
            content: typeof frame.content === "string" ? frame.content : "",
            exists: frame.exists !== false,
            binary: frame.binary === true,
          });
        },
      });
    });
    this.send?.({
      type: "git_command",
      requestId,
      workspaceGeneration: this.generation,
      command: { type: "file_at_head", pathBytesBase64 },
    });
    return promise;
  }

  /**
   * @param {unknown} operation
   * @param {unknown} snapshotId
   * @param {unknown} entries
   * @returns {string | null}
   */
  write(operation, snapshotId, entries) {
    const requestId = this.command({ type: operation, snapshotId, entries });
    if (requestId) this.pendingWrites.add(requestId);
    return requestId;
  }

  /** @param {unknown} message @returns {boolean} */
  consumeWriteAck(message) {
    if (!message || typeof message !== "object") return false;
    const frame = /** @type {{ workspaceGeneration?: unknown, requestId?: unknown }} */ (message);
    if (frame.workspaceGeneration !== this.generation) return false;
    const requestId = frame.requestId;
    if (typeof requestId !== "string" || !this.pendingWrites.has(requestId)) return false;
    this.pendingWrites.delete(requestId);
    return true;
  }

  /** @param {unknown} message @returns {boolean} */
  consumeWriteFailure(message) {
    if (!message || typeof message !== "object") return false;
    const frame = /** @type {{ workspaceGeneration?: unknown, requestId?: unknown }} */ (message);
    if (frame.workspaceGeneration !== this.generation) return false;
    const requestId = frame.requestId;
    if (typeof requestId !== "string") return false;
    return this.pendingWrites.delete(requestId);
  }

  /** @returns {string | null} */
  aiCommitMessage() {
    return this.command({}, "git_ai_commit_message");
  }

  /** @returns {string | null} */
  push() {
    return this.command({ type: "push" });
  }

  /** @returns {string | null} */
  fetch() {
    return this.command({ type: "fetch" });
  }

  /** @returns {string | null} */
  pull() {
    return this.command({ type: "pull" });
  }

  /** @returns {string | null} */
  branches() {
    return this.command({ type: "branches" });
  }

  /** @returns {string | null} */
  init() {
    return this.command({ type: "init" });
  }

  /**
   * @param {unknown} name
   * @param {{ create?: boolean }} [options]
   * @returns {string | null}
   */
  checkout(name, { create = false } = {}) {
    return this.command({ type: "checkout", name, create: Boolean(create) });
  }

  /**
   * @param {unknown} snapshotId
   * @param {unknown} message
   * @param {unknown} [confirmationToken]
   * @param {boolean} [amend]
   * @returns {string | null}
   */
  commit(snapshotId, message, confirmationToken = null, amend = false) {
    return this.command({ type: "commit", snapshotId, message, confirmationToken, amend });
  }

  /**
   * @param {Record<string, unknown>} payload
   * @param {((message: unknown) => boolean) | null} [matcher]
   * @param {number} [timeoutMs]
   * @returns {Promise<unknown>}
   */
  sendAndAwait(payload, matcher = null, timeoutMs = this.timeoutMs) {
    if (this.generation === null) return Promise.resolve(null);
    const requestId = `git-${++this.counter}`;
    const promise = this._await(
      requestId,
      matcher ||
        ((message) => {
          if (!message || typeof message !== "object") return false;
          return /** @type {{ requestId?: unknown }} */ (message).requestId === requestId;
        }),
      timeoutMs,
    );
    this.send?.({
      type: "git_command",
      requestId,
      workspaceGeneration: this.generation,
      command: payload,
    });
    return promise;
  }

  /**
   * @param {string} requestId
   * @param {(message: unknown) => boolean} matcher
   * @param {number} timeoutMs
   * @returns {Promise<unknown>}
   */
  _await(requestId, matcher, timeoutMs) {
    return new Promise((resolve) => {
      /** @type {ReturnType<typeof setTimeout> | 0} */
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve(null);
      }, timeoutMs);
      this.pending.set(requestId, {
        matcher,
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
      });
    });
  }

  /** @param {unknown} message @returns {boolean} */
  resolveResponse(message) {
    if (!message || typeof message !== "object") return false;
    const frame = /** @type {{ requestId?: unknown }} */ (message);
    if (typeof frame.requestId !== "string") return false;
    const requestId = frame.requestId;
    const entry = this.pending.get(requestId);
    if (!entry?.matcher(message)) return false;
    this.pending.delete(requestId);
    entry.resolve(message);
    return true;
  }

  reset() {
    for (const entry of this.pending.values()) entry.resolve(null);
    this.pending.clear();
    this.pendingWrites.clear();
    this.generation = null;
  }
}
