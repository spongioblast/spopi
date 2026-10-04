// ABOUTME: Small pieces shared by the Installed packages list, detail pane, and toolbar.
// ABOUTME: Resource count text, the package key, buttons, and notes; no state lives here.

import { t } from "../i18n/i18n.js";

/**
 * @typedef {import("./packages-installed.js").ResourceCounts} ResourceCounts
 */

/** @type {ReadonlyArray<[keyof ResourceCounts, string, string]>} */
export const RESOURCE_GROUPS = [
  ["extensions", "extensions.counts.extensionsOne", "extensions.counts.extensionsOther"],
  ["skills", "extensions.counts.skillsOne", "extensions.counts.skillsOther"],
  ["prompts", "extensions.counts.promptsOne", "extensions.counts.promptsOther"],
  ["themes", "extensions.counts.themesOne", "extensions.counts.themesOther"],
];

/**
 * "1 extension · 2 skills"; zero counts are left out.
 * @param {Partial<ResourceCounts> | null | undefined} counts
 * @returns {string}
 */
export function countsText(counts) {
  return RESOURCE_GROUPS.map(([key, one, other]) => {
    const count = counts?.[key] ?? 0;
    return count > 0 ? t(count === 1 ? one : other, { count }) : "";
  })
    .filter(Boolean)
    .join(" · ");
}

/**
 * @param {{ scope: string, source: string }} pkg
 * @returns {string}
 */
export function keyOf(pkg) {
  return `${pkg.scope}\0${pkg.source}`;
}

/**
 * @param {string} label
 * @param {object} [options]
 * @param {boolean} [options.danger=false]
 * @param {boolean} [options.disabled=false]
 * @param {string} [options.title=""]
 * @returns {HTMLButtonElement}
 */
export function iconButton(label, { danger = false, disabled = false, title = "" } = {}) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "settings-value-btn pkg-manager-btn";
  if (danger) btn.classList.add("is-danger");
  btn.disabled = disabled;
  btn.textContent = label;
  if (title) btn.title = title;
  return btn;
}

/**
 * @param {string} text
 * @param {object} [options]
 * @param {boolean} [options.isError=false]
 * @returns {HTMLDivElement}
 */
export function message(text, { isError = false } = {}) {
  const el = document.createElement("div");
  el.className = `pkg-manager-message${isError ? " is-error" : ""}`;
  el.textContent = text;
  return el;
}

/**
 * @param {string} text
 * @returns {HTMLDivElement}
 */
export function emptyNote(text) {
  const el = document.createElement("div");
  el.className = "settings-api-keys-empty";
  el.textContent = text;
  return el;
}
