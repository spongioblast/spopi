// ABOUTME: Remembers which preview tabs are open and which one is active.
// ABOUTME: The state is in memory for the current window.

import { basenameLocalPath, normalizeLocalPath } from "../files/path-utils.js";
import { uiStore } from "../storage/ui-store.js";

/**
 * @typedef {{ getItem: (key: string) => string | null, setItem: (key: string, value: string) => void }} TabStorage
 *
 * @typedef {{
 *   id: string,
 *   kind: string,
 *   filePath: string,
 *   fileName: string,
 *   mode: string,
 *   content: string | null,
 *   originalContent: string | null,
 *   dirty: boolean,
 *   loading: boolean,
 *   saving: boolean,
 *   conflict: boolean,
 *   error: string | null,
 *   mtimeMs: number | null,
 *   editable: boolean | null,
 *   renderAs: string | null,
 *   truncated: boolean,
 *   isBinary: boolean,
 *   mimeType: string | null,
 *   size: number | null,
 *   saveError: string | null,
 *   errorDetail: string | null,
 * }} FileTab
 *
 * @typedef {{
 *   fileName?: string,
 *   mode?: string,
 *   editable?: boolean | null,
 *   renderAs?: string | null,
 *   truncated?: boolean,
 *   isBinary?: boolean,
 *   mimeType?: string | null,
 *   size?: number | null,
 * }} OpenFileMetadata
 *
 * @typedef {{
 *   byRoot: Record<string, { tabs?: Partial<FileTab>[], activeTabId?: string | null, touchedAt?: number }>,
 * }} TabSnapshot
 */

export class FileTabState {
  /**
   * @param {object} [opts]
   * @param {TabStorage} [opts.storage] injectable storage (defaults to the ui.* store)
   * @param {string} [opts.storageKey] key under which tab snapshots are persisted
   */
  constructor({ storage = uiStore, storageKey = "ui.editor.tabs" } = {}) {
    /** @type {TabStorage} */
    this.storage = storage;
    /** @type {string} */
    this.storageKey = storageKey;
    /** @type {string | null} */
    this.workspaceRoot = null;
    /** @type {FileTab[]} */
    this.tabs = [];
    /** @type {string | null} */
    this.activeTabId = null;
    /** @type {Set<() => void>} */
    this._listeners = new Set();
  }

  /**
   * Load persisted tab state for the given workspace root.
   * Clears any previously loaded state.
   * @param {string} workspaceRoot
   */
  load(workspaceRoot) {
    const normalized = this._normalizeRoot(workspaceRoot);
    this.workspaceRoot = normalized;
    this.tabs = [];
    this.activeTabId = null;

    const snapshot = this._readSnapshot();
    if (!snapshot) return;

    const rootState = snapshot.byRoot?.[normalized];
    if (!rootState) return;

    this.tabs = (rootState.tabs || [])
      .filter((tab) => tab && typeof tab.id === "string" && typeof tab.filePath === "string")
      .map((tab) => ({
        id: /** @type {string} */ (tab.id),
        kind: tab.kind || "file",
        filePath: /** @type {string} */ (tab.filePath),
        fileName: String(tab.fileName || basenameLocalPath(tab.filePath) || tab.filePath || ""),
        mode: tab.mode || "preview",
        content: null,
        originalContent: null,
        dirty: false,
        loading: false,
        saving: false,
        conflict: false,
        error: null,
        mtimeMs: null,
        editable: null,
        renderAs: null,
        truncated: false,
        isBinary: false,
        mimeType: null,
        size: null,
        saveError: null,
        errorDetail: null,
      }));
    const restoredActive = rootState.activeTabId;
    this.activeTabId =
      typeof restoredActive === "string" && this.tabs.some((tab) => tab.id === restoredActive)
        ? restoredActive
        : (this.tabs[0]?.id ?? null);
  }

  /**
   * Open a file tab (or select it if already open).
   * Returns the tab object.
   * @param {string} filePath
   * @param {OpenFileMetadata} [metadata]
   * @returns {FileTab}
   */
  openFile(filePath, metadata = {}) {
    const normalizedPath = this._normalizePath(filePath);
    const tabId = `file:${normalizedPath}`;

    const existing = this.tabs.find((tab) => tab.id === tabId);
    if (existing) {
      this.activeTabId = tabId;
      this.persist();
      this._notify();
      return existing;
    }

    /** @type {FileTab} */
    const tab = {
      id: tabId,
      kind: "file",
      filePath: normalizedPath,
      fileName: metadata.fileName || basenameLocalPath(normalizedPath) || normalizedPath,
      mode: metadata.mode || "preview",
      content: null,
      originalContent: null,
      dirty: false,
      loading: false,
      saving: false,
      conflict: false,
      error: null,
      mtimeMs: null,
      editable: metadata.editable ?? null,
      renderAs: metadata.renderAs ?? null,
      truncated: Boolean(metadata.truncated),
      isBinary: Boolean(metadata.isBinary),
      mimeType: metadata.mimeType || null,
      size: metadata.size ?? null,
      saveError: null,
      errorDetail: null,
    };

    this.tabs.push(tab);
    this.activeTabId = tabId;
    this._notify();
    this.persist();
    return tab;
  }

  /**
   * Select a tab by id. Returns true if the tab exists and was selected.
   * @param {string} tabId
   * @returns {boolean}
   */
  selectTab(tabId) {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab) return false;
    this.activeTabId = tabId;
    this.persist();
    this._notify();
    return true;
  }

  /**
   * Update a tab with a patch object. Only known fields are updated.
   * Returns true if the tab was found.
   * @param {string} tabId
   * @param {Partial<FileTab>} patch
   * @returns {boolean}
   */
  updateTab(tabId, patch) {
    const idx = this.tabs.findIndex((t) => t.id === tabId);
    if (idx === -1) return false;
    this.tabs[idx] = { ...this.tabs[idx], ...patch };
    this._notify();
    return true;
  }

  /**
   * @param {string} tabId
   * @returns {FileTab | null}
   */
  getTab(tabId) {
    return this.tabs.find((t) => t.id === tabId) || null;
  }

  /** @returns {FileTab[]} */
  getTabs() {
    return [...this.tabs];
  }

  /**
   * Whether any persisted tabs exist for the given workspace root, without
   * loading or switching the active state. Lets callers decide whether a
   * cross-workspace switch should immediately collapse the editor panel
   * (target has no persisted tabs) instead of waiting for the authoritative
   * setWorkspaceRoot when the workspace changes.
   * @param {string} workspaceRoot
   * @returns {boolean}
   */
  hasTabsForRoot(workspaceRoot) {
    const normalized = this._normalizeRoot(workspaceRoot);
    if (!normalized) return false;
    const snapshot = this._readSnapshot();
    if (!snapshot) return false;
    const rootState = snapshot.byRoot?.[normalized];
    return Array.isArray(rootState?.tabs) && rootState.tabs.length > 0;
  }

  /** @returns {FileTab | null} */
  getActiveTab() {
    if (!this.activeTabId) return null;
    return this.getTab(this.activeTabId);
  }

  /**
   * Close a tab. Returns the next tab id to activate, or null if no tabs remain.
   * @param {string} tabId
   * @returns {{ closed: boolean, nextTabId: string | null }}
   */
  closeTab(tabId) {
    const idx = this.tabs.findIndex((t) => t.id === tabId);
    if (idx === -1) return { closed: false, nextTabId: null };

    this.tabs.splice(idx, 1);

    /** @type {string | null} */
    let nextTabId = null;
    if (this.activeTabId === tabId) {
      // Prefer right neighbor, then left neighbor.
      if (this.tabs.length > 0) {
        const nextIdx = Math.min(idx, this.tabs.length - 1);
        nextTabId = this.tabs[nextIdx].id;
      }
      this.activeTabId = nextTabId;
    } else {
      // If the closed tab wasn't active, keep current selection.
      nextTabId = this.activeTabId;
    }

    this._notify();
    this.persist();
    return { closed: true, nextTabId };
  }

  /**
   * Subscribe to state changes. Returns an unsubscribe function.
   * @param {() => void} listener
   * @returns {() => boolean}
   */
  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  /**
   * Persist the current state (sans dirty content) to storage.
   */
  persist() {
    if (!this.storage || !this.workspaceRoot) return;

    const snapshot = this._readSnapshot() || { byRoot: {} };

    snapshot.byRoot[this.workspaceRoot] = {
      tabs: this.tabs.map((t) => ({
        id: t.id,
        kind: t.kind,
        filePath: t.filePath,
        fileName: t.fileName,
        mode: t.mode,
      })),
      activeTabId: this.activeTabId,
      touchedAt: Date.now(),
    };

    // Clamp to 20 most recently touched roots.
    const entries = Object.entries(snapshot.byRoot);
    if (entries.length > 20) {
      entries.sort((a, b) => (b[1].touchedAt || 0) - (a[1].touchedAt || 0));
      snapshot.byRoot = Object.fromEntries(entries.slice(0, 20));
    }

    try {
      this.storage.setItem(this.storageKey, JSON.stringify(snapshot));
    } catch {
      // Storage full or unavailable — non-fatal.
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────

  /**
   * @param {unknown} root
   * @returns {string}
   */
  _normalizeRoot(root) {
    if (typeof root !== "string") return "";
    return normalizeLocalPath(root) || "/";
  }

  /**
   * @param {string} filePath
   * @returns {string}
   */
  _normalizePath(filePath) {
    return normalizeLocalPath(filePath);
  }

  /** @returns {TabSnapshot | null} */
  _readSnapshot() {
    if (!this.storage) return null;
    try {
      const raw = this.storage.getItem(this.storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || !parsed.byRoot) return null;
      return /** @type {TabSnapshot} */ (parsed);
    } catch {
      return null;
    }
  }

  _notify() {
    for (const listener of this._listeners) {
      try {
        listener();
      } catch {
        // Listener error — non-fatal.
      }
    }
  }
}
