// ABOUTME: Settings-hosted Recommended-for-SPOPI cards. Never relocates the package manager.
// ABOUTME: Remounts only #extensions-recommended-host so Installed Packages stays intact.

import { extensionsSettingsRefs } from "../settings/extensions-settings.js";
import { FIRST_RUN_KEY, missingRecommended, RECOMMENDED_PACKAGES } from "./packages-recommended.js";

/**
 * @typedef {import("./packages-recommended.js").PackageRef} PackageRef
 * @typedef {import("./packages-recommended.js").RecommendedPackage} RecommendedPackage
 *
 * @typedef {(key: string, params?: Record<string, unknown>) => string} TranslateFn
 */

/**
 * @typedef {{ name?: string, state?: string, error?: string }} PackageHealth
 */

/**
 * @param {TranslateFn} translate
 * @param {{ done: number, total: number } | null} progress
 */
function batchLabel(translate, progress) {
  if (!progress || progress.total <= 1) return translate("recommended.installing");
  const done = Math.min(progress.total, progress.done + 1);
  return translate("recommended.installingProgress", { done, total: progress.total });
}

/**
 * @param {HTMLButtonElement} button
 * @param {{
 *   label: string,
 *   busy: boolean,
 *   busyLabel: string,
 *   determinate?: boolean,
 *   done?: number,
 *   total?: number,
 * }} state
 */
function paintInstallButton(button, state) {
  button.replaceChildren();
  if (!state.busy) {
    button.textContent = state.label;
    return;
  }
  button.disabled = true;
  const track = document.createElement("span");
  track.className = "pkg-install-track";
  track.setAttribute("role", "progressbar");
  track.setAttribute("aria-label", state.busyLabel);
  const total = state.total || 0;
  if (state.determinate && total > 0) {
    track.dataset.determinate = "1";
    track.setAttribute("aria-valuemin", "0");
    track.setAttribute("aria-valuemax", String(total));
    track.setAttribute("aria-valuenow", String(state.done || 0));
    const percent = Math.round(((state.done || 0) / total) * 100);
    track.style.setProperty("--pkg-install-pct", String(percent));
  }
  const bar = document.createElement("span");
  bar.className = "pkg-install-bar";
  track.append(bar);
  const text = document.createElement("span");
  text.className = "pkg-install-label";
  text.textContent = state.busyLabel;
  button.append(track, text);
}

/**
 * @param {Element | null | undefined} root
 * @param {object} [options]
 * @param {PackageRef[]} [options.packages]
 * @param {boolean} [options.firstRunDismissed]
 * @param {((source: string) => void | Promise<void>) | null | undefined} [options.onInstall]
 * @param {((sources: string[]) => void | Promise<void>) | null | undefined} [options.onInstallAll]
 * @param {string[]} [options.installing]
 * @param {Record<string, string>} [options.installErrors]
 * @param {{ done: number, total: number } | null} [options.progress]
 * @param {((key: string) => void) | null | undefined} [options.onDismissFirstRun]
 * @param {TranslateFn} [options.t]
 * @param {PackageHealth[]} [options.health]
 * @returns {{ missing: RecommendedPackage[], missingCount: number } | null}
 */
export function mountExtensionsPanel(
  root,
  {
    packages = [],
    firstRunDismissed = false,
    onInstall,
    onInstallAll,
    installing = [],
    installErrors = {},
    progress = null,
    onDismissFirstRun,
    t = (key) => key,
    health = [],
  } = {},
) {
  if (!root || !("dataset" in root) || !("replaceChildren" in root)) return null;
  const host = /** @type {HTMLElement} */ (/** @type {unknown} */ (root));
  const notice = host.querySelector("[data-npm-notice]");
  host.replaceChildren();
  if (notice) host.prepend(notice);
  const missing = missingRecommended(packages);
  host.dataset.missingCount = String(missing.length);
  host.dataset.firstRun = !firstRunDismissed && missing.length ? "1" : "";
  const badge = extensionsSettingsRefs(document).missingBadge;
  if (badge && "hidden" in badge && "title" in badge) {
    badge.hidden = missing.length === 0;
    badge.textContent = missing.length ? String(missing.length) : "";
    badge.title = t("recommended.missingCount", { n: missing.length });
  }

  const rec = document.createElement("section");
  rec.className = "extensions-recommended settings-section";
  const help = document.createElement("p");
  help.className = "settings-help";
  help.textContent =
    t("recommended.help") ||
    "These packages unlock dock and sidebar features. Install stays here — never /install in chat.";
  rec.append(help);

  if (!firstRunDismissed && missing.length) {
    const card = document.createElement("section");
    card.className = "extensions-first-run ui-card";
    const copy = document.createElement("p");
    copy.textContent = t("recommended.firstRun") || "SPOPI features need these packages.";
    const install = document.createElement("button");
    install.type = "button";
    install.className = "ui-button ui-button--primary ui-button--sm";
    const batchActive = Boolean(progress && installing.length);
    const shownDone = progress
      ? Math.min(progress.total, progress.done + (installing.length ? 1 : 0))
      : 0;
    paintInstallButton(install, {
      label: t("recommended.installMissingCount", { n: missing.length }),
      busy: batchActive,
      busyLabel: batchLabel(t, progress),
      determinate: batchActive && (progress?.total || 0) > 1,
      done: shownDone,
      total: progress?.total || 0,
    });
    install.addEventListener("click", () => {
      const sources = missing.map((item) => item.source);
      if (onInstallAll) {
        void onInstallAll(sources);
        return;
      }
      for (const source of sources) void onInstall?.(source);
    });
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "ui-button ui-button--sm";
    dismiss.textContent = t("recommended.dismiss") || "Dismiss";
    dismiss.addEventListener("click", () => onDismissFirstRun?.(FIRST_RUN_KEY));
    const actions = document.createElement("div");
    actions.className = "settings-intro-actions";
    actions.append(install, dismiss);
    card.append(copy, actions);
    rec.appendChild(card);
  }

  const grid = document.createElement("div");
  grid.className = "extensions-recommended-grid";
  for (const item of RECOMMENDED_PACKAGES) {
    const card = document.createElement("article");
    card.className = "extensions-recommended-card";
    card.dataset.package = item.name;
    const installed = !missing.some((miss) => miss.name === item.name);
    if (installed) card.classList.add("is-installed");
    const name = document.createElement("strong");
    name.textContent = item.name;
    const why = document.createElement("span");
    why.className = "extensions-recommended-why";
    why.textContent = t(item.why);
    const enables = document.createElement("span");
    enables.className = "extensions-recommended-enables";
    enables.textContent = `${t("recommended.enables") || "enables"} · ${item.enables}`;
    const status = health.find((row) => row.name === item.name);
    card.dataset.health = status?.state || "";
    card.title = status?.error || status?.state || "";
    if (status?.state === "failed") {
      const hint = document.createElement("span");
      hint.className = "extensions-pi-hint";
      hint.textContent = t("recommended.updatePi") || "Update Pi";
      card.append(hint);
    }
    const busy = installing.includes(item.source);
    const action = document.createElement("button");
    action.type = "button";
    action.className = "ui-button ui-button--sm";
    paintInstallButton(action, {
      label: installed ? t("recommended.installed") : t("recommended.install"),
      busy,
      busyLabel: t("recommended.installing"),
      done: 0,
      total: 1,
    });
    action.disabled = installed || busy;
    if (!installed) action.addEventListener("click", () => void onInstall?.(item.source));
    card.append(name, why, enables, action);
    const failure = installErrors[item.source];
    if (failure && !busy) {
      const error = document.createElement("p");
      error.className = "pkg-install-error";
      error.textContent = failure;
      card.append(error);
    }
    grid.appendChild(card);
  }
  rec.appendChild(grid);
  host.appendChild(rec);
  return { missing, missingCount: missing.length };
}
