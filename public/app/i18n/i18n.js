// ABOUTME: Loads the locale catalogs and translates keys for the UI.
// ABOUTME: The chosen language is stored in ui.language, with the cookie as the first paint.

/**
 * Internationalization — zero-dependency i18n for SPOPI.
 *
 * Storage note: language preference is persisted in a cookie so every
 * workspace window on localhost shares one language.
 * A single `spopi-language` cookie is visible to every workspace window.
 */

import { readCookie, writeCookie } from "../storage/cookies.js";

const LANGUAGE_COOKIE = "spopi-language";
const LANGUAGE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 10; // 10 years

/** @type {{ get?: (key: string) => Promise<unknown>, set?: (key: string, value: unknown) => Promise<unknown> } | null} */
let languagePreferences = null;

/**
 * @param {{ get?: (key: string) => Promise<unknown>, set?: (key: string, value: unknown) => Promise<unknown> } | null | undefined} next
 */
function bindLanguagePreferences(next) {
  languagePreferences = next || null;
}

/**
 * Cookie first, then ui.language. A stored preference replaces the cookie.
 * @param {{ get?: (key: string) => Promise<unknown>, set?: (key: string, value: unknown) => Promise<unknown> } | null | undefined} preferences
 */
export async function hydrateLanguagePreference(preferences) {
  bindLanguagePreferences(preferences);
  let stored = null;
  try {
    stored = await preferences?.get?.("ui.language");
  } catch {
    stored = null;
  }
  if (typeof stored === "string" && stored) {
    await setLocale(stored);
    return;
  }
  languagePreferences?.set?.("ui.language", getLanguagePreference())?.catch?.(() => {});
}

const SUPPORTED_PREFERENCES = new Set(["system", "en", "zh", "ja", "es"]);
const BCP47_TAG = { en: "en", zh: "zh-CN", ja: "ja", es: "es" };

/** @typedef {Record<string, unknown>} MessageTree */

/** English messages — loaded at init, serve as the fallback. */
/** @type {MessageTree} */
let enMessages = {};
/** Active locale messages — may be the same object as enMessages. */
/** @type {MessageTree} */
let activeMessages = {};
let currentLocale = "en";
let currentPreference = "system";
let initialized = false;
let localeLoadSequence = 0;
/** @type {Set<(locale: string, preference: string) => void>} */
const listeners = new Set();
const warnedKeys = new Set();

export const LANGUAGES = [
  { value: "system", labelKey: "settings.language.systemDefault" },
  { value: "en", nativeLabel: "English" },
  { value: "zh", nativeLabel: "中文" },
  { value: "ja", nativeLabel: "日本語" },
  { value: "es", nativeLabel: "Español" },
];

// ── Preference normalization ──────────────────────────────────────────

/**
 * @param {unknown} preference
 * @returns {string}
 */
function normalizePreference(preference) {
  const value = typeof preference === "string" ? preference : "";
  return SUPPORTED_PREFERENCES.has(value) ? value : "system";
}

/**
 * @param {unknown} preference
 * @param {string} [systemLanguage]
 * @returns {"en" | "zh" | "ja" | "es"}
 */
export function resolveLocale(preference, systemLanguage = navigator.language) {
  const pref = normalizePreference(preference);
  if (pref === "en") return "en";
  if (pref === "zh") return "zh";
  if (pref === "ja") return "ja";
  if (pref === "es") return "es";
  // system
  const lang = systemLanguage?.toLowerCase() ?? "";
  if (lang.startsWith("zh")) return "zh";
  if (lang.startsWith("ja")) return "ja";
  if (lang.startsWith("es")) return "es";
  return "en";
}

// ── Cookie helpers (mirrors public/app/theme/themes.js pattern) ─────────────────

function readLanguageCookie() {
  return readCookie(LANGUAGE_COOKIE);
}

/** @param {string} preference */
function writeLanguageCookie(preference) {
  writeCookie(LANGUAGE_COOKIE, preference, LANGUAGE_COOKIE_MAX_AGE_SECONDS);
}

export function getLanguagePreference() {
  return normalizePreference(readLanguageCookie());
}

export function getLocale() {
  return currentLocale;
}

// ── Locale fetching & loading ─────────────────────────────────────────

/** @param {string} locale @returns {Promise<MessageTree>} */
async function fetchLocale(locale) {
  const res = await fetch(`/locales/${locale}.json`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load locale ${locale}: ${res.status}`);
  return /** @type {MessageTree} */ (await res.json());
}

/**
 * Returns one of:
 * - { locale: "en", messages: enMessages, fallback: false }
 * - { locale, messages, fallback: false }  (successful non-English fetch)
 * - { locale: "en", messages: enMessages, fallback: true, failedLocale } (failed non-English fetch)
 */
/** @param {string} locale */
async function loadMessagesForLocale(locale) {
  if (locale === "en") {
    return { locale: "en", messages: enMessages, fallback: false };
  }
  try {
    const messages = await fetchLocale(locale);
    return { locale, messages, fallback: false };
  } catch {
    return { locale: "en", messages: enMessages, fallback: true, failedLocale: locale };
  }
}

// ── Lookup & interpolation ────────────────────────────────────────────

/**
 * @param {unknown} messages
 * @param {string} key
 * @returns {string | undefined}
 */
function lookup(messages, key) {
  if (!messages || typeof messages !== "object") return undefined;
  const parts = key.split(".");
  /** @type {unknown} */
  let current = messages;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = /** @type {Record<string, unknown>} */ (current)[part];
  }
  return typeof current === "string" ? current : undefined;
}

/**
 * @param {string} text
 * @param {object} [params]
 */
function interpolate(text, params) {
  if (!params || typeof params !== "object") return text;
  const values = /** @type {Record<string, unknown>} */ (params);
  return text.replace(/\{(\w+)\}/g, (_match, name) => {
    const val = values[String(name)];
    return val !== undefined && val !== null ? String(val) : "";
  });
}

/**
 * @param {string} key
 * @param {object} [params]
 */
export function t(key, params = {}) {
  const fromActive = lookup(activeMessages, key);
  if (fromActive !== undefined) return interpolate(fromActive, params);
  const fromEn = lookup(enMessages, key);
  if (fromEn !== undefined) return interpolate(fromEn, params);
  if (initialized && !warnedKeys.has(key)) {
    warnedKeys.add(key);
    console.warn(`[i18n] missing key: ${key}`);
  }
  return key;
}

/**
 * Pick `key.one` or `key.other` from the count. `{count}` is filled in.
 * @param {string} key
 * @param {number} count
 * @param {Record<string, unknown>} [params]
 */
export function tn(key, count, params = {}) {
  const form = count === 1 ? "one" : "other";
  return t(`${key}.${form}`, { ...params, count });
}

// ── DOM translation application ───────────────────────────────────────

/**
 * Translate every `data-i18n*` attribute under `root`. Exported for components
 * that build their DOM after startup (a dialog created on first open): the
 * document-wide pass has already run by then, so the new subtree has to be
 * translated explicitly.
 */
/**
 * Translate `root` once the catalog is loaded. Skips the pass when the first
 * key still resolves to itself, which is how chrome used to probe before the
 * catalog finished loading.
 */
/** @param {ParentNode | null | undefined} root */
export function translateSubtree(root) {
  if (!root) return;
  const probe = root.querySelector("[data-i18n]");
  const probeKey = probe?.getAttribute("data-i18n");
  if (probe && probeKey != null && t(probeKey) === probeKey) return;
  applyTranslations(root);
}

/** @param {ParentNode} [root] */
function applyTranslations(root = document) {
  if (!root) return;

  root.querySelectorAll("[data-i18n]").forEach((el) => {
    if (!("dataset" in el)) return;
    const node = /** @type {HTMLElement} */ (el);
    node.textContent = t(node.dataset.i18n || "");
  });
  root.querySelectorAll("[data-i18n-ph]").forEach((el) => {
    if (!("dataset" in el)) return;
    const node = /** @type {HTMLElement & { placeholder?: string }} */ (el);
    node.placeholder = t(node.dataset.i18nPh || "");
  });
  root.querySelectorAll("[data-i18n-title]").forEach((el) => {
    if (!("dataset" in el)) return;
    const node = /** @type {HTMLElement} */ (el);
    node.title = t(node.dataset.i18nTitle || "");
  });
  root.querySelectorAll("[data-i18n-aria-label]").forEach((el) => {
    if (!("dataset" in el)) return;
    const node = /** @type {HTMLElement} */ (el);
    node.setAttribute("aria-label", t(node.dataset.i18nAriaLabel || ""));
  });
  root.querySelectorAll("[data-i18n-alt]").forEach((el) => {
    if (!("dataset" in el)) return;
    const node = /** @type {HTMLElement} */ (el);
    node.setAttribute("alt", t(node.dataset.i18nAlt || ""));
  });
}

function notifyLocaleChange() {
  for (const listener of listeners) {
    try {
      listener(currentLocale, currentPreference);
    } catch (e) {
      console.warn("[i18n] locale-change listener error:", e);
    }
  }

  window.dispatchEvent(
    new CustomEvent("spopi:locale-change", {
      detail: { locale: currentLocale, preference: currentPreference },
    }),
  );
}

// ── Initialization ────────────────────────────────────────────────────

/**
 * @param {Record<string, unknown>} base
 * @param {unknown} override
 * @returns {string[]}
 */
export function mergeLocaleOverrides(base, override) {
  /** @type {string[]} */
  const unknown = [];
  const walk = (
    /** @type {Record<string, unknown>} */ target,
    /** @type {unknown} */ extra,
    /** @type {string} */ prefix,
  ) => {
    if (!extra || typeof extra !== "object" || Array.isArray(extra)) return;
    for (const [key, value] of Object.entries(/** @type {Record<string, unknown>} */ (extra))) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        if (target[key] && typeof target[key] === "object")
          walk(/** @type {Record<string, unknown>} */ (target[key]), value, path);
        else unknown.push(path);
      } else if (typeof value === "string" && typeof target[key] === "string") {
        target[key] = value;
      } else unknown.push(path);
    }
  };
  walk(base, override, "");
  return unknown;
}

async function applyServerLocaleOverrides() {
  try {
    const res = await fetch(`/api/ui/locale?lang=${encodeURIComponent(currentLocale)}`, {
      cache: "no-store",
    });
    if (!res.ok) return;
    mergeLocaleOverrides(/** @type {Record<string, unknown>} */ (activeMessages), await res.json());
  } catch {
    // No host in unit tests.
  }
}

export async function createI18n() {
  try {
    // Always load English first — it's the fallback for everything.
    try {
      enMessages = await fetchLocale("en");
    } catch (e) {
      console.warn("[i18n] failed to load English locale:", e);
      enMessages = {};
    }
    activeMessages = enMessages;

    currentPreference = getLanguagePreference();
    const targetLocale = resolveLocale(currentPreference);

    if (targetLocale !== "en") {
      const result = await loadMessagesForLocale(targetLocale);
      activeMessages = result.messages;
      currentLocale = result.locale;
    } else {
      currentLocale = "en";
    }
    await applyServerLocaleOverrides();
  } catch (e) {
    // createI18n must never throw — degrade to English silently.
    console.warn("[i18n] initialization error, falling back to English:", e);
    activeMessages = enMessages;
    currentLocale = "en";
    currentPreference = "system";
  }

  initialized = true;
  document.documentElement.lang = bcp47(currentLocale);
  applyTranslations(document);
  notifyLocaleChange();
}

/**
 * @param {string} locale
 * @returns {string}
 */
function bcp47(locale) {
  if (locale === "en" || locale === "zh" || locale === "ja" || locale === "es") {
    return BCP47_TAG[locale];
  }
  return "en";
}

// ── Locale switching ──────────────────────────────────────────────────

/** @param {unknown} preference */
export async function setLocale(preference) {
  const sequence = ++localeLoadSequence;
  const pref = normalizePreference(preference);
  const targetLocale = resolveLocale(pref);

  const result = await loadMessagesForLocale(targetLocale);

  // Discard stale result — a later setLocale call has superseded us.
  if (sequence !== localeLoadSequence) return;

  activeMessages = result.messages;
  currentLocale = result.locale;
  currentPreference = result.fallback ? "system" : pref;

  // Only persist the cookie when the requested locale loaded successfully.
  if (!result.fallback) {
    writeLanguageCookie(pref);
    languagePreferences?.set?.("ui.language", pref)?.catch?.(() => {});
  }

  document.documentElement.lang = bcp47(currentLocale);
  applyTranslations(document);
  notifyLocaleChange();
}

/** @param {(locale: string, preference: string) => void} listener */
export function onLocaleChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
