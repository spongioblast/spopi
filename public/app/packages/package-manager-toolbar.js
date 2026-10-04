// ABOUTME: The Installed packages toolbar: totals, update-check notice, Refresh, Update all, Reload agent.
// ABOUTME: Also shows the last action's message under it; the page passes state and callbacks in.

import { t } from "../i18n/i18n.js";
import { countsText, iconButton, message, RESOURCE_GROUPS } from "./package-manager-parts.js";

/**
 * @typedef {import("./packages-installed.js").ManagedPackage} ManagedPackage
 * @typedef {import("./packages-installed.js").ResourceCounts} ResourceCounts
 *
 * @typedef {{
 *   packages: ManagedPackage[],
 *   checkingUpdates: boolean,
 *   checkNotice: string | null,
 *   updatingAll: boolean,
 *   restarting: boolean,
 *   busyScope: string | null,
 *   canManage: boolean,
 *   updatable: number,
 *   onRefresh: () => void,
 *   onUpdateAll: () => void,
 *   onRestart: () => void,
 * }} PackageToolbarState
 */

/**
 * @param {string} text
 * @param {boolean} [isError]
 * @returns {HTMLSpanElement}
 */
function noticeNote(text, isError = false) {
  const el = document.createElement("span");
  el.className = `pkg-manager-notice${isError ? " pkg-manager-notice-error" : ""}`;
  el.setAttribute("role", "status");
  el.textContent = text;
  return el;
}

/**
 * @param {Element} toolbarEl
 * @param {PackageToolbarState} state
 */
export function renderPackageToolbar(toolbarEl, state) {
  const { packages, checkingUpdates, checkNotice, updatingAll, restarting, busyScope, canManage } =
    state;
  toolbarEl.innerHTML = "";
  const summary = document.createElement("span");
  summary.className = "pkg-manager-toolbar-summary";
  if (packages.length) {
    /** @type {ResourceCounts} */
    const totals = { extensions: 0, skills: 0, prompts: 0, themes: 0 };
    for (const pkg of packages) {
      for (const [key] of RESOURCE_GROUPS) totals[key] += pkg.counts?.[key] ?? 0;
    }
    const count = packages.length;
    summary.textContent = [
      t(count === 1 ? "extensions.packagesOne" : "extensions.packagesOther", { count }),
      countsText(totals),
    ]
      .filter(Boolean)
      .join(" · ");
  } else {
    summary.textContent = t("extensions.noPackagesSummary");
  }
  // The update-check state rides on the summary line so nothing below moves when it
  // appears or clears. Its own class keeps showPackageMessage from removing it.
  if (checkingUpdates) {
    summary.appendChild(noticeNote(t("extensions.checkingUpdates")));
  } else if (checkNotice) {
    summary.appendChild(noticeNote(checkNotice, !updatingAll));
  }
  toolbarEl.appendChild(summary);

  const actions = document.createElement("span");
  actions.className = "pkg-manager-toolbar-actions";
  const refreshBtn = iconButton(t("extensions.refresh"), {
    disabled: updatingAll || restarting,
    title: t("extensions.refreshTip"),
  });
  refreshBtn.addEventListener("click", state.onRefresh);
  actions.appendChild(refreshBtn);
  if (packages.length) {
    const updatable = state.updatable;
    const updateAllLabel = updatable
      ? t("extensions.updateAll", { count: updatable })
      : t("extensions.updateAllNone");
    const updateAllBtn = iconButton(updateAllLabel, {
      disabled: updatingAll || restarting || busyScope !== null || !canManage || updatable === 0,
      title: t("extensions.updateTip"),
    });
    updateAllBtn.id = "pkg-manager-update-all-btn";
    updateAllBtn.addEventListener("click", state.onUpdateAll);
    actions.appendChild(updateAllBtn);
    const reloadBtn = iconButton(t("extensions.reloadAgent"), {
      disabled: busyScope !== null || restarting || !canManage,
      title: t("extensions.reloadAgentTip"),
    });
    reloadBtn.id = "pkg-manager-reload-btn";
    reloadBtn.addEventListener("click", state.onRestart);
    actions.appendChild(reloadBtn);
  }
  toolbarEl.appendChild(actions);
}

/**
 * Replaces the message under the toolbar; a message outranks an error.
 * @param {Element} toolbarEl
 * @param {string | null} lastMessage
 * @param {string | null} lastError
 */
export function showPackageMessage(toolbarEl, lastMessage, lastError) {
  const existing = toolbarEl.querySelector(".pkg-manager-message");
  if (existing) existing.remove();
  if (lastMessage) {
    toolbarEl.appendChild(message(lastMessage));
  } else if (lastError) {
    toolbarEl.appendChild(message(lastError, { isError: true }));
  }
}
