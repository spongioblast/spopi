// ABOUTME: Appearance preferences for the dedicated Appearance settings page:
// ABOUTME: five-level font sizes (chat / preview / terminal), the preview
// ABOUTME: theme mode, and every terminal display preference (theme mode,
// ABOUTME: scrollback, smooth scroll, WebGL). The cookie is the synchronous
// ABOUTME: first-paint cache; the host preference DB is the durable truth.

/**
 * Shared five-level font size scale. Per-surface px maps live in the
 * *_FONT_SIZE_PX tables; `normal` always equals the previously hardcoded
 * value for that surface.
 *
 * @typedef {"small" | "normal" | "medium" | "large" | "xlarge"} FontSizeLevel
 * @typedef {"system" | "light" | "dark"} PreviewThemeMode
 * @typedef {"system" | "light" | "dark"} TerminalThemeMode
 * @typedef {"default" | "git-bash" | "powershell" | "command-prompt"} TerminalProfileId
 * @typedef {Record<FontSizeLevel, number>} FontSizePxMap
 * @typedef {{
 *   id: string,
 *   available?: boolean,
 *   label?: string,
 *   guidance?: string,
 * }} ShellProfile
 * @typedef {{
 *   chatFontSize: FontSizeLevel,
 *   previewFontSize: FontSizeLevel,
 *   previewTheme: PreviewThemeMode,
 *   terminalFontSize: FontSizeLevel,
 *   terminalThemeMode: TerminalThemeMode,
 *   terminalDefaultProfile: string,
 *   terminalScrollbackLimit: number,
 *   terminalSmoothScrollDuration: number,
 *   terminalWebglRenderer?: boolean,
 *   terminalThemeModeMigrated?: boolean,
 * }} AppearanceCookie
 * @typedef {Partial<AppearanceCookie>} AppearanceCookiePatch
 */
import { readCookie, writeCookie } from "../storage/cookies.js";

/** @type {readonly FontSizeLevel[]} */
export const FONT_SIZE_LEVELS = ["small", "normal", "medium", "large", "xlarge"];
/** @type {FontSizeLevel} */
export const DEFAULT_FONT_SIZE_LEVEL = "normal";

/** @type {FontSizePxMap} */
export const CHAT_FONT_SIZE_PX = { small: 12, normal: 13, medium: 14, large: 16, xlarge: 18 };
/** @type {FontSizePxMap} */
export const PREVIEW_FONT_SIZE_PX = { small: 11, normal: 13, medium: 15, large: 17, xlarge: 19 };
/** @type {FontSizePxMap} */
export const TERMINAL_FONT_SIZE_PX = { small: 12, normal: 13, medium: 14, large: 16, xlarge: 18 };

/** Preview color scheme modes: follow the SPOPI theme, or force one. */
/** @type {readonly PreviewThemeMode[]} */
export const PREVIEW_THEME_MODES = ["system", "light", "dark"];
/** @type {PreviewThemeMode} */
export const DEFAULT_PREVIEW_THEME_MODE = "system";

/** Terminal color scheme modes: follow the SPOPI theme, or force one. */
/** @type {readonly TerminalThemeMode[]} */
export const TERMINAL_THEME_MODES = ["system", "light", "dark"];
/** @type {TerminalThemeMode} */
export const DEFAULT_TERMINAL_THEME_MODE = "system";
/** @type {readonly TerminalProfileId[]} */
const TERMINAL_PROFILE_IDS = ["default", "git-bash", "powershell", "command-prompt"];
/** @type {TerminalProfileId} */
export const DEFAULT_TERMINAL_PROFILE = "default";
/** Bash first: Git Bash on Windows, and the shell that exists on Linux too. */
/** @type {readonly TerminalProfileId[]} */
const PREFERRED_SHELL_ORDER = ["git-bash", "powershell", "command-prompt"];
export const DEFAULT_SCROLLBACK_LIMIT = 1000;
const DEFAULT_SMOOTH_SCROLL_DURATION = 0;

const APPEARANCE_COOKIE = "spopi-appearance";
const APPEARANCE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 10; // 10 years

/**
 * @param {unknown} value
 * @returns {FontSizeLevel}
 */
export function normalizeFontLevel(value) {
  return typeof value === "string" &&
    /** @type {readonly string[]} */ (FONT_SIZE_LEVELS).includes(value)
    ? /** @type {FontSizeLevel} */ (value)
    : DEFAULT_FONT_SIZE_LEVEL;
}

/** Unknown/stale preview theme values fall back to system.
 * @param {unknown} value
 * @returns {PreviewThemeMode}
 */
export function normalizePreviewThemeMode(value) {
  return typeof value === "string" &&
    /** @type {readonly string[]} */ (PREVIEW_THEME_MODES).includes(value)
    ? /** @type {PreviewThemeMode} */ (value)
    : DEFAULT_PREVIEW_THEME_MODE;
}

/** Unknown/stale terminal theme values fall back to system (match the SPOPI theme).
 * @param {unknown} value
 * @returns {TerminalThemeMode}
 */
export function normalizeThemeMode(value) {
  return typeof value === "string" &&
    /** @type {readonly string[]} */ (TERMINAL_THEME_MODES).includes(value)
    ? /** @type {TerminalThemeMode} */ (value)
    : DEFAULT_TERMINAL_THEME_MODE;
}

/** Unknown/stale shell profile ids fall back to the host default profile.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeTerminalProfile(value) {
  return typeof value === "string" &&
    /** @type {readonly string[]} */ (TERMINAL_PROFILE_IDS).includes(value)
    ? value
    : DEFAULT_TERMINAL_PROFILE;
}

/**
 * Shells the picker may offer. "default" is not a shell: it is omitted when a
 * real profile is available. When the host only has the system shell (Linux
 * and macOS), that one entry stays, labeled with the program the host named.
 * @param {unknown} profiles
 * @returns {ShellProfile[]}
 */
export function shellProfileChoices(profiles) {
  /** @type {ShellProfile[]} */
  const list = Array.isArray(profiles)
    ? profiles
        .filter((profile) => {
          if (profile == null || typeof profile !== "object") return false;
          return Boolean(/** @type {{ id?: unknown }} */ (profile).id);
        })
        .map((profile) => /** @type {ShellProfile} */ (profile))
    : [];
  const concrete = list.filter((profile) => profile.id !== "default");
  if (concrete.some((profile) => profile.available !== false)) return concrete;
  const system = list.find((profile) => profile.id === "default");
  if (system) return [system];
  if (!list.length) {
    return PREFERRED_SHELL_ORDER.map((id) => ({ id, available: true }));
  }
  return concrete;
}

/** Saved "default" means the preferred available shell, bash when it is installed.
 * @param {unknown} saved
 * @param {unknown} profiles
 * @returns {string}
 */
export function selectedShellProfile(saved, profiles) {
  const choices = shellProfileChoices(profiles);
  if (
    typeof saved === "string" &&
    saved &&
    saved !== "default" &&
    choices.some((profile) => profile.id === saved)
  ) {
    return saved;
  }
  const preferred = PREFERRED_SHELL_ORDER.find((id) =>
    choices.some((profile) => profile.id === id && profile.available !== false),
  );
  if (preferred) return preferred;
  const available = choices.find((profile) => profile.available !== false);
  return available?.id || choices[0]?.id || PREFERRED_SHELL_ORDER[0];
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clampNumber(value, fallback, min, max) {
  if (value === "" || value === null || value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.round(Math.min(max, Math.max(min, number)));
}

/**
 * @param {unknown} value
 * @returns {number}
 */
export function normalizeScrollbackLimit(value) {
  return clampNumber(value, DEFAULT_SCROLLBACK_LIMIT, 100, 50000);
}

/**
 * @param {unknown} value
 * @returns {number}
 */
export function normalizeSmoothScrollDuration(value) {
  return clampNumber(value, DEFAULT_SMOOTH_SCROLL_DURATION, 0, 1000);
}

/**
 * WebGL renderer is opt-in per platform: default ON on macOS/Linux, OFF on
 * Windows until GPU driver coverage is validated. `userAgent` is injectable
 * for tests.
 * @param {string} [userAgent]
 * @returns {boolean}
 */
export function defaultWebglRenderer(
  userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "",
) {
  return !/Windows/i.test(userAgent);
}

/**
 * Resolve the effective preview color scheme: "light"/"dark" force a side,
 * "system" follows the active SPOPI theme's dark flag.
 * @param {unknown} mode
 * @param {unknown} themeIsDark
 * @returns {"light" | "dark"}
 */
export function resolvePreviewTheme(mode, themeIsDark) {
  if (mode === "light") return "light";
  if (mode === "dark") return "dark";
  return themeIsDark ? "dark" : "light";
}

/** @returns {unknown} */
function readAppearanceCookieRaw() {
  try {
    const raw = readCookie(APPEARANCE_COOKIE);
    return raw == null ? null : /** @type {unknown} */ (JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * @param {AppearanceCookiePatch} value
 */
function writeAppearanceCookieRaw(value) {
  writeCookie(APPEARANCE_COOKIE, JSON.stringify(value), APPEARANCE_COOKIE_MAX_AGE_SECONDS);
}

/**
 * Normalized appearance values from the cookie cache; defaults when
 * absent/corrupt. `terminalWebglRenderer` is the one field without a static
 * default — absent means "never touched", which defers to the platform
 * default (defaultWebglRenderer), so it stays undefined instead.
 * @returns {AppearanceCookie}
 */
export function loadAppearanceCookie() {
  const parsed = readAppearanceCookieRaw();
  /** @type {Record<string, unknown>} */
  const raw =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? /** @type {Record<string, unknown>} */ (parsed)
      : {};
  return {
    chatFontSize: normalizeFontLevel(raw.chatFontSize),
    previewFontSize: normalizeFontLevel(raw.previewFontSize),
    previewTheme: normalizePreviewThemeMode(raw.previewTheme),
    terminalFontSize: normalizeFontLevel(raw.terminalFontSize),
    terminalThemeMode: normalizeThemeMode(raw.terminalThemeMode),
    terminalDefaultProfile: normalizeTerminalProfile(raw.terminalDefaultProfile),
    terminalScrollbackLimit: normalizeScrollbackLimit(raw.terminalScrollbackLimit),
    terminalSmoothScrollDuration: normalizeSmoothScrollDuration(raw.terminalSmoothScrollDuration),
    terminalWebglRenderer:
      typeof raw.terminalWebglRenderer === "boolean" ? raw.terminalWebglRenderer : undefined,
    terminalThemeModeMigrated: raw.terminalThemeModeMigrated === true,
  };
}

/** Merge a patch into the cookie cache (values normalized before writing).
 * @param {AppearanceCookiePatch | null | undefined} patch
 */
export function saveAppearanceCookie(patch) {
  const merged = { ...loadAppearanceCookie(), ...(patch || {}) };
  writeAppearanceCookieRaw({
    chatFontSize: normalizeFontLevel(merged.chatFontSize),
    previewFontSize: normalizeFontLevel(merged.previewFontSize),
    previewTheme: normalizePreviewThemeMode(merged.previewTheme),
    terminalFontSize: normalizeFontLevel(merged.terminalFontSize),
    terminalThemeMode: normalizeThemeMode(merged.terminalThemeMode),
    terminalDefaultProfile: normalizeTerminalProfile(merged.terminalDefaultProfile),
    terminalScrollbackLimit: normalizeScrollbackLimit(merged.terminalScrollbackLimit),
    terminalSmoothScrollDuration: normalizeSmoothScrollDuration(
      merged.terminalSmoothScrollDuration,
    ),
    terminalWebglRenderer:
      typeof merged.terminalWebglRenderer === "boolean" ? merged.terminalWebglRenderer : undefined,
    terminalThemeModeMigrated: merged.terminalThemeModeMigrated === true,
  });
}

/**
 * Older builds stored "dark" as if the user had chosen it. Reset once to
 * system. Preview theme already defaults to system and has no stale dark
 * fallback, so it is left alone.
 * @returns {boolean} true when this call performed the reset
 */
export function migrateTerminalThemeCookie() {
  const parsed = readAppearanceCookieRaw();
  const raw =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? /** @type {Record<string, unknown>} */ (parsed)
      : {};
  if (raw.terminalThemeModeMigrated === true) return false;
  saveAppearanceCookie({
    terminalThemeMode: DEFAULT_TERMINAL_THEME_MODE,
    terminalThemeModeMigrated: true,
  });
  return true;
}

/**
 * Mirror the rendered appearance onto the document: font-size custom
 * properties, plus the preview theme attribute CSS scopes its light/dark
 * overrides against. In "system" mode the attribute is REMOVED so the panel
 * keeps the active SPOPI theme's own palette; only forced modes set it.
 * @param {{
 *   chatFontSize?: unknown,
 *   previewFontSize?: unknown,
 *   previewTheme?: unknown,
 *   themeIsDark?: unknown,
 * }} [options]
 */
export function applyAppearanceToDom({
  chatFontSize,
  previewFontSize,
  previewTheme,
  themeIsDark,
} = {}) {
  const root = document.documentElement;
  root.style.setProperty(
    "--chat-font-size",
    `${CHAT_FONT_SIZE_PX[normalizeFontLevel(chatFontSize)]}px`,
  );
  root.style.setProperty(
    "--preview-font-size",
    `${PREVIEW_FONT_SIZE_PX[normalizeFontLevel(previewFontSize)]}px`,
  );
  const mode = normalizePreviewThemeMode(previewTheme);
  if (mode === "system") {
    root.removeAttribute("data-preview-theme");
  } else {
    root.setAttribute("data-preview-theme", resolvePreviewTheme(mode, themeIsDark));
  }
}
