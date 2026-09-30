// ABOUTME: One Dependencies row: a state badge, a detail, and its actions.
// ABOUTME: State names map to locale keys through a fixed object, never a built string.

import { t } from "../../i18n/i18n.js";
import { el } from "../../ui/dom.js";
import { row } from "../../ui/settings-controls.js";

/** @type {Record<string, string>} */
const STATE_KEYS = {
  ok: "settings.dependencies.state.ok",
  missing: "settings.dependencies.state.missing",
  error: "settings.dependencies.state.error",
  unknown: "settings.dependencies.state.unknown",
  off: "settings.dependencies.state.off",
  not_installed: "settings.dependencies.state.notInstalled",
  not_connected: "settings.dependencies.state.notConnected",
};

/** @type {Record<string, string>} */
const TONE = {
  ok: "ok",
  missing: "warn",
  error: "error",
  unknown: "warn",
  off: "warn",
  not_installed: "warn",
  not_connected: "error",
};

/**
 * @param {string} labelKey
 * @param {{ primary?: boolean, disabled?: boolean, onClick?: () => void }} [options]
 */
export function actionButton(labelKey, { primary = false, disabled = false, onClick } = {}) {
  const button = /** @type {HTMLButtonElement} */ (
    el("button", {
      type: "button",
      class: primary
        ? "ui-button ui-button--primary ui-button--sm"
        : "ui-button ui-button--secondary ui-button--sm",
      text: t(labelKey),
      onClick,
    })
  );
  button.dataset.i18n = labelKey;
  button.disabled = disabled;
  return button;
}

/**
 * @param {{
 *   labelKey: string,
 *   descriptionKey?: string,
 *   status?: { state?: string, version?: string, detail?: string, path?: string },
 *   actions?: Node[],
 * }} options
 */
export function dependencyRow({ labelKey, descriptionKey, status = {}, actions = [] }) {
  const state = status.state || "unknown";
  const key = STATE_KEYS[state] || STATE_KEYS.unknown;
  const badge = /** @type {HTMLElement} */ (
    el("span", { class: "settings-static-value", text: t(key) })
  );
  badge.dataset.i18n = key;
  badge.dataset.tone = TONE[state] || "warn";
  const detailText = status.version || status.detail || "";
  const detail = detailText ? el("span", { class: "dependencies-detail", text: detailText }) : null;
  const control = el("span", { class: "dependencies-actions" }, [badge, detail, ...actions]);
  return row({
    label: t(labelKey),
    labelKey,
    description: descriptionKey ? t(descriptionKey) : "",
    descriptionKey,
    control,
  });
}
