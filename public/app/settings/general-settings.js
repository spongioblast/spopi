// ABOUTME: Settings → General renders language, agent, and version rows.
// ABOUTME: Toggles, thinking effort, language, and idle timeout bind on this page.

import {
  getLanguagePreference,
  LANGUAGES,
  onLocaleChange,
  setLocale,
  t,
  translateSubtree,
} from "../i18n/i18n.js";
import { uiStore } from "../storage/ui-store.js";
import { el } from "../ui/dom.js";
import { enhanceSelect } from "../ui/select-menu.js";
import {
  numberField,
  row,
  sectionTitle,
  segmentedLevel,
  select,
  settingsPage,
  toggle,
} from "../ui/settings-controls.js";
import { randomId } from "../utils/random-id.js";
import { agentToggleSpecs } from "./agent-toggles.js";
import { guardSettingsSection } from "./guard-settings.js";
import { projectsFolderRow } from "./projects-folder-setting.js";
import { queueModeControls } from "./queue-modes.js";

const STORAGE_PREFIX = "ui.settings.";
export const RUNTIME_IDLE_TIMEOUT_KEY = "ui.runtimeIdleTimeoutMinutes";
export const DEFAULT_RUNTIME_IDLE_MINUTES = 30;
const MAX_RUNTIME_IDLE_MINUTES = 1440;

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high"];

/**
 * @typedef {{
 *   ok?: boolean,
 *   error?: string,
 *   data?: Record<string, unknown>,
 * }} ConfigCallResult
 *
 * @typedef {{
 *   call: (
 *     op: string,
 *     params?: Record<string, unknown>,
 *     options?: Record<string, unknown>
 *   ) => Promise<ConfigCallResult>,
 * }} ConfigGatewayLike
 *
 * @typedef {{
 *   get: (key: string) => Promise<unknown>,
 *   set: (key: string, value: unknown) => Promise<unknown>,
 * }} PreferencesLike
 *
 * @typedef {{
 *   request: (
 *     message: Record<string, unknown>,
 *     target: unknown,
 *     options?: Record<string, unknown>
 *   ) => Promise<unknown>,
 * }} RuntimeLike
 *
 * @typedef {{
 *   configGateway?: ConfigGatewayLike | null,
 *   onError?: ((error: unknown) => void) | null,
 *   preferences?: PreferencesLike | null,
 *   runtime?: RuntimeLike | null,
 *   getTarget?: (() => unknown) | null,
 *   onThinkingLevelChanged?: ((level: string, target: unknown) => void) | null,
 * }} GeneralSettingsDeps
 *
 * @typedef {{
 *   id: string,
 *   key: string,
 *   label: string,
 *   labelKey?: string,
 *   defaultValue: boolean,
 *   persist?: string,
 *   load?: (configGateway: ConfigGatewayLike | null | undefined) => Promise<unknown>,
 *   save?: (configGateway: ConfigGatewayLike | null | undefined, value: boolean) => Promise<unknown>,
 *   onChange?: (value: boolean) => void,
 * }} SettingToggleConfig
 *
 * @typedef {{
 *   piVersion: HTMLElement | null,
 *   appVersion: HTMLElement | null,
 *   thinkingEffort: HTMLElement | null,
 *   thinkingEffortName: HTMLElement | null,
 *   thinkingEffortMarker: HTMLElement | null,
 *   updateStatus: HTMLElement | null,
 *   checkUpdates: HTMLElement | null,
 *   languageSelect: HTMLSelectElement | null,
 *   idleTimeout: HTMLInputElement | null,
 * }} GeneralSettingsRefs
 */

/**
 * @param {unknown} value
 * @returns {number}
 */
export function normalizeIdleMinutes(value) {
  if (typeof value === "string" && value.trim() === "") return DEFAULT_RUNTIME_IDLE_MINUTES;
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes < 0) return DEFAULT_RUNTIME_IDLE_MINUTES;
  return Math.min(MAX_RUNTIME_IDLE_MINUTES, Math.round(minutes));
}

/**
 * @param {string} title
 * @param {string} i18n
 * @param {Array<Node | string | false | null | undefined>} children
 * @param {string} [id]
 * @returns {HTMLElement}
 */
function section(title, i18n, children, id) {
  const node = /** @type {HTMLElement} */ (
    el("div", { class: "settings-section" }, [sectionTitle(title, { i18n }), ...children])
  );
  if (id) node.id = id;
  return node;
}

/**
 * @param {string} id
 * @param {string} text
 * @param {string | null | undefined} i18n
 * @param {boolean} loading
 * @returns {HTMLElement}
 */
function staticValue(id, text, i18n, loading) {
  const node = /** @type {HTMLElement} */ (
    el("span", {
      class: loading ? "settings-static-value ui-loading" : "settings-static-value",
      id,
      role: "status",
      text,
    })
  );
  node.setAttribute("aria-live", "polite");
  if (loading) node.setAttribute("aria-busy", "true");
  if (i18n) node.dataset.i18n = i18n;
  return node;
}

function thinkingControl() {
  return segmentedLevel({
    id: "thinking-effort",
    nameId: "thinking-effort-name",
    markerId: "thinking-effort-marker",
    stepsId: "thinking-effort-steps",
    radioName: "thinking-effort-level",
    label: "Thinking effort",
    labelKey: "settings.thinkingEffort",
    value: "off",
    ends: {
      start: "Faster",
      startKey: "settings.thinkingFaster",
      current: "off",
      currentKey: "settings.thinkingLevels.off",
      end: "Smarter",
      endKey: "settings.thinkingSmarter",
    },
    levels: THINKING_LEVELS.map((level) => ({
      value: level,
      label: level,
      key: `settings.thinkingLevels.${level}`,
    })),
  });
}

/**
 * @param {ConfigGatewayLike | null | undefined} configGateway
 * @param {string} op
 * @param {Record<string, unknown>} params
 * @param {string} failure
 */
async function callConfigBoolean(configGateway, op, params, failure) {
  if (!configGateway) return undefined;
  const response = await configGateway.call(op, params);
  if (!response?.ok) throw new Error(response?.error || failure);
  return response.data?.enabled;
}

/**
 * @param {SettingToggleConfig} config
 * @param {{
 *   configGateway?: ConfigGatewayLike | null,
 *   onError?: ((error: unknown) => void) | null,
 * }} [options]
 */
function settingToggle(config, { configGateway, onError } = {}) {
  const storageKey = `${STORAGE_PREFIX}${config.key}`;
  const stored = config.persist === "config" ? null : uiStore.getItem(storageKey);
  let enabled = stored !== null ? stored === "true" : config.defaultValue;
  const button = toggle({
    id: config.id,
    checked: enabled,
    label: config.label,
    onChange(next) {
      const previous = enabled;
      enabled = next;
      config.onChange?.(next);
      if (config.persist === "config") {
        config.save?.(configGateway, next).catch((/** @type {unknown} */ error) => {
          enabled = previous;
          button.classList.toggle("on", previous);
          button.setAttribute("aria-checked", String(previous));
          config.onChange?.(previous);
          onError?.(error);
        });
        return;
      }
      uiStore.setItem(storageKey, String(next));
    },
  });
  if (config.labelKey) button.dataset.i18nAriaLabel = config.labelKey;
  config.onChange?.(enabled);
  if (config.persist === "config") {
    config
      .load?.(configGateway)
      .then((/** @type {unknown} */ value) => {
        if (typeof value !== "boolean") return;
        enabled = value;
        button.classList.toggle("on", value);
        button.setAttribute("aria-checked", String(value));
        config.onChange?.(value);
      })
      .catch((/** @type {unknown} */ error) => onError?.(error));
  }
  return {
    button,
    get: () => button.classList.contains("on"),
    /**
     * @param {boolean} value
     */
    set(value) {
      enabled = value;
      if (config.persist !== "config") uiStore.setItem(storageKey, String(value));
      button.classList.toggle("on", value);
      button.setAttribute("aria-checked", String(value));
      config.onChange?.(value);
    },
  };
}

/**
 * @param {GeneralSettingsDeps | null | undefined} deps
 */
function generalToggles(deps) {
  /** @type {SettingToggleConfig[]} */
  const specs = [
    ...agentToggleSpecs(deps),
    {
      id: "toggle-show-thinking",
      key: "show-thinking",
      label: "Show thinking",
      defaultValue: true,
      persist: "config",
      load: async (configGateway) => {
        const legacyKey = `${STORAGE_PREFIX}show-thinking`;
        const legacy = uiStore.getItem(legacyKey);
        if (legacy !== null && configGateway) {
          await callConfigBoolean(
            configGateway,
            "set_show_thinking",
            { enabled: legacy === "true" },
            "Failed to save show thinking",
          );
          uiStore.removeItem(legacyKey);
          return legacy === "true";
        }
        return callConfigBoolean(
          configGateway,
          "get_show_thinking",
          {},
          "Failed to load show thinking",
        );
      },
      save: (configGateway, value) =>
        callConfigBoolean(
          configGateway,
          "set_show_thinking",
          { enabled: value },
          "Failed to save show thinking",
        ),
      onChange: (value) => {
        document.body.dataset.showThinking = value ? "on" : "off";
      },
    },
    {
      id: "toggle-task-notifications",
      key: "task-notifications",
      label: "Task completion notifications",
      labelKey: "settings.taskNotifications",
      defaultValue: true,
    },
  ];
  const toggles = specs.map((spec) => ({ spec, control: settingToggle(spec, deps ?? {}) }));
  return {
    byId: Object.fromEntries(toggles.map(({ spec, control }) => [spec.id, control.button])),
    /**
     * @param {string} key
     * @returns {boolean}
     */
    getToggleState(key) {
      const found = toggles.find(({ spec }) => spec.key === key);
      if (found) return found.control.get();
      const stored = uiStore.getItem(`${STORAGE_PREFIX}${key}`);
      if (stored !== null) return stored === "true";
      return false;
    },
    /**
     * @param {string} key
     * @param {boolean} value
     */
    setToggleState(key, value) {
      toggles.find(({ spec }) => spec.key === key)?.control.set(value);
    },
  };
}

/**
 * @param {ParentNode | null | undefined} root
 * @param {GeneralSettingsDeps | null | undefined} deps
 */
export function mountGeneralSettings(root, deps) {
  if (!root) return { refresh() {}, reload() {}, destroy() {} };
  const switches = generalToggles(deps);
  // The page mounts at startup, before the host connection is open, so a read made
  // then fails. Rows register their loaders: a failed load retries each second for a
  // while, and opening Settings runs every loader again.
  /** @type {Array<() => Promise<unknown> | undefined>} */
  const loaders = [];
  /** @param {() => Promise<unknown> | undefined} load */
  const run = (load, attempt = 0) => {
    Promise.resolve()
      .then(load)
      .catch(() => {
        if (attempt < 10) setTimeout(() => run(load, attempt + 1), 1000);
      });
  };
  /** @param {() => Promise<unknown> | undefined} load */
  const register = (load) => {
    loaders.push(load);
    run(load);
  };
  const languageSelect = select({
    id: "settings-language-select",
    label: "Language",
    className: "ui-select settings-language-select",
  });
  languageSelect.dataset.i18nAriaLabel = "settings.language.title";
  const idle = numberField({
    id: "settings-runtime-idle-timeout",
    value: String(DEFAULT_RUNTIME_IDLE_MINUTES),
    min: 0,
    max: MAX_RUNTIME_IDLE_MINUTES,
    step: 1,
    label: "Idle session timeout in minutes",
    labelKey: "settings.runtimeIdleTimeout",
    className: "settings-terminal-number",
    inputMode: "numeric",
  });
  const checkUpdates = /** @type {HTMLElement} */ (
    el("button", {
      type: "button",
      class: "ui-button ui-button--secondary ui-button--sm",
      id: "btn-check-updates",
      text: "Check now",
    })
  );
  checkUpdates.dataset.i18n = "updater.checkNow";
  const updateRow = /** @type {HTMLElement} */ (
    row({
      label: "Updates",
      labelKey: "settings.updates",
      control: el("span", { class: "settings-update-controls" }, [
        staticValue("setting-update-status", "", "", false),
        checkUpdates,
      ]),
    })
  );
  updateRow.classList.add("settings-update-row");
  root.replaceChildren(
    ...settingsPage("General", "settings.general", [
      section("Language", "settings.language.title", [
        row({
          id: "setting-language",
          label: "Language",
          labelKey: "settings.language.title",
          description:
            "Choose the interface language. System Default follows your operating system.",
          descriptionKey: "settings.language.description",
          control: languageSelect,
        }),
      ]),
      section("Projects", "settings.projectsFolder.section", [
        projectsFolderRow({ preferences: deps?.preferences, register }),
      ]),
      guardSettingsSection(deps, register),
      section("Agent", "settings.agent", [
        ...queueModeControls(deps),
        row({
          id: "setting-auto-compact",
          label: "Auto-compaction",
          labelKey: "settings.autoCompaction",
          control: switches.byId["toggle-auto-compact"],
        }),
        row({
          id: "setting-auto-retry",
          label: "Auto-retry",
          labelKey: "settings.autoRetry",
          control: switches.byId["toggle-auto-retry"],
        }),
        row({
          id: "setting-thinking",
          label: "Thinking effort",
          labelKey: "settings.thinkingEffort",
          description: "Reasoning depth",
          descriptionKey: "settings.reasoningDepth",
          control: thinkingControl(),
        }),
        row({
          label: "Show thinking",
          labelKey: "settings.showThinking",
          control: switches.byId["toggle-show-thinking"],
        }),
        row({
          label: "Task completion notifications",
          labelKey: "settings.taskNotifications",
          description: "Show an operating system notification when a task finishes.",
          descriptionKey: "settings.taskNotificationsDescription",
          control: switches.byId["toggle-task-notifications"],
        }),
        row({
          id: "setting-runtime-idle-timeout",
          label: "Idle session timeout",
          labelKey: "settings.runtimeIdleTimeout",
          description:
            "Stop a background session's agent after this many minutes with no activity. 0 keeps them until the app exits.",
          descriptionKey: "settings.runtimeIdleTimeoutDescription",
          control: idle,
        }),
      ]),
      section(
        "Updates",
        "settings.updates",
        [
          row({
            id: "setting-pi-version",
            label: "Pi version",
            labelKey: "settings.piVersion",
            control: staticValue(
              "setting-pi-version-value",
              "Loading...",
              "settings.config.loading",
              true,
            ),
          }),
          row({
            label: "SPOPI version",
            labelKey: "settings.spopiVersion",
            control: staticValue(
              "setting-app-version-value",
              "Loading...",
              "settings.config.loading",
              true,
            ),
          }),
          updateRow,
        ],
        "setting-updater-section",
      ),
    ]),
  );
  translateSubtree(root);
  const language = root.isConnected ? mountLanguageSelector() : null;
  const thinking = root.isConnected
    ? mountThinkingEffortControl({
        ...(deps ?? {}),
        onRuntimeLevelChanged: deps?.onThinkingLevelChanged,
      })
    : null;
  if (root.isConnected) mountRuntimeIdleTimeout({ preferences: deps?.preferences });
  return {
    refresh() {
      translateSubtree(root);
    },
    reload() {
      for (const load of loaders) run(load);
    },
    destroy() {
      language?.destroy?.();
      thinking?.destroy?.();
      root.replaceChildren();
    },
    thinkingControl: thinking,
    getToggleState: switches.getToggleState,
    setToggleState: switches.setToggleState,
  };
}

/**
 * Elements this page creates. Callers use the refs instead of looking up ids.
 * @param {ParentNode | null | undefined} root
 * @returns {GeneralSettingsRefs}
 */
export function generalSettingsRefs(root) {
  return {
    piVersion: /** @type {HTMLElement | null} */ (
      root?.querySelector("#setting-pi-version-value") ?? null
    ),
    appVersion: /** @type {HTMLElement | null} */ (
      root?.querySelector("#setting-app-version-value") ?? null
    ),
    thinkingEffort: /** @type {HTMLElement | null} */ (
      root?.querySelector("#thinking-effort") ?? null
    ),
    thinkingEffortName: /** @type {HTMLElement | null} */ (
      root?.querySelector("#thinking-effort-name") ?? null
    ),
    thinkingEffortMarker: /** @type {HTMLElement | null} */ (
      root?.querySelector("#thinking-effort-marker") ?? null
    ),
    updateStatus: /** @type {HTMLElement | null} */ (
      root?.querySelector("#setting-update-status") ?? null
    ),
    checkUpdates: /** @type {HTMLElement | null} */ (
      root?.querySelector("#btn-check-updates") ?? null
    ),
    languageSelect: /** @type {HTMLSelectElement | null} */ (
      root?.querySelector("#settings-language-select") ?? null
    ),
    idleTimeout: /** @type {HTMLInputElement | null} */ (
      root?.querySelector("#settings-runtime-idle-timeout") ?? null
    ),
  };
}

/**
 * @param {{
 *   onChange?: (() => void) | null,
 * }} [options]
 */
export function mountLanguageSelector({ onChange } = {}) {
  const languageSelect = generalSettingsRefs(document).languageSelect;
  if (!languageSelect) return null;
  const selectEl = languageSelect;
  const menu = enhanceSelect(selectEl);
  function render() {
    const current = getLanguagePreference();
    selectEl.replaceChildren();
    for (const language of LANGUAGES) {
      const option = document.createElement("option");
      option.value = language.value;
      option.textContent = language.nativeLabel ?? t(language.labelKey);
      option.selected = current === language.value;
      selectEl.append(option);
    }
  }
  async function handleChange() {
    selectEl.disabled = true;
    try {
      await setLocale(selectEl.value);
      render();
      onChange?.();
    } finally {
      selectEl.disabled = false;
    }
  }
  selectEl.addEventListener("change", handleChange);
  render();
  const unsubscribe = onLocaleChange(render);
  return {
    render,
    destroy() {
      unsubscribe();
      menu?.destroy();
    },
  };
}

/**
 * @param {{
 *   preferences?: PreferencesLike | null,
 * }} [options]
 */
export function mountRuntimeIdleTimeout({ preferences } = {}) {
  const input = generalSettingsRefs(document).idleTimeout;
  if (!input) return null;
  /**
   * @param {number} minutes
   */
  const show = (minutes) => {
    input.value = String(minutes);
  };
  show(DEFAULT_RUNTIME_IDLE_MINUTES);
  preferences
    ?.get(RUNTIME_IDLE_TIMEOUT_KEY)
    .then((/** @type {unknown} */ value) => {
      if (value != null && value !== "") show(normalizeIdleMinutes(value));
    })
    .catch(() => {});
  input.addEventListener("change", () => {
    const minutes = normalizeIdleMinutes(input.value);
    show(minutes);
    preferences?.set(RUNTIME_IDLE_TIMEOUT_KEY, minutes).catch(() => {});
  });
  return { show };
}

/**
 * @param {string} level
 * @returns {string}
 */
function formatThinkingLevelLabel(level) {
  const key = `settings.thinkingLevels.${level}`;
  const label = t(key);
  return label === key ? level : label;
}

/**
 * @param {unknown} response
 * @returns {unknown}
 */
function runtimeResponseData(response) {
  if (!response || typeof response !== "object") return response;
  const record = /** @type {Record<string, unknown>} */ (response);
  const nested = record.response;
  const nestedData =
    nested && typeof nested === "object"
      ? /** @type {Record<string, unknown>} */ (nested).data
      : undefined;
  return nestedData ?? record.data ?? response;
}

/**
 * @param {{
 *   runtime?: RuntimeLike | null,
 *   getTarget?: (() => unknown) | null,
 *   configGateway?: ConfigGatewayLike | null,
 *   onError?: ((error: unknown) => void) | null,
 *   onRuntimeLevelChanged?: ((level: string, target: unknown) => void) | null,
 * }} [options]
 */
export function mountThinkingEffortControl({
  runtime,
  getTarget,
  configGateway,
  onError,
  onRuntimeLevelChanged,
} = {}) {
  const general = generalSettingsRefs(document);
  const radioGroup = general.thinkingEffort;
  const levelName = general.thinkingEffortName;
  const thumb = general.thinkingEffortMarker;
  if (!radioGroup) return;
  /** @type {HTMLInputElement[]} */
  const buttons = Array.from(radioGroup.querySelectorAll(".thinking-effort-dot")).flatMap(
    (node) => {
      if (!("checked" in node) || !("dataset" in node) || !("focus" in node)) return [];
      return [/** @type {HTMLInputElement} */ (node)];
    },
  );
  const levels = /** @type {string[]} */ (buttons.map((btn) => btn.dataset.level).filter(Boolean));
  let hasUserChangedLevel = false;

  /**
   * @param {string} level
   */
  function updateUI(level) {
    const index = levels.indexOf(level);
    if (index === -1) return;
    for (let i = 0; i < buttons.length; i++) {
      const isActive = i === index;
      buttons[i].checked = isActive;
      buttons[i].classList.toggle("active", isActive);
    }
    if (levelName) {
      levelName.dataset.thinkingLevel = level;
      levelName.textContent = formatThinkingLevelLabel(level);
    }
    if (thumb && buttons[index]) {
      const button = buttons[index];
      thumb.style.left = `${button.offsetLeft + (button.offsetWidth - thumb.offsetWidth) / 2}px`;
    }
  }

  /**
   * @param {string} level
   */
  async function setThinkingLevel(level) {
    hasUserChangedLevel = true;
    try {
      if (configGateway) {
        const response = await configGateway.call("set_default_thinking_level", {
          level,
          scope: "global",
        });
        if (!response?.ok) throw new Error(response?.error || "Failed to save thinking level");
      }
      updateUI(level);
    } catch (error) {
      onError?.(error);
      return;
    }
    const target = getTarget?.();
    if (!(runtime && target)) return;
    try {
      const availableResponse = await runtime.request(
        { type: "get_available_thinking_levels" },
        target,
      );
      const availableLevelsRaw = runtimeResponseData(availableResponse);
      const availableLevels =
        availableLevelsRaw && typeof availableLevelsRaw === "object"
          ? /** @type {Record<string, unknown>} */ (availableLevelsRaw).levels
          : undefined;
      if (Array.isArray(availableLevels) && availableLevels.includes(level)) {
        await runtime.request({ type: "set_thinking_level", level }, target, {
          idempotencyKey: randomId(),
        });
        onRuntimeLevelChanged?.(level, target);
      }
    } catch (error) {
      console.warn(
        "[spopi] Saved default thinking level but could not apply it to session:",
        error,
      );
    }
  }

  async function loadDefaultThinkingLevel() {
    if (!configGateway) return;
    try {
      const response = await configGateway.call("get_default_thinking_level", { scope: "global" });
      const level = response?.data?.level;
      if (!hasUserChangedLevel && response?.ok && level) updateUI(String(level));
    } catch (error) {
      onError?.(error);
    }
  }

  for (const button of buttons) {
    button.addEventListener("click", () => {
      const level = button.dataset.level;
      if (level) setThinkingLevel(level).catch((/** @type {unknown} */ error) => onError?.(error));
    });
  }
  radioGroup.addEventListener("keydown", (/** @type {KeyboardEvent} */ event) => {
    const currentIndex = buttons.findIndex((btn) => btn.checked);
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      nextIndex = (currentIndex + 1) % buttons.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
    } else return;
    const nextLevel = levels[nextIndex];
    if (nextLevel) {
      buttons[nextIndex].focus();
      setThinkingLevel(nextLevel).catch((/** @type {unknown} */ error) => onError?.(error));
    }
  });
  const unsubscribeLocale = onLocaleChange(() => {
    const currentLevel =
      levelName?.dataset.thinkingLevel || levels.find((_, i) => buttons[i]?.checked);
    if (currentLevel) updateUI(currentLevel);
  });
  void loadDefaultThinkingLevel();
  return { updateUI, destroy: unsubscribeLocale };
}
