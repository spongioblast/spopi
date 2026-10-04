// ABOUTME: Terminal Panel: DOM, tab bar, collapse/expand, height clamp, close-risk.
// ABOUTME: Rendered for desktop and remote/LAN/mobile clients alike.

import { t } from "../i18n/i18n.js";
import { confirmDialog } from "../ui/dialog.js";
import { appKeybindings, formatChord } from "../ui/keybindings.js";

/** One restart notice per app start, and only for a tab that was actually running. */
let restartNoticeShown = false;

/**
 * @typedef {{
 *   terminalId: string,
 *   generation?: number,
 *   label?: string,
 *   profileId?: string,
 *   status?: string,
 *   failReason?: string,
 *   running?: boolean,
 *   pid?: number | string | null,
 * }} TerminalPanelTab
 *
 * @typedef {{
 *   create?: (profileId?: string) => unknown,
 *   close?: (terminalId: string, generation?: number) => unknown,
 *   restart?: (terminalId: string, generation?: number, profileId?: string) => unknown,
 *   focusTab?: (id: string) => void,
 *   refitTab?: (id: string) => void,
 *   refitAll?: () => void,
 *   setPanelHeight?: (heightPx: number | null) => unknown,
 *   checkpointAll?: () => Promise<unknown>,
 *   closeAll?: () => Promise<unknown>,
 * }} TerminalPanelClient
 *
 * @typedef {{ left?: number, top?: number, right?: number }} TerminalFullscreenBounds
 */

const MIN_HEIGHT_PX = 160;
const DEFAULT_HEIGHT_RATIO = 0.3;
const MAX_HEIGHT_RATIO = 0.7;
const SVG_BASE =
  'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';
const CLOSE_ICON_SVG = `<svg ${SVG_BASE}><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
const EXPAND_ICON_SVG = `<svg ${SVG_BASE}><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>`;
const PLUS_ICON_SVG = `<svg ${SVG_BASE}><path d="M5 12h14"/><path d="M12 5v14"/></svg>`;
const REFRESH_ICON_SVG = `<svg ${SVG_BASE}><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></svg>`;
const CHAT_ICON_SVG = `<svg ${SVG_BASE}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
const FULLSCREEN_SCOPE_CHAT = "chat";

export class TerminalPanel {
  /**
   * @param {object} [options]
   * @param {boolean} [options.enabled]
   * @param {TerminalPanelClient | null | undefined} [options.client]
   * @param {((listener: () => void) => (() => void)) | null | undefined} [options.subscribeLocale]
   * @param {(() => number) | null | undefined} [options.getAvailableHeight]
   * @param {(() => (TerminalFullscreenBounds | null | undefined)) | null | undefined} [options.getFullscreenBounds]
   * @param {string} [options.fullscreenScope]
   * @param {boolean} [options.docked]
   * @param {(() => string) | null | undefined} [options.getDefaultProfile]
   * @param {((terminalId: string) => void) | null | undefined} [options.onSendToChat]
   */
  constructor({
    enabled,
    client,
    subscribeLocale,
    getAvailableHeight,
    getFullscreenBounds,
    fullscreenScope = FULLSCREEN_SCOPE_CHAT,
    docked = false,
    getDefaultProfile,
    onSendToChat,
  } = {}) {
    this.enabled = Boolean(enabled);
    /** @type {TerminalPanelClient | null | undefined} */
    this.client = client;
    this.docked = Boolean(docked);
    /** @type {() => number} */
    this.getAvailableHeight = getAvailableHeight || (() => 800);
    /** @type {(() => (TerminalFullscreenBounds | null | undefined)) | null} */
    this.getFullscreenBounds = getFullscreenBounds || null;
    /** @type {string} */
    this.fullscreenScope = fullscreenScope;
    /** @type {boolean} */
    this.expanded = false;
    /** @type {number | null} */
    this.heightPx = null;
    /** @type {TerminalPanelTab[]} */
    this.tabs = [];
    /** @type {string | null} */
    this.activeTerminalId = null;
    /** @type {string | null} */
    this._pendingActiveId = null;
    /** @type {boolean} */
    this.locked = false;
    /** @type {Set<string>} */
    this.activityByTab = new Set();
    /** @type {Map<string, HTMLDivElement>} */
    this.tabContainers = new Map();
    /** @type {Map<string, HTMLButtonElement>} */
    this.tabButtons = new Map();
    /** @type {() => string} */
    this.getDefaultProfile =
      typeof getDefaultProfile === "function" ? getDefaultProfile : () => "default";
    /** @type {((terminalId: string) => void) | null | undefined} */
    this.onSendToChat = onSendToChat;
    /** @type {boolean} */
    this._restartNoticeShown = false;
    /** @type {ReturnType<typeof setTimeout> | 0} */
    this._dragRefitTimer = 0;
    /** @type {(() => void) | null} */
    this._unbindTerminalShortcut = null;
    /** @type {boolean} */
    this.enlarged = false;
    /** @type {(() => void) | null} */
    this._fullscreenBoundsCleanup = null;
    /** @type {Promise<void> | null | undefined} */
    this._spawnInFlight = null;
    /** Set while an automatic create waits for the host to list the new tab. */
    this._autoCreatePending = false;
    /** @type {HTMLButtonElement | null} */
    this.toggleEl = null;
    /** @type {HTMLButtonElement | null | undefined} */
    this.enlargeButton = null;
    /** @type {HTMLElement | null} */
    this.root = null;
    /** @type {HTMLElement | null} */
    this.tabBarEl = null;
    /** @type {HTMLElement | null} */
    this.bodyEl = null;
    /** @type {ResizeObserver | null} */
    this.resizeObserver = null;
    /** @type {(() => void) | null} */
    this.unsubscribeLocale = null;
    if (subscribeLocale) {
      this.unsubscribeLocale = subscribeLocale(() => this.applyLocale());
    }
  }

  /**
   * Build the toggle + panel DOM. A disabled panel renders nothing.
   * @param {object} options
   * @param {ParentNode | null | undefined} options.toggleContainer
   * @param {ParentNode | null | undefined} options.panelContainer
   */
  mount({ toggleContainer, panelContainer }) {
    if (!this.enabled || !toggleContainer || !panelContainer) {
      return;
    }
    this.toggleEl = document.createElement("button");
    this.toggleEl.type = "button";
    this.toggleEl.className = "terminal-toggle panel-toggle-btn";
    this.toggleEl.dataset.terminalToggle = "";
    this.toggleEl.setAttribute("aria-pressed", "false");
    this.toggleEl.setAttribute("aria-label", t("terminal.toggle"));
    this.toggleEl.setAttribute("title", t("terminal.toggle"));
    this.toggleEl.innerHTML = `<svg width="16" height="16" ${SVG_BASE}><rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M7 15h10"/></svg>`;
    this.toggleEl.addEventListener("click", () => this.toggle());
    this._unbindTerminalShortcut = appKeybindings().register({
      id: "dock.terminal",
      keys: "Mod+`",
      labelKey: "terminal.toggle",
      when: (event) => isTerminalShortcut(event),
      run: () => this.toggle(),
    });

    this.root = document.createElement("section");
    this.root.id = "terminal-panel";
    this.root.className = "terminal-panel hidden";
    this.root.dataset.terminalPanel = "";
    this.root.setAttribute("aria-label", t("terminal.panelLabel"));

    const resizer = document.createElement("div");
    resizer.className = "terminal-resizer";
    resizer.setAttribute("role", "separator");
    resizer.setAttribute("aria-orientation", "horizontal");
    resizer.tabIndex = 0;
    resizer.setAttribute("aria-label", t("terminal.ariaResizer"));
    resizer.addEventListener("pointerdown", (event) => this._beginResize(event));
    resizer.addEventListener("keydown", (event) => this._keyboardResize(event));

    this.tabBarEl = document.createElement("div");
    this.tabBarEl.className = "terminal-tab-bar";
    this.tabBarEl.setAttribute("role", "tablist");

    this.bodyEl = document.createElement("div");
    this.bodyEl.className = "terminal-body";
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.client?.refitAll?.());
      this.resizeObserver.observe(this.bodyEl);
    }

    const newTabButton = document.createElement("button");
    newTabButton.type = "button";
    newTabButton.className = "terminal-new-tab";
    newTabButton.dataset.terminalNewTab = "";
    newTabButton.innerHTML = PLUS_ICON_SVG;
    newTabButton.title = t("terminal.newTab");
    newTabButton.setAttribute("aria-label", t("terminal.newTab"));
    newTabButton.addEventListener("click", () => {
      if (!this.locked) this.client?.create?.(this.getDefaultProfile());
    });
    this.tabBarEl.append(newTabButton);
    if (this.docked) {
      // Instances stack beside the terminal; dock.js adopts the `+` button.
      this.root.classList.add("docked");
      this.tabBarEl.classList.add("terminal-instances");
      this.tabBarEl.hidden = true;
      this.root.append(this.bodyEl, this.tabBarEl);
    } else {
      const closeButton = document.createElement("button");
      closeButton.type = "button";
      closeButton.className = "terminal-collapse";
      closeButton.dataset.terminalCollapse = "";
      closeButton.innerHTML = CLOSE_ICON_SVG;
      closeButton.addEventListener("click", () => this.collapse());
      this.enlargeButton = document.createElement("button");
      this.enlargeButton.type = "button";
      this.enlargeButton.className = "terminal-enlarge";
      this.enlargeButton.dataset.terminalEnlarge = "";
      this.enlargeButton.title = t("terminal.enlarge");
      this.enlargeButton.setAttribute("aria-label", t("terminal.enlarge"));
      this.enlargeButton.innerHTML = EXPAND_ICON_SVG;
      this.enlargeButton.addEventListener("click", () => this.toggleEnlarge());
      this.tabBarEl.append(this.enlargeButton, closeButton);
      this.root.append(resizer, this.tabBarEl, this.bodyEl);
    }
    toggleContainer.appendChild(this.toggleEl);
    panelContainer.appendChild(this.root);
    this.applyLocale();
  }

  isExpanded() {
    return this.expanded;
  }

  toggle() {
    if (this.expanded) {
      this.collapse();
    } else {
      void this.expand();
    }
  }

  async expand() {
    if (!this.enabled || this.locked) return;
    /** @param {TerminalPanelTab} tab */
    const live = (tab) => tab.status === "running" || tab.status === "creating";
    if (this.expanded && this.tabs.some(live)) return;
    this.expanded = true;
    this.root?.classList.remove("hidden");
    this.toggleEl?.setAttribute("aria-pressed", "true");
    this.clearActivity();
    if (!this._spawnInFlight) {
      const restored = this.tabs.filter((tab) => tab.status === "restoredMetadata");
      this._spawnInFlight = this._spawnPty(restored).finally(() => {
        this._spawnInFlight = null;
      });
    }
    await this._spawnInFlight;
    this.layoutHeight();
    this.client?.refitAll?.();
  }

  /**
   * @param {TerminalPanelTab[]} restored
   */
  async _spawnPty(restored) {
    // An empty terminal_listed can arrive before the host has handled the
    // create, and it calls expand() again; without this guard each one spawns.
    if (this._autoCreatePending) return;
    try {
      const wasRunning = restored.some(
        (tab) => tab.running === true || (tab.pid != null && String(tab.pid) !== ""),
      );
      if (restored.length) {
        if (wasRunning && !restartNoticeShown) {
          restartNoticeShown = true;
          this._showRestartNotice();
        }
        this._autoCreatePending = true;
        for (const tab of restored) {
          await this.client?.create?.(tab.profileId || this.getDefaultProfile());
        }
      } else if (!this.tabs.length) {
        this._autoCreatePending = true;
        await this.client?.create?.(this.getDefaultProfile());
      }
    } catch {
      /* host socket not ready; terminal_listed retries */
      this._autoCreatePending = false;
    }
  }

  collapse() {
    if (this.docked) return;
    this.expanded = false;
    this.enlarged = false;
    this.enlargeButton?.classList.remove("enlarged");
    this.root?.classList.remove("enlarged");
    this.root?.classList.add("hidden");
    this.toggleEl?.setAttribute("aria-pressed", "false");
    this._updateToggleAffordance();
  }

  /** Toggle the panel between its default height and the chat-panel bounds. */
  toggleEnlarge() {
    this.enlarged = !this.enlarged;
    if (this.enlarged) {
      this.root?.classList.add("enlarged");
      this._applyFullscreenBounds();
      this._startFullscreenBoundsTracking();
      if (this.root) this.root.style.height = "";
    } else {
      this.root?.classList.remove("enlarged");
      this._stopFullscreenBoundsTracking();
      this._clearFullscreenBounds();
      const available = this.getAvailableHeight() || 800;
      this.setHeight(Math.round(available * DEFAULT_HEIGHT_RATIO));
    }
    this.enlargeButton?.classList.toggle("enlarged", this.enlarged);
    const label = t(this.enlarged ? "terminal.restore" : "terminal.enlarge");
    this.enlargeButton?.setAttribute("aria-label", label);
    if (this.enlargeButton) this.enlargeButton.title = label;
    this.client?.refitAll?.();
  }

  /**
   * @param {number} px
   */
  setHeight(px) {
    const available = this.getAvailableHeight() || 800;
    const max = Math.round(available * MAX_HEIGHT_RATIO);
    const clamped = Math.min(max, Math.max(MIN_HEIGHT_PX, Math.round(px)));
    this.heightPx = clamped;
    if (this.root) this.root.style.height = `${clamped}px`;
    this.client?.refitAll?.();
    return clamped;
  }

  async beforeWorkspaceTransition() {
    this.locked = true;
    try {
      await this.client?.checkpointAll?.();
    } catch (error) {
      this.locked = false;
      throw error;
    }
    return true;
  }

  cancelWorkspaceTransition() {
    this.locked = false;
  }

  getCloseRisk() {
    const live = this.tabs.filter((tab) => tab.status === "running" || tab.status === "creating");
    return {
      terminalTabs: live.map((tab) => ({
        terminalId: tab.terminalId,
        label: tab.label,
      })),
    };
  }

  /**
   * @param {string} decision
   */
  async settleCloseRisk(decision) {
    if (decision === "discard") {
      this.locked = true;
      try {
        await this.client?.closeAll?.();
      } catch {
        // Best-effort cleanup; the host remains the final authority.
      }
    } else {
      this.locked = false;
    }
  }

  /**
   * @param {unknown} locked
   */
  setInteractionLocked(locked) {
    this.locked = Boolean(locked);
  }

  /**
   * A terminal this client just created becomes the active tab once the host lists it.
   * @param {string | null | undefined} terminalId
   */
  activateWhenListed(terminalId) {
    if (terminalId) this._pendingActiveId = terminalId;
  }

  /**
   * @param {unknown} tabs
   */
  setTabs(tabs) {
    /** @type {TerminalPanelTab[]} */
    const next = Array.isArray(tabs) ? /** @type {TerminalPanelTab[]} */ (tabs) : [];
    this.tabs = next;
    if (next.some((tab) => tab.status !== "restoredMetadata")) this._autoCreatePending = false;
    const pending = this._pendingActiveId;
    const created = pending && this.tabs.some((tab) => tab.terminalId === pending);
    if (created) {
      this.activeTerminalId = pending;
      this._pendingActiveId = null;
    }
    const activeOk = this.tabs.some((tab) => tab.terminalId === this.activeTerminalId);
    if (!activeOk) this.activeTerminalId = this.tabs[0]?.terminalId ?? null;
    this._renderTabBar();
    if (created && pending) this.setActiveTerminalId(pending);
    this._updateToggleAffordance();
    if (this.docked && this.tabBarEl) this.tabBarEl.hidden = this.tabs.length <= 1;
    const failed = this.tabs.find((tab) => tab.status === "failed" && tab.failReason);
    if (failed) {
      this.showStartError(failed.failReason);
    } else {
      this.clearStartError();
    }
    if (this.tabs.length === 0 && this.expanded && !this.docked) {
      this.collapse();
    }
  }

  /**
   * Surface a host-side start failure inside the open panel (no re-render flicker).
   * @param {unknown} message
   */
  showStartError(message) {
    this._autoCreatePending = false;
    const text = typeof message === "string" ? message : "";
    const shown = this.bodyEl?.querySelector("[data-terminal-start-error]");
    if (shown?.textContent === text) return;
    this.clearStartError();
    if (!this.bodyEl || !text) return;
    const el = document.createElement("div");
    el.className = "terminal-start-error";
    el.dataset.terminalStartError = "";
    el.setAttribute("role", "alert");
    el.textContent = text;
    this.bodyEl.prepend(el);
  }

  clearStartError() {
    this.bodyEl?.querySelector("[data-terminal-start-error]")?.remove();
  }

  /**
   * Record background output for a tab (cleared when the user views the panel).
   * @param {string | null | undefined} terminalId
   */
  markActivity(terminalId) {
    if (terminalId) this.activityByTab.add(terminalId);
    this._updateToggleAffordance();
  }

  /**
   * @param {string | null} [terminalId]
   */
  clearActivity(terminalId = null) {
    if (terminalId) {
      this.activityByTab.delete(terminalId);
    } else {
      this.activityByTab.clear();
    }
    this._updateToggleAffordance();
  }

  /** Sidebar projection: live terminal count + whether any has background output. */
  getProjection() {
    return {
      count: this.tabs.length,
      hasActivity: this.activityByTab.size > 0,
    };
  }

  /** Toolbar toggle stays icon-only. Background output lights the dock Terminal tab. */
  _updateToggleAffordance() {
    if (this.toggleEl) {
      this.toggleEl.classList.remove("has-activity");
      delete this.toggleEl.dataset.terminalCount;
    }
    document
      .querySelector(".spopi-dock-tab[data-dock='terminal']")
      ?.classList.toggle("has-activity", this.activityByTab.size > 0);
  }

  // Direct child to insert tabs before: the + button, or the profile-menu group
  // wrapping it (insertBefore throws NotFoundError on a nested node).
  _newTabAnchor() {
    const plus = this.tabBarEl?.querySelector("[data-terminal-new-tab]");
    const group = plus && "closest" in plus ? plus.closest(".terminal-new-tab-group") : null;
    return [plus, group].find((el) => el?.parentElement === this.tabBarEl) ?? null;
  }

  _renderTabBar() {
    if (!this.tabBarEl) return;
    const tabBarEl = this.tabBarEl;
    for (const btn of this.tabButtons.values()) btn.remove();
    this.tabButtons.clear();
    // Tabs of the same shell are numbered ("Git Bash", "Git Bash 2") so they can be told apart.
    /** @type {Map<string, number>} */
    const seen = new Map();
    for (const tab of this.tabs) {
      const base = tab.label || tab.terminalId;
      const index = (seen.get(base) ?? 0) + 1;
      seen.set(base, index);
      const shownLabel = index > 1 ? `${base} ${index}` : base;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "terminal-tab";
      btn.dataset.terminalId = tab.terminalId;
      btn.setAttribute("role", "tab");
      const active = tab.terminalId === this.activeTerminalId;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
      btn.tabIndex = active ? 0 : -1;
      btn.addEventListener("keydown", (event) => this._tabKeydown(event, tab.terminalId));
      const label = document.createElement("span");
      label.className = "terminal-tab-label";
      label.textContent = shownLabel;
      btn.appendChild(label);
      const send = document.createElement("button");
      send.type = "button";
      send.className = "terminal-tab-send";
      send.innerHTML = CHAT_ICON_SVG;
      send.title = t("terminal.sendToChat");
      send.addEventListener("click", (event) => {
        event.stopPropagation();
        this.onSendToChat?.(tab.terminalId);
      });
      btn.appendChild(send);
      const restart = document.createElement("span");
      restart.className = "terminal-tab-restart";
      restart.innerHTML = REFRESH_ICON_SVG;
      restart.title = t("terminal.retry");
      restart.addEventListener("click", (event) => {
        event.stopPropagation();
        this.client?.restart?.(tab.terminalId, tab.generation);
      });
      btn.appendChild(restart);
      const close = document.createElement("button");
      close.type = "button";
      close.className = "terminal-tab-close";
      close.innerHTML = CLOSE_ICON_SVG;
      close.setAttribute("aria-label", t("dock.terminalTab.closeLabel"));
      close.addEventListener("click", (event) => {
        event.stopPropagation();
        const live = tab.status === "running" || tab.status === "creating";
        void (async () => {
          if (live) {
            const ok = await confirmDialog({
              message: t("dock.terminalTab.closeConfirm", {
                name: shownLabel || t("dock.terminal"),
              }),
            });
            if (!ok) return;
          }
          this.client?.close?.(tab.terminalId, tab.generation);
        })();
      });
      btn.appendChild(close);
      btn.addEventListener("click", () => this.setActiveTerminalId(tab.terminalId));
      this.tabButtons.set(tab.terminalId, btn);
      tabBarEl.insertBefore(btn, this._newTabAnchor());
    }
    this._applyActiveContainer();
  }

  /**
   * @param {string} terminalId
   */
  setActiveTerminalId(terminalId) {
    this.activeTerminalId = terminalId;
    this.clearActivity(terminalId);
    if (!this.tabButtons.has(terminalId)) return;
    for (const [id, btn] of this.tabButtons) {
      const active = id === terminalId;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    }
    this._applyActiveContainer();
    // The newly-shown xterm must refit to its container and take focus so the
    // user's keystrokes reach it.
    this.client?.refitTab?.(terminalId);
    this.client?.focusTab?.(terminalId);
  }

  /**
   * Per-tab xterm container; created lazily inside the panel body.
   * @param {string} terminalId
   */
  getTabContainer(terminalId) {
    if (!this.bodyEl) return null;
    let el = this.tabContainers.get(terminalId);
    if (!el) {
      el = document.createElement("div");
      el.className = "terminal-tab-container hidden";
      el.dataset.terminalId = terminalId;
      this.bodyEl.appendChild(el);
      this.tabContainers.set(terminalId, el);
    }
    return el;
  }

  _applyActiveContainer() {
    const live = new Set(this.tabs.map((tab) => tab.terminalId));
    for (const id of [...this.tabContainers.keys()]) {
      if (!live.has(id)) {
        this.tabContainers.get(id)?.remove();
        this.tabContainers.delete(id);
      }
    }
    for (const [id, el] of this.tabContainers) {
      el.classList.toggle("hidden", id !== this.activeTerminalId);
    }
  }

  destroy() {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this._stopFullscreenBoundsTracking();
    this.unsubscribeLocale?.();
    this.unsubscribeLocale = null;
    for (const btn of this.tabButtons.values()) btn.remove();
    for (const el of this.tabContainers.values()) el.remove();
    this.tabButtons.clear();
    this.tabContainers.clear();
    this.toggleEl?.remove();
    this.root?.remove();
    this.toggleEl = null;
    this.root = null;
    this.tabBarEl = null;
    this.bodyEl = null;
    this._unbindTerminalShortcut?.();
    this._unbindTerminalShortcut = null;
  }

  layoutHeight() {
    if (this.heightPx == null) {
      const available = this.getAvailableHeight() || 800;
      this.setHeight(Math.round(available * DEFAULT_HEIGHT_RATIO));
    } else {
      this.setHeight(this.heightPx);
    }
  }

  _showRestartNotice() {
    if (!this.bodyEl || this._restartNoticeShown) {
      return;
    }
    this._restartNoticeShown = true;
    const notice = document.createElement("div");
    notice.className = "terminal-restart-notice";
    notice.textContent = t("terminal.restartNotice");
    this.bodyEl.prepend(notice);
    // Auto-dismiss so it doesn't outlive the session that produced it.
    setTimeout(() => notice.remove(), 8000);
  }

  _applyFullscreenBounds() {
    if (!this.root) return;
    this.root.dataset.fullscreenScope = this.fullscreenScope;
    const bounds = this.getFullscreenBounds?.();
    if (!bounds) {
      this._clearFullscreenBounds();
      return;
    }
    const left = Number.isFinite(bounds.left) ? /** @type {number} */ (bounds.left) : 0;
    const top = Number.isFinite(bounds.top) ? /** @type {number} */ (bounds.top) : 0;
    const right = Number.isFinite(bounds.right) ? /** @type {number} */ (bounds.right) : 0;
    this.root.style.setProperty("--terminal-fullscreen-left", `${Math.max(0, Math.round(left))}px`);
    this.root.style.setProperty("--terminal-fullscreen-top", `${Math.max(0, Math.round(top))}px`);
    this.root.style.setProperty(
      "--terminal-fullscreen-right",
      `${Math.max(0, Math.round(right))}px`,
    );
  }

  _clearFullscreenBounds() {
    if (!this.root) return;
    delete this.root.dataset.fullscreenScope;
    this.root.style.removeProperty("--terminal-fullscreen-left");
    this.root.style.removeProperty("--terminal-fullscreen-top");
    this.root.style.removeProperty("--terminal-fullscreen-right");
  }

  _startFullscreenBoundsTracking() {
    if (this._fullscreenBoundsCleanup) return;
    const update = () => {
      if (this.enlarged) {
        this._applyFullscreenBounds();
        this.client?.refitAll?.();
      }
    };
    window.addEventListener("resize", update);
    this._fullscreenBoundsCleanup = () => window.removeEventListener("resize", update);
  }

  _stopFullscreenBoundsTracking() {
    this._fullscreenBoundsCleanup?.();
    this._fullscreenBoundsCleanup = null;
  }

  /**
   * @param {PointerEvent} event
   */
  _beginResize(event) {
    if (this.locked) return;
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = this.heightPx || this.root?.clientHeight || 400;
    /** @param {PointerEvent} e */
    const move = (e) => {
      const dy = startY - e.clientY;
      this.setHeight(startHeight + dy);
      this._scheduleDragRefit();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (this._dragRefitTimer) {
        clearTimeout(this._dragRefitTimer);
        this._dragRefitTimer = 0;
      }
      this.client?.refitAll?.();
      this.client?.setPanelHeight?.(this.heightPx);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  _scheduleDragRefit() {
    if (this._dragRefitTimer) return;
    this._dragRefitTimer = setTimeout(() => {
      this._dragRefitTimer = 0;
      this.client?.refitAll?.();
    }, 100);
  }

  /**
   * @param {KeyboardEvent} event
   */
  _keyboardResize(event) {
    if (this.locked) return;
    const step = event.shiftKey ? 80 : 20;
    const current = this.heightPx || 400;
    if (event.key === "ArrowUp") {
      this.setHeight(current + step);
      event.preventDefault();
    } else if (event.key === "ArrowDown") {
      this.setHeight(current - step);
      event.preventDefault();
    }
  }

  /**
   * @param {KeyboardEvent} event
   * @param {string} terminalId
   */
  _tabKeydown(event, terminalId) {
    const ids = this.tabs.map((tab) => tab.terminalId);
    const idx = ids.indexOf(terminalId);
    if (idx === -1) return;
    /** @type {string | null} */
    let next = null;
    if (event.key === "ArrowRight") next = ids[(idx + 1) % ids.length] ?? null;
    else if (event.key === "ArrowLeft") next = ids[(idx - 1 + ids.length) % ids.length] ?? null;
    else if (event.key === "Home") next = ids[0] ?? null;
    else if (event.key === "End") next = ids[ids.length - 1] ?? null;
    if (next) {
      const nextId = next;
      this.setActiveTerminalId(nextId);
      const btn = this.tabButtons.get(nextId);
      if (btn && "focus" in btn && typeof btn.focus === "function") btn.focus();
      event.preventDefault();
    }
  }

  applyLocale() {
    const toggleLabel = t("terminal.toggle");
    this.toggleEl?.setAttribute("aria-label", toggleLabel);
    this.toggleEl?.setAttribute("title", `${toggleLabel} (${formatChord("Mod+`")})`);
    this._renderTabBar();
  }
}

/**
 * @param {KeyboardEvent} event
 */
function isTerminalShortcut(event) {
  if (event.defaultPrevented || event.isComposing) return false;
  const target = event.target;
  if (!(target instanceof Element)) return true;
  if (target.closest("input, textarea, select, .terminal-body")) return false;
  if (target.closest('[contenteditable="true"]') !== null) return false;
  return true;
}
