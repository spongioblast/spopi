// ABOUTME: The Installed packages master-detail: the scope-grouped list and the selected package's pane.
// ABOUTME: Renders from the state it is given; selection and package actions call back to the page.

import { shortenPath } from "../files/path-utils.js";
import { t } from "../i18n/i18n.js";
import { appendHealthFailure, displayStatus } from "./package-health.js";
import { countsText, emptyNote, iconButton, keyOf } from "./package-manager-parts.js";

/**
 * @typedef {import("./packages-installed.js").ManagedPackage} ManagedPackage
 *
 * @typedef {{
 *   busyKey: string | null,
 *   canManage: boolean,
 *   updatingAll: boolean,
 *   cwd: string,
 *   onToggle: (pkg: ManagedPackage, key: string) => void,
 *   onUpdate: (pkg: ManagedPackage, key: string) => void,
 *   onRemove: (pkg: ManagedPackage, key: string) => void,
 * }} PackageDetailOptions
 */

/** @type {Record<string, string>} */
const STATUS_KEYS = {
  loaded: "extensions.statusLoaded",
  installed: "extensions.statusInstalled",
  disabled: "extensions.statusDisabled",
  failed: "extensions.statusFailed",
};

/**
 * @param {unknown} status
 * @returns {string}
 */
function statusLabel(status) {
  const key = STATUS_KEYS[String(status)];
  return key ? t(key) : String(status || "");
}

/**
 * @param {string} status
 * @returns {HTMLSpanElement}
 */
function statusDot(status) {
  const dot = document.createElement("span");
  dot.className = "pkg-manager-status-dot";
  dot.dataset.status = status;
  dot.title = statusLabel(status);
  return dot;
}

/**
 * @param {ManagedPackage | null | undefined} pkg
 * @returns {string}
 */
function installedPathLabel(pkg) {
  return pkg?.installedPath ? shortenPath(pkg.installedPath) : t("extensions.notOnDisk");
}

/**
 * @param {ManagedPackage | null | undefined} pkg
 * @returns {string}
 */
function resourceSummary(pkg) {
  return countsText(pkg?.counts) || t("extensions.noResources");
}

/**
 * @param {unknown} scope
 * @returns {string}
 */
function scopeLabel(scope) {
  return scope === "project" ? t("extensions.scopeProject") : t("extensions.scopeGlobal");
}

/**
 * @param {object} opts
 * @param {boolean} opts.enabled
 * @param {boolean} opts.loading
 * @param {() => void} opts.onToggle
 * @param {string} opts.label
 * @returns {HTMLButtonElement}
 */
function makeToggle({ enabled, loading, onToggle, label }) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ui-toggle ui-toggle--sm pkg-manager-toggle";
  btn.setAttribute("role", "switch");
  btn.setAttribute("aria-checked", String(enabled));
  btn.setAttribute("aria-label", label);
  btn.title = label;
  btn.addEventListener("click", onToggle);
  updateToggle(btn, enabled, loading);
  return btn;
}

/**
 * @param {HTMLButtonElement | null | undefined} btn
 * @param {boolean} enabled
 * @param {unknown} loading
 */
function updateToggle(btn, enabled, loading) {
  if (!btn) return;
  btn.setAttribute("aria-checked", String(enabled));
  btn.setAttribute("aria-busy", String(Boolean(loading)));
  btn.disabled = Boolean(loading);
}

/**
 * @param {string} label
 * @param {string | Node} value
 * @param {{ mono?: boolean }} [options]
 * @returns {HTMLDivElement}
 */
function statusRow(label, value, { mono = false } = {}) {
  const row = document.createElement("div");
  row.className = "pkg-manager-status-row";
  const labelEl = document.createElement("span");
  labelEl.className = "pkg-manager-status-label";
  labelEl.textContent = label;
  const valueEl = document.createElement("span");
  valueEl.className = mono ? "pkg-manager-status-value is-mono" : "pkg-manager-status-value";
  if (typeof value === "string") valueEl.textContent = value;
  else valueEl.appendChild(value);
  row.append(labelEl, valueEl);
  return row;
}

function updateBadge() {
  const badge = document.createElement("span");
  badge.className = "ui-badge ui-badge--accent pkg-manager-update-badge";
  badge.textContent = t("extensions.updateAvailable");
  badge.title = t("extensions.updateAvailable");
  badge.setAttribute("role", "status");
  return badge;
}

/**
 * @param {Element} groupsEl
 * @param {ManagedPackage[]} packages
 * @param {{ selectedKey: string | null, onSelect: (key: string) => void }} options
 */
export function renderPackageList(groupsEl, packages, { selectedKey, onSelect }) {
  groupsEl.innerHTML = "";
  if (!packages.length) {
    groupsEl.appendChild(emptyNote(t("extensions.noInstalled")));
    return;
  }
  for (const scope of /** @type {const} */ (["global", "project"])) {
    const scoped = packages.filter((pkg) => pkg.scope === scope);
    if (!scoped.length) continue;
    const header = document.createElement("div");
    header.className = "pkg-manager-group-header";
    header.textContent = scopeLabel(scope).toUpperCase();
    groupsEl.appendChild(header);
    for (const pkg of scoped) groupsEl.appendChild(sidebarRow(pkg, selectedKey, onSelect));
  }
}

/**
 * @param {ManagedPackage} pkg
 * @param {string | null} selectedKey
 * @param {(key: string) => void} onSelect
 * @returns {HTMLButtonElement}
 */
function sidebarRow(pkg, selectedKey, onSelect) {
  const key = keyOf(pkg);
  const row = document.createElement("button");
  row.type = "button";
  row.className = `pkg-manager-sidebar-row${key === selectedKey ? " is-selected" : ""}`;
  row.addEventListener("click", () => onSelect(key));

  const status = displayStatus(pkg);
  row.dataset.status = status;

  const top = document.createElement("div");
  top.className = "pkg-manager-row-top";
  const name = document.createElement("span");
  name.className = "pkg-manager-sidebar-name";
  name.textContent = pkg.packageName || pkg.source;
  name.title = pkg.packageName || pkg.source;
  top.append(statusDot(status), name);
  if (pkg.updateAvailable === true) top.appendChild(updateBadge());
  row.appendChild(top);

  const meta = document.createElement("div");
  meta.className = "pkg-manager-sidebar-meta";
  meta.textContent =
    status === "failed"
      ? t("extensions.healthFailed")
      : [pkg.version ? `v${pkg.version}` : "", countsText(pkg.counts)].filter(Boolean).join(" · ");
  row.appendChild(meta);

  return row;
}

/**
 * @param {Element} detailEl
 * @param {ManagedPackage | null} pkg
 * @param {PackageDetailOptions} options
 */
export function renderPackageDetail(detailEl, pkg, options) {
  detailEl.innerHTML = "";
  if (!pkg) return;
  const { busyKey, canManage, updatingAll, cwd } = options;
  const key = keyOf(pkg);
  const busy = busyKey === key;

  const header = document.createElement("div");
  header.className = "pkg-manager-detail-header";

  const titleBlock = document.createElement("div");
  titleBlock.className = "pkg-manager-title-block";
  const title = document.createElement("div");
  title.className = "pkg-manager-title";
  title.textContent = pkg.packageName || pkg.source;
  const subtitle = document.createElement("div");
  subtitle.className = "pkg-manager-subtitle";
  const sourceEl = document.createElement("span");
  sourceEl.className = "pkg-manager-source";
  sourceEl.textContent = pkg.source;
  sourceEl.title = pkg.source;
  const scopeTag = document.createElement("span");
  scopeTag.className = "pkg-manager-scope";
  scopeTag.textContent = scopeLabel(pkg.scope);
  subtitle.append(sourceEl, scopeTag);
  if (pkg.version) {
    const version = document.createElement("span");
    version.className = "pkg-manager-version";
    version.textContent = `v${pkg.version}`;
    subtitle.appendChild(version);
  }
  if (pkg.updateAvailable === true) subtitle.appendChild(updateBadge());
  titleBlock.append(title, subtitle);

  const controls = document.createElement("div");
  controls.className = "pkg-manager-detail-controls";
  const enable = document.createElement("label");
  enable.className = "pkg-manager-enable";
  const toggle = makeToggle({
    enabled: !pkg.disabled,
    loading: busy,
    label: pkg.disabled ? t("extensions.enablePackage") : t("extensions.disablePackage"),
    onToggle: () => options.onToggle(pkg, key),
  });
  const enableText = document.createElement("span");
  enableText.textContent = pkg.disabled ? t("extensions.disabled") : t("extensions.enabled");
  enable.append(toggle, enableText);

  // The update probe decides whether an update actually exists; until it
  // succeeds for this package (updateAvailable === true) the button stays off.
  const updateBtn = iconButton(t("extensions.update"), {
    disabled: busy || !canManage || pkg.updateAvailable !== true || updatingAll,
    title: t("extensions.updateTip"),
  });
  updateBtn.addEventListener("click", () => options.onUpdate(pkg, key));
  const removeBtn = iconButton(t("extensions.remove"), {
    danger: true,
    disabled: busy || !canManage,
    title: t("extensions.removeTip"),
  });
  removeBtn.addEventListener("click", () => options.onRemove(pkg, key));
  controls.append(enable, updateBtn, removeBtn);

  header.append(titleBlock, controls);
  detailEl.appendChild(header);

  if (pkg.description) {
    const description = document.createElement("p");
    description.className = "pkg-manager-description";
    description.textContent = pkg.description;
    detailEl.appendChild(description);
  }
  appendHealthFailure(detailEl, pkg);

  const status = displayStatus(pkg);
  const statusValue = document.createElement("span");
  statusValue.className = "pkg-manager-status-inline";
  statusValue.append(statusDot(status), document.createTextNode(statusLabel(status)));
  const statusGrid = document.createElement("div");
  statusGrid.className = "pkg-manager-status-grid";
  statusGrid.append(
    statusRow(t("extensions.status"), statusValue),
    statusRow(t("extensions.resources"), resourceSummary(pkg)),
    statusRow(t("extensions.installPath"), installedPathLabel(pkg), { mono: true }),
  );
  if (cwd && pkg.scope === "project") {
    statusGrid.appendChild(statusRow(t("extensions.cwd"), cwd, { mono: true }));
  }
  detailEl.appendChild(statusGrid);

  const resolvedTitle = document.createElement("div");
  resolvedTitle.className = "settings-section-title settings-section-title-small";
  resolvedTitle.textContent = t("extensions.resolvedResources");
  detailEl.appendChild(resolvedTitle);

  const resourceList = document.createElement("div");
  resourceList.className = "pkg-manager-resource-list";
  if (!pkg.resources.length) {
    resourceList.appendChild(emptyNote(t("extensions.noResources")));
  } else {
    for (const entry of pkg.resources) {
      const row = document.createElement("div");
      row.className = "pkg-manager-resource-row";
      const name = document.createElement("span");
      name.className = "pkg-manager-resource-name";
      name.textContent = entry.name;
      const path = document.createElement("span");
      path.className = "pkg-manager-resource-path";
      path.textContent = entry.relativePath;
      row.append(name, path);
      resourceList.appendChild(row);
    }
  }
  detailEl.appendChild(resourceList);
}
