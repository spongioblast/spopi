// ABOUTME: The idle session timeout in Settings → General: its preference key, range, and number field.
// ABOUTME: Only reads and writes the preference; the host stops idle background agents on its own.

import { numberField } from "../ui/settings-controls.js";

export const RUNTIME_IDLE_TIMEOUT_KEY = "ui.runtimeIdleTimeoutMinutes";
export const DEFAULT_RUNTIME_IDLE_MINUTES = 30;
const MAX_RUNTIME_IDLE_MINUTES = 1440;

/**
 * @typedef {import("./general-settings.js").PreferencesLike} PreferencesLike
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

export function idleTimeoutField() {
  return numberField({
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
}

/**
 * @param {{
 *   preferences?: PreferencesLike | null,
 * }} [options]
 */
export function mountRuntimeIdleTimeout({ preferences } = {}) {
  const input = /** @type {HTMLInputElement | null} */ (
    document.querySelector("#settings-runtime-idle-timeout")
  );
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
