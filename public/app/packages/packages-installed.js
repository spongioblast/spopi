// ABOUTME: Lists installed packages and can disable or remove one.
// ABOUTME: Enable and disable go through Pi; install and remove stay on the host CLI.

// Settings → Extensions → "Installed Packages" management.
//
// Owns the management layer that pi-web exposes but SPOPI's community browser
// does not: a master-detail view over the installed packages — sidebar list
// grouped by scope, and a detail pane with enable/disable, update, remove,
// status fields, and the resolved extensions/skills/prompts/themes a package
// contributes — plus an agent-reload action and a diagnostics/totals footer.
// Package operations run the embedded `pi` CLI on the Rust host via the
// HostControlGateway (`host_request` frames); `listPiPackages` returns full
// package objects including package-level metadata and a resolved `resources` list.
//
// This is a distinct concern from the community catalog browser
// (package-browse.js), so it lives in its own module per the repo's
// one-concern-per-file rule.

import { t } from "../i18n/i18n.js";
import { extensionsSettingsRefs } from "../settings/extensions-settings.js";
import { confirmDialog } from "../ui/dialog.js";
import { getPackageInstallFailure } from "./install-status.js";
import { noteInstalledPackages } from "./packages-bundled.js";

/**
 * @typedef {{
 *   extensions: number,
 *   skills: number,
 *   prompts: number,
 *   themes: number,
 * }} ResourceCounts
 *
 * @typedef {{
 *   name: string,
 *   relativePath: string,
 * }} PackageResource
 *
 * @typedef {{
 *   source?: unknown,
 *   scope?: unknown,
 *   installedPath?: unknown,
 *   packageName?: unknown,
 *   version?: unknown,
 *   description?: unknown,
 *   disabled?: unknown,
 *   counts?: Partial<ResourceCounts> | null,
 *   resources?: unknown,
 * }} PiPackageRaw
 *
 * @typedef {{
 *   source: string,
 *   scope: "global" | "project",
 *   installedPath: string | null,
 *   packageName: string | null,
 *   version: string | null,
 *   description: string | null,
 *   disabled: boolean,
 *   status: string,
 *   counts: Partial<ResourceCounts>,
 *   resources: PackageResource[],
 *   index: number,
 *   updateAvailable: boolean | null,
 * }} ManagedPackage
 *
 * @typedef {{
 *   listPiPackages: () => Promise<unknown>,
 *   checkPiPackageUpdates: (workspaceId?: string | null | undefined) => Promise<unknown>,
 *   updatePiPackage: (source: string) => Promise<unknown>,
 *   removePiPackage: (source: string, opts?: { local?: boolean }) => Promise<unknown>,
 *   restartRuntime?: (workspaceId: string, sessionId: string) => Promise<unknown>,
 * }} PackageManagerControl
 *
 * @typedef {{
 *   workspaceInfo: (
 *     workspaceId: string,
 *   ) => Promise<{ info?: { path?: string } | null | undefined } | null | undefined>,
 * }} PackageManagerData
 *
 * @typedef {object} PackageManagerDeps
 * @property {unknown} [control]
 * @property {{ call: (op: string, params?: Record<string, unknown>) => Promise<{ ok?: boolean, error?: string, data?: unknown }> } | null} [configGateway]
 * @property {unknown} [data]
 * @property {unknown} [notify]
 * @property {(() => string | null | undefined) | null | undefined} [getWorkspaceId]
 * @property {(() => string | null | undefined) | null | undefined} [getSessionId]
 * @property {unknown} [onRestarted]
 * @property {(() => void | Promise<void>) | undefined} [onReloaded]
 * @property {((count: number) => void) | null | undefined} [onUpdatesChecked]
 * @property {(() => void) | null | undefined} [onBrowseRevealed]
 */

/** @type {ReadonlyArray<[keyof ResourceCounts, string, string]>} */
const RESOURCE_GROUPS = [
  ["extensions", "extensions.counts.extensionsOne", "extensions.counts.extensionsOther"],
  ["skills", "extensions.counts.skillsOne", "extensions.counts.skillsOther"],
  ["prompts", "extensions.counts.promptsOne", "extensions.counts.promptsOther"],
  ["themes", "extensions.counts.themesOne", "extensions.counts.themesOther"],
];

/** @type {Record<string, string>} */
const STATUS_KEYS = {
  loaded: "extensions.statusLoaded",
  installed: "extensions.statusInstalled",
  disabled: "extensions.statusDisabled",
  failed: "extensions.statusFailed",
};

/**
 * "1 extension · 2 skills"; zero counts are left out.
 * @param {Partial<ResourceCounts> | null | undefined} counts
 * @returns {string}
 */
function countsText(counts) {
  return RESOURCE_GROUPS.map(([key, one, other]) => {
    const count = counts?.[key] ?? 0;
    return count > 0 ? t(count === 1 ? one : other, { count }) : "";
  })
    .filter(Boolean)
    .join(" · ");
}

/**
 * @param {{ source?: unknown } | null | undefined} pkg
 * @returns {string}
 */
function sourceOf(pkg) {
  return typeof pkg?.source === "string" ? pkg.source : "";
}

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
function appendHealthFailure(parent, pkg) {
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
function displayStatus(pkg) {
  if (pkg.status === "loaded" && healthFor(pkg)?.state === "failed") return "failed";
  return pkg.status;
}

/**
 * @param {{ scope: string, source: string }} pkg
 * @returns {string}
 */
function keyOf(pkg) {
  return `${pkg.scope}\0${pkg.source}`;
}

// Normalize a user-typed install source: trim whitespace and unwrap a pasted
// `pi install ...` command so any of `npm:foo`, `pi install npm:foo`, or
// `npm install @scope/pkg` style inputs work.
/**
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeSource(raw) {
  let value = String(raw || "").trim();
  const installMatch = value.match(/(?:^|\s)(?:pi|npm)\s+install\s+(.+)$/i);
  if (installMatch) {
    value = installMatch[1]
      .split(/\s+/)
      .filter((part) => part && !part.startsWith("-"))
      .join(" ");
  }
  return value.trim();
}

/**
 * @param {unknown} path
 * @returns {string}
 */
function shortenPath(path) {
  if (!path) return "";
  return String(path).replace(/^\/?(Users|home)\/[^/]+/, "~");
}

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
 * @param {string} label
 * @param {object} [options]
 * @param {boolean} [options.danger=false]
 * @param {boolean} [options.disabled=false]
 * @param {string} [options.title=""]
 * @returns {HTMLButtonElement}
 */
function iconButton(label, { danger = false, disabled = false, title = "" } = {}) {
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
  btn.className = "pkg-manager-toggle";
  btn.setAttribute("role", "switch");
  btn.setAttribute("aria-checked", String(enabled));
  btn.setAttribute("aria-label", label);
  btn.title = label;
  btn.addEventListener("click", onToggle);
  const knob = document.createElement("span");
  knob.className = "pkg-manager-toggle-knob";
  btn.appendChild(knob);
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
  btn.classList.toggle("is-on", enabled);
  btn.classList.toggle("is-loading", Boolean(loading));
  btn.setAttribute("aria-checked", String(enabled));
  btn.disabled = Boolean(loading);
}

/**
 * @param {string} text
 * @param {object} [options]
 * @param {boolean} [options.isError=false]
 * @returns {HTMLDivElement}
 */
function message(text, { isError = false } = {}) {
  const el = document.createElement("div");
  el.className = `pkg-manager-message${isError ? " is-error" : ""}`;
  el.textContent = text;
  return el;
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

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function asOptionalString(value) {
  return typeof value === "string" && value ? value : null;
}

/**
 * @param {unknown} value
 * @returns {PackageResource[]}
 */
function asResources(value) {
  if (!Array.isArray(value)) return [];
  /** @type {PackageResource[]} */
  const out = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const rec = /** @type {Record<string, unknown>} */ (entry);
    out.push({
      name: typeof rec.name === "string" ? rec.name : "",
      relativePath: typeof rec.relativePath === "string" ? rec.relativePath : "",
    });
  }
  return out;
}

/**
 * @param {unknown} error
 * @returns {string | undefined}
 */
function errorMessage(error) {
  if (error && typeof error === "object" && "message" in error) {
    const msg = /** @type {{ message: unknown }} */ (error).message;
    return typeof msg === "string" ? msg : undefined;
  }
  return undefined;
}

// Wires the Settings → Extensions installed-package management UI.
// `deps` = { control, data, notify, getWorkspaceId, getSessionId, onRestarted }.
/**
 * @param {PackageManagerDeps} deps
 * @returns {{ load: (force?: boolean) => Promise<void> | void }}
 */
export function mountPackageManager(deps) {
  const control =
    deps.control && typeof deps.control === "object"
      ? /** @type {PackageManagerControl} */ (deps.control)
      : null;
  const dataApi =
    deps.data && typeof deps.data === "object"
      ? /** @type {PackageManagerData} */ (deps.data)
      : null;
  const manager = extensionsSettingsRefs(document);
  const groupsElMaybe = manager.managerGroups;
  if (!groupsElMaybe) return { load() {} };
  const groupsEl = groupsElMaybe;

  const sectionEl = manager.managerSection;
  const detailEl = manager.managerDetail;
  const toolbarEl = manager.managerToolbar;
  const canManage = Boolean(control);

  let cwd = "";
  /** @type {ManagedPackage[]} */
  let packages = [];
  /** @type {string | null} */
  let selectedKey = null;
  /** @type {string | null} */
  let busyScope = null; // key that identifies which per-package action is in flight
  let restarting = false;
  /** @type {string | null} */
  let lastError = null;
  /** @type {string | null} */
  let lastMessage = null;
  let lastLoaded = false;
  let checkingUpdates = false;
  let updatingAll = false;
  /** @type {string | null} */
  let checkNotice = null;
  /** @type {Promise<void> | null} */
  let checkInFlight = null;

  async function resolveCwd() {
    try {
      const workspaceId = deps.getWorkspaceId?.();
      if (!workspaceId || !dataApi) return "";
      const info = await dataApi.workspaceInfo(workspaceId);
      return info?.info?.path ?? "";
    } catch {
      return "";
    }
  }

  /**
   * @param {boolean} [force]
   */
  async function load(force = false) {
    // runUpdateAll owns the list while it is in flight; a concurrent reload
    // (e.g. re-entering the tab mid-update) would swap the list underneath it.
    if (updatingAll) return;
    if (!force && lastLoaded) {
      render();
      return;
    }
    lastLoaded = true;
    if (!canManage) {
      renderEmpty(t("extensions.managementUnavailable"));
      return;
    }
    try {
      await fetchList(null);
    } catch (error) {
      renderError(error);
      return;
    }
    render();
    await checkForUpdates();
  }

  // Re-list installed packages. `previousStates` (keyOf -> updateAvailable) keeps
  // already-known update badges stable across the reload instead of resetting them.
  /**
   * @param {Map<string, boolean | null> | null} previousStates
   */
  async function fetchList(previousStates) {
    const ctrl = control;
    if (!ctrl) return;
    cwd = await resolveCwd();
    const listed = await ctrl.listPiPackages();
    packages = (Array.isArray(listed) ? listed : []).map((pkg, index) => {
      /** @type {PiPackageRaw} */
      const p =
        typeof pkg === "string"
          ? { source: pkg }
          : pkg && typeof pkg === "object"
            ? /** @type {PiPackageRaw} */ (pkg)
            : {};
      const status = p.disabled ? "disabled" : p.installedPath ? "loaded" : "installed";
      const source = sourceOf(p);
      // Normalize the scope once here so keyOf() below always produces the same
      // key format as the update-probe response mapping.
      const scope = p.scope === "project" ? "project" : "global";
      const key = `${scope}\0${source}`;
      return {
        source,
        scope,
        installedPath: asOptionalString(p.installedPath),
        packageName: asOptionalString(p.packageName),
        version: asOptionalString(p.version),
        description: asOptionalString(p.description),
        disabled: Boolean(p.disabled),
        status,
        counts: p.counts && typeof p.counts === "object" ? p.counts : {},
        resources: asResources(p.resources),
        index,
        updateAvailable: previousStates?.get(key) ?? null,
      };
    });
    if (!packages.some((p) => keyOf(p) === selectedKey)) {
      selectedKey = packages[0] ? keyOf(packages[0]) : null;
    }
  }

  function updateCount() {
    return packages.filter((pkg) => pkg.updateAvailable === true).length;
  }

  // Probe every installed package for an available update. Concurrent calls are
  // merged into one probe so re-entering the page never stacks network checks.
  function checkForUpdates() {
    if (updatingAll) return Promise.resolve();
    const ctrl = control;
    if (!ctrl) return Promise.resolve();
    if (checkInFlight) return checkInFlight;
    checkInFlight = (async () => {
      checkingUpdates = true;
      checkNotice = null;
      render();
      try {
        const updates = await ctrl.checkPiPackageUpdates(deps.getWorkspaceId?.());
        const availableByKey = new Map(
          (Array.isArray(updates) ? updates : []).map((update) => {
            const rec =
              update && typeof update === "object"
                ? /** @type {Record<string, unknown>} */ (update)
                : {};
            const scope = rec.scope === "project" ? "project" : "global";
            const source = typeof rec.source === "string" ? rec.source : "";
            return /** @type {[string, boolean]} */ ([
              `${scope}\0${source}`,
              rec.available === true,
            ]);
          }),
        );
        packages = packages.map((pkg) => ({
          ...pkg,
          updateAvailable: availableByKey.get(keyOf(pkg)) ?? false,
        }));
      } catch {
        // Keep the loaded list; every Update button stays disabled because no
        // package reports updateAvailable === true, and the notice explains why.
        checkNotice = t("extensions.checkUpdatesFailed");
      } finally {
        checkingUpdates = false;
        render();
        deps.onUpdatesChecked?.(updateCount());
      }
    })();
    return checkInFlight.finally(() => {
      checkInFlight = null;
    });
  }

  function render() {
    noteInstalledPackages(packages);
    sectionEl?.classList.remove("hidden");
    renderGroups();
    renderDetail(packages.find((p) => keyOf(p) === selectedKey) || null);
    renderToolbar();
    flashMessage();
    fitShell();
  }

  // The list and detail scroll inside the box, so the box takes exactly the
  // height left below its top edge in the settings scroller.
  function fitShell() {
    const shell = sectionEl?.querySelector(".pkg-manager-shell");
    const scroller = shell?.closest(".settings-content");
    if (!(shell instanceof HTMLElement) || !(scroller instanceof HTMLElement)) return;
    if (!shell.offsetParent) return;
    const top =
      shell.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    const bottom = Number.parseFloat(getComputedStyle(scroller).paddingBottom) || 0;
    const height = Math.max(352, Math.floor(scroller.clientHeight - top - bottom));
    shell.style.setProperty("--pkg-shell-height", `${height}px`);
  }
  window.addEventListener("resize", fitShell);

  /**
   * @param {string} text
   */
  function renderEmpty(text) {
    groupsEl.replaceChildren(emptyNote(text));
    detailEl?.replaceChildren();
    renderToolbar();
  }

  /**
   * @param {unknown} error
   */
  function renderError(error) {
    const errMsg = errorMessage(error);
    const msg = message(errMsg ? `Failed to load installed packages: ${errMsg}` : String(error), {
      isError: true,
    });
    groupsEl.replaceChildren(msg);
    detailEl?.replaceChildren();
    renderToolbar();
  }

  /**
   * @param {string} text
   * @returns {HTMLDivElement}
   */
  function emptyNote(text) {
    const el = document.createElement("div");
    el.className = "settings-api-keys-empty";
    el.textContent = text;
    return el;
  }

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

  function renderGroups() {
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
      for (const pkg of scoped) groupsEl.appendChild(renderSidebarRow(pkg));
    }
  }

  /**
   * @param {ManagedPackage} pkg
   * @returns {HTMLButtonElement}
   */
  function renderSidebarRow(pkg) {
    const key = keyOf(pkg);
    const row = document.createElement("button");
    row.type = "button";
    row.className = `pkg-manager-sidebar-row${key === selectedKey ? " is-selected" : ""}`;
    row.addEventListener("click", () => {
      selectedKey = key;
      render();
    });

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
        : [pkg.version ? `v${pkg.version}` : "", countsText(pkg.counts)]
            .filter(Boolean)
            .join(" · ");
    row.appendChild(meta);

    return row;
  }

  function updateBadge() {
    const badge = document.createElement("span");
    badge.className = "pkg-manager-update-badge";
    badge.textContent = t("extensions.updateAvailable");
    badge.title = t("extensions.updateAvailable");
    badge.setAttribute("role", "status");
    return badge;
  }

  /**
   * @param {ManagedPackage | null} pkg
   */
  function renderDetail(pkg) {
    if (!detailEl) return;
    detailEl.innerHTML = "";
    if (!pkg) return;
    const key = keyOf(pkg);
    const busy = busyScope === key;

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
      onToggle: () => runToggle(pkg, key),
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
    updateBtn.addEventListener("click", () => runUpdate(pkg, key));
    const removeBtn = iconButton(t("extensions.remove"), {
      danger: true,
      disabled: busy || !canManage,
      title: t("extensions.removeTip"),
    });
    removeBtn.addEventListener("click", () => runRemove(pkg, key));
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

  function renderToolbar() {
    if (!toolbarEl) return;
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
    // appears or clears. Its own class keeps flashMessage from removing it.
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
    refreshBtn.addEventListener("click", () => load(true));
    actions.appendChild(refreshBtn);
    if (packages.length) {
      const updatable = updateCount();
      const updateAllLabel = updatable
        ? t("extensions.updateAll", { count: updatable })
        : t("extensions.updateAllNone");
      const updateAllBtn = iconButton(updateAllLabel, {
        disabled: updatingAll || restarting || busyScope !== null || !canManage || updatable === 0,
        title: t("extensions.updateTip"),
      });
      updateAllBtn.id = "pkg-manager-update-all-btn";
      updateAllBtn.addEventListener("click", () => void runUpdateAll());
      actions.appendChild(updateAllBtn);
      const reloadBtn = iconButton(t("extensions.reloadAgent"), {
        disabled: busyScope !== null || restarting || !canManage,
        title: t("extensions.reloadAgentTip"),
      });
      reloadBtn.id = "pkg-manager-reload-btn";
      reloadBtn.addEventListener("click", runRestart);
      actions.appendChild(reloadBtn);
    }
    toolbarEl.appendChild(actions);
  }

  // Update every package that reported an available update, one at a time so
  // failures stay isolated. Afterwards re-list to refresh versions while keeping
  // each package's last known update state (no fresh network probe).
  async function runUpdateAll() {
    const ctrl = control;
    if (!ctrl || !canManage || busyScope !== null || restarting || updatingAll) return;
    const targets = packages.filter((pkg) => pkg.updateAvailable === true);
    if (!targets.length) return;
    updatingAll = true;
    let updated = 0;
    let failed = 0;
    for (const [index, pkg] of targets.entries()) {
      checkNotice = t("extensions.updatingAll", { done: index, total: targets.length });
      render();
      try {
        await ctrl.updatePiPackage(pkg.source);
        pkg.updateAvailable = false;
        updated += 1;
      } catch {
        failed += 1;
      }
    }
    updatingAll = false;
    checkNotice = failed
      ? t("extensions.updatedAllWithFailures", { count: updated, failed })
      : null;
    if (!failed) {
      lastMessage = t("extensions.updatedAll", { count: updated });
      lastError = null;
    }
    const previousStates = new Map(packages.map((pkg) => [keyOf(pkg), pkg.updateAvailable]));
    try {
      await fetchList(previousStates);
    } catch {
      // Keep showing the pre-update list; the user can hit Refresh to retry.
    }
    render();
    deps.onUpdatesChecked?.(updateCount());
  }

  // Restart the embedded pi subprocess for the current workspace/session so
  // package enable/disable/update changes take effect immediately. On success
  // the caller re-bootstraps the session against the fresh runtime.
  async function runRestart() {
    const ctrl = control;
    if (!ctrl || !canManage || restarting || busyScope !== null) return;
    const workspaceId = deps.getWorkspaceId?.();
    const sessionId = deps.getSessionId?.();
    if (!workspaceId || !sessionId || !ctrl.restartRuntime) {
      lastError = t("extensions.reloadAgentUnavailable");
      lastMessage = null;
      render();
      return;
    }
    const restartRuntime = ctrl.restartRuntime;
    restarting = true;
    lastError = null;
    lastMessage = t("extensions.reloadingAgent");
    render();
    try {
      await restartRuntime(workspaceId, sessionId);
      const onRestarted = deps.onRestarted;
      if (typeof onRestarted === "function") onRestarted();
    } catch (error) {
      lastError = summarizeActionError(error);
      lastMessage = null;
    } finally {
      restarting = false;
      render();
    }
  }

  /**
   * @param {ManagedPackage} pkg
   * @param {string} key
   */
  async function runToggle(pkg, key) {
    const ctrl = control;
    if (!ctrl || !canManage || busyScope) return;
    busyScope = key;
    render();
    try {
      const gateway = deps.configGateway;
      if (!gateway?.call) throw new Error(t("extensions.packageToggleFailed"));
      const response = await gateway.call("set_package_enabled", {
        source: pkg.source,
        scope: pkg.scope,
        enabled: pkg.disabled,
      });
      if (!response?.ok) throw new Error(response?.error || t("extensions.packageToggleFailed"));
      const data = /** @type {{ reloaded?: boolean } | undefined} */ (response.data);
      if (data?.reloaded) void deps.onReloaded?.();
      pkg.disabled = !pkg.disabled;
      pkg.status = pkg.disabled ? "disabled" : pkg.installedPath ? "loaded" : "installed";
      lastMessage = pkg.disabled
        ? t("extensions.packageDisabledMessage", { source: pkg.source })
        : t("extensions.packageEnabledMessage", { source: pkg.source });
      lastError = null;
    } catch (error) {
      lastError = summarizeActionError(error);
      lastMessage = null;
    } finally {
      busyScope = null;
      render();
    }
  }

  /**
   * @param {ManagedPackage} pkg
   * @param {string} key
   */
  async function runUpdate(pkg, key) {
    const ctrl = control;
    if (!ctrl || !canManage || busyScope) return;
    busyScope = key;
    render();
    try {
      await ctrl.updatePiPackage(pkg.source);
      await load(true);
      lastMessage = t("extensions.updateMessage", { source: pkg.source });
      lastError = null;
      render();
    } catch (error) {
      lastError = summarizeActionError(error);
      lastMessage = null;
      render();
    } finally {
      busyScope = null;
    }
  }

  /**
   * @param {ManagedPackage} pkg
   * @param {string} key
   */
  async function runRemove(pkg, key) {
    const ctrl = control;
    if (!ctrl || !canManage || busyScope) return;
    const ok = await confirmDialog({
      message: t("settings.confirmRemove", { name: pkg.packageName || pkg.source }),
      confirmLabel: t("extensions.remove"),
    });
    if (!ok) return;
    busyScope = key;
    render();
    try {
      await ctrl.removePiPackage(pkg.source, { local: pkg.scope === "project" });
      packages = packages.filter((p) => keyOf(p) !== key);
      if (selectedKey === key) {
        selectedKey = packages[0] ? keyOf(packages[0]) : null;
      }
      lastMessage = t("extensions.removeMessage", { source: pkg.source });
      lastError = null;
      render();
    } catch (error) {
      lastError = summarizeActionError(error);
      lastMessage = null;
      render();
    } finally {
      busyScope = null;
    }
  }

  /**
   * @param {unknown} error
   * @returns {string}
   */
  function summarizeActionError(error) {
    const failure = getPackageInstallFailure(error, "install");
    return failure.detail || String(errorMessage(error) || error || "unknown error");
  }

  // Re-render last message/error under the toolbar.
  function flashMessage() {
    if (!toolbarEl) return;
    const existing = toolbarEl.querySelector(".pkg-manager-message");
    if (existing) existing.remove();
    if (lastMessage) {
      toolbarEl.appendChild(message(lastMessage));
    } else if (lastError) {
      toolbarEl.appendChild(message(lastError, { isError: true }));
    }
  }

  return { load };
}
