// ABOUTME: Coordinates the file preview panel: its shared state, public API, workspace switches, and open/close.
// ABOUTME: Tab actions, loading, saving, the toolbar, the tab strip, sizing, and dialogs live in sibling file-preview-* modules.

import { normalizeLocalPath } from "../files/path-utils.js";
import { onLocaleChange } from "../i18n/i18n.js";
import { uiStore } from "../storage/ui-store.js";
import { copyText } from "../ui/clipboard.js";
import { showConflictDialog, showDirtyDialog } from "./file-preview-dialogs.js";
import { abortPreviewGitDiff, fetchPreviewGitDiff } from "./file-preview-git-diff.js";
import { abortPreviewTabLoad, loadPreviewTabContent } from "./file-preview-loader.js";
import { switchPreviewMode } from "./file-preview-mode.js";
import {
  DEFAULT_PANEL_RATIO,
  readPreviewPreferences,
  writePreviewPreferences,
} from "./file-preview-prefs.js";
import { mountTabRenderer } from "./file-preview-renderer-mount.js";
import { mountFilePreviewResizer, updatePanelWidth } from "./file-preview-resizer.js";
import {
  clearAutoSave,
  reloadTab,
  saveTab,
  scheduleAutoSave,
  settleDirtyTabs,
} from "./file-preview-save.js";
import { closePreviewTab, openPreviewFile, selectPreviewTab } from "./file-preview-tab-actions.js";
import { renderFilePreviewTabBar } from "./file-preview-tab-bar.js";
import { mountFilePreviewToolbar, renderFilePreviewToolbar } from "./file-preview-toolbar.js";
import { FileTabState } from "./file-tab-state.js";
import { normalizeNewlines, sameFileText } from "./file-text.js";
import { onLeadTabChange } from "./lead-tab.js";

/**
 * @typedef {import("./file-tab-state.js").FileTab & { newlineStyle?: string }} FilePreviewTab
 * @typedef {import("./file-tab-state.js").TabStorage} FilePreviewStorage
 *
 * @typedef {{
 *   enlarge?: HTMLElement | null,
 *   collapse?: HTMLElement | null,
 *   close?: HTMLElement | null,
 *   toolbarToggle?: HTMLElement | null,
 *   toolbar?: HTMLElement | null,
 *   preview?: HTMLButtonElement | null,
 *   edit?: HTMLButtonElement | null,
 *   diff?: HTMLButtonElement | null,
 *   save?: HTMLButtonElement | null,
 *   saveIcon?: HTMLButtonElement | null,
 *   reload?: HTMLButtonElement | null,
 *   search?: HTMLButtonElement | null,
 *   goToLine?: HTMLButtonElement | null,
 *   goToLineInput?: HTMLInputElement | null,
 *   copy?: HTMLButtonElement | null,
 *   openDesktop?: HTMLButtonElement | null,
 *   wrap?: HTMLInputElement | null,
 *   autoSave?: HTMLInputElement | null,
 *   status?: HTMLElement | null,
 * }} FilePreviewControls
 *
 * @typedef {{
 *   mount: (container: Element) => void,
 *   destroy: () => void,
 *   update?: (next?: unknown) => void,
 *   getValue?: () => string,
 *   goToLine?: (line: number) => boolean,
 *   openSearch?: () => void,
 *   setWrapLines?: (wrap: boolean) => void,
 *   contentType?: string,
 * }} FilePreviewRenderer
 *
 * @typedef {{
 *   readFileContent?: (path: string, options?: { signal?: AbortSignal }) => Promise<Response>,
 *   writeFileContent?: (args: {
 *     path: string,
 *     content: string,
 *     expectedMtimeMs?: number | null,
 *     force?: boolean,
 *   }) => Promise<Response>,
 *   readGitDiff?: (path: string, options?: { signal?: AbortSignal }) => Promise<Response>,
 *   rawUrlForPath?: (path: string) => string,
 * }} FilePreviewFileApi
 *
 * @typedef {{
 *   panel?: HTMLElement | null,
 *   resizer?: HTMLElement | null,
 *   tabBar?: HTMLElement | null,
 *   content?: HTMLElement | null,
 *   mainContainer?: HTMLElement | null,
 *   fileApi?: FilePreviewFileApi | null,
 *   onOpenDesktop?: (path: string) => void,
 *   onCopyText?: (text: string) => void | Promise<void>,
 *   confirmDirty?: (
 *     tabs: FilePreviewTab[],
 *     reason: string,
 *   ) => Promise<string | false | null | undefined>,
 *   resolveConflict?: (tab: FilePreviewTab) => Promise<string | false | null | undefined>,
 *   storage?: FilePreviewStorage | null,
 *   onToggleChat?: ((collapsed: boolean) => void) | null,
 *   controls?: FilePreviewControls | null,
 *   fileSidebarToggle?: HTMLElement | null,
 * }} FilePreviewPanelOptions
 *
 * @typedef {{ kind: "file", id: string }} FilePreviewActiveContent
 */

export class FilePreviewPanel {
  /**
   * @param {FilePreviewPanelOptions} [options]
   */
  constructor({
    panel,
    resizer,
    tabBar,
    content,
    mainContainer,
    fileApi,
    onOpenDesktop,
    onCopyText,
    confirmDirty,
    resolveConflict,
    storage,
    onToggleChat,
    controls,
    fileSidebarToggle,
  } = {}) {
    /** @type {HTMLElement | null | undefined} */
    this.panel = panel;
    /** @type {HTMLElement | null | undefined} */
    this.resizer = resizer;
    /** @type {HTMLElement | null | undefined} */
    this.tabBar = tabBar;
    /** @type {HTMLElement | null | undefined} */
    this.content = content;
    /** @type {HTMLElement | null | undefined} */
    this.mainContainer = mainContainer;
    /** @type {FilePreviewFileApi | null} */
    this.fileApi = fileApi || null;
    /** @type {(path: string) => void} */
    this.onOpenDesktop = onOpenDesktop || (() => {});
    /** @type {(text: string) => void | Promise<void>} */
    this.onCopyText = onCopyText || copyText;
    /** @type {((collapsed: boolean) => void) | null} */
    this.onToggleChat = onToggleChat || null;
    /** @type {FilePreviewControls} */
    this.controls = controls || {};
    /** @type {HTMLElement | null | undefined} */
    this.fileSidebarToggle = fileSidebarToggle || null;
    /** @type {(tabs: FilePreviewTab[], reason: string) => Promise<string | false | null | undefined>} */
    this.confirmDirty = confirmDirty || ((tabs) => showDirtyDialog(this, tabs));
    /** @type {(tab: FilePreviewTab) => Promise<string | false | null | undefined>} */
    this.resolveConflict = resolveConflict || ((tab) => showConflictDialog(this, tab));

    if (storage !== undefined) {
      /** @type {FilePreviewStorage | null | undefined} */
      this.storage = storage;
    } else {
      try {
        /** @type {FilePreviewStorage | null | undefined} */
        this.storage = uiStore;
      } catch {
        this.storage = null;
      }
    }
    this.state = new FileTabState({
      storage: this.storage === null ? undefined : this.storage,
    });
    /** @type {FilePreviewRenderer | null} */
    this.currentRenderer = null;
    /** @type {string} */
    this.workspaceRoot = "";
    // gitDiff cache: tabId → { supported, patch, isNewFile, isDeletedFile } | null
    /** @type {Map<string, unknown>} */
    this.gitDiffCache = new Map();
    // In-flight diff fetch abort controllers: tabId → AbortController
    /** @type {Map<string, AbortController>} */
    this.gitDiffControllers = new Map();
    /** @type {Map<string, number>} */
    this.loadTokens = new Map();
    /** @type {Map<string, AbortController>} */
    this.loadAbortControllers = new Map();
    /** @type {Map<string, Promise<boolean>>} */
    this.savePromises = new Map();
    /** @type {Map<string, ReturnType<typeof setTimeout>>} */
    this.autoSaveTimers = new Map();
    this.autoSaveEnabled = false;
    this.wrapLines = false;
    this.panelOpen = false;
    this.enlarged = false;
    this.panelRatio = DEFAULT_PANEL_RATIO;
    this.toolbarOpen = false;
    this.goToLineInputOpen = false;
    /** @type {string} */
    this.transientStatus = "";
    /** @type {Array<() => void>} */
    this.cleanupListeners = [];
    /** @type {(() => void) | null} */
    this.activeDialogCancel = null;
    /** @type {FilePreviewActiveContent | null} */
    this.activeContent = null;
    this._interactionLocked = false;
    this._riskVersion = 0;
    /** @type {(() => void) | void | undefined} */
    this._unsubscribeLocale = undefined;
    /** @type {(() => void) | undefined} */
    this._unsubscribeState = undefined;

    this._restorePreferences();
    this._unsubscribeState = this.state.subscribe(() => {
      this._renderTabBar();
      this._renderToolbar();
    });
    mountFilePreviewResizer(this);
    mountFilePreviewToolbar(this);
    this._unsubscribeLocale = onLocaleChange(() => {
      this._renderTabBar();
      this._renderToolbar();
    });
    this._unsubscribeLead = onLeadTabChange(() => this._renderTabBar());
  }

  /** @param {string | null | undefined} root */
  async setWorkspaceRoot(root) {
    const normalized = normalizeLocalPath(root) || "/";
    if (normalized === this.workspaceRoot) return true;

    this._captureActiveRenderer();
    const dirtyTabs = this.state.getTabs().filter((tab) => tab.dirty);
    if (dirtyTabs.length > 0) {
      const settled = await this._settleDirtyTabs(dirtyTabs, "workspace");
      if (!settled) return false;
    }

    this._abortAllTabLoads();
    this._destroyRenderer();
    this.workspaceRoot = normalized;
    this.state.load(normalized);
    this._renderTabBar();
    this._renderToolbar();

    if (this.state.getTabs().length === 0) {
      this.activeContent = null;
      this._closePanel();
      return true;
    }

    const activeTab = this.state.getActiveTab();
    this.activeContent = activeTab ? { kind: "file", id: activeTab.id } : null;
    // Defer opening the panel until the restored tab's content loads. During
    // a foreground workspace switch the persisted tabs can belong to a
    // workspace the current server is not scoped to, so the content fetch
    // returns 403; opening first would flash the panel open with a load
    // error before the authoritative state closes it again. Only open on a
    // successful load that is still the current workspace.
    if (activeTab) {
      const loaded = await this._loadTabContent(activeTab);
      if (loaded && this.workspaceRoot === normalized) {
        this._openPanel();
      } else if (this.workspaceRoot === normalized) {
        this.activeContent = null;
      }
    }
    return true;
  }

  /**
   * @param {string} filePath
   * @param {{ mode?: string, line?: number | string, [key: string]: unknown }} [metadata]
   */
  openFile(filePath, metadata = {}) {
    return openPreviewFile(this, filePath, metadata);
  }

  /**
   * Open a file the agent just wrote. New files do NOT force the panel open
   * (the turn-end chips row is their entry point); an existing dirty tab is
   * focused so the concurrent write is noticed without overwriting edits;
   * an existing clean tab silently reloads from disk without stealing focus.
   */
  /** @param {string} filePath */
  async revealWrite(filePath) {
    const normalizedPath = normalizeLocalPath(filePath);
    if (!normalizedPath) return null;
    const existing = this.state.getTabs().find((tab) => tab.filePath === normalizedPath);
    if (!existing) return null;
    if (existing.dirty) return this.openFile(normalizedPath);
    await this._reloadTab(existing.id, { skipConfirmation: true });
    return this.state.getTab(existing.id);
  }

  async closePanel() {
    this._captureActiveRenderer();
    const dirtyTabs = this.state.getTabs().filter((tab) => tab.dirty);
    if (dirtyTabs.length > 0) {
      const settled = await this._settleDirtyTabs(dirtyTabs, "panel");
      if (!settled) return false;
    }
    this._closePanel();
    return true;
  }

  enlarge() {
    this.enlarged = true;
    if (this._inShell()) this.onToggleChat?.(true);
    else {
      this.panel?.classList.add("enlarged");
      this.panel?.classList.remove("collapsed");
      this.mainContainer?.classList.add("preview-enlarged");
      this._savePreferences();
    }
    this._updateControlButtons();
  }

  collapse() {
    this.enlarged = false;
    if (this._inShell()) this.onToggleChat?.(false);
    else {
      this.panel?.classList.remove("enlarged");
      this.mainContainer?.classList.remove("preview-enlarged");
      this._savePreferences();
    }
    this._updateControlButtons();
    updatePanelWidth(this);
  }

  destroy() {
    for (const timer of this.autoSaveTimers.values()) clearTimeout(timer);
    this.autoSaveTimers.clear();
    this._abortAllTabLoads();
    this.loadTokens.clear();
    this._destroyRenderer();
    this.activeDialogCancel?.();
    this.activeDialogCancel = null;

    for (const cleanup of this.cleanupListeners.splice(0)) cleanup();
    this._unsubscribeState?.();
    this._unsubscribeLocale?.();
    this._unsubscribeLead?.();
  }

  showPanel() {
    this._openPanel();
  }

  hidePanel() {
    this._closePanel();
  }

  /**
   * Whether the given workspace has any persisted file tabs in storage, without
   * switching the active state. See FileTabState.hasTabsForRoot.
   */
  /** @param {string} workspaceRoot */
  hasPersistedTabs(workspaceRoot) {
    return this.state.hasTabsForRoot?.(workspaceRoot) ?? false;
  }

  // Close-risk participant contract consumed by the window close coordinator.
  getCloseRisk() {
    this._riskVersion += 1;
    return {
      version: 3,
      riskVersion: this._riskVersion,
      dirtyFiles: this.state
        .getTabs()
        .filter((tab) => tab.dirty)
        .map((tab) => ({ id: tab.id, name: tab.fileName })),
    };
  }

  /** @param {boolean} locked */
  setInteractionLocked(locked) {
    this._interactionLocked = Boolean(locked);
    if (this.content) this.content.inert = this._interactionLocked;
    this._renderTabBar();
  }

  /** @param {string} decision */
  async settleCloseRisk(decision) {
    if (decision === "cancel") return this.getCloseRisk();
    const dirtyTabs = this.state.getTabs().filter((tab) => tab.dirty);
    if (dirtyTabs.length === 0) return this.getCloseRisk();
    if (decision === "discard") {
      for (const tab of dirtyTabs) {
        this.state.updateTab(tab.id, { content: tab.originalContent ?? "", dirty: false });
      }
      return this.getCloseRisk();
    }
    // decision === "save": flush every dirty tab.
    for (const tab of dirtyTabs) {
      await this._saveTab(tab.id).catch(() => {});
    }
    return this.getCloseRisk();
  }

  _deactivateCurrent() {
    if (this.activeContent?.kind === "file" || this.currentRenderer) {
      this._captureActiveRenderer();
      this._destroyRenderer();
      this.content?.replaceChildren();
    }
    this.activeContent = null;
  }

  _openPanel() {
    this.panelOpen = true;
    this.panel?.classList.remove("collapsed");
    this.resizer?.classList.remove("collapsed");
    updatePanelWidth(this);
    this._updateControlButtons();
    this._renderToolbar();
  }

  _closePanel() {
    this.panelOpen = false;
    this.enlarged = false;
    this.panel?.classList.add("collapsed");
    this.panel?.classList.remove("enlarged");
    this.resizer?.classList.add("collapsed");
    this.mainContainer?.classList.remove("preview-enlarged");
    if (this.activeContent) this._deactivateCurrent();
    this._destroyRenderer();
    this.content?.replaceChildren();
    this._updateControlButtons();
    this._renderToolbar();
  }

  _destroyRenderer() {
    if (!this.currentRenderer) return;
    this.currentRenderer.destroy();
    this.currentRenderer = null;
  }

  _captureActiveRenderer() {
    const tab = this.state.getActiveTab();
    const value = this.currentRenderer?.getValue?.();
    if (!tab || typeof value !== "string" || value === tab.content) return;
    this.state.updateTab(tab.id, {
      content: normalizeNewlines(value),
      dirty: !sameFileText(value, tab.originalContent ?? ""),
    });
  }

  _updateControlButtons() {
    const enlargeBtn = this.controls.enlarge;
    const collapseBtn = this.controls.collapse;
    enlargeBtn?.classList.toggle("hidden", this.enlarged);
    collapseBtn?.classList.toggle("hidden", !this.enlarged);
  }

  _inShell() {
    return Boolean((this.panel || this.mainContainer)?.closest(".spopi-shell"));
  }

  _renderTabBar() {
    renderFilePreviewTabBar(this);
  }

  _renderToolbar() {
    renderFilePreviewToolbar(this);
  }

  /** @param {string} tabId */
  _selectTab(tabId) {
    return selectPreviewTab(this, tabId);
  }

  /** @param {string} tabId */
  _closeTab(tabId) {
    return closePreviewTab(this, tabId);
  }

  /** @param {FilePreviewTab} tab */
  _loadTabContent(tab) {
    return loadPreviewTabContent(this, tab);
  }

  /** @param {string | null | undefined} tabId */
  _abortTabLoad(tabId) {
    abortPreviewTabLoad(this, tabId);
  }

  _abortAllTabLoads() {
    for (const tabId of this.loadAbortControllers.keys()) this._abortTabLoad(tabId);
    for (const tabId of [...this.gitDiffControllers.keys()]) abortPreviewGitDiff(this, tabId);
    this.gitDiffCache.clear();
  }

  /**
   * @param {string} tabId
   * @param {string} filePath
   */
  _fetchGitDiff(tabId, filePath) {
    return fetchPreviewGitDiff(this, tabId, filePath);
  }

  /** @param {string} tabId */
  async _mountIfActive(tabId) {
    if (this.state.activeTabId !== tabId) return;
    const tab = this.state.getTab(tabId);
    if (tab) await this._mountRenderer(tab);
  }

  /** @param {FilePreviewTab | null | undefined} tab */
  _mountRenderer(tab) {
    return mountTabRenderer(this, tab);
  }

  /** @param {string} tabId */
  _scheduleAutoSave(tabId) {
    scheduleAutoSave(this, tabId);
  }

  /** @param {string} tabId */
  _clearAutoSave(tabId) {
    clearAutoSave(this, tabId);
  }

  /**
   * @param {string} tabId
   * @param {{ autoSave?: boolean, force?: boolean }} [options]
   */
  _saveTab(tabId, options) {
    return saveTab(this, tabId, options);
  }

  /**
   * @param {string} tabId
   * @param {{ skipConfirmation?: boolean }} [options]
   */
  _reloadTab(tabId, options) {
    return reloadTab(this, tabId, options);
  }

  /**
   * @param {FilePreviewTab[]} tabs
   * @param {string} reason
   */
  _settleDirtyTabs(tabs, reason) {
    return settleDirtyTabs(this, tabs, reason);
  }

  /** @param {string} mode */
  _setMode(mode) {
    return switchPreviewMode(this, mode);
  }

  /**
   * @param {EventTarget | null | undefined} target
   * @param {string} eventName
   * @param {EventListener} listener
   */
  _listen(target, eventName, listener) {
    if (!target) return;
    target.addEventListener(eventName, listener);
    this.cleanupListeners.push(() => target.removeEventListener(eventName, listener));
  }

  _restorePreferences() {
    Object.assign(this, readPreviewPreferences(this.storage));
  }

  _savePreferences() {
    writePreviewPreferences(this.storage, this);
  }
}
