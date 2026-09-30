// ABOUTME: Turns a package install error into a short status the page can show.
// ABOUTME: It does not retry the install.

import { t } from "../i18n/i18n.js";

/**
 * @param {unknown} err
 * @returns {string}
 */
function packageErrorText(err) {
  if (err && typeof err === "object" && "message" in err && err.message != null) {
    return String(err.message);
  }
  return String(err || "unknown error");
}

/**
 * @param {unknown} err
 * @returns {string}
 */
export function summarizePackageError(err) {
  const raw = packageErrorText(err);
  if (raw.includes("EACCES") || raw.includes("permission denied")) {
    return t("extensions.permissionDenied");
  }
  return raw;
}

/**
 * @param {unknown} err
 * @param {string} [operation]
 * @returns {{ title: string, note: string, detail: string }}
 */
export function getPackageInstallFailure(err, operation = "install") {
  const fullMessage = packageErrorText(err);
  const isUninstall = operation === "uninstall";
  return {
    title: isUninstall ? t("extensions.uninstallFailed") : t("extensions.installFailed"),
    note: isUninstall ? t("extensions.uninstallFailedNote") : t("extensions.installFailedNote"),
    detail: summarizePackageError(fullMessage),
  };
}

/**
 * @param {HTMLElement | null | undefined} status
 * @param {unknown} err
 * @param {string} [operation]
 */
export function renderPackageInstallFailure(status, err, operation = "install") {
  if (!status) return;
  const failure = getPackageInstallFailure(err, operation);
  status.hidden = false;
  status.classList.add("is-error");
  status.title = "";
  status.replaceChildren();

  const title = document.createElement("div");
  title.className = "settings-extension-status-title";
  title.textContent = failure.title;
  status.appendChild(title);

  const npmNote = document.createElement("div");
  npmNote.className = "settings-extension-status-note";
  npmNote.textContent = failure.note;
  status.appendChild(npmNote);

  const detail = document.createElement("div");
  detail.className = "settings-extension-status-detail";
  detail.textContent = failure.detail;
  status.appendChild(detail);
}
