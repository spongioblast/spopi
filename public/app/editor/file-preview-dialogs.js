// ABOUTME: Shows the file preview's modal choices: unsaved changes and a file changed on disk.
// ABOUTME: Resolves with the chosen action; acting on it is the save module's job.

import { t } from "../i18n/i18n.js";
import { trapModal } from "../ui/dialog.js";

/**
 * @typedef {import("./file-preview-panel.js").FilePreviewTab} FilePreviewTab
 * @typedef {{ activeDialogCancel: (() => void) | null }} DialogHost
 */

/**
 * @param {DialogHost} host
 * @param {FilePreviewTab[]} tabs
 */
export function showDirtyDialog(host, tabs) {
  const message =
    tabs.length === 1
      ? t("files.unsaved.description")
      : t("files.unsaved.descriptionMultiple", { count: tabs.length });
  return showChoiceDialog(host, {
    title: t("files.unsaved.title"),
    message,
    choices: [
      { action: "save", label: t("files.unsaved.save"), primary: true },
      { action: "discard", label: t("files.unsaved.discard") },
      { action: "cancel", label: t("files.unsaved.cancel") },
    ],
    cancelAction: "cancel",
  });
}

/**
 * @param {DialogHost} host
 * @param {FilePreviewTab} tab
 */
export function showConflictDialog(host, tab) {
  return showChoiceDialog(host, {
    title: t("files.preview.conflict"),
    message: t("files.preview.conflictMessage", { name: tab.fileName }),
    choices: [
      { action: "reload", label: t("files.preview.conflictReload") },
      {
        action: "overwrite",
        label: t("files.preview.conflictOverwrite"),
        primary: true,
      },
      { action: "cancel", label: t("files.unsaved.cancel") },
    ],
    cancelAction: "cancel",
  });
}

/**
 * Only one dialog is open at a time: opening another cancels the current one.
 * @param {DialogHost} host
 * @param {{
 *   title: string,
 *   message: string,
 *   choices: Array<{ action: string, label: string, primary?: boolean }>,
 *   cancelAction: string,
 * }} options
 * @returns {Promise<string>}
 */
function showChoiceDialog(host, { title, message, choices, cancelAction }) {
  host.activeDialogCancel?.();
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "file-preview-dialog-overlay";
    const dialog = document.createElement("div");
    dialog.className = "file-preview-dialog";
    dialog.setAttribute("role", "alertdialog");

    const heading = document.createElement("h3");
    heading.textContent = title;
    const body = document.createElement("p");
    body.textContent = message;
    const actions = document.createElement("div");
    actions.className = "file-preview-dialog-actions";
    dialog.append(heading, body, actions);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    let settled = false;
    let unbindModal = () => {};
    /** @param {string} action */
    const finish = (action) => {
      if (settled) return;
      settled = true;
      unbindModal();
      overlay.remove();
      host.activeDialogCancel = null;
      resolve(action);
    };
    unbindModal = trapModal(dialog, { onClose: () => finish(cancelAction) });

    for (const choice of choices) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `file-preview-dialog-button${choice.primary ? " primary" : ""}`;
      button.textContent = choice.label;
      button.addEventListener("click", () => finish(choice.action));
      actions.appendChild(button);
    }

    host.activeDialogCancel = () => finish(cancelAction);
    const primary = actions.querySelector(".primary");
    if (primary && "focus" in primary && typeof primary.focus === "function") {
      primary.focus();
    }
  });
}
