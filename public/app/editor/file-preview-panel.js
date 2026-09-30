// ABOUTME: Coordinates file preview tabs and panel layout.
// ABOUTME: Owns dirty-buffer settlement, renderer lifecycle, and tab interactions.

import { normalizeLocalPath } from "../files/path-utils.js";
import { onLocaleChange, t } from "../i18n/i18n.js";
import { uiStore } from "../storage/ui-store.js";
import { readFile, writeFile } from "../transport/workspace-http.js";
import { bindModal } from "../ui/dialog.js";
import { createIcon } from "../ui/icons.js";
import { createLoadingPlaceholder } from "../ui/loading-placeholder.js";
import { classifyFilePath } from "./file-classify.js";
import {
  DEFAULT_PANEL_RATIO,
  readPreviewPreferences,
  writePreviewPreferences,
} from "./file-preview-prefs.js";
import { createFileRenderer } from "./file-preview-renderers.js";
import { FileTabState } from "./file-tab-state.js";
import { applyNewlineStyle, newlineStyle, normalizeNewlines, sameFileText } from "./file-text.js";
import { leadTabActive, leadTabs, leaveLeadTab, onLeadTabChange } from "./lead-tab.js";

/**
 * @typedef {import("./file-tab-state.js").FileTab & { newlineStyle?: string }} FilePreviewTab
 * @typedef {import("./file-tab-state.js").TabStorage} FilePreviewStorage
 * @typedef {import("./file-preview-renderers.js").FileRendererOptions} FileRendererOptions
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

const AUTO_SAVE_DELAY = 1500;
const MIN_PANEL_WIDTH = 320;
const SVG_NS = "http://www.w3.org/2000/svg";

/** @param {HTMLElement} button */
function appendCloseIcon(button) {
  const svg = document.createElementNS(SVG_NS, "svg");
  for (const [name, value] of Object.entries({
    "aria-hidden": "true",
    width: "10",
    height: "10",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2.5",
    "stroke-linecap": "round",
  })) {
    svg.setAttribute(name, value);
  }
  const firstLine = document.createElementNS(SVG_NS, "line");
  firstLine.setAttribute("x1", "18");
  firstLine.setAttribute("y1", "6");
  firstLine.setAttribute("x2", "6");
  firstLine.setAttribute("y2", "18");
  const secondLine = document.createElementNS(SVG_NS, "line");
  secondLine.setAttribute("x1", "6");
  secondLine.setAttribute("y1", "6");
  secondLine.setAttribute("x2", "18");
  secondLine.setAttribute("y2", "18");
  svg.append(firstLine, secondLine);
  button.appendChild(svg);
}

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
    this.onCopyText = onCopyText || ((text) => navigator.clipboard?.writeText(text));
    /** @type {((collapsed: boolean) => void) | null} */
    this.onToggleChat = onToggleChat || null;
    /** @type {FilePreviewControls} */
    this.controls = controls || {};
    /** @type {HTMLElement | null | undefined} */
    this.fileSidebarToggle = fileSidebarToggle || null;
    /** @type {(tabs: FilePreviewTab[], reason: string) => Promise<string | false | null | undefined>} */
    this.confirmDirty = confirmDirty || ((tabs, reason) => this._showDirtyDialog(tabs, reason));
    /** @type {(tab: FilePreviewTab) => Promise<string | false | null | undefined>} */
    this.resolveConflict = resolveConflict || ((tab) => this._showConflictDialog(tab));

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
    this._setupListeners();
    this._setupResizer();
    this._setupControls();
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
  async openFile(filePath, metadata = {}) {
    leaveLeadTab();
    const normalizedPath = normalizeLocalPath(filePath);
    const existing = this.state.getTabs().find((tab) => tab.filePath === normalizedPath);
    const currentTab = this.state.getActiveTab();

    if (existing) {
      if (metadata.mode === "diff") this.state.updateTab(existing.id, { mode: "diff" });
      if (metadata.mode === "diff") void this._fetchGitDiff(existing.id, existing.filePath);
      if (currentTab?.id !== existing.id) {
        if (this._isConversionTab(currentTab)) this._abortTabLoad(currentTab?.id);
        this._captureActiveRenderer();
        this.state.selectTab(existing.id);
        if (existing.content === null && existing.loading) {
          this._abortTabLoad(existing.id);
          this.state.updateTab(existing.id, { loading: false, error: null, errorDetail: null });
        }
      }
      this._openPanel();
      this._renderTabBar();
      const freshExisting = this.state.getTab(existing.id);
      if (freshExisting?.content === null && !freshExisting.loading) {
        await this._loadTabContent(freshExisting);
      } else if (currentTab?.id !== existing.id || !this.currentRenderer) {
        await this._mountRenderer(freshExisting);
      }
      this.activeContent = { kind: "file", id: existing.id };
      this._revealLine(metadata.line);
      return existing;
    }

    if (this._isConversionTab(currentTab)) this._abortTabLoad(currentTab?.id);
    this._captureActiveRenderer();
    const defaultMode =
      metadata.mode ??
      (classifyFilePath(normalizedPath).contentType === "text" ? "edit" : "preview");
    const tab = this.state.openFile(normalizedPath, { ...metadata, mode: defaultMode });
    if (metadata.mode === "diff") void this._fetchGitDiff(tab.id, tab.filePath);
    this._openPanel();
    this._renderTabBar();
    await this._loadTabContent(tab);
    this.activeContent = { kind: "file", id: tab.id };
    this._revealLine(metadata.line);
    return tab;
  }

  /** @param {number | string | null | undefined} line */
  _revealLine(line) {
    const lineNumber = Number(line);
    if (!Number.isInteger(lineNumber) || lineNumber < 1) return false;
    return this.currentRenderer?.goToLine?.(lineNumber) ?? false;
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
    if (document.querySelector(".spopi-shell")) this.onToggleChat?.(true);
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
    if (document.querySelector(".spopi-shell")) this.onToggleChat?.(false);
    else {
      this.panel?.classList.remove("enlarged");
      this.mainContainer?.classList.remove("preview-enlarged");
      this._savePreferences();
    }
    this._updateControlButtons();
    this._updatePanelWidth();
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
    this._updatePanelWidth();
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

  _availableWidth() {
    const layoutWidth = this.panel?.parentElement?.offsetWidth || 0;
    const combinedWidth = (this.mainContainer?.offsetWidth || 0) + (this.panel?.offsetWidth || 0);
    return layoutWidth || combinedWidth || this.mainContainer?.offsetWidth || 800;
  }

  /** @param {number} width */
  _applyPanelWidth(width) {
    if (document.querySelector(".spopi-shell")) return;
    const panel = this.panel;
    if (!panel) return;
    const totalWidth = this._availableWidth();
    const maxWidth = Math.max(1, totalWidth * 0.7);
    const minWidth = Math.min(MIN_PANEL_WIDTH, maxWidth);
    const clampedWidth = Math.max(minWidth, Math.min(maxWidth, width));
    this.panelRatio = clampedWidth / totalWidth;
    panel.style.width = `${Math.round(clampedWidth)}px`;
    panel.style.flexBasis = `${Math.round(clampedWidth)}px`;
    this.resizer?.setAttribute("aria-valuenow", String(Math.round(this.panelRatio * 100)));
  }

  _updatePanelWidth() {
    if (document.querySelector(".spopi-shell") || !this.panel || this.enlarged) return;
    this._applyPanelWidth(this._availableWidth() * this.panelRatio);
  }

  _renderTabBar() {
    if (!this.tabBar) return;
    this.tabBar.replaceChildren();
    this.tabBar.setAttribute("role", "tablist");
    const leading = leadTabActive();
    this._renderLeadTabs();

    for (const tab of this.state.getTabs()) {
      const tabEl = document.createElement("div");
      const isActive =
        !leading &&
        (this.activeContent?.kind === "file"
          ? this.activeContent.id === tab.id
          : this.activeContent == null && tab.id === this.state.activeTabId);
      tabEl.className = `file-preview-tab${isActive ? " active" : ""}`;
      tabEl.dataset.tabId = tab.id;
      tabEl.setAttribute("role", "tab");
      tabEl.setAttribute("tabindex", isActive ? "0" : "-1");
      tabEl.setAttribute("aria-selected", String(isActive));

      const icon = document.createElement("span");
      icon.className = "file-preview-tab-icon";
      icon.textContent = this._getFileIcon(tab.fileName);
      icon.setAttribute("aria-hidden", "true");
      tabEl.appendChild(icon);

      const name = document.createElement("span");
      name.className = "file-preview-tab-name";
      name.textContent = tab.fileName;
      name.title = tab.filePath;
      tabEl.appendChild(name);

      if (tab.dirty) {
        const dot = document.createElement("span");
        dot.className = "file-preview-tab-dirty";
        dot.textContent = "●";
        dot.title = t("files.unsaved.title");
        dot.setAttribute("aria-label", t("files.unsaved.title"));
        tabEl.appendChild(dot);
      }
      if (tab.conflict) {
        const warning = document.createElement("span");
        warning.className = "file-preview-tab-conflict";
        warning.textContent = "⚠";
        warning.title = t("files.preview.conflict");
        warning.setAttribute("aria-label", t("files.preview.conflict"));
        tabEl.appendChild(warning);
      }

      const closeBtn = document.createElement("button");
      closeBtn.className = "file-preview-tab-close";
      closeBtn.type = "button";
      closeBtn.title = t("files.preview.close");
      closeBtn.setAttribute("aria-label", t("files.preview.close"));
      closeBtn.disabled = this._interactionLocked;
      appendCloseIcon(closeBtn);
      closeBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        void this._closeTab(tab.id);
      });
      tabEl.appendChild(closeBtn);

      const showTab = () => {
        leaveLeadTab();
        void this._selectTab(tab.id).then(() => this._renderTabBar());
      };
      tabEl.addEventListener("click", () => {
        if (!this._interactionLocked) showTab();
      });
      tabEl.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          showTab();
          return;
        }
        this._onTabKeydown(event);
      });
      this.tabBar.appendChild(tabEl);
    }

    this._ensureRovingTabindex();
  }

  _renderLeadTabs() {
    for (const [id, lead] of leadTabs()) this._renderLeadTab(id, lead);
  }

  /**
   * @param {string} id
   * @param {import("./lead-tab.js").LeadTab} lead
   */
  _renderLeadTab(id, lead) {
    if (!this.tabBar) return;
    const tabEl = document.createElement("div");
    tabEl.className = `file-preview-tab lead-tab${lead.active ? " active" : ""}`;
    tabEl.dataset.leadTab = id;
    tabEl.setAttribute("role", "tab");
    tabEl.setAttribute("tabindex", lead.active ? "0" : "-1");
    tabEl.setAttribute("aria-selected", String(lead.active));

    const icon = document.createElement("span");
    icon.className = "file-preview-tab-icon";
    icon.setAttribute("aria-hidden", "true");
    const svg = createIcon(lead.icon || "review", { size: 12 });
    if (svg) icon.appendChild(svg);
    tabEl.appendChild(icon);

    const name = document.createElement("span");
    name.className = "file-preview-tab-name";
    name.textContent = lead.label;
    tabEl.appendChild(name);

    const closeBtn = document.createElement("button");
    closeBtn.className = "file-preview-tab-close";
    closeBtn.type = "button";
    closeBtn.title = t("files.preview.close");
    closeBtn.setAttribute("aria-label", t("files.preview.close"));
    appendCloseIcon(closeBtn);
    closeBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      lead.onClose();
    });
    tabEl.appendChild(closeBtn);

    const select = () => {
      if (!this._interactionLocked && !lead.active) lead.onSelect();
    };
    tabEl.addEventListener("click", select);
    tabEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        select();
        return;
      }
      this._onTabKeydown(event);
    });
    this.tabBar.appendChild(tabEl);
  }

  /** @param {KeyboardEvent} event */
  _onTabKeydown(event) {
    if (this._interactionLocked || !this.tabBar) return;
    const tabs = Array.from(this.tabBar.querySelectorAll(".file-preview-tab"));
    const currentTarget = event.currentTarget;
    const current =
      currentTarget && typeof currentTarget === "object"
        ? tabs.indexOf(/** @type {Element} */ (currentTarget))
        : -1;
    if (current < 0) return;
    let target = current;
    if (event.key === "ArrowRight") target = (current + 1) % tabs.length;
    else if (event.key === "ArrowLeft") target = (current - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = tabs.length - 1;
    else return;
    event.preventDefault();
    const next = tabs[target];
    if (next && "focus" in next && typeof next.focus === "function") {
      next.focus();
    }
    if (next && "click" in next && typeof next.click === "function") {
      next.click();
    }
    // Keep the focused tab visible when the tab strip overflows.
    if (next && "scrollIntoView" in next && typeof next.scrollIntoView === "function") {
      next.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }

  // Roving tabindex: exactly one tab is in the tab order. If none is active,
  // make the first tab focusable so keyboard users can enter the strip.
  _ensureRovingTabindex() {
    if (!this.tabBar) return;
    const tabs = Array.from(this.tabBar.querySelectorAll(".file-preview-tab"));
    if (tabs.length === 0) return;
    if (tabs.some((tab) => tab.getAttribute("tabindex") === "0")) return;
    tabs[0].setAttribute("tabindex", "0");
  }

  /** @param {string} fileName */
  _getFileIcon(fileName) {
    const ext = (fileName.split(".").pop() || "").toLowerCase();
    /** @type {Record<string, string>} */
    const iconMap = {
      js: "📄",
      ts: "📄",
      jsx: "📄",
      tsx: "📄",
      py: "🐍",
      r: "📊",
      json: "📋",
      yaml: "📋",
      yml: "📋",
      md: "📝",
      markdown: "📝",
      html: "🌐",
      css: "🎨",
      png: "🖼️",
      jpg: "🖼️",
      jpeg: "🖼️",
      gif: "🖼️",
      svg: "🎨",
      pdf: "📕",
    };
    return iconMap[ext] || "📄";
  }

  /** @param {string} tabId */
  async _selectTab(tabId) {
    const currentTab = this.state.getActiveTab();
    if (currentTab?.id === tabId) {
      if (!this.currentRenderer) {
        const tab = this.state.getTab(tabId);
        if (tab) await this._mountRenderer(tab);
      }
      this.activeContent = { kind: "file", id: tabId };
      return true;
    }
    if (this._isConversionTab(currentTab)) this._abortTabLoad(currentTab?.id);
    this._captureActiveRenderer();
    if (!this.state.selectTab(tabId)) return false;

    const tab = this.state.getTab(tabId);
    if (!tab) return false;
    if (tab.content === null && !tab.loading) {
      await this._loadTabContent(tab);
    } else {
      await this._mountRenderer(tab);
    }
    this.activeContent = { kind: "file", id: tabId };
    return true;
  }

  /** @param {string} tabId */
  async _closeTab(tabId) {
    const tab = this.state.getTab(tabId);
    if (!tab) return false;
    if (tab.id === this.state.activeTabId) this._captureActiveRenderer();

    const freshTab = this.state.getTab(tabId);
    if (freshTab?.dirty) {
      const settled = await this._settleDirtyTabs([freshTab], "tab");
      if (!settled) return false;
    }

    this._clearAutoSave(tabId);
    this._abortTabLoad(tabId);
    this._abortGitDiff(tabId);
    this.gitDiffCache.delete(tabId);
    this.loadTokens.delete(tabId);
    const wasActive = this.state.activeTabId === tabId;
    if (wasActive) this._destroyRenderer();
    const result = this.state.closeTab(tabId);
    if (!result.closed) return false;

    if (result.nextTabId) {
      const nextTab = this.state.getTab(result.nextTabId);
      if (nextTab?.content === null && !nextTab.loading) {
        await this._loadTabContent(nextTab);
      } else if (wasActive && nextTab) {
        await this._mountRenderer(nextTab);
      }
      if (wasActive) {
        const nextFocus = Array.from(this.tabBar?.querySelectorAll("[data-tab-id]") || []).find(
          (node) => {
            if (!("dataset" in node)) return false;
            const dataset = /** @type {DOMStringMap} */ (node.dataset);
            return dataset.tabId === result.nextTabId;
          },
        );
        if (nextFocus && "focus" in nextFocus && typeof nextFocus.focus === "function") {
          nextFocus.focus();
        }
      }
    } else {
      this._closePanel();
      const lead = leadTabs().at(-1)?.[1];
      if (lead) lead.onSelect();
      else if (wasActive) this.fileSidebarToggle?.focus();
    }
    return true;
  }

  /** @param {FilePreviewTab} tab */
  async _loadTabContent(tab) {
    this._abortTabLoad(tab.id);
    const token = (this.loadTokens.get(tab.id) || 0) + 1;
    this.loadTokens.set(tab.id, token);
    this.state.updateTab(tab.id, { loading: true, error: null, errorDetail: null });

    const controller = new AbortController();
    this.loadAbortControllers.set(tab.id, controller);

    try {
      const res = this.fileApi?.readFileContent
        ? await this.fileApi.readFileContent(tab.filePath, { signal: controller.signal })
        : await readFile(tab.filePath, { signal: controller.signal });
      if (this.loadTokens.get(tab.id) !== token || !this.state.getTab(tab.id)) return false;
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        this.state.updateTab(tab.id, {
          loading: false,
          error: t("files.preview.loadError"),
          errorDetail: errorData.error || `HTTP ${res.status}`,
        });
        await this._mountIfActive(tab.id);
        return false;
      }

      const data = await res.json();
      if (this.loadTokens.get(tab.id) !== token || !this.state.getTab(tab.id)) return false;
      const classification = classifyFilePath(tab.filePath);
      if (data.previewStatus === "dependencyUnavailable") {
        const reason = data.dependencyReason;
        const version = typeof data.pythonVersion === "string" ? data.pythonVersion : "";
        const messageKey = `files.preview.markitdown.${reason}`;
        const message = t(messageKey, version ? { version } : undefined);
        const needsInstallCommand =
          reason === "markitdownMissing" || reason === "markitdownIncompatible";
        const displayCommand =
          typeof data.displayCommand === "string" && /^[a-z0-9 ._-]+$/i.test(data.displayCommand)
            ? data.displayCommand
            : /win/i.test(globalThis.navigator?.platform || "")
              ? "py -3"
              : "python3";
        const installKey = /win/i.test(displayCommand)
          ? "files.preview.markitdown.installWindows"
          : "files.preview.markitdown.installPosix";
        const installCommand = t(installKey).replace(/^(python3|py -3)/, displayCommand);
        const guidance = needsInstallCommand ? `${message}\n${installCommand}` : message;
        this.state.updateTab(tab.id, {
          loading: false,
          content: null,
          originalContent: null,
          editable: false,
          mode: "preview",
          error: guidance,
          errorDetail: null,
          isBinary: false,
        });
        await this._mountIfActive(tab.id);
        return false;
      }
      if (data.previewStatus === "conversionFailed") {
        this.state.updateTab(tab.id, {
          loading: false,
          content: null,
          originalContent: null,
          editable: false,
          mode: "preview",
          error: t("files.preview.unsupportedBinary"),
          errorDetail: null,
          isBinary: false,
        });
        await this._mountIfActive(tab.id);
        return false;
      }
      if (
        data.isBinary &&
        (classification.contentType === "text" || classification.contentType === "binary")
      ) {
        this.state.updateTab(tab.id, {
          loading: false,
          error: t("files.preview.unsupportedBinary"),
          errorDetail: null,
          isBinary: true,
          editable: false,
        });
        await this._mountIfActive(tab.id);
        return false;
      }

      const editable =
        data.editable !== false && classification.editable && !data.truncated && !data.isBinary;
      /** @type {Partial<FilePreviewTab>} */
      const loadedPatch = {
        loading: false,
        content: normalizeNewlines(data.content ?? ""),
        originalContent: normalizeNewlines(data.content ?? ""),
        newlineStyle: newlineStyle(data.content ?? ""),
        renderAs: data.renderAs,
        mtimeMs: data.mtimeMs,
        mimeType: data.mimeType,
        size: data.size,
        truncated: Boolean(data.truncated),
        isBinary: Boolean(data.isBinary),
        editable,
        dirty: false,
        conflict: false,
        saveError: null,
        error: null,
        errorDetail: null,
        mode: editable ? tab.mode : "preview",
      };
      this.state.updateTab(
        tab.id,
        /** @type {Partial<import("./file-tab-state.js").FileTab>} */ (
          /** @type {unknown} */ (loadedPatch)
        ),
      );
      this.state.persist();
      await this._mountIfActive(tab.id);
      // Fire-and-forget git diff fetch (non-blocking, only when a workspace is known)
      if (this.workspaceRoot) void this._fetchGitDiff(tab.id, tab.filePath);
      return true;
    } catch (error) {
      const errName =
        error && typeof error === "object" && "name" in error
          ? String(/** @type {{ name?: unknown }} */ (error).name)
          : "";
      if (errName === "AbortError" || controller.signal.aborted) {
        if (this.loadTokens.get(tab.id) === token && this.state.getTab(tab.id)) {
          this.state.updateTab(tab.id, { loading: false, error: null, errorDetail: null });
        }
        return false;
      }
      if (this.loadTokens.get(tab.id) !== token || !this.state.getTab(tab.id)) return false;
      this.state.updateTab(tab.id, {
        loading: false,
        error: t("files.preview.loadError"),
        errorDetail: error instanceof Error ? error.message : String(error),
      });
      await this._mountIfActive(tab.id);
      return false;
    } finally {
      if (this.loadAbortControllers.get(tab.id) === controller) {
        this.loadAbortControllers.delete(tab.id);
      }
    }
  }

  /** @param {FilePreviewTab | null | undefined} tab */
  _isConversionTab(tab) {
    return Boolean(tab && classifyFilePath(tab.filePath).contentType === "convertible");
  }

  /** @param {string | null | undefined} tabId */
  _abortTabLoad(tabId) {
    if (!tabId) return;
    this.loadTokens.set(tabId, (this.loadTokens.get(tabId) || 0) + 1);
    const tab = this.state.getTab(tabId);
    if (tab?.content === null && tab.loading) {
      this.state.updateTab(tabId, { loading: false, error: null, errorDetail: null });
    }
    const controller = this.loadAbortControllers.get(tabId);
    if (!controller) return;
    this.loadAbortControllers.delete(tabId);
    controller.abort();
  }

  _abortAllTabLoads() {
    for (const tabId of this.loadAbortControllers.keys()) this._abortTabLoad(tabId);
    for (const tabId of [...this.gitDiffControllers.keys()]) this._abortGitDiff(tabId);
    this.gitDiffCache.clear();
  }

  /** @param {string} tabId */
  _abortGitDiff(tabId) {
    const ctrl = this.gitDiffControllers.get(tabId);
    if (ctrl) {
      ctrl.abort();
      this.gitDiffControllers.delete(tabId);
    }
  }

  /**
   * @param {string} tabId
   * @param {string} filePath
   */
  async _fetchGitDiff(tabId, filePath) {
    this._abortGitDiff(tabId);
    const ctrl = new AbortController();
    this.gitDiffControllers.set(tabId, ctrl);
    try {
      const res = await this.fileApi?.readGitDiff?.(filePath, { signal: ctrl.signal });
      if (!res) {
        this.gitDiffCache.set(tabId, null);
        return;
      }
      if (!res.ok) {
        this.gitDiffCache.set(tabId, null);
        return;
      }
      const data = await res.json();
      if (!data.supported) {
        this.gitDiffCache.set(tabId, null);
        return;
      }
      this.gitDiffCache.set(tabId, data);
    } catch (e) {
      const errName =
        e && typeof e === "object" && "name" in e
          ? String(/** @type {{ name?: unknown }} */ (e).name)
          : "";
      if (errName !== "AbortError") this.gitDiffCache.set(tabId, null);
      return;
    } finally {
      if (this.gitDiffControllers.get(tabId) === ctrl) this.gitDiffControllers.delete(tabId);
    }
    this._renderToolbar();
    const activeTab = this.state.getActiveTab();
    if (activeTab?.id === tabId && activeTab?.mode === "diff") {
      const tab = this.state.getTab(tabId);
      if (tab) await this._mountRenderer(tab);
    }
  }

  /** @param {string} tabId */
  async _mountIfActive(tabId) {
    if (this.state.activeTabId !== tabId) return;
    const tab = this.state.getTab(tabId);
    if (tab) await this._mountRenderer(tab);
  }

  /** @param {FilePreviewTab | null | undefined} tab */
  async _mountRenderer(tab) {
    if (!tab || tab.id !== this.state.activeTabId || !this.content) return;
    this._destroyRenderer();
    this.content.replaceChildren();

    if (tab.loading) {
      this.content.appendChild(
        createLoadingPlaceholder({
          className: "file-preview-loading",
          label: t("files.preview.loading"),
        }),
      );
      this._renderToolbar();
      return;
    }
    if (tab.error) {
      const errorEl = document.createElement("div");
      errorEl.className = "file-preview-error";
      errorEl.textContent = tab.error;
      this.content.appendChild(errorEl);
      this._renderToolbar();
      return;
    }

    const tabId = tab.id;
    const gitDiff = this.gitDiffCache.get(tab.id);
    /** @type {FileRendererOptions} */
    const rendererOptions = {
      filePath: tab.filePath,
      fileName: tab.fileName,
      content: tab.content || "",
      renderAs: tab.renderAs ?? undefined,
      mode: tab.mode || "preview",
      readOnly: tab.mode !== "edit" || !this._isEditable(tab),
      wrapLines: this.wrapLines,
      gitDiff:
        gitDiff && typeof gitDiff === "object"
          ? /** @type {{ patch?: string }} */ (gitDiff)
          : undefined,
      onChange: (newContent) => {
        if (this._interactionLocked) return;
        const freshTab = this.state.getTab(tabId);
        if (!freshTab) return;
        const dirty = !sameFileText(newContent, freshTab.originalContent ?? "");
        this.state.updateTab(tabId, {
          content: newContent,
          dirty,
          saveError: null,
        });
        if (dirty) this._scheduleAutoSave(tabId);
      },
      onSave: () => this._saveTab(tabId),
      onModeChange: (mode) => {
        if (this._interactionLocked) return;
        this.state.updateTab(tabId, { mode });
        this.state.persist();
      },
      onError: (error) => {
        this.state.updateTab(tabId, {
          error: t("files.preview.loadError"),
          errorDetail: error instanceof Error ? error.message : String(error),
        });
      },
      rawUrlForPath: /** @type {FileRendererOptions["rawUrlForPath"]} */ (
        this.fileApi?.rawUrlForPath?.bind(this.fileApi)
      ),
    };
    this.currentRenderer = /** @type {FilePreviewRenderer} */ (createFileRenderer(rendererOptions));
    await this.currentRenderer.mount(this.content);
    this._renderToolbar();
  }

  /** @param {FilePreviewTab | null | undefined} tab */
  _isEditable(tab) {
    if (
      !tab ||
      tab.content === null ||
      tab.editable === false ||
      tab.truncated ||
      tab.isBinary ||
      (tab.renderAs === "markdown" && classifyFilePath(tab.filePath).contentType === "convertible")
    ) {
      return false;
    }
    return classifyFilePath(tab.filePath).editable;
  }

  /** @param {string} tabId */
  _scheduleAutoSave(tabId) {
    const tab = this.state.getTab(tabId);
    if (!this.autoSaveEnabled || !tab?.dirty || tab.conflict || !this._isEditable(tab)) return;
    this._clearAutoSave(tabId);
    const timer = setTimeout(() => {
      this.autoSaveTimers.delete(tabId);
      void this._saveTab(tabId, { autoSave: true });
    }, AUTO_SAVE_DELAY);
    this.autoSaveTimers.set(tabId, timer);
  }

  /** @param {string} tabId */
  _clearAutoSave(tabId) {
    const timer = this.autoSaveTimers.get(tabId);
    clearTimeout(timer);
    this.autoSaveTimers.delete(tabId);
  }

  /**
   * @param {string} tabId
   * @param {{ autoSave?: boolean, force?: boolean }} [options]
   * @returns {Promise<boolean>}
   */
  async _saveTab(tabId, options = {}) {
    const inFlight = this.savePromises.get(tabId);
    if (inFlight) {
      await inFlight;
      const tab = this.state.getTab(tabId);
      if (tab?.dirty && !tab.conflict) return this._saveTab(tabId, options);
      return Boolean(tab && !tab.dirty);
    }

    const operation = this._performSave(tabId, options);
    this.savePromises.set(tabId, operation);
    try {
      return await operation;
    } finally {
      if (this.savePromises.get(tabId) === operation) this.savePromises.delete(tabId);
    }
  }

  /**
   * @param {string} tabId
   * @param {{ autoSave?: boolean, force?: boolean }} [options]
   * @returns {Promise<boolean>}
   */
  async _performSave(tabId, { autoSave = false, force = false } = {}) {
    const tab = this.state.getTab(tabId);
    if (!tab?.dirty) return true;
    if (!this._isEditable(tab)) return false;

    if (tab.conflict && !force) {
      if (autoSave) return false;
      return this._resolveSaveConflict(tabId);
    }

    const savedContent = normalizeNewlines(tab.content);
    const writtenContent = applyNewlineStyle(
      savedContent,
      /** @type {FilePreviewTab} */ (tab).newlineStyle ?? "\n",
    );
    const expectedMtimeMs = tab.mtimeMs;
    this.state.updateTab(tabId, { saving: true, saveError: null });

    try {
      const res = this.fileApi?.writeFileContent
        ? await this.fileApi.writeFileContent({
            path: tab.filePath,
            content: writtenContent,
            expectedMtimeMs,
            force,
          })
        : await writeFile({
            path: tab.filePath,
            content: writtenContent,
            expectedMtimeMs: expectedMtimeMs ?? undefined,
            force,
          });

      if (res.status === 409) {
        this.state.updateTab(tabId, { saving: false, conflict: true });
        if (autoSave) return false;
        return this._resolveSaveConflict(tabId);
      }
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        this.state.updateTab(tabId, {
          saving: false,
          saveError: t("files.preview.saveError"),
          errorDetail: errorData.error || `HTTP ${res.status}`,
        });
        return false;
      }

      const data = await res.json();
      const current = this.state.getTab(tabId);
      if (!current) return false;
      this.state.updateTab(tabId, {
        saving: false,
        dirty: current.content !== savedContent,
        conflict: false,
        mtimeMs: data.mtimeMs,
        originalContent: savedContent,
        saveError: null,
        errorDetail: null,
      });
      return true;
    } catch (error) {
      this.state.updateTab(tabId, {
        saving: false,
        saveError: t("files.preview.saveError"),
        errorDetail: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * @param {string} tabId
   * @returns {Promise<boolean>}
   */
  async _resolveSaveConflict(tabId) {
    const tab = this.state.getTab(tabId);
    if (!tab) return false;
    const action = await this.resolveConflict(tab);
    if (action === "overwrite") {
      this.state.updateTab(tabId, { conflict: false });
      return this._performSave(tabId, { force: true });
    }
    if (action === "reload") {
      return this._reloadTab(tabId, { skipConfirmation: true });
    }
    return false;
  }

  /**
   * @param {string} tabId
   * @param {{ skipConfirmation?: boolean }} [options]
   * @returns {Promise<boolean>}
   */
  async _reloadTab(tabId, { skipConfirmation = false } = {}) {
    this._captureActiveRenderer();
    const tab = this.state.getTab(tabId);
    if (!tab) return false;
    if (tab.dirty && !skipConfirmation) {
      const settled = await this._settleDirtyTabs([tab], "reload");
      if (!settled) return false;
    }
    this._clearAutoSave(tabId);
    this.state.updateTab(tabId, {
      conflict: false,
      dirty: false,
      saveError: null,
    });
    const fresh = this.state.getTab(tabId);
    if (!fresh) return false;
    return this._loadTabContent(fresh);
  }

  /**
   * @param {FilePreviewTab[]} tabs
   * @param {string} reason
   * @returns {Promise<boolean>}
   */
  async _settleDirtyTabs(tabs, reason) {
    const action = await this.confirmDirty(tabs, reason);
    if (action === "cancel" || !action) return false;
    if (action === "save") {
      for (const tab of tabs) {
        const saved = await this._saveTab(tab.id);
        if (!saved || this.state.getTab(tab.id)?.dirty) return false;
      }
      return true;
    }
    if (action === "discard") {
      for (const tab of tabs) {
        this._clearAutoSave(tab.id);
        this.state.updateTab(tab.id, {
          content: tab.originalContent ?? "",
          dirty: false,
          conflict: false,
          saveError: null,
        });
      }
      return true;
    }
    return false;
  }

  /** @param {string} mode */
  async _setMode(mode) {
    const tab = this.state.getActiveTab();
    if (!tab || !["preview", "edit", "diff"].includes(mode)) return false;
    if (mode === "edit" && !this._isEditable(tab)) return false;
    if (mode === "diff" && !this.gitDiffCache.has(tab.id))
      await this._fetchGitDiff(tab.id, tab.filePath);
    if (mode === "diff" && this.gitDiffCache.get(tab.id) == null) return false;
    if (tab.mode === mode) return true;
    this._captureActiveRenderer();
    this.state.updateTab(tab.id, { mode });
    this.state.persist();
    const fresh = this.state.getTab(tab.id);
    if (fresh) await this._mountRenderer(fresh);
    return true;
  }

  _setupControls() {
    this._listen(this.controls.enlarge, "click", () => this.enlarge());
    this._listen(this.controls.collapse, "click", () => this.collapse());
    this._listen(this.controls.close, "click", () => {
      void this.closePanel();
    });
    this._listen(this.controls.toolbarToggle, "click", () => {
      this.toolbarOpen = !this.toolbarOpen;
      this._renderToolbar();
    });
    this._listen(this.controls.preview, "click", () => void this._setMode("preview"));
    this._listen(this.controls.edit, "click", () => void this._setMode("edit"));
    this._listen(this.controls.diff, "click", () => void this._setMode("diff"));
    const saveActive = () => {
      const tab = this.state.getActiveTab();
      if (tab?.dirty) void this._saveTab(tab.id);
    };
    this._listen(this.controls.save, "click", saveActive);
    this._listen(this.controls.saveIcon, "click", saveActive);
    this._listen(
      this.panel,
      "keydown",
      /** @type {EventListener} */ (
        (event) => {
          const keyEvent = /** @type {KeyboardEvent} */ (event);
          if (!(keyEvent.ctrlKey || keyEvent.metaKey) || keyEvent.key.toLowerCase() !== "s") return;
          keyEvent.preventDefault();
          this._captureActiveRenderer();
          saveActive();
        }
      ),
    );
    this._listen(this.controls.reload, "click", () => {
      const tab = this.state.getActiveTab();
      if (tab) void this._reloadTab(tab.id);
    });
    this._listen(this.controls.search, "click", () => this.currentRenderer?.openSearch?.());
    this._listen(this.controls.goToLine, "click", () => this._showGoToLineInput());
    this._listen(
      this.controls.goToLineInput,
      "keydown",
      /** @type {EventListener} */ (
        (event) => {
          const keyEvent = /** @type {KeyboardEvent} */ (event);
          if (keyEvent.key === "Escape") {
            keyEvent.preventDefault();
            this._hideGoToLineInput();
            return;
          }
          if (keyEvent.key !== "Enter") return;
          keyEvent.preventDefault();
          const target = keyEvent.target;
          if (!target || !("value" in target)) return;
          const raw = String(/** @type {{ value?: unknown }} */ (target).value ?? "").trim();
          if (/^[1-9]\d*$/.test(raw)) {
            this.currentRenderer?.goToLine?.(Number(raw));
          }
          this._hideGoToLineInput();
        }
      ),
    );
    this._listen(this.controls.goToLineInput, "blur", () => this._hideGoToLineInput());
    this._listen(this.controls.copy, "click", () => void this._copyActiveContent());
    this._listen(this.controls.openDesktop, "click", () => {
      const tab = this.state.getActiveTab();
      if (tab) this.onOpenDesktop(tab.filePath);
    });
    this._listen(
      this.controls.wrap,
      "change",
      /** @type {EventListener} */ (
        (event) => {
          const target = event.target;
          this.wrapLines = Boolean(
            target && "checked" in target && /** @type {{ checked?: unknown }} */ (target).checked,
          );
          this.currentRenderer?.setWrapLines?.(this.wrapLines);
          this._savePreferences();
          this._renderToolbar();
        }
      ),
    );
    this._listen(
      this.controls.autoSave,
      "change",
      /** @type {EventListener} */ (
        (event) => {
          const target = event.target;
          this.autoSaveEnabled = Boolean(
            target && "checked" in target && /** @type {{ checked?: unknown }} */ (target).checked,
          );
          if (!this.autoSaveEnabled) {
            for (const tabId of this.autoSaveTimers.keys()) this._clearAutoSave(tabId);
          } else {
            const tab = this.state.getActiveTab();
            if (tab?.dirty) this._scheduleAutoSave(tab.id);
          }
          this._savePreferences();
          this._renderToolbar();
        }
      ),
    );
    this._renderToolbar();
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

  _showGoToLineInput() {
    if (!this.controls?.goToLineInput || this.controls.goToLine?.disabled) return;
    this.goToLineInputOpen = true;
    this._renderToolbar();
    this.controls.goToLineInput.value = "";
    this.controls.goToLineInput.focus();
  }

  _hideGoToLineInput() {
    if (!this.goToLineInputOpen) return;
    this.goToLineInputOpen = false;
    this._renderToolbar();
  }

  async _copyActiveContent() {
    this._captureActiveRenderer();
    const tab = this.state.getActiveTab();
    if (!tab || typeof tab.content !== "string") return;
    try {
      await this.onCopyText(tab.content);
      this.transientStatus = t("messages.copied");
    } catch {
      this.transientStatus = t("files.preview.copyFailed");
    }
    this._renderToolbar();
    setTimeout(() => {
      this.transientStatus = "";
      this._renderToolbar();
    }, 1200);
  }

  _renderToolbar() {
    const controls = this.controls;
    if (!controls) return;
    controls.toolbar?.classList.toggle("hidden", !this.toolbarOpen);
    controls.toolbarToggle?.setAttribute("aria-expanded", String(this.toolbarOpen));

    const tab = this.state.getActiveTab();
    const editable = this._isEditable(tab);
    const hasText = typeof tab?.content === "string" && !tab?.isBinary;
    const contentType = tab ? classifyFilePath(tab.filePath).contentType : "";
    const hasEditor =
      hasText &&
      contentType !== "image" &&
      contentType !== "pdf" &&
      contentType !== "convertible" &&
      ((contentType !== "markdown" && contentType !== "html") || tab.mode === "edit");

    const hasDiff = tab
      ? this.gitDiffCache.has(tab.id) && this.gitDiffCache.get(tab.id) !== null
      : false;
    if (controls.preview) {
      controls.preview.disabled = !hasText;
      controls.preview.classList.toggle(
        "active",
        hasText && tab?.mode !== "edit" && tab?.mode !== "diff",
      );
      controls.preview.setAttribute(
        "aria-pressed",
        String(hasText && tab?.mode !== "edit" && tab?.mode !== "diff"),
      );
    }
    if (controls.edit) {
      controls.edit.disabled = !editable;
      controls.edit.classList.toggle("active", tab?.mode === "edit");
      controls.edit.setAttribute("aria-pressed", String(tab?.mode === "edit"));
    }
    if (controls.diff) {
      controls.diff.disabled = !hasText;
      controls.diff.title = hasDiff ? t("files.preview.diff") : t("files.preview.noDiff");
      controls.diff.classList.toggle("active", tab?.mode === "diff");
      controls.diff.setAttribute("aria-pressed", String(tab?.mode === "diff"));
    }
    const saveDisabled = !tab?.dirty || !editable || tab.saving;
    if (controls.save) controls.save.disabled = saveDisabled;
    if (controls.saveIcon) controls.saveIcon.disabled = saveDisabled;
    if (controls.reload) controls.reload.disabled = !tab || tab.loading;
    if (controls.search) controls.search.disabled = !hasEditor;
    if (controls.goToLine) {
      controls.goToLine.disabled = !hasEditor;
      controls.goToLine.classList.toggle("hidden", hasEditor && this.goToLineInputOpen);
    }
    if (controls.goToLineInput) {
      controls.goToLineInput.disabled = !hasEditor;
      controls.goToLineInput.classList.toggle("hidden", !hasEditor || !this.goToLineInputOpen);
    }
    if (controls.copy) controls.copy.disabled = !hasText;
    if (controls.openDesktop) controls.openDesktop.disabled = !tab;
    if (controls.wrap) controls.wrap.checked = this.wrapLines;
    if (controls.autoSave) controls.autoSave.checked = this.autoSaveEnabled;
    if (controls.status) {
      controls.status.textContent = this._toolbarStatus(tab, editable);
    }
  }

  /**
   * @param {FilePreviewTab | null | undefined} tab
   * @param {boolean} editable
   */
  _toolbarStatus(tab, editable) {
    if (this.transientStatus) return this.transientStatus;
    if (!tab) return "";
    if (tab.loading) return t("files.preview.loading");
    if (tab.saving) return t("files.preview.saving");
    if (tab.conflict) return t("files.preview.conflict");
    if (tab.saveError) return tab.saveError;
    if (tab.dirty) return t("files.unsaved.title");
    if (!editable) return t("files.preview.readOnly");
    return t("files.preview.saved");
  }

  _setupResizer() {
    const resizer = this.resizer;
    if (!resizer) return;
    let dragging = false;
    let startX = 0;
    let startWidth = 0;

    /** @param {MouseEvent} event */
    const onMouseDown = (event) => {
      if (event.button !== 0) return;
      dragging = true;
      startX = event.clientX;
      startWidth = this.panel?.offsetWidth || 0;
      resizer.classList.add("dragging");
      document.body.classList.add("file-preview-resizing");
      event.preventDefault();
    };
    /** @param {MouseEvent} event */
    const onMouseMove = (event) => {
      if (!dragging) return;
      this._applyPanelWidth(startWidth + startX - event.clientX);
    };
    const finishDrag = () => {
      if (!dragging) return;
      dragging = false;
      resizer.classList.remove("dragging");
      document.body.classList.remove("file-preview-resizing");
      this._savePreferences();
    };
    /** @param {KeyboardEvent} event */
    const onKeyDown = (event) => {
      const currentWidth = this.panel?.offsetWidth || this._availableWidth() * this.panelRatio;
      let nextWidth = currentWidth;
      if (event.key === "ArrowLeft") nextWidth += 16;
      else if (event.key === "ArrowRight") nextWidth -= 16;
      else if (event.key === "Home") nextWidth = MIN_PANEL_WIDTH;
      else if (event.key === "End") nextWidth = this._availableWidth() * 0.7;
      else return;
      event.preventDefault();
      this._applyPanelWidth(nextWidth);
      this._savePreferences();
    };
    const onResize = () => this._updatePanelWidth();

    this._listen(resizer, "mousedown", /** @type {EventListener} */ (onMouseDown));
    this._listen(document, "mousemove", /** @type {EventListener} */ (onMouseMove));
    this._listen(document, "mouseup", finishDrag);
    this._listen(resizer, "keydown", /** @type {EventListener} */ (onKeyDown));
    this._listen(window, "resize", onResize);
    this.cleanupListeners.push(() => {
      dragging = false;
      resizer.classList.remove("dragging");
      document.body.classList.remove("file-preview-resizing");
    });
  }

  _setupListeners() {
    this._unsubscribeState = this.state.subscribe(() => {
      this._renderTabBar();
      this._renderToolbar();
    });
  }

  /**
   * @param {FilePreviewTab[]} tabs
   * @param {string} [_reason]
   */
  _showDirtyDialog(tabs, _reason) {
    const message =
      tabs.length === 1
        ? t("files.unsaved.description")
        : t("files.unsaved.descriptionMultiple", { count: tabs.length });
    return this._showChoiceDialog({
      title: t("files.unsaved.title"),
      message,
      choices: [
        { action: "save", label: t("files.unsaved.save"), primary: true },
        { action: "discard", label: t("files.unsaved.discard") },
        { action: "cancel", label: t("files.unsaved.cancel") },
      ],
      cancelAction: "cancel",
    });
  }

  /** @param {FilePreviewTab} tab */
  _showConflictDialog(tab) {
    return this._showChoiceDialog({
      title: t("files.preview.conflict"),
      message: t("files.preview.conflictMessage", { name: tab.fileName }),
      choices: [
        { action: "reload", label: t("files.preview.conflictReload") },
        {
          action: "overwrite",
          label: t("files.preview.conflictOverwrite"),
          primary: true,
        },
        { action: "cancel", label: t("files.unsaved.cancel") },
      ],
      cancelAction: "cancel",
    });
  }

  /**
   * @param {{
   *   title: string,
   *   message: string,
   *   choices: Array<{ action: string, label: string, primary?: boolean }>,
   *   cancelAction: string,
   * }} options
   * @returns {Promise<string>}
   */
  _showChoiceDialog({ title, message, choices, cancelAction }) {
    this.activeDialogCancel?.();
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "file-preview-dialog-overlay";
      const dialog = document.createElement("div");
      dialog.className = "file-preview-dialog";
      dialog.setAttribute("role", "alertdialog");

      const heading = document.createElement("h3");
      heading.textContent = title;
      const body = document.createElement("p");
      body.textContent = message;
      const actions = document.createElement("div");
      actions.className = "file-preview-dialog-actions";
      dialog.append(heading, body, actions);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);

      let settled = false;
      let unbindModal = () => {};
      /** @param {string} action */
      const finish = (action) => {
        if (settled) return;
        settled = true;
        unbindModal();
        overlay.remove();
        this.activeDialogCancel = null;
        resolve(action);
      };
      unbindModal = bindModal(dialog, { onClose: () => finish(cancelAction) });

      for (const choice of choices) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `file-preview-dialog-button${choice.primary ? " primary" : ""}`;
        button.textContent = choice.label;
        button.addEventListener("click", () => finish(choice.action));
        actions.appendChild(button);
      }

      this.activeDialogCancel = () => finish(cancelAction);
      const primary = actions.querySelector(".primary");
      if (primary && "focus" in primary && typeof primary.focus === "function") {
        primary.focus();
      }
    });
  }

  _restorePreferences() {
    Object.assign(this, readPreviewPreferences(this.storage));
  }

  _savePreferences() {
    writePreviewPreferences(this.storage, this);
  }
}
