// ABOUTME: Owner-scoped terminal broker client: request correlation, snapshot
// ABOUTME: replay (checkpoint before strictly sequential journal), and reconnect.
// ABOUTME: Owns no DOM; visual rendering belongs to terminal-tab.js.

import { createRequestIds } from "../transport/request-id.js";

/**
 * @typedef {{
 *   tab: import("./terminal-tab.js").TerminalTab,
 *   generation: number,
 *   lastAppliedSequence: number,
 *   paused: boolean,
 *   historyGap?: boolean,
 * }} ClientTabEntry
 */

/**
 * @typedef {{
 *   resolve: (value: unknown) => void,
 *   match: (msg: unknown) => boolean,
 * }} TerminalAwaiter
 */

/**
 * @typedef {{
 *   firstSequence?: number | string,
 *   lastSequence?: number | string,
 *   dataBase64: string,
 * }} TerminalBatch
 */

/**
 * @typedef {{
 *   terminalId: string,
 *   generation: number,
 *   status?: string,
 *   checkpoint?: string,
 *   checkpointWatermark?: number | string,
 *   historyGap?: boolean,
 *   journal?: TerminalBatch,
 * }} TerminalDescriptor
 */

/**
 * TerminalClient owns the broker protocol surface for one owner/workspace:
 * request correlation, the workspace-generation compare token, and the
 * snapshot-before-journal replay state machine. It never touches the DOM and
 * never accepts owner/root/port hints — those are derived by the host.
 */
export class TerminalClient {
  /**
   * @param {{
   *   send: (envelope: Record<string, unknown>) => (string | null | undefined),
   *   createTab: (terminalId: string, generation: number) => import("./terminal-tab.js").TerminalTab,
   * }} opts
   */
  constructor({ send, createTab }) {
    this.send = send;
    this.createTab = createTab;
    /** @type {Map<string, ClientTabEntry>} */
    this.tabs = new Map();
    /** @type {number | null} */
    this.workspaceGeneration = null;
    this.nextId = createRequestIds("tm");
    /** @type {TerminalAwaiter[]} */
    this._awaiters = [];
  }

  /**
   * Update the host-owned workspace generation compare token.
   * @param {unknown} generation
   * @returns {boolean}
   */
  setWorkspaceGeneration(generation) {
    const value = Number(generation);
    if (!Number.isSafeInteger(value) || value < 0) return false;
    this.workspaceGeneration = value;
    return true;
  }

  /** Drop every tab and destroy its adapter (e.g. before a full rebuild). */
  reset() {
    for (const entry of this.tabs.values()) {
      entry.tab.destroy?.();
    }
    this.tabs.clear();
  }

  /**
   * Build a terminal_command envelope around an inner payload and send it.
   * @param {Record<string, unknown>} payload
   * @returns {string | null | undefined}
   */
  command(payload) {
    if (this.workspaceGeneration === null) return null;
    const requestId = this.nextId();
    const envelope = {
      type: "terminal_command",
      requestId,
      workspaceGeneration: this.workspaceGeneration,
      payload,
    };
    return this.send(envelope);
  }

  /**
   * Send a command and resolve when a matching synchronous response arrives
   * (resolved via resolveResponse from the app's event listener). Resolves
   * `null` on timeout so a stuck host cannot block the caller indefinitely.
   * @param {Record<string, unknown>} payload
   * @param {(msg: unknown) => boolean} match
   * @param {number} [timeoutMs]
   * @returns {Promise<unknown>}
   */
  sendAndAwait(payload, match, timeoutMs = 5000) {
    return new Promise((resolve) => {
      const awaiter = { resolve, match };
      this._awaiters.push(awaiter);
      this.command(payload);
      setTimeout(() => {
        const idx = this._awaiters.indexOf(awaiter);
        if (idx >= 0) {
          this._awaiters.splice(idx, 1);
          resolve(null);
        }
      }, timeoutMs);
    });
  }

  /**
   * Resolve any sendAndAwait awaiter whose matcher accepts this response.
   * @param {unknown} msg
   */
  resolveResponse(msg) {
    for (let i = this._awaiters.length - 1; i >= 0; i -= 1) {
      if (this._awaiters[i].match(msg)) {
        const { resolve } = this._awaiters[i];
        this._awaiters.splice(i, 1);
        resolve(msg);
      }
    }
  }

  /** Request a fresh terminal_list (used on attach, reconnect, and gap recovery). */
  requestList() {
    return this.command({ type: "terminal_list" });
  }

  /**
   * Apply a terminal_listed response: rebuild tabs from descriptors.
   * @param {{ tabs?: TerminalDescriptor[] }} opts
   */
  applyListed({ tabs }) {
    const liveTabs = (tabs || []).filter((tab) => tab.status !== "restoredMetadata");
    const live = new Set(liveTabs.map((t) => t.terminalId));
    // Drop tabs the host no longer reports (closed/exited elsewhere).
    for (const id of [...this.tabs.keys()]) {
      if (!live.has(id)) this.removeTab(id);
    }
    for (const desc of liveTabs) {
      this.applySnapshot({
        terminalId: desc.terminalId,
        generation: desc.generation,
        checkpoint: desc.checkpoint,
        checkpointWatermark: desc.checkpointWatermark,
        historyGap: desc.historyGap,
        journal: desc.journal ? [desc.journal] : [],
      });
    }
  }

  /**
   * Restore one tab: write the serialized checkpoint first, then apply journal
   * batches only when the next sequence is exactly lastApplied + 1. A forward
   * gap pauses the tab and requests a fresh list rather than appending blindly.
   * @param {{
   *   terminalId: string,
   *   generation: number,
   *   checkpoint?: string,
   *   checkpointWatermark?: number | string,
   *   historyGap?: boolean,
   *   journal?: TerminalBatch[],
   * }} opts
   */
  applySnapshot({ terminalId, generation, checkpoint, checkpointWatermark, historyGap, journal }) {
    let entry = this.tabs.get(terminalId);
    if (!entry || entry.generation !== generation) {
      const tab = this.createTab(terminalId, generation);
      entry = {
        tab,
        generation,
        lastAppliedSequence: 0,
        paused: false,
        historyGap: Boolean(historyGap),
      };
      this.tabs.set(terminalId, entry);
    }
    // A fresh snapshot/list is authoritative: clear a pause left by a prior
    // forward-gap recovery before replaying checkpoint + journal.
    entry.paused = false;
    entry.historyGap = Boolean(historyGap);
    if (checkpoint) {
      entry.tab.writeSnapshot(checkpoint);
      entry.lastAppliedSequence = Number(checkpointWatermark) || 0;
    }
    for (const batch of journal || []) {
      this.applyBatch(entry, batch, { replay: true });
    }
  }

  /**
   * Apply a live terminal_output event with strict sequence validation.
   * @param {{
   *   terminalId: string,
   *   generation: number,
   *   firstSequence: number | string,
   *   lastSequence: number | string,
   *   dataBase64: string,
   * }} opts
   */
  applyOutput({ terminalId, generation, firstSequence, lastSequence, dataBase64 }) {
    const entry = this.tabs.get(terminalId);
    if (!entry || entry.generation !== generation || entry.paused) {
      return;
    }
    this.applyBatch(entry, { firstSequence, lastSequence, dataBase64 });
  }

  /**
   * Remove a tab from local state (closed/exited).
   * @param {string} terminalId
   * @param {number | null} [generation]
   * @returns {boolean}
   */
  removeTab(terminalId, generation = null) {
    const entry = this.tabs.get(terminalId);
    if (!entry || (generation !== null && entry.generation !== generation)) {
      return false;
    }
    entry.tab.destroy?.();
    this.tabs.delete(terminalId);
    return true;
  }

  /**
   * @param {ClientTabEntry} entry
   * @param {TerminalBatch} batch
   * @param {{ replay?: boolean }} [options]
   */
  applyBatch(entry, batch, { replay } = {}) {
    const first = Number(batch.firstSequence);
    const last = Number(batch.lastSequence);
    // Duplicate or already-applied sequences are ignored without pausing.
    if (first <= entry.lastAppliedSequence) {
      return;
    }
    // A retention gap is an explicit server state: display the retained tail
    // and continue from it instead of requesting the same unrecoverable list
    // forever.
    if (entry.historyGap) {
      entry.tab.writeOutput(batch.dataBase64, { replay });
      entry.lastAppliedSequence = last;
      entry.tab.ack(last);
      this.command({
        type: "terminal_ack",
        terminalId: entry.tab.terminalId,
        generation: entry.tab.generation,
        sequence: last,
      });
      return;
    }
    if (first !== entry.lastAppliedSequence + 1) {
      // Forward gap: continuity cannot be proven. Pause and re-snapshot.
      entry.paused = true;
      this.requestList();
      return;
    }
    entry.tab.writeOutput(batch.dataBase64, { replay });
    entry.lastAppliedSequence = last;
    entry.tab.ack(last);
    this.command({
      type: "terminal_ack",
      terminalId: entry.tab.terminalId,
      generation: entry.tab.generation,
      sequence: last,
    });
  }
}
