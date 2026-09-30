// ABOUTME: Primary rail: Sessions, Files, Review, Git; theme, Extensions, Settings actions.
// ABOUTME: Theme and Extensions are data-action so they never steal the active panel.

import { applyTheme, getCurrentTheme, onThemeChange, themes } from "../theme/themes.js";
import { registerContextMenuHost } from "../ui/context-menu.js";
import { createIcon } from "../ui/icons.js";

export const RAIL_ITEMS = ["sessions", "files", "review", "git"];
export const THEME_ORDER = Object.keys(themes);

/**
 * @param {string} current
 * @param {string} next
 * @param {boolean} hidden
 * @returns {{ panel: string, sidebarHidden: boolean }}
 */
export function nextRailPanel(current, next, hidden) {
  if (current === next && !hidden) return { panel: next, sidebarHidden: true };
  return { panel: next, sidebarHidden: false };
}

/** @param {string} [current] */
export function nextThemeId(current = getCurrentTheme()) {
  const index = THEME_ORDER.indexOf(current);
  return THEME_ORDER[(index + 1) % THEME_ORDER.length];
}

/**
 * @param {string} id
 * @param {string} title
 */
function iconButton(id, title) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ui-icon-button ui-icon-button--sm ui-icon-button--ghost spopi-rail-btn";
  button.title = title;
  button.setAttribute("aria-label", title);
  const icon = createIcon(id);
  if (icon) button.appendChild(icon);
  return button;
}

/**
 * @param {Element | null | undefined} root
 * @param {object} [options]
 * @param {(id: string) => void} [options.onSelect]
 * @param {(section?: string) => void} [options.onSettings]
 * @param {() => void} [options.onOpenAppearance]
 * @param {() => void} [options.onOpenExtensions]
 * @param {(key: string, params?: Record<string, string>) => string} [options.t]
 * @returns {{
 *   buttons: Map<string, HTMLButtonElement>,
 *   settings: HTMLButtonElement,
 *   themeBtn: HTMLButtonElement,
 *   extensions: HTMLButtonElement,
 * } | null}
 */
export function mountRail(
  root,
  { onSelect, onSettings, onOpenAppearance, onOpenExtensions, t = (key) => key } = {},
) {
  if (!root) return null;
  root.classList.add("spopi-rail");
  root.setAttribute("aria-label", t("shell.rail.label"));
  root.setAttribute("data-i18n-aria-label", "shell.rail.label");
  root.replaceChildren();

  const logo = document.createElement("img");
  logo.className = "spopi-rail-logo";
  logo.src = "icons/favicon.svg";
  logo.alt = "SPOPI";
  root.appendChild(logo);

  /** @type {Map<string, HTMLButtonElement>} */
  const buttons = new Map();
  for (const id of RAIL_ITEMS) {
    const title = t(`nav.${id}`) || id;
    const button = iconButton(id, title);
    button.dataset.nav = id;
    button.setAttribute("aria-pressed", id === "sessions" ? "true" : "false");
    button.addEventListener("click", () => {
      for (const item of buttons.values()) {
        item.classList.remove("active");
        item.setAttribute("aria-pressed", "false");
      }
      button.classList.add("active");
      button.setAttribute("aria-pressed", "true");
      onSelect?.(id);
    });
    buttons.set(id, button);
    root.appendChild(button);
  }
  buttons.get("sessions")?.classList.add("active");

  const spacer = document.createElement("div");
  spacer.className = "spopi-rail-spacer";
  root.appendChild(spacer);

  const themeBtn = iconButton("theme", themeTitle(t, getCurrentTheme()));
  themeBtn.dataset.action = "theme";
  themeBtn.id = "theme-cycle";
  /** @param {string} id */
  const refreshThemeTitle = (id) => {
    themeBtn.title = themeTitle(t, id);
    themeBtn.setAttribute("aria-label", themeBtn.title);
  };
  themeBtn.addEventListener("click", (event) => {
    if (event.shiftKey) {
      onOpenAppearance?.();
      return;
    }
    const next = nextThemeId(getCurrentTheme());
    applyTheme(next, { origin: { x: event.clientX, y: event.clientY } });
    refreshThemeTitle(next);
  });
  themeBtn.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    onOpenAppearance?.();
  });
  registerContextMenuHost(themeBtn);
  onThemeChange(/** @param {string} id */ (id) => refreshThemeTitle(id));
  root.appendChild(themeBtn);

  const extensions = iconButton("extensions", t("nav.extensions") || "Extensions");
  extensions.dataset.action = "extensions";
  extensions.addEventListener("click", () => {
    if (onOpenExtensions) onOpenExtensions();
    else onSettings?.("extensions");
  });
  root.appendChild(extensions);

  const settings = iconButton("settings", t("settings.title") || "Settings");
  settings.dataset.action = "settings";
  settings.addEventListener("click", () => onSettings?.());
  root.appendChild(settings);
  return { buttons, settings, themeBtn, extensions };
}

/**
 * @param {(key: string, params?: Record<string, string>) => string} t
 * @param {string} id
 */
function themeTitle(t, id) {
  /** @type {Record<string, { name?: string } | undefined>} */
  const themeMap = themes;
  const name = themeMap[id]?.name || id;
  return t("nav.themeNamed", { name }) || `Theme: ${name}`;
}
