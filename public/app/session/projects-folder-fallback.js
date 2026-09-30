// ABOUTME: Tells the user once when startup could not use their Projects folder.
// ABOUTME: The host leaves ui.projectsFolderFallback; this shows it and clears it.

import { t } from "../i18n/i18n.js";
import { uiStore } from "../storage/ui-store.js";

const FALLBACK_KEY = "ui.projectsFolderFallback";

/**
 * @param {{ notify: (notice: { type: string, title: string, message: string, action?: { label: string, onClick: () => void } }) => unknown }} notifications
 * @param {() => void} [openGeneralSettings]
 * @returns {boolean} whether a note was shown
 */
export function showProjectsFolderFallback(notifications, openGeneralSettings) {
  const raw = uiStore.getItem(FALLBACK_KEY);
  if (!raw) return false;
  uiStore.removeItem(FALLBACK_KEY);
  /** @type {{ wanted?: unknown, used?: unknown, error?: unknown }} */
  let record = {};
  try {
    record = JSON.parse(raw);
  } catch {
    return false;
  }
  const wanted = typeof record.wanted === "string" ? record.wanted : "";
  const used = typeof record.used === "string" ? record.used : "";
  if (!wanted) return false;
  notifications.notify({
    type: "warning",
    title: t("projects.fallbackTitle"),
    message: used
      ? t("projects.fallbackUsed", { wanted, used })
      : t("projects.fallbackHome", { wanted }),
    ...(openGeneralSettings
      ? { action: { label: t("projects.fallbackOpenSettings"), onClick: openGeneralSettings } }
      : {}),
  });
  return true;
}
