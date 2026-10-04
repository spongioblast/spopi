// ABOUTME: Lists installed packages and can disable or remove one.
// ABOUTME: Enable and disable go through Pi; install and remove stay on the host CLI.

// Settings → Extensions → "Installed Packages" management: the page state, the
// package actions (enable/disable, update, update all, remove, agent reload), and
// the update probe. The list and detail pane render in package-master-detail.js,
// the toolbar in package-manager-toolbar.js.
// Package operations run the embedded `pi` CLI on the Rust host via the
// HostControlGateway (`host_request` frames); `listPiPackages` returns full
// package objects including package-level metadata and a resolved `resources` list.

import { t } from "../i18n/i18n.js";
import { extensionsSettingsRefs } from "../settings/extensions-settings.js";
import { confirmDialog } from "../ui/dialog.js";
import { getPackageInstallFailure } from "./install-status.js";
import { emptyNote, keyOf, message } from "./package-manager-parts.js";
import { renderPackageToolbar, showPackageMessage } from "./package-manager-toolbar.js";
import { renderPackageDetail, renderPackageList } from "./package-master-detail.js";
import { noteInstalledPackages } from "./packages-bundled.js";

export { notePackageHealth } from "./package-health.js";

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

/**
 * @param {{ source?: unknown } | null | undefined} pkg
 * @returns {string}
 */
function sourceOf(pkg) {
  return typeof pkg?.source === "string" ? pkg.source : "";
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
    renderPackageList(groupsEl, packages, {
      selectedKey,
      onSelect: (key) => {
        selectedKey = key;
        render();
      },
    });
    if (detailEl) {
      renderPackageDetail(detailEl, packages.find((p) => keyOf(p) === selectedKey) || null, {
        busyKey: busyScope,
        canManage,
        updatingAll,
        cwd,
        onToggle: runToggle,
        onUpdate: runUpdate,
        onRemove: runRemove,
      });
    }
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

  function renderToolbar() {
    if (!toolbarEl) return;
    renderPackageToolbar(toolbarEl, {
      packages,
      checkingUpdates,
      checkNotice,
      updatingAll,
      restarting,
      busyScope,
      canManage,
      updatable: updateCount(),
      onRefresh: () => load(true),
      onUpdateAll: () => void runUpdateAll(),
      onRestart: runRestart,
    });
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
    showPackageMessage(toolbarEl, lastMessage, lastError);
  }

  return { load };
}
