// ABOUTME: The on/off switches of Settings → General: agent toggles, show thinking, task notifications.
// ABOUTME: A switch persists to the UI store, or to Pi config when its spec says persist: "config".

import { t } from "../i18n/i18n.js";
import { uiStore } from "../storage/ui-store.js";
import { toggle } from "../ui/settings-controls.js";
import { agentToggleSpecs } from "./agent-toggles.js";

const STORAGE_PREFIX = "ui.settings.";

/**
 * @typedef {import("./general-settings.js").ConfigGatewayLike} ConfigGatewayLike
 * @typedef {import("./general-settings.js").GeneralSettingsDeps} GeneralSettingsDeps
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
 */

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
export function createGeneralToggles(deps) {
  /** @type {SettingToggleConfig[]} */
  const specs = [
    ...agentToggleSpecs(deps),
    {
      id: "toggle-show-thinking",
      key: "show-thinking",
      label: t("settings.showThinking"),
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
