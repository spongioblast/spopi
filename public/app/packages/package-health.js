// ABOUTME: Holds Pi's latest package load health and spells out a failed load on the Installed page.
// ABOUTME: The workbench passes the rows in; a healthy package shows nothing extra.

import { t } from "../i18n/i18n.js";

/**
 * @typedef {import("./packages-installed.js").ManagedPackage} ManagedPackage
 */

/** @type {Array<{ name?: string, state?: string, error?: string }>} */
let healthRows = [];

/**
 * @param {unknown} rows
 */
export function notePackageHealth(rows) {
  healthRows = Array.isArray(rows) ? rows.filter((row) => row && typeof row === "object") : [];
}

/**
 * @param {{ packageName?: string | null, source?: string }} pkg
 */
function healthFor(pkg) {
  const names = [pkg.packageName, pkg.source, String(pkg.source || "").replace(/^npm:/, "")].filter(
    (name) => typeof name === "string" && name,
  );
  return healthRows.find((row) => row.name && names.includes(row.name));
}

/**
 * Healthy is the normal case and needs no words; only a failed load is spelled out.
 * @param {ParentNode} parent
 * @param {{ packageName?: string | null, source?: string }} pkg
 */
export function appendHealthFailure(parent, pkg) {
  const health = healthFor(pkg);
  if (health?.state !== "failed") return;
  const line = document.createElement("div");
  line.className = "pkg-health-line";
  line.dataset.health = health.state;
  line.setAttribute("role", "alert");
  line.textContent = t("extensions.healthFailed");
  if (health.error) {
    const detail = document.createElement("span");
    detail.className = "pkg-health-error";
    detail.textContent = ` ${health.error}`;
    line.append(detail);
  }
  parent.append(line);
}

/**
 * The list dot shows one state: a failed load outranks loaded.
 * @param {ManagedPackage} pkg
 * @returns {string}
 */
export function displayStatus(pkg) {
  if (pkg.status === "loaded" && healthFor(pkg)?.state === "failed") return "failed";
  return pkg.status;
}
