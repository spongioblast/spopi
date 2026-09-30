// ABOUTME: Settings → Terminal renders shell, theme, font, scrollback, and WebGL rows.
// ABOUTME: Preference changes update the cookie immediately and the host when it is up.

import { onLocaleChange, t, translateSubtree } from "../i18n/i18n.js";
import { enhanceSelect } from "../ui/select-menu.js";
import { numberField, row, segmentedLevel, select, toggle } from "../ui/settings-controls.js";
import {
  loadAppearanceCookie,
  normalizeFontLevel,
  normalizeScrollbackLimit,
  normalizeSmoothScrollDuration,
  normalizeTerminalProfile,
  normalizeThemeMode,
  saveAppearanceCookie,
  selectedShellProfile,
  shellProfileChoices,
  TERMINAL_FONT_SIZE_PX,
  TERMINAL_THEME_MODES,
} from "./appearance-preferences.js";

/**
 * @typedef {{
 *   get: (key: string) => Promise<unknown>,
 *   set: (key: string, value: unknown) => Promise<unknown>,
 * }} TerminalPreferencesApi
 *
 * @typedef {{
 *   applyPreferences?: (prefs: {
 *     fontSize?: number,
 *     themeMode?: string,
 *     scrollbackLimit?: number,
 *     smoothScrollDuration?: number,
 *     webglRenderer?: boolean,
 *   }) => void,
 *   listProfiles?: () => Promise<unknown>,
 * }} TerminalSettingsTerminalApi
 *
 * @typedef {{
 *   preferences?: TerminalPreferencesApi | null,
 *   terminal?: TerminalSettingsTerminalApi | null,
 * }} TerminalSettingsDeps
 *
 * @typedef {{
 *   font: HTMLElement,
 *   profileSelect: HTMLSelectElement,
 *   themeSelect: HTMLSelectElement,
 *   scrollbackInput: HTMLInputElement,
 *   smoothScrollInput: HTMLInputElement,
 *   webglToggle: HTMLButtonElement,
 * }} TerminalSettingsControls
 *
 * @typedef {"terminalFontSize" | "terminalThemeMode" | "terminalDefaultProfile" | "terminalScrollbackLimit" | "terminalSmoothScrollDuration" | "terminalWebglRenderer"} TerminalPreferenceField
 *
 * @typedef {{
 *   refresh: () => void | Promise<void>,
 *   destroy: () => void,
 * }} TerminalSettingsHandle
 */

const PREFERENCE_KEYS = Object.freeze({
  terminalFontSize: "ui.terminalFontSize",
  terminalThemeMode: "ui.terminalThemeMode",
  terminalDefaultProfile: "ui.terminalDefaultProfile",
  terminalScrollbackLimit: "ui.terminalScrollbackLimit",
  terminalSmoothScrollDuration: "ui.terminalSmoothScrollDuration",
  terminalWebglRenderer: "ui.terminalWebglRenderer",
});

/** @type {readonly string[]} */
const FONT_LEVELS = ["small", "normal", "medium", "large", "xlarge"];
const PROFILE_LABEL_KEYS = Object.freeze({
  default: "terminal.profileDefault",
  "git-bash": "terminal.profileGitBash",
  powershell: "terminal.profilePowerShell",
  "command-prompt": "terminal.profileCommandPrompt",
});

/**
 * @param {HTMLElement | null | undefined} root
 * @param {TerminalSettingsDeps | null | undefined} deps
 * @returns {TerminalSettingsHandle}
 */
export function mountTerminalSettings(root, deps) {
  if (!root) return { refresh() {}, destroy() {} };
  const font = segmentedLevel({
    id: "settings-terminal-font-size",
    nameId: "settings-terminal-font-size-name",
    markerId: "settings-terminal-font-size-marker",
    stepsId: "settings-terminal-font-size-steps",
    radioName: "settings-terminal-font-size-level",
    label: "Font size",
    labelKey: "settings.terminal.fontSize",
    value: "normal",
    ends: {
      start: "Small",
      startKey: "settings.fontLevel.small",
      current: "Normal",
      currentKey: "settings.fontLevel.normal",
      end: "Extra large",
      endKey: "settings.fontLevel.xlarge",
    },
    levels: FONT_LEVELS.map((level) => ({
      value: level,
      label: level,
      key: `settings.fontLevel.${level}`,
    })),
  });
  const profileSelect = select({
    id: "settings-terminal-profile-select",
    label: "Default shell",
    className: "ui-select settings-terminal-theme-select",
  });
  profileSelect.dataset.i18nAriaLabel = "settings.terminal.defaultShell";
  const themeSelect = select({
    id: "settings-terminal-theme-select",
    label: "Terminal theme",
    className: "ui-select settings-terminal-theme-select",
  });
  themeSelect.dataset.i18nAriaLabel = "settings.terminal.theme";
  const scrollbackInput = numberField({
    id: "settings-terminal-scrollback-input",
    label: "Scrollback lines",
    labelKey: "settings.terminal.scrollback",
    className: "settings-terminal-number",
    min: 100,
    max: 50000,
    step: 100,
    inputMode: "numeric",
  });
  const smoothScrollInput = numberField({
    id: "settings-terminal-smooth-scroll-input",
    label: "Smooth scroll duration",
    labelKey: "settings.terminal.smoothScroll",
    className: "settings-terminal-number",
    min: 0,
    max: 1000,
    step: 10,
    inputMode: "numeric",
  });
  const webglToggle = toggle({
    id: "toggle-terminal-webgl",
    label: "WebGL renderer",
  });
  webglToggle.dataset.i18nAriaLabel = "settings.terminal.webgl";

  const header = document.createElement("div");
  header.className = "settings-header";
  const heading = document.createElement("h3");
  heading.dataset.i18n = "settings.terminal.title";
  heading.textContent = t("settings.terminal.title");
  header.append(heading);
  root.replaceChildren(
    header,
    elBody([
      row({
        id: "setting-terminal-profile",
        label: "Default shell",
        labelKey: "settings.terminal.defaultShell",
        description: "New terminals open with this shell.",
        descriptionKey: "settings.terminal.defaultShellDescription",
        control: profileSelect,
      }),
      row({
        id: "setting-terminal-theme",
        label: "Terminal theme",
        labelKey: "settings.terminal.theme",
        description: "Follow the SPOPI theme, or force light or dark.",
        descriptionKey: "settings.terminal.themeDescription",
        control: themeSelect,
      }),
      row({
        id: "setting-terminal-font-size",
        label: "Font size",
        labelKey: "settings.terminal.fontSize",
        description: "Terminal text size.",
        descriptionKey: "settings.terminal.fontSizeDescription",
        control: font,
      }),
      row({
        id: "setting-terminal-scrollback",
        label: "Scrollback",
        labelKey: "settings.terminal.scrollback",
        description: "Number of terminal history lines to retain.",
        descriptionKey: "settings.terminal.scrollbackDescription",
        control: scrollbackInput,
      }),
      row({
        id: "setting-terminal-smooth-scroll",
        label: "Smooth scroll duration",
        labelKey: "settings.terminal.smoothScroll",
        description: "Animation duration in milliseconds; 0 disables it.",
        descriptionKey: "settings.terminal.smoothScrollDescription",
        control: smoothScrollInput,
      }),
      row({
        id: "setting-terminal-webgl",
        label: "WebGL renderer",
        labelKey: "settings.terminal.webgl",
        description: "Render the terminal on the GPU. Disable it if text looks blurry.",
        descriptionKey: "settings.terminal.webglDescription",
        control: webglToggle,
      }),
    ]),
  );
  translateSubtree(root);
  if (!deps) {
    return {
      refresh() {
        translateSubtree(root);
      },
      destroy() {
        root.replaceChildren();
      },
    };
  }
  return bindTerminalSettings(root, deps, {
    font,
    profileSelect,
    themeSelect,
    scrollbackInput,
    smoothScrollInput,
    webglToggle,
  });
}

/**
 * @param {Array<Node | string>} children
 */
function elBody(children) {
  const body = document.createElement("div");
  body.className = "settings-body";
  const section = document.createElement("div");
  section.className = "settings-section";
  section.append(...children);
  body.append(section);
  return body;
}

/**
 * @param {HTMLElement} root
 * @param {TerminalSettingsDeps} deps
 * @param {TerminalSettingsControls} controls
 * @returns {TerminalSettingsHandle}
 */
function bindTerminalSettings(root, { preferences, terminal }, controls) {
  const { font, profileSelect, themeSelect, scrollbackInput, smoothScrollInput, webglToggle } =
    controls;
  const fontName = font.querySelector("#settings-terminal-font-size-name");
  const fontMarker = font.querySelector("#settings-terminal-font-size-marker");
  /** @type {Map<TerminalPreferenceField, number>} */
  const localChangeVersions = new Map();
  let reconcileRunId = 0;
  /** @type {import("./appearance-preferences.js").ShellProfile[]} */
  let cachedProfiles = shellProfileChoices(null);
  let profilesFromHost = false;

  /**
   * @param {string} key
   * @param {unknown} value
   */
  const persist = (key, value) => {
    if (!preferences) return;
    preferences.set(key, value).catch(() => {});
  };
  /**
   * @param {TerminalPreferenceField} field
   */
  function markLocalChange(field) {
    localChangeVersions.set(field, (localChangeVersions.get(field) || 0) + 1);
  }
  /**
   * @param {string} value
   */
  function renderSegmented(value) {
    const dots = Array.from(font.querySelectorAll(".thinking-effort-dot"));
    const index = dots.findIndex((dot) => {
      if (!("dataset" in dot)) return false;
      const dataset = /** @type {DOMStringMap} */ (
        /** @type {{ dataset: unknown }} */ (dot).dataset
      );
      return dataset.level === value;
    });
    if (index === -1) return;
    for (let i = 0; i < dots.length; i++) {
      const dot = dots[i];
      if (!("checked" in dot) || !("classList" in dot)) continue;
      /** @type {{ checked: boolean }} */ (dot).checked = i === index;
      dot.classList.toggle("active", i === index);
    }
    if (fontName) fontName.textContent = t(`settings.fontLevel.${value}`);
    const active = dots[index];
    if (
      fontMarker &&
      "style" in fontMarker &&
      active &&
      "offsetLeft" in active &&
      "offsetWidth" in active
    ) {
      const button = /** @type {{ offsetLeft: number, offsetWidth: number }} */ (active);
      const thumb = /** @type {{ style: { left: string }, offsetWidth: number }} */ (
        /** @type {unknown} */ (fontMarker)
      );
      const offset = button.offsetLeft + (button.offsetWidth - thumb.offsetWidth) / 2;
      thumb.style.left = `${offset}px`;
    }
  }
  /**
   * @param {string} current
   */
  function fillThemeSelect(current) {
    themeSelect.replaceChildren();
    for (const mode of TERMINAL_THEME_MODES) {
      const option = document.createElement("option");
      option.value = mode;
      option.textContent = t(
        {
          system: "settings.terminal.themeSystem",
          light: "settings.terminal.themeLight",
          dark: "settings.terminal.themeDark",
        }[mode],
      );
      option.selected = mode === current;
      themeSelect.append(option);
    }
  }
  /**
   * @param {string} current
   * @param {unknown} profiles
   */
  function fillProfileSelect(current, profiles) {
    const choices = shellProfileChoices(profiles);
    const selected = selectedShellProfile(current, profiles);
    profileSelect.replaceChildren();
    for (const profile of choices) {
      const option = document.createElement("option");
      option.value = profile.id;
      const labelKey = /** @type {Readonly<Record<string, string>>} */ (PROFILE_LABEL_KEYS)[
        profile.id
      ];
      option.textContent = profile.label || t(labelKey || profile.id);
      option.disabled = profile.available === false;
      if (profile.guidance) option.title = profile.guidance;
      option.selected = profile.id === selected;
      profileSelect.append(option);
    }
    if ([...profileSelect.options].some((option) => option.value === selected)) {
      profileSelect.value = selected;
    }
  }
  function renderControls() {
    const cookie = loadAppearanceCookie();
    renderSegmented(cookie.terminalFontSize);
    fillThemeSelect(cookie.terminalThemeMode);
    fillProfileSelect(cookie.terminalDefaultProfile, cachedProfiles);
    scrollbackInput.value = String(cookie.terminalScrollbackLimit);
    smoothScrollInput.value = String(cookie.terminalSmoothScrollDuration);
    const enabled = cookie.terminalWebglRenderer === true;
    webglToggle.classList.toggle("on", enabled);
    webglToggle.setAttribute("aria-checked", String(enabled));
  }
  /**
   * @param {import("./appearance-preferences.js").FontSizeLevel} level
   */
  function setFontLevel(level) {
    markLocalChange("terminalFontSize");
    saveAppearanceCookie({ terminalFontSize: level });
    persist(PREFERENCE_KEYS.terminalFontSize, level);
    terminal?.applyPreferences?.({ fontSize: TERMINAL_FONT_SIZE_PX[level] });
    renderControls();
  }
  /**
   * @param {unknown} mode
   */
  function setTerminalTheme(mode) {
    const normalized = normalizeThemeMode(mode);
    markLocalChange("terminalThemeMode");
    saveAppearanceCookie({ terminalThemeMode: normalized });
    terminal?.applyPreferences?.({ themeMode: normalized });
    persist(PREFERENCE_KEYS.terminalThemeMode, normalized);
    renderControls();
  }
  /**
   * @param {unknown} profileId
   */
  function setTerminalProfile(profileId) {
    const normalized = normalizeTerminalProfile(profileId);
    markLocalChange("terminalDefaultProfile");
    saveAppearanceCookie({ terminalDefaultProfile: normalized });
    persist(PREFERENCE_KEYS.terminalDefaultProfile, normalized);
    renderControls();
  }
  async function refreshProfiles() {
    try {
      const listed = await terminal?.listProfiles?.();
      const profiles =
        listed && typeof listed === "object" && "profiles" in listed
          ? /** @type {{ profiles?: unknown }} */ (listed).profiles
          : listed;
      if (Array.isArray(profiles) && profiles.length) {
        cachedProfiles = /** @type {import("./appearance-preferences.js").ShellProfile[]} */ (
          profiles
        );
        profilesFromHost = true;
      }
    } catch {
      // Cookie-only fallback keeps the known ids selectable.
    }
    const saved = loadAppearanceCookie().terminalDefaultProfile;
    const resolved = selectedShellProfile(saved, cachedProfiles);
    if (profilesFromHost && saved === "default" && resolved !== "default") {
      setTerminalProfile(resolved);
      return;
    }
    fillProfileSelect(saved, cachedProfiles);
  }
  /**
   * @param {unknown} value
   */
  function setScrollback(value) {
    const normalized = normalizeScrollbackLimit(value);
    markLocalChange("terminalScrollbackLimit");
    saveAppearanceCookie({ terminalScrollbackLimit: normalized });
    scrollbackInput.value = String(normalized);
    terminal?.applyPreferences?.({ scrollbackLimit: normalized });
    persist(PREFERENCE_KEYS.terminalScrollbackLimit, normalized);
  }
  /**
   * @param {unknown} value
   */
  function setSmoothScroll(value) {
    const normalized = normalizeSmoothScrollDuration(value);
    markLocalChange("terminalSmoothScrollDuration");
    saveAppearanceCookie({ terminalSmoothScrollDuration: normalized });
    smoothScrollInput.value = String(normalized);
    terminal?.applyPreferences?.({ smoothScrollDuration: normalized });
    persist(PREFERENCE_KEYS.terminalSmoothScrollDuration, normalized);
  }
  /**
   * @param {boolean} enabled
   */
  function setWebgl(enabled) {
    markLocalChange("terminalWebglRenderer");
    saveAppearanceCookie({ terminalWebglRenderer: enabled });
    webglToggle.classList.toggle("on", enabled);
    webglToggle.setAttribute("aria-checked", String(enabled));
    terminal?.applyPreferences?.({ webglRenderer: enabled });
    persist(PREFERENCE_KEYS.terminalWebglRenderer, enabled);
  }

  font.addEventListener("change", (event) => {
    const target = event.target;
    if (!target || !("closest" in target)) return;
    const dot = /** @type {{ closest: (s: string) => Element | null }} */ (target).closest(
      ".thinking-effort-dot",
    );
    if (dot && "dataset" in dot) {
      const dataset = /** @type {DOMStringMap} */ (
        /** @type {{ dataset: unknown }} */ (dot).dataset
      );
      setFontLevel(normalizeFontLevel(dataset.level));
    }
  });
  themeSelect.addEventListener("change", () => setTerminalTheme(themeSelect.value));
  profileSelect.addEventListener("change", () => setTerminalProfile(profileSelect.value));
  scrollbackInput.addEventListener("change", () => setScrollback(scrollbackInput.value));
  smoothScrollInput.addEventListener("change", () => setSmoothScroll(smoothScrollInput.value));
  webglToggle.addEventListener("click", () => {
    setWebgl(webglToggle.getAttribute("aria-checked") === "true");
  });
  enhanceSelect(themeSelect);
  enhanceSelect(profileSelect);

  const unsubscribeLocale = onLocaleChange(renderControls);
  renderControls();
  void refreshProfiles();

  async function reconcile() {
    const runId = ++reconcileRunId;
    const startedVersions = new Map(localChangeVersions);
    /**
     * @param {TerminalPreferenceField} field
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
    const migratedFlag = await readPreference("ui.terminalThemeModeMigrated");
    const skipServerTheme = migratedFlag.ok && migratedFlag.value !== true;
    if (skipServerTheme && isCurrent("terminalThemeMode")) {
      saveAppearanceCookie({
        terminalThemeMode: "system",
        terminalThemeModeMigrated: true,
      });
      persist(PREFERENCE_KEYS.terminalThemeMode, "system");
      persist("ui.terminalThemeModeMigrated", true);
    }
    /** @type {Array<{
     *   key: string,
     *   field: Exclude<TerminalPreferenceField, "terminalWebglRenderer">,
     *   normalize: (value: unknown) => string | number,
     * }>} */
    const entries = [
      {
        key: PREFERENCE_KEYS.terminalFontSize,
        field: "terminalFontSize",
        normalize: normalizeFontLevel,
      },
      {
        key: PREFERENCE_KEYS.terminalThemeMode,
        field: "terminalThemeMode",
        normalize: normalizeThemeMode,
      },
      {
        key: PREFERENCE_KEYS.terminalDefaultProfile,
        field: "terminalDefaultProfile",
        normalize: normalizeTerminalProfile,
      },
      {
        key: PREFERENCE_KEYS.terminalScrollbackLimit,
        field: "terminalScrollbackLimit",
        normalize: normalizeScrollbackLimit,
      },
      {
        key: PREFERENCE_KEYS.terminalSmoothScrollDuration,
        field: "terminalSmoothScrollDuration",
        normalize: normalizeSmoothScrollDuration,
      },
    ];
    for (const entry of entries) {
      if (entry.field === "terminalThemeMode" && skipServerTheme) continue;
      const result = await readPreference(entry.key);
      if (!isCurrent(entry.field) || !result.ok) continue;
      const current = loadAppearanceCookie();
      if (result.value === null || result.value === undefined) {
        persist(entry.key, current[entry.field]);
        continue;
      }
      const normalized = entry.normalize(result.value);
      if (
        entry.field === "terminalDefaultProfile" &&
        normalized === "default" &&
        current.terminalDefaultProfile !== "default"
      ) {
        continue;
      }
      if (normalized !== current[entry.field]) {
        saveAppearanceCookie({ [entry.field]: normalized });
      }
    }
    const webglResult = await readPreference(PREFERENCE_KEYS.terminalWebglRenderer);
    if (isCurrent("terminalWebglRenderer") && webglResult.ok) {
      const current = loadAppearanceCookie();
      if (
        typeof webglResult.value === "boolean" &&
        webglResult.value !== current.terminalWebglRenderer
      ) {
        saveAppearanceCookie({ terminalWebglRenderer: webglResult.value });
      }
    }
    if (runId !== reconcileRunId) return;
    renderControls();
    const updated = loadAppearanceCookie();
    terminal?.applyPreferences?.({
      fontSize: TERMINAL_FONT_SIZE_PX[updated.terminalFontSize],
      themeMode: updated.terminalThemeMode,
      scrollbackLimit: updated.terminalScrollbackLimit,
      smoothScrollDuration: updated.terminalSmoothScrollDuration,
      ...(typeof updated.terminalWebglRenderer === "boolean"
        ? { webglRenderer: updated.terminalWebglRenderer }
        : {}),
    });
  }

  return {
    refresh() {
      translateSubtree(root);
      renderControls();
      void refreshProfiles();
      return reconcile();
    },
    destroy() {
      reconcileRunId += 1;
      unsubscribeLocale();
      root.replaceChildren();
    },
  };
}

/** Elements this page creates. Callers use the refs instead of looking up ids.
 * @param {ParentNode | null | undefined} root
 */
export function terminalSettingsRefs(root) {
  return {
    fontGroup: root?.querySelector("#settings-terminal-font-size") ?? null,
    fontName: root?.querySelector("#settings-terminal-font-size-name") ?? null,
    fontMarker: root?.querySelector("#settings-terminal-font-size-marker") ?? null,
    themeSelect: root?.querySelector("#settings-terminal-theme-select") ?? null,
    profileSelect: root?.querySelector("#settings-terminal-profile-select") ?? null,
    profileRow: root?.querySelector("#setting-terminal-profile") ?? null,
    scrollbackInput: root?.querySelector("#settings-terminal-scrollback-input") ?? null,
    smoothScrollInput: root?.querySelector("#settings-terminal-smooth-scroll-input") ?? null,
    webglToggle: root?.querySelector("#toggle-terminal-webgl") ?? null,
  };
}
