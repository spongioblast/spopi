// ABOUTME: Settings → Appearance renders theme, chat, and preview controls.
// ABOUTME: The cookie paints immediately; the host preference DB wins on reconcile.

import { onLocaleChange, t, translateSubtree } from "../i18n/i18n.js";
import { applyTheme, getCurrentTheme, themes } from "../theme/themes.js";
import { el } from "../ui/dom.js";
import { enhanceSelect } from "../ui/select-menu.js";
import { row, segmentedLevel, select, settingsCard } from "../ui/settings-controls.js";
import {
  applyAppearanceToDom,
  FONT_SIZE_LEVELS,
  loadAppearanceCookie,
  normalizeFontLevel,
  normalizePreviewThemeMode,
  PREVIEW_THEME_MODES,
  saveAppearanceCookie,
} from "./appearance-preferences.js";

/**
 * @typedef {{
 *   get: (key: string) => Promise<unknown>,
 *   set: (key: string, value: unknown) => Promise<unknown>,
 * }} AppearancePreferencesApi
 *
 * @typedef {"chatFontSize" | "previewFontSize"} AppearanceFontField
 * @typedef {AppearanceFontField | "previewTheme"} AppearanceField
 *
 * @typedef {{
 *   preferences?: AppearancePreferencesApi | null,
 * }} AppearanceSettingsDeps
 *
 * @typedef {{
 *   preferences?: AppearancePreferencesApi | null,
 *   themeGrid: HTMLElement,
 *   chatFont: HTMLElement,
 *   previewFont: HTMLElement,
 *   previewTheme: HTMLSelectElement,
 * }} AppearanceBindContext
 *
 * @typedef {{
 *   refresh: () => void | Promise<void>,
 *   paint: () => void,
 *   destroy: () => void,
 * }} AppearanceSettingsHandle
 */

const PREFERENCE_KEYS = Object.freeze({
  chatFontSize: "ui.chatFontSize",
  previewFontSize: "ui.previewFontSize",
  previewTheme: "ui.previewTheme",
});

/** @type {Readonly<Record<import("./appearance-preferences.js").PreviewThemeMode, string>>} */
const PREVIEW_THEME_LABELS = Object.freeze({
  system: "settings.preview.themeSystem",
  light: "settings.preview.themeLight",
  dark: "settings.preview.themeDark",
});

/**
 * @param {string} id
 * @param {string} nameId
 * @param {string} markerId
 * @param {string} stepsId
 * @param {string} radioName
 * @param {string} labelKey
 */
function fontLevel(id, nameId, markerId, stepsId, radioName, labelKey) {
  return segmentedLevel({
    id,
    nameId,
    markerId,
    stepsId,
    radioName,
    label: "Font size",
    labelKey,
    value: "normal",
    ends: {
      start: "Small",
      startKey: "settings.fontLevel.small",
      current: "Normal",
      currentKey: "settings.fontLevel.normal",
      end: "Extra large",
      endKey: "settings.fontLevel.xlarge",
    },
    levels: FONT_SIZE_LEVELS.map((level) => ({
      value: level,
      label: level,
      key: `settings.fontLevel.${level}`,
    })),
  });
}

/**
 * @param {string} title
 * @param {string} i18n
 * @param {Array<Node | string | false | null | undefined>} children
 */
function section(title, i18n, children) {
  return settingsCard(title, i18n, children);
}

/**
 * @param {HTMLElement | null | undefined} root
 * @param {AppearanceSettingsDeps} [options]
 * @returns {AppearanceSettingsHandle}
 */
export function mountAppearanceSettings(root, { preferences } = {}) {
  if (!root) return { refresh() {}, paint() {}, destroy() {} };
  const themeGrid = /** @type {HTMLElement} */ (
    el("div", { class: "theme-grid", id: "theme-grid" })
  );
  const chatFont = fontLevel(
    "settings-chat-font-size",
    "settings-chat-font-size-name",
    "settings-chat-font-size-marker",
    "settings-chat-font-size-steps",
    "settings-chat-font-size-level",
    "settings.chat.fontSize",
  );
  const previewFont = fontLevel(
    "settings-preview-font-size",
    "settings-preview-font-size-name",
    "settings-preview-font-size-marker",
    "settings-preview-font-size-steps",
    "settings-preview-font-size-level",
    "settings.preview.fontSize",
  );
  const previewTheme = select({
    id: "settings-preview-theme-select",
    label: "Preview theme",
    className: "ui-select settings-preview-theme-select",
  });
  previewTheme.dataset.i18nAriaLabel = "settings.preview.theme";
  const heading = /** @type {HTMLElement} */ (el("h3", { text: "Appearance" }));
  heading.dataset.i18n = "settings.appearance";
  root.replaceChildren(
    el("div", { class: "settings-header" }, [heading]),
    el("div", { class: "settings-body" }, [
      section("Theme", "settings.theme", [themeGrid]),
      section("Chat", "settings.chat.title", [
        row({
          id: "setting-chat-font-size",
          label: "Font size",
          labelKey: "settings.chat.fontSize",
          description: "Text size for chat messages.",
          descriptionKey: "settings.chat.fontSizeDescription",
          control: chatFont,
        }),
      ]),
      section("Preview", "settings.preview.title", [
        row({
          id: "setting-preview-theme",
          label: "Preview theme",
          labelKey: "settings.preview.theme",
          description:
            "Follow the SPOPI theme, or force light or dark for code and markdown previews.",
          descriptionKey: "settings.preview.themeDescription",
          control: previewTheme,
        }),
        row({
          id: "setting-preview-font-size",
          label: "Font size",
          labelKey: "settings.preview.fontSize",
          description: "Text size for the file preview.",
          descriptionKey: "settings.preview.fontSizeDescription",
          control: previewFont,
        }),
      ]),
    ]),
  );
  translateSubtree(root);
  return bindAppearance(root, { preferences, themeGrid, chatFont, previewFont, previewTheme });
}

/**
 * @param {HTMLElement} root
 * @param {AppearanceBindContext} context
 * @returns {AppearanceSettingsHandle}
 */
function bindAppearance(root, { preferences, themeGrid, chatFont, previewFont, previewTheme }) {
  /** @type {Array<{ key: AppearanceFontField, group: HTMLElement }>} */
  const controls = [
    { key: "chatFontSize", group: chatFont },
    { key: "previewFontSize", group: previewFont },
  ];
  /** @type {Map<AppearanceField, number>} */
  const localChangeVersions = new Map();
  let reconcileRunId = 0;
  /**
   * @param {string} key
   * @param {unknown} value
   */
  const persist = (key, value) => {
    if (!preferences) return;
    preferences.set(key, value).catch(() => {});
  };

  function currentThemeIsDark() {
    const themeId = document.documentElement.getAttribute("data-theme");
    if (!themeId) return true;
    const theme = /** @type {Record<string, { dark?: boolean } | undefined>} */ (themes)[themeId];
    return theme?.dark ?? true;
  }

  function applyDom() {
    const cookie = loadAppearanceCookie();
    applyAppearanceToDom({
      chatFontSize: cookie.chatFontSize,
      previewFontSize: cookie.previewFontSize,
      previewTheme: cookie.previewTheme,
      themeIsDark: currentThemeIsDark(),
    });
  }

  /**
   * @param {HTMLElement} group
   * @param {string} value
   */
  function renderSegmented(group, value) {
    const dots = Array.from(group.querySelectorAll(".thinking-effort-dot"));
    const index = dots.findIndex((dot) => {
      if (!("dataset" in dot)) return false;
      const dataset = /** @type {DOMStringMap} */ (
        /** @type {{ dataset: unknown }} */ (dot).dataset
      );
      return dataset.level === value;
    });
    if (index === -1) return;
    const name = group.querySelector(".thinking-effort-name");
    const marker = group.querySelector(".thinking-effort-thumb");
    for (let i = 0; i < dots.length; i++) {
      const dot = dots[i];
      if (!("checked" in dot) || !("classList" in dot)) continue;
      /** @type {{ checked: boolean }} */ (dot).checked = i === index;
      dot.classList.toggle("active", i === index);
    }
    if (name) name.textContent = t(`settings.fontLevel.${value}`);
    const active = dots[index];
    if (
      marker &&
      "style" in marker &&
      active &&
      "offsetLeft" in active &&
      "offsetWidth" in active
    ) {
      const button = /** @type {{ offsetLeft: number, offsetWidth: number }} */ (active);
      const thumb = /** @type {{ style: { left: string }, offsetWidth: number }} */ (
        /** @type {unknown} */ (marker)
      );
      thumb.style.left = `${button.offsetLeft + (button.offsetWidth - thumb.offsetWidth) / 2}px`;
    }
  }

  /**
   * @param {string} current
   */
  function fillPreviewTheme(current) {
    previewTheme.replaceChildren();
    for (const mode of PREVIEW_THEME_MODES) {
      const option = document.createElement("option");
      option.value = mode;
      option.textContent = t(PREVIEW_THEME_LABELS[mode]);
      option.selected = mode === current;
      previewTheme.append(option);
    }
  }

  function renderControls() {
    const cookie = loadAppearanceCookie();
    for (const control of controls) renderSegmented(control.group, cookie[control.key]);
    fillPreviewTheme(cookie.previewTheme);
  }

  /**
   * @param {AppearanceField} field
   */
  function markLocalChange(field) {
    localChangeVersions.set(field, (localChangeVersions.get(field) || 0) + 1);
  }

  /**
   * @param {AppearanceFontField} key
   * @param {import("./appearance-preferences.js").FontSizeLevel | string} level
   */
  function setFontLevel(key, level) {
    markLocalChange(key);
    saveAppearanceCookie({ [key]: level });
    applyDom();
    persist(PREFERENCE_KEYS[key], level);
    renderControls();
  }

  /**
   * @param {unknown} mode
   */
  function setPreviewTheme(mode) {
    const normalized = normalizePreviewThemeMode(mode);
    markLocalChange("previewTheme");
    saveAppearanceCookie({ previewTheme: normalized });
    applyDom();
    persist(PREFERENCE_KEYS.previewTheme, normalized);
    renderControls();
  }

  function paint() {
    themeGrid.replaceChildren();
    const current = getCurrentTheme();
    for (const [id, theme] of Object.entries(
      /** @type {Record<string, { colors?: string[] }>} */ (themes),
    )) {
      const colors = /** @type {HTMLElement} */ (el("span", { class: "swatch-colors" }));
      for (const color of theme.colors || []) {
        const dot = /** @type {HTMLElement} */ (el("span", { class: "swatch-dot" }));
        dot.style.background = color;
        colors.append(dot);
      }
      const btn = /** @type {HTMLElement} */ (
        el("button", {
          class: `theme-swatch${current === id ? " active" : ""}`,
        })
      );
      const named = /** @type {{ name?: string }} */ (
        /** @type {Record<string, { name?: string }>} */ (themes)[id] || {}
      );
      const themeName = named.name || id;
      btn.setAttribute("aria-label", themeName);
      btn.title = themeName;
      btn.append(el("span", { class: "theme-swatch-name", text: themeName }), colors);
      btn.addEventListener("click", () => {
        applyTheme(id);
        for (const swatch of themeGrid.querySelectorAll(".theme-swatch")) {
          swatch.classList.remove("active");
        }
        btn.classList.add("active");
      });
      themeGrid.append(btn);
    }
  }

  for (const control of controls) {
    control.group.addEventListener("change", (event) => {
      const target = event.target;
      if (!target || !("closest" in target)) return;
      const dot = /** @type {{ closest: (s: string) => Element | null }} */ (target).closest(
        ".thinking-effort-dot",
      );
      if (dot && "dataset" in dot) {
        const dataset = /** @type {DOMStringMap} */ (
          /** @type {{ dataset: unknown }} */ (dot).dataset
        );
        setFontLevel(control.key, normalizeFontLevel(dataset.level));
      }
    });
    control.group.addEventListener("click", (event) => {
      const target = event.target;
      if (!target || !("closest" in target)) return;
      const dot = /** @type {{ closest: (s: string) => Element | null }} */ (target).closest(
        ".thinking-effort-dot",
      );
      if (
        dot &&
        "checked" in dot &&
        !(/** @type {{ checked?: boolean }} */ (dot).checked) &&
        "click" in dot &&
        typeof (/** @type {{ click?: unknown }} */ (dot).click) === "function"
      ) {
        /** @type {{ click: () => void }} */ (dot).click();
      }
    });
  }
  enhanceSelect(previewTheme);
  previewTheme.addEventListener("change", () => setPreviewTheme(previewTheme.value));
  const observer = new MutationObserver(() => applyDom());
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const unsubscribeLocale = onLocaleChange(renderControls);
  applyDom();
  renderControls();
  paint();

  async function reconcile() {
    const runId = ++reconcileRunId;
    const startedVersions = new Map(localChangeVersions);
    /**
     * @param {AppearanceField} field
     */
    const isCurrent = (field) =>
      runId === reconcileRunId && localChangeVersions.get(field) === startedVersions.get(field);
    /**
     * @param {string} key
     */
    const readPreference = async (key) => {
      try {
        return { ok: true, value: await preferences?.get(key) };
      } catch {
        return { ok: false, value: undefined };
      }
    };
    /** @type {Array<{
     *   key: string,
     *   field: AppearanceField,
     *   normalize: (value: unknown) => string,
     * }>} */
    const entries = [
      { key: PREFERENCE_KEYS.chatFontSize, field: "chatFontSize", normalize: normalizeFontLevel },
      {
        key: PREFERENCE_KEYS.previewFontSize,
        field: "previewFontSize",
        normalize: normalizeFontLevel,
      },
      {
        key: PREFERENCE_KEYS.previewTheme,
        field: "previewTheme",
        normalize: normalizePreviewThemeMode,
      },
    ];
    for (const entry of entries) {
      const result = await readPreference(entry.key);
      if (!isCurrent(entry.field) || !result.ok) continue;
      const current = loadAppearanceCookie();
      if (result.value === null || result.value === undefined) {
        persist(entry.key, current[entry.field]);
        continue;
      }
      const normalized = entry.normalize(result.value);
      if (normalized !== current[entry.field]) {
        saveAppearanceCookie({ [entry.field]: normalized });
      }
    }
    if (runId !== reconcileRunId) return;
    applyDom();
    renderControls();
  }

  return {
    paint,
    refresh() {
      translateSubtree(root);
      paint();
      renderControls();
      return reconcile();
    },
    destroy() {
      reconcileRunId += 1;
      observer.disconnect();
      unsubscribeLocale();
      root.replaceChildren();
    },
  };
}
