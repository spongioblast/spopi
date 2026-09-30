// ABOUTME: Asks for confirmation before a destructive git action.
// ABOUTME: Cancelling leaves the repository unchanged.

import { t } from "../i18n/i18n.js";
import { openDialog } from "../ui/dialog.js";

/**
 * @param {{
 *   message?: string,
 *   confirmLabel?: string,
 *   cancelLabel?: string,
 * }} [options]
 * @returns {Promise<boolean>}
 */
export function confirmGitAction({
  message,
  confirmLabel = t("git.discard"),
  cancelLabel = t("git.cancel"),
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    /** @param {boolean} result */
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const body = document.createElement("p");
    body.className = "git-confirm-message";
    body.textContent = message || "";
    const handle = openDialog({
      body,
      actions: [
        {
          label: cancelLabel,
          onClick: () => {
            finish(false);
            handle.close();
          },
        },
        {
          label: confirmLabel,
          className: "git-confirm-discard",
          onClick: () => {
            finish(true);
            handle.close();
          },
        },
      ],
      onClose: () => finish(false),
    });
    const discardBtn = handle.element.querySelector(".git-confirm-discard");
    if (discardBtn && "focus" in discardBtn && typeof discardBtn.focus === "function") {
      discardBtn.focus();
    }
  });
}
