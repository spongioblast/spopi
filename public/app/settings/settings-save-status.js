// ABOUTME: Shows a timed success or error next to a settings save button.
// ABOUTME: The timer is cleared when the message element is reused.

import { t } from "../i18n/i18n.js";

/**
 * @typedef {{
 *   textContent: string,
 *   classList: { add: (token: string) => void, remove: (token: string) => void },
 *   dataset: DOMStringMap,
 * }} SettingsSaveMessageEl
 *
 * @typedef {{
 *   disabled: boolean,
 *   textContent: string,
 * }} SettingsSaveButtonEl
 */

/** @type {WeakMap<SettingsSaveMessageEl, ReturnType<typeof setTimeout>>} */
const messageTimers = new WeakMap();

/**
 * @param {SettingsSaveMessageEl | null | undefined} messageEl
 */
export function clearSettingsSaveMessage(messageEl) {
  if (!messageEl) return;
  const timer = messageTimers.get(messageEl);
  if (timer) {
    clearTimeout(timer);
    messageTimers.delete(messageEl);
  }
  messageEl.textContent = "";
  messageEl.classList.add("hidden");
  delete messageEl.dataset.tone;
}

/**
 * @param {SettingsSaveMessageEl | null | undefined} messageEl
 * @param {string} message
 */
export function showSettingsSaveError(messageEl, message) {
  if (!messageEl) return;
  clearSettingsSaveMessage(messageEl);
  messageEl.textContent = message;
  messageEl.dataset.tone = "error";
  messageEl.classList.remove("hidden");
}

/**
 * @param {SettingsSaveMessageEl | null | undefined} messageEl
 * @param {string} [message]
 */
export function showSettingsSaveSuccess(messageEl, message = t("status.saved")) {
  if (!messageEl) return;
  clearSettingsSaveMessage(messageEl);
  messageEl.textContent = message;
  messageEl.dataset.tone = "ok";
  messageEl.classList.remove("hidden");
  const timer = setTimeout(() => clearSettingsSaveMessage(messageEl), 2000);
  messageTimers.set(messageEl, timer);
}

/**
 * @param {SettingsSaveButtonEl | null | undefined} button
 * @param {boolean} isSaving
 */
export function setSettingsSaveButtonSaving(button, isSaving) {
  if (!button) return;
  button.disabled = isSaving;
  button.textContent = isSaving ? t("status.saving") : t("actions.save");
}
