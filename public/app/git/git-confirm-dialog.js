// ABOUTME: Asks for confirmation before a destructive git action.
// ABOUTME: Cancelling leaves the repository unchanged.

import { t } from "../i18n/i18n.js";
import { confirmDialog } from "../ui/dialog.js";

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
  return confirmDialog({
    message,
    confirmLabel,
    cancelLabel,
    danger: true,
  });
}
