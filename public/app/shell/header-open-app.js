// ABOUTME: Opens the current workspace in another installed application.
// ABOUTME: The app list comes from the host.

import { uiStore } from "../storage/ui-store.js";
import { headerChromeRefs } from "./chrome/chat.js";

const STORAGE_KEY = "ui.shell.openApp";

// Shared brand-mark tables: the header split-button and the Info panel both
// resolve app logos/monograms from these tables so the two surfaces can
// never drift.
const OPEN_APP_MONOGRAMS = {
  vscode: "VS",
  cursor: "C",
  webstorm: "WS",
  zed: "Z",
  terminal: "T",
  ghostty: "G",
  finder: "F",
};

const OPEN_APP_ICONS = {
  vscode: "icons/app-vscode.png",
  cursor: "icons/app-cursor.svg",
  webstorm: "icons/app-webstorm.svg",
  zed: "icons/app-zed.png",
  terminal: "icons/app-terminal.svg",
  ghostty: "icons/app-ghostty.png",
  finder: "icons/app-finder.png",
};

/**
 * @typedef {keyof typeof OPEN_APP_ICONS} OpenAppBrandId
 * @typedef {{
 *   id: string,
 *   label: string,
 *   appName?: string | null,
 *   command?: string | null,
 * }} OpenAppEntry
 * @typedef {{
 *   workspaceInfo: (workspaceId: string) => Promise<{ info?: { path?: string } } | null | undefined>,
 * }} OpenAppData
 * @typedef {{
 *   listInstalledApps: () => Promise<unknown>,
 *   openInApp: (
 *     path: string,
 *     options?: { appName?: string | null, command?: string | null },
 *   ) => Promise<unknown>,
 * }} OpenAppControl
/**
 * @param {string | undefined} id
 * @returns {string | undefined}
 */
function iconForId(id) {
  if (id == null) return undefined;
  if (id in OPEN_APP_ICONS) return OPEN_APP_ICONS[/** @type {OpenAppBrandId} */ (id)];
  return undefined;
}

/**
 * @param {string | undefined} id
 * @returns {string | undefined}
 */
function monogramForId(id) {
  if (id == null) return undefined;
  if (id in OPEN_APP_MONOGRAMS) return OPEN_APP_MONOGRAMS[/** @type {OpenAppBrandId} */ (id)];
  return undefined;
}

/**
 * @param {OpenAppEntry | null | undefined} app
 * @returns {HTMLElement}
 */
function renderLogo(app) {
  const icon = iconForId(app?.id);
  if (icon) {
    const image = document.createElement("img");
    image.src = icon;
    image.alt = "";
    image.className = "header-open-app-logo-img";
    return image;
  }
  const label = document.createElement("span");
  label.className = "header-open-app-logo-text";
  label.textContent = monogramForId(app?.id) || app?.label?.slice(0, 1).toUpperCase() || "•";
  return label;
}

/**
 * @param {((error: Error) => void) | undefined} onError
 * @param {unknown} error
 */
function reportError(onError, error) {
  onError?.(error instanceof Error ? error : new Error(String(error)));
}

/**
 * @param {Element | null | undefined} el
 * @returns {HTMLElement | null}
 */
function asOpenAppRoot(el) {
  if (!el || !("classList" in el) || !("replaceChildren" in el)) return null;
  return /** @type {HTMLElement} */ (el);
}

/**
 * @param {Element | null | undefined} el
 * @returns {HTMLElement | null}
 */
function asOpenAppButton(el) {
  if (!el || !("title" in el) || !("setAttribute" in el) || !("addEventListener" in el)) {
    return null;
  }
  return /** @type {HTMLElement} */ (el);
}

/**
 * @param {Element | null | undefined} el
 * @returns {HTMLElement | null}
 */
function asOpenAppToggle(el) {
  if (!el || !("getBoundingClientRect" in el) || !("addEventListener" in el)) return null;
  return /** @type {HTMLElement} */ (el);
}

/**
 * @param {Element | null | undefined} el
 * @returns {HTMLElement | null}
 */
function asOpenAppMenu(el) {
  if (
    !el ||
    !("classList" in el) ||
    !("style" in el) ||
    !("innerHTML" in el) ||
    !("appendChild" in el) ||
    !("parentElement" in el)
  ) {
    return null;
  }
  return /** @type {HTMLElement} */ (el);
}

/**
 * Wire the header split button that opens the current workspace in an external
 * editor/app (VS Code, Cursor, Finder, Terminal, ...).
 *
 * @param {object} [options]
 * @param {OpenAppData} [options.data]
 * @param {OpenAppControl} [options.control]
 * @param {string} [options.workspaceId]
 * @param {(error: Error) => void} [options.onError]
 * @returns {boolean}
 */
export function mountHeaderOpenApp({ data, control, workspaceId, onError } = {}) {
  const dataGw = /** @type {OpenAppData} */ (data);
  const controlGw = /** @type {OpenAppControl} */ (control);
  const workspace = /** @type {string} */ (workspaceId);

  const header = headerChromeRefs();
  const root = asOpenAppRoot(header.openApp);
  const button = asOpenAppButton(header.openAppBtn);
  const logo = asOpenAppRoot(header.openAppLogo);
  const toggle = asOpenAppToggle(header.openAppToggle);
  const menu = asOpenAppMenu(header.openAppMenu);
  if (!root || !button || !logo || !toggle || !menu) return false;

  /** @type {{ apps: OpenAppEntry[], path: string, selectedId: string | null }} */
  const state = {
    apps: [],
    path: "",
    selectedId: uiStore.getItem(STORAGE_KEY) || null,
  };

  /** @returns {OpenAppEntry | null} */
  const selectedApp = () =>
    state.apps.find((app) => app.id === state.selectedId) || state.apps[0] || null;

  const refresh = () => {
    const app = selectedApp();
    if (!state.path || !app || state.apps.length === 0) {
      root.classList.add("hidden");
      return;
    }
    root.classList.remove("hidden");
    logo.replaceChildren(renderLogo(app));
    button.title = `Open ${state.path} in ${app.label}`;
    button.setAttribute("aria-label", `Open workspace in ${app.label}`);
  };

  // Portal the menu to <body> so it escapes the header's `overflow-x: auto;
  // overflow-y: hidden` clipping (the header scrolls horizontally when its
  // content overflows, which also clips any child that visually extends
  // below it, per docs/engineering-lessons.md). Re-position it with fixed
  // coordinates on every open so it tracks the toggle button.
  if (menu.parentElement !== document.body) {
    document.body.appendChild(menu);
  }

  const positionMenu = () => {
    const rect = toggle.getBoundingClientRect();
    menu.style.position = "fixed";
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.right = `${window.innerWidth - rect.right}px`;
    menu.style.left = "auto";
  };

  const closeMenu = () => menu.classList.add("hidden");

  /** @param {OpenAppEntry | null} [app] */
  const openWorkspace = async (app = selectedApp()) => {
    if (!app || !state.path) return;
    state.selectedId = app.id;
    uiStore.setItem(STORAGE_KEY, app.id);
    refresh();
    try {
      await controlGw.openInApp(state.path, {
        appName: app.appName ?? null,
        command: app.command ?? null,
      });
    } catch (error) {
      reportError(onError, error);
    }
  };

  const renderMenu = () => {
    menu.innerHTML = "";
    for (const app of state.apps) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "header-open-app-menu-item";
      if (app.id === state.selectedId) item.classList.add("active");
      item.title = `Open in ${app.label}`;
      item.setAttribute("aria-label", `Open in ${app.label}`);
      const glyph = document.createElement("span");
      glyph.className = "header-open-app-logo";
      glyph.setAttribute("aria-hidden", "true");
      glyph.append(renderLogo(app));
      const name = document.createElement("span");
      name.textContent = app.label;
      item.append(glyph, name);
      item.addEventListener("click", (event) => {
        event.stopPropagation();
        closeMenu();
        openWorkspace(app);
      });
      menu.appendChild(item);
    }
  };

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    openWorkspace();
  });
  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    if (menu.classList.contains("hidden")) {
      renderMenu();
      positionMenu();
      menu.classList.remove("hidden");
    } else {
      closeMenu();
    }
  });
  document.addEventListener("click", closeMenu);

  Promise.all([dataGw.workspaceInfo(workspace).catch(() => null), controlGw.listInstalledApps()])
    .then(([workspaceInfo, apps]) => {
      state.path = workspaceInfo?.info?.path || "";
      state.apps = Array.isArray(apps) ? /** @type {OpenAppEntry[]} */ (apps) : [];
      if (!state.apps.some((app) => app.id === state.selectedId)) {
        state.selectedId = state.apps[0]?.id || null;
      }
      refresh();
    })
    .catch((error) => {
      root.classList.add("hidden");
      reportError(onError, error);
    });

  return true;
}
