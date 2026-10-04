// ABOUTME: Loading, empty, error, and unavailable states for settings pages.
// ABOUTME: Pages pass the copy and an optional retry; the look comes from .ui-empty.

import { t } from "../i18n/i18n.js";
import { createLoadingPlaceholder } from "./loading-placeholder.js";

/**
 * @typedef {"loading" | "empty" | "error" | "unavailable"} SettingsStateKind
 * @typedef {{
 *   kind: SettingsStateKind,
 *   text?: string,
 *   hint?: string,
 *   className?: string,
 *   onRetry?: () => void,
 * }} SettingsStateOptions
 */

/**
 * @param {SettingsStateOptions} options
 * @returns {HTMLElement}
 */
export function settingsState({ kind, text = "", hint = "", className = "", onRetry }) {
  if (kind === "loading") {
    return createLoadingPlaceholder({
      label: text || t("settings.config.loading"),
      className: `ui-empty ${className}`.trim(),
    });
  }
  const node = document.createElement("div");
  node.className = `ui-empty ui-empty--${kind} ${className}`.trim();
  if (kind === "error") node.setAttribute("role", "alert");
  const title = document.createElement("p");
  title.className = "ui-empty-title";
  title.textContent = text;
  node.append(title);
  if (hint) {
    const detail = document.createElement("p");
    detail.className = "ui-empty-hint";
    detail.textContent = hint;
    node.append(detail);
  }
  if (onRetry) {
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "ui-button ui-button--secondary ui-button--sm ui-empty-retry";
    retry.textContent = t("actions.retry");
    retry.addEventListener("click", onRetry);
    node.append(retry);
  }
  return node;
}
