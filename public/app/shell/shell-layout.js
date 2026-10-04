// ABOUTME: Wrap the SPOPI DOM into rail | sidebar | editor-over-dock | chat.
// ABOUTME: Evicts stray SPOPI side panels so workspace-content stays one grid row.

import { showPiReview } from "../editor/review-pane.js";
import { isSettingsOpen } from "../settings/settings-panel.js";
import { appKeybindings } from "../ui/keybindings.js";
import { headerChromeRefs } from "./chrome/chat.js";
import { filePreviewRefs } from "./chrome/file-preview.js";
import { fileSidebarRefs } from "./chrome/file-sidebar.js";
import { sidePanelRefs } from "./chrome/side-panels.js";
import { sidebarChromeRefs } from "./chrome/sidebar.js";
import { createLayoutMode } from "./layout-mode.js";
import { applyLayoutVars, DEFAULT_LAYOUT, normalizeLayout } from "./layout-prefs.js";
import { layoutPresetPatch } from "./layout-preset.js";
import { mountPhoneTabs } from "./phone-tabs.js";
import { mountRail, nextRailPanel } from "./rail.js";
import { mountLayoutResizers } from "./resizers.js";

/**
 * @typedef {{ app: HTMLElement, workspace: HTMLElement, content: HTMLElement, main: HTMLElement }} ShellLayoutNodes
 * @typedef {typeof DEFAULT_LAYOUT} ShellLayoutState
 * @typedef {(key: string, vars?: Record<string, unknown>) => string} ShellTranslate
 * @typedef {(layout: ShellLayoutState) => void | Promise<void>} PersistLayout
 */

export const SHELL_PANELS = {
  sessions: "#sidebar",
  files: "#file-sidebar",
  review: "#review-sidebar",
  git: "#git-sidebar",
};

/**
 * @param {string} id
 * @param {string} tag
 * @param {string | null | undefined} className
 * @param {ParentNode | null | undefined} parent
 * @returns {HTMLElement}
 */
function ensureNode(id, tag, className, parent) {
  const existing = document.getElementById(id);
  if (existing) return existing;
  const node = document.createElement(tag);
  node.id = id;
  if (className) node.className = className;
  parent?.appendChild(node);
  return node;
}

/**
 * @param {Element | null | undefined} child
 * @param {string} wrapperClass
 * @param {string | undefined} [wrapperId]
 * @returns {HTMLElement | null}
 */
function wrapIfNeeded(child, wrapperClass, wrapperId) {
  if (!child) return null;
  if (child.parentElement?.classList.contains(wrapperClass)) return child.parentElement;
  const wrap = document.createElement("div");
  wrap.className = wrapperClass;
  if (wrapperId) wrap.id = wrapperId;
  child.parentElement?.insertBefore(wrap, child);
  wrap.appendChild(child);
  return wrap;
}

/**
 * @param {Element | null | undefined} el
 * @returns {HTMLElement | null}
 */
function asShellNavItem(el) {
  if (!el || !("dataset" in el) || !("classList" in el) || !("setAttribute" in el)) return null;
  return /** @type {HTMLElement} */ (el);
}

/**
 * @param {Element | null | undefined} el
 * @returns {{ focus: () => void } | null}
 */
function asFocusableEl(el) {
  if (
    !el ||
    !("focus" in el) ||
    typeof (/** @type {{ focus?: unknown }} */ (el).focus) !== "function"
  ) {
    return null;
  }
  return /** @type {{ focus: () => void }} */ (el);
}

/**
 * @param {ShellTranslate} translate
 */
function mountNarrowDrawer(translate) {
  document.querySelector(".shell-scrim")?.remove();
  const scrim = document.createElement("button");
  scrim.type = "button";
  scrim.className = "shell-scrim";
  scrim.hidden = true;
  scrim.dataset.i18nAriaLabel = "shell.drawerClose";
  scrim.setAttribute("aria-label", translate("shell.drawerClose"));
  document.body.append(scrim);
  /** @type {HTMLElement | null} */
  let opener = null;
  const close = () => {
    delete document.body.dataset.drawer;
    scrim.hidden = true;
    const button = opener;
    opener = null;
    button?.focus();
  };
  /**
   * @param {"sidebar" | "center"} kind
   * @param {Element | null} source
   */
  const open = (kind, source) => {
    document.body.dataset.drawer = kind;
    scrim.hidden = false;
    opener = source instanceof HTMLElement ? source : null;
  };
  scrim.addEventListener("click", close);
  /** @param {KeyboardEvent} event */
  const onKey = (event) => {
    if (event.key !== "Escape" || !document.body.dataset.drawer) return;
    event.preventDefault();
    close();
  };
  document.addEventListener("keydown", onKey);
  return {
    open,
    close,
    destroy() {
      document.removeEventListener("keydown", onKey);
      scrim.remove();
      delete document.body.dataset.drawer;
    },
  };
}

/**
 * @param {object} [options]
 * @param {ShellTranslate} [options.t]
 * @param {PersistLayout} [options.persistLayout]
 * @param {ShellLayoutState | Record<string, unknown>} [options.initialLayout]
 * @param {(panel?: string) => void} [options.onSettings]
 * @param {(() => void) | undefined} [options.onOpenAppearance]
 * @param {(() => void) | undefined} [options.onOpenExtensions]
 * @param {(panel: string) => void} [options.onPanelShown]
 * @param {ShellLayoutNodes} [options.layout]
 * @returns {{
 *   readonly layout: ShellLayoutState,
 *   setPanel: (panel: string, hidden: boolean) => void,
 *   applyHidden: (patch: Record<string, unknown>) => void,
 *   applyLayout: (next: Record<string, unknown>) => void,
 *   showCenter: () => void,
 *   paneCenter: HTMLElement | null,
 *   destroy: () => void,
 * } | null}
 */
export function applyShellLayout({
  t = (key) => key,
  persistLayout = async () => {},
  initialLayout = DEFAULT_LAYOUT,
  onSettings,
  onOpenAppearance,
  onOpenExtensions,
  onPanelShown,
  layout: nodes,
} = {}) {
  const app = nodes?.app;
  if (!app || app.dataset.spopiShell === "1") return null;
  app.dataset.spopiShell = "1";
  app.classList.add("spopi-shell");

  const sidebar = sidebarChromeRefs().sidebar;
  const { workspace, content: workspaceContent } = nodes;
  const previewRefs = filePreviewRefs();
  const preview = previewRefs.panel;
  const previewResizer = previewRefs.resizer;
  const files = fileSidebarRefs();
  const fileSidebar = files.sidebar;
  const gitPanel = files.gitPanel;

  const rail = ensureNode("spopi-rail", "nav", "spopi-rail", null);
  app.insertBefore(rail, app.firstChild);

  const gitSidebar = ensureNode("git-sidebar", "aside", "app-side-panel", app);
  if (gitPanel && gitPanel.parentElement !== gitSidebar) {
    gitPanel.classList.remove("hidden");
    gitSidebar.appendChild(gitPanel);
  }

  const sidebarStack = ensureNode("spopi-sidebar-stack", "div", "spopi-sidebar-stack", null);
  if (sidebar) sidebarStack.appendChild(sidebar);
  if (fileSidebar) {
    fileSidebar.classList.remove("collapsed");
    sidebarStack.appendChild(fileSidebar);
  }
  const reviewSidebar = ensureNode(
    "review-sidebar",
    "aside",
    "file-sidebar app-side-panel review-sidebar",
    null,
  );
  sidebarStack.appendChild(reviewSidebar);
  sidebarStack.appendChild(gitSidebar);

  const infoSidebar = sidePanelRefs().info;
  if (infoSidebar) {
    infoSidebar.classList.add("collapsed");
    sidebarStack.appendChild(infoSidebar);
  }
  if (workspace) app.insertBefore(sidebarStack, workspace);
  else app.appendChild(sidebarStack);

  const paneCenter = wrapIfNeeded(preview, "pane-center", "pane-center");
  previewResizer?.classList.add("collapsed");

  const main = nodes.main;
  if (workspaceContent && main && paneCenter && main.parentElement === workspaceContent) {
    workspaceContent.insertBefore(paneCenter, main);
  }

  const chatHandle = ensureNode(
    "spopi-chat-resizer",
    "div",
    "spopi-chat-resizer",
    workspaceContent,
  );
  if (workspaceContent && main && chatHandle.parentElement === workspaceContent) {
    workspaceContent.insertBefore(chatHandle, main);
  }
  if (workspaceContent) {
    /** @type {Set<Element>} */
    const keep = new Set([paneCenter, chatHandle, main].filter((node) => node !== null));
    for (const child of [...workspaceContent.children]) {
      if (keep.has(child)) continue;
      child.classList.add("collapsed");
      sidebarStack.appendChild(child);
    }
  }
  const sidebarHandle = ensureNode("spopi-sidebar-resizer", "div", "spopi-sidebar-resizer", app);
  if (workspace) app.insertBefore(sidebarHandle, workspace);
  const dockHandle = ensureNode("spopi-dock-resizer", "div", "spopi-dock-resizer", paneCenter);
  if (paneCenter && dockHandle.parentElement !== paneCenter) paneCenter.appendChild(dockHandle);

  /** @type {ShellLayoutState} */
  let layout = normalizeLayout(initialLayout);
  applyLayoutVars(layout);
  let beforeReview = "sessions";

  /**
   * @param {string} panel
   * @param {boolean} hidden
   */
  const setPanel = (panel, hidden) => {
    if (panel !== "review") beforeReview = panel;
    layout = { ...layout, sidebarHidden: hidden, focus: hidden && layout.focus };
    applyLayoutVars(layout);
    for (const [id, selector] of Object.entries(SHELL_PANELS)) {
      const node = document.querySelector(selector);
      if (!node) continue;
      const active = id === panel && !hidden;
      node.classList.toggle("is-active-shell-panel", active);
    }
    persistLayout(layout);
    if (!hidden) onPanelShown?.(panel);
  };

  /** The sidebar and the pressed rail button always name the same panel. */
  /** @param {string} panel */
  const selectRail = (panel) => {
    document.body.dataset.railPanel = panel;
    setPanel(panel, layout.sidebarHidden);
    for (const item of rail.querySelectorAll("[data-nav]")) {
      const navItem = asShellNavItem(item);
      if (!navItem) continue;
      const active = navItem.dataset.nav === panel;
      navItem.classList.toggle("active", active);
      navItem.setAttribute("aria-pressed", String(active));
    }
  };

  /** @param {Record<string, unknown>} patch */
  const applyHidden = (patch) => {
    const reveals = patch.sidebarHidden === false || patch.dockHidden === false;
    const leaveFocus = reveals && !Object.hasOwn(patch, "focus") ? { focus: false } : {};
    layout = normalizeLayout({ ...layout, ...patch, ...leaveFocus });
    applyLayoutVars(layout);
    persistLayout(layout);
  };

  const railOptions = {
    t,
    onSettings,
    onOpenAppearance: onOpenAppearance || onSettings,
    onOpenExtensions: onOpenExtensions || (() => onSettings?.("extensions")),
    /** @param {string} id */
    onSelect: (id) => {
      const current = document.body.dataset.railPanel || "sessions";
      const next = nextRailPanel(current, id, layout.sidebarHidden);
      document.body.dataset.railPanel = next.panel;
      setPanel(next.panel, next.sidebarHidden);
      const opener =
        [...rail.querySelectorAll("[data-nav]")].find(
          (button) => button instanceof HTMLElement && button.dataset.nav === id,
        ) ?? null;
      if (document.body.dataset.layout !== "narrow") {
        drawer.close();
        if (id === "review" && !next.sidebarHidden) showPiReview();
        return;
      }
      if (next.sidebarHidden) drawer.close();
      else if (id === "review") showPiReview();
      else drawer.open(Object.hasOwn(SHELL_PANELS, id) ? "sidebar" : "center", opener);
    },
  };
  const drawer = mountNarrowDrawer(t);
  // A narrow window cannot show list and diff side by side; Review opens the diff.
  /** @param {Event} event */
  const onReviewShown = (event) => {
    // Pi's changes are listed by the Review panel; a Git diff keeps the Git panel beside it.
    const list = /** @type {CustomEvent} */ (event).detail?.list || "review";
    if (document.body.dataset.railPanel !== list) selectRail(list);
    if (document.body.dataset.layout === "narrow") drawer.open("center", null);
  };
  // Closing Review gives the sidebar back only if it still shows the Review list.
  const onReviewHidden = () => {
    if (document.body.dataset.railPanel === "review") selectRail(beforeReview);
    if (document.body.dataset.drawer === "center") drawer.close();
  };
  // Focus and a narrow window both hide the editor and dock column.
  const showCenter = () => {
    if (layout.focus) applyHidden(layoutPresetPatch("workbench"));
    if (document.body.dataset.layout === "narrow") drawer.open("center", null);
  };
  document.addEventListener("spopi-review-shown", onReviewShown);
  document.addEventListener("spopi-review-hidden", onReviewHidden);
  mountRail(rail, railOptions);
  document.body.dataset.railPanel = "sessions";
  setPanel("sessions", layout.sidebarHidden);

  headerChromeRefs().sidebarToggle?.addEventListener("click", (event) => {
    event.stopImmediatePropagation();
    const current = document.body.dataset.railPanel || "sessions";
    setPanel(current, !layout.sidebarHidden);
  });

  const keys = appKeybindings();
  const settingsClosed = () => !isSettingsOpen();
  keys.register({
    id: "workspace-search",
    keys: "Mod+P",
    labelKey: "nav.search",
    when: settingsClosed,
    run: () => {
      layout = { ...layout, sidebarHidden: false };
      selectRail("files");
      const searchInput = asFocusableEl(fileSidebarRefs().searchInput);
      searchInput?.focus();
    },
  });
  keys.register({
    id: "sidebar",
    keys: "Mod+B",
    labelKey: "keybindings.sidebar",
    when: settingsClosed,
    run: () => {
      const current = document.body.dataset.railPanel || "sessions";
      setPanel(current, !layout.sidebarHidden);
    },
  });
  keys.register({
    id: "dock",
    keys: "Mod+J",
    labelKey: "keybindings.dock",
    when: settingsClosed,
    run: () => applyHidden({ dockHidden: !layout.dockHidden }),
  });
  keys.register({
    id: "chat",
    keys: "Mod+Shift+L",
    labelKey: "keybindings.chat",
    when: settingsClosed,
    run: () => applyHidden({ chatHidden: !layout.chatHidden }),
  });

  mountLayoutResizers({
    sidebarHandle,
    chatHandle,
    dockHandle,
    getLayout: () => layout,
    getCenterHeight: () => paneCenter?.clientHeight,
    onResize: (patch) => {
      layout = normalizeLayout({ ...layout, ...patch });
      applyLayoutVars(layout);
    },
    onCommit: () => persistLayout(layout),
  });
  const layoutMode = createLayoutMode();
  const phoneTabs = document.createElement("div");
  document.body.append(phoneTabs);
  const tabs = mountPhoneTabs(phoneTabs, { onSettings: () => onSettings?.() });

  return {
    get layout() {
      return layout;
    },
    setPanel,
    applyHidden,
    /** @param {Record<string, unknown>} next */
    applyLayout: (next) => {
      layout = normalizeLayout(next);
      applyLayoutVars(layout);
    },
    showCenter,
    paneCenter,
    destroy() {
      layoutMode.destroy();
      tabs.destroy();
      phoneTabs.remove();
      document.removeEventListener("spopi-review-shown", onReviewShown);
      document.removeEventListener("spopi-review-hidden", onReviewHidden);
      drawer.destroy();
    },
  };
}
