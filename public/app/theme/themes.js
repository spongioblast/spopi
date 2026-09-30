// ABOUTME: Applies a named theme and remembers it for the next launch.
// ABOUTME: Listeners can follow theme changes, including view transitions.

/**
 * Every theme is one entry here plus a `:root[data-theme]` token block.
 * Rules that differ between light and dark key on `data-scheme`, derived
 * from `dark`, never on a list of ids.
 *
 * Storage note: the active theme is persisted in a cookie so every
 * workspace window on localhost shares one theme.
 */

import { readCookie, writeCookie } from "../storage/cookies.js";

/**
 * @typedef {{ name: string, dark: boolean, colors: string[], vars: Record<string, string> }} Theme
 */

/** @type {Record<string, Theme>} */
export const themes = {
  night: {
    name: "Dusk",
    dark: true,
    colors: ["#1a1a1a", "#e2e2e2", "#8a8a8a", "#6e6e6e"],
    vars: {},
  },
  dawn: {
    name: "Dawn",
    dark: true,
    colors: ["#1a1d26", "#7a8ab0", "#6a5a80", "#5a7a9a"],
    vars: {},
  },
  midnight: {
    name: "Midnight",
    dark: true,
    colors: ["#080c18", "#6ea8ff", "#5a6b85", "#6a78a8"],
    vars: {},
  },
  clean: {
    name: "Clean",
    dark: false,
    colors: ["#ffffff", "#0580c4", "#007aff", "#5ac8fa"],
    vars: {},
  },
  terracotta: {
    name: "Terracotta",
    dark: false,
    colors: ["#f8f5f0", "#c2603c", "#8a6a50", "#9a8e82"],
    vars: {},
  },
  sage: {
    name: "Sage",
    dark: false,
    colors: ["#f5f7f4", "#4f8a6c", "#56727a", "#8c9a93"],
    vars: {},
  },
};

// The theme cookie is the cross-window first-paint cache. The scheme cookie
// lets that script pick light or dark rules for a theme it does not know.
const THEME_COOKIE = "spopi-theme";
const SCHEME_COOKIE = "spopi-scheme";
const THEME_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 10; // 10 years

/** @type {{ set?: (key: string, value: unknown) => Promise<unknown> | void, get?: (key: string) => Promise<unknown> } | null} */
let themePreferences = null;

/**
 * @param {{ set?: (key: string, value: unknown) => Promise<unknown> | void, get?: (key: string) => Promise<unknown> } | null | undefined} next
 */
export function bindThemePreferences(next) {
  themePreferences = next || null;
}

/**
 * Cookie first, then the ui.theme preference. A stored theme replaces the cookie.
 * @param {{ get?: (key: string) => Promise<unknown>, set?: (key: string, value: unknown) => Promise<unknown> } | null | undefined} preferences
 */
export async function hydrateThemePreference(preferences) {
  bindThemePreferences(preferences);
  let stored = null;
  try {
    stored = await preferences?.get?.("ui.theme");
  } catch {
    stored = null;
  }
  const known =
    stored === "dark" || stored === "light" || (typeof stored === "string" && themes[stored]);
  applyTheme(known ? String(stored) : getCurrentTheme());
}

function readThemeCookie() {
  return readCookie(THEME_COOKIE);
}

/** @param {string} themeId */
function writeThemeCookie(themeId) {
  writeCookie(THEME_COOKIE, themeId, THEME_COOKIE_MAX_AGE_SECONDS);
  writeCookie(SCHEME_COOKIE, schemeOf(themeId), THEME_COOKIE_MAX_AGE_SECONDS);
}

/** @param {string} themeId @returns {"dark" | "light"} */
export function schemeOf(themeId) {
  return themes[themeId]?.dark === false ? "light" : "dark";
}

/** @type {Set<(themeId: string) => void>} */
const themeListeners = new Set();

/**
 * Subscribe to active-theme changes. Returns an unsubscribe function.
 * Fired whenever `data-theme` changes (explicit applyTheme or OS-driven),
 * not at subscription time — subscribers re-derive state from CSS variables.
 * @param {(themeId: string) => void} listener
 */
export function onThemeChange(listener) {
  if (typeof listener !== "function") return () => {};
  themeListeners.add(listener);
  return () => themeListeners.delete(listener);
}

/** @param {string} themeId */
function notifyThemeChange(themeId) {
  for (const listener of themeListeners) {
    try {
      listener(themeId);
    } catch (e) {
      console.warn("[themes] theme-change listener error:", e);
    }
  }
  window.dispatchEvent(new CustomEvent("spopi:theme-change", { detail: { themeId } }));
}

/** @param {string} themeId */
function setRootTheme(themeId) {
  const root = document.documentElement;
  if (!themes[themeId]) themeId = "dawn";
  root.setAttribute("data-theme", themeId);
  root.setAttribute("data-scheme", schemeOf(themeId));
  notifyThemeChange(themeId);
  return themeId;
}

/**
 * @param {string} themeId
 * @param {{ origin?: { x: number, y: number } }} [options]
 */
export function applyTheme(themeId, options) {
  const apply = () => {
    const resolved = setRootTheme(themeId);
    writeThemeCookie(resolved);
    themePreferences?.set?.("ui.theme", resolved)?.catch?.(() => {});
  };
  const origin = options?.origin;
  if (origin && Number.isFinite(origin.x) && Number.isFinite(origin.y)) {
    withViewTransition(apply, origin);
  } else {
    withViewTransition(apply);
  }
}

/**
 * Fallback-first View Transitions wrapper. Synchronously runs `apply()` when
 * `document.startViewTransition` is missing or the user prefers reduced
 * motion; otherwise records the click origin (center fallback) into CSS
 * custom properties and routes through the native transition. Callers may
 * omit the origin entirely to retain the documented 50%/50% center fallback.
 * @param {() => void} apply
 * @param {{ x?: number, y?: number }} [origin]
 */
export function withViewTransition(apply, origin) {
  const root = document.documentElement;
  const supportsTransition =
    typeof document !== "undefined" && typeof document.startViewTransition === "function";
  const prefersReducedMotion =
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!supportsTransition || prefersReducedMotion) {
    apply();
    return;
  }
  const x = origin && Number.isFinite(origin.x) ? `${origin.x}px` : "50%";
  const y = origin && Number.isFinite(origin.y) ? `${origin.y}px` : "50%";
  root.style.setProperty("--theme-transition-x", x);
  root.style.setProperty("--theme-transition-y", y);
  document.startViewTransition(apply);
}

export function getCurrentTheme() {
  const saved = readThemeCookie();
  if (saved === "dark") return "night";
  if (saved === "light") return "terracotta";
  if (saved && themes[saved]) return saved;
  return "dawn";
}

// Track OS theme changes only when the user hasn't picked a theme yet.
// As soon as a cookie exists (set by applyTheme) this listener becomes a
// no-op, so the user's explicit choice wins.
if (!readThemeCookie()) {
  setRootTheme("dawn");
}
