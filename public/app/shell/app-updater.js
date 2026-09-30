// ABOUTME: Checks the release feed for an update and starts the install when asked.
// ABOUTME: The download progress is shown on the update indicator.

import { onLocaleChange, t } from "../i18n/i18n.js";
import { generalSettingsRefs } from "../settings/general-settings.js";
import { sidebarChromeRefs } from "./chrome/sidebar.js";

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * @typedef {(...args: unknown[]) => unknown} TauriFn
 * @typedef {{
 *   event?: string,
 *   data?: { contentLength?: number, chunkLength?: number },
 * }} UpdateProgressEvent
 * @typedef {{
 *   version?: string,
 *   downloadAndInstall?: (
 *     onEvent?: (event: UpdateProgressEvent) => void,
 *   ) => unknown | Promise<unknown>,
 * }} AppUpdate
 * @typedef {
 *   | { kind: "idle" }
 *   | { kind: "checking" }
 *   | { kind: "available", version?: string }
 *   | { kind: "upToDate" }
 *   | { kind: "checkFailed" }
 *   | { kind: "noRelease" }
 *   | { kind: "preparing" }
 *   | { kind: "downloading" }
 *   | { kind: "installing" }
 *   | { kind: "relaunching" }
 *   | { kind: "installFailed" }
 * } UpdaterView
 * @typedef {{
 *   textContent: string | null,
 *   disabled: boolean,
 *   dataset: DOMStringMap,
 *   classList: DOMTokenList,
 *   setAttribute: (name: string, value: string) => void,
 *   addEventListener: EventTarget["addEventListener"],
 * }} UpdateCheckButton
 * @typedef {{
 *   textContent: string | null,
 *   disabled: boolean,
 *   classList: DOMTokenList,
 *   innerHTML: string,
 *   append: (...nodes: (Node | string)[]) => void,
 *   addEventListener: EventTarget["addEventListener"],
 * }} UpdateSidebarButton
 * @typedef {{ warn?: (...args: unknown[]) => void }} UpdaterLogger
 * @typedef {{
 *   __TAURI__?: {
 *     process?: { relaunch?: TauriFn },
 *     updater?: { check?: TauriFn },
 *   },
 * }} TauriGlobal
 */

/**
 * @param {Element | null | undefined} el
 * @returns {UpdateCheckButton | null}
 */
function asUpdateCheckButton(el) {
  if (
    !el ||
    !("disabled" in el) ||
    !("dataset" in el) ||
    !("textContent" in el) ||
    !("setAttribute" in el) ||
    !("addEventListener" in el)
  ) {
    return null;
  }
  return /** @type {UpdateCheckButton} */ (el);
}

/**
 * @param {Element | null | undefined} el
 * @returns {UpdateSidebarButton | null}
 */
function asUpdateSidebarButton(el) {
  if (
    !el ||
    !("disabled" in el) ||
    !("classList" in el) ||
    !("textContent" in el) ||
    !("innerHTML" in el) ||
    !("append" in el) ||
    !("addEventListener" in el)
  ) {
    return null;
  }
  return /** @type {UpdateSidebarButton} */ (el);
}

/**
 * @param {object} [options]
 * @param {UpdaterLogger} [options.logger]
 * @returns {{ checkNow: (opts?: { silent?: boolean }) => Promise<AppUpdate | null>, installUpdate: () => Promise<void> } | null}
 */
export function mountAppUpdater({ logger = console } = {}) {
  const g = /** @type {TauriGlobal} */ (globalThis);
  const relaunch = g.__TAURI__?.process?.relaunch;
  const checkFn = g.__TAURI__?.updater?.check;
  const general = generalSettingsRefs(document);
  const statusCandidate = general.updateStatus;
  const checkCandidate = asUpdateCheckButton(general.checkUpdates);
  const sidebarBtn = asUpdateSidebarButton(sidebarChromeRefs().updateBtn);
  if (!statusCandidate || !checkCandidate || typeof checkFn !== "function") {
    return null;
  }
  const statusEl = statusCandidate;
  const checkBtn = checkCandidate;
  /** @type {TauriFn} */
  const check = checkFn;

  /** @type {AppUpdate | null} */
  let update = null;
  let lastCheckMs = 0;
  let checking = false;
  let installing = false;
  let totalBytes = 0;
  let downloadedBytes = 0;
  /** @type {ReturnType<typeof setTimeout> | 0} */
  let silentTimer = 0;

  const LOADING_SVG =
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>';

  /** @param {boolean} visible */
  function setSidebarVisible(visible) {
    sidebarBtn?.classList.toggle("hidden", !visible);
  }

  /** @type {UpdaterView} */
  let view = { kind: "idle" };

  function applyView() {
    switch (view.kind) {
      case "checking":
        setState({
          status: t("updater.checking"),
          button: t("updater.checking"),
          disabled: true,
        });
        break;
      case "available": {
        const available = view;
        const version = available.version ? `v${available.version}` : t("updater.update");
        setState({
          status: t("updater.versionAvailable", { version }),
          button: t("updater.downloadInstall"),
          canInstall: true,
        });
        setSidebarVisible(true);
        break;
      }
      case "upToDate":
        setState({ status: t("updater.upToDate"), button: t("updater.checkNow") });
        setSidebarVisible(false);
        break;
      case "checkFailed":
        setState({ status: t("updater.checkFailed"), button: t("updater.checkNow") });
        break;
      case "noRelease":
        setState({ status: t("updater.noReleaseYet"), button: t("updater.checkNow") });
        break;
      case "preparing":
        setState({
          status: t("updater.preparingDownload"),
          button: t("updater.installing"),
          disabled: true,
        });
        break;
      case "downloading":
        setState({
          status: formatProgress(),
          button: t("updater.installing"),
          disabled: true,
        });
        break;
      case "installing":
        setState({
          status: t("updater.installing"),
          button: t("updater.installing"),
          disabled: true,
        });
        break;
      case "relaunching":
        setState({
          status: t("updater.installedRelaunching"),
          button: t("updater.relaunching"),
          disabled: true,
        });
        break;
      case "installFailed":
        setState({
          status: t("updater.installFailed"),
          button: t("updater.tryAgain"),
          canInstall: true,
        });
        break;
      default:
        setState({ status: "", button: t("updater.checkNow") });
        setSidebarVisible(false);
    }
  }

  /** @param {boolean} loading */
  function setSidebarLoading(loading) {
    if (!sidebarBtn) return;
    if (loading) {
      sidebarBtn.classList.remove("hidden");
      sidebarBtn.classList.add("loading");
      sidebarBtn.disabled = true;
      sidebarBtn.innerHTML = LOADING_SVG;
      sidebarBtn.append(document.createTextNode(t("updater.update")));
    } else {
      sidebarBtn.classList.remove("loading");
      sidebarBtn.disabled = false;
      sidebarBtn.textContent = t("updater.update");
    }
  }

  /**
   * @param {object} state
   * @param {string} state.status
   * @param {string} state.button
   * @param {boolean} [state.disabled]
   * @param {boolean} [state.canInstall]
   */
  function setState({ status, button, disabled = false, canInstall = false }) {
    statusEl.textContent = status;
    checkBtn.textContent = button;
    checkBtn.disabled = disabled;
    checkBtn.dataset.mode = canInstall ? "install" : "check";
    checkBtn.setAttribute("aria-busy", disabled ? "true" : "false");
  }

  function showIdle() {
    view = { kind: "idle" };
    applyView();
  }

  /** @param {AppUpdate | null | undefined} nextUpdate */
  function showAvailable(nextUpdate) {
    view = { kind: "available", version: nextUpdate?.version };
    applyView();
  }

  /**
   * @param {object} [opts]
   * @param {boolean} [opts.silent]
   * @returns {Promise<AppUpdate | null>}
   */
  async function checkNow({ silent = false } = {}) {
    if (checking || installing) return update;
    checking = true;
    lastCheckMs = Date.now();
    if (!silent) {
      view = { kind: "checking" };
      applyView();
    }

    try {
      const result = await check();
      update = result ? /** @type {AppUpdate} */ (result) : null;
      if (update) showAvailable(update);
      else {
        view = { kind: "upToDate" };
        applyView();
      }
      return update;
    } catch (error) {
      const err = /** @type {unknown} */ (error);
      if (!silent) {
        const text = err instanceof Error ? err.message : String(err ?? "");
        view = { kind: /\b404\b/.test(text) ? "noRelease" : "checkFailed" };
        applyView();
      }
      logger.warn?.("[Updater] Check failed:", err);
      return null;
    } finally {
      checking = false;
    }
  }

  function formatProgress() {
    if (!totalBytes) return t("updater.downloading");
    const pct = Math.min(99, Math.floor((downloadedBytes / totalBytes) * 100));
    return t("updater.downloadingPct", { pct });
  }

  async function installUpdate() {
    if (installing) return;
    if (!update) {
      await checkNow();
      if (!update) return;
    }

    const currentUpdate = update;
    installing = true;
    totalBytes = 0;
    downloadedBytes = 0;
    setSidebarLoading(true);
    view = { kind: "preparing" };
    applyView();

    try {
      await currentUpdate.downloadAndInstall?.((event) => {
        if (event?.event === "Started") {
          totalBytes = event.data?.contentLength || 0;
          downloadedBytes = 0;
          view = { kind: "downloading" };
          applyView();
        } else if (event?.event === "Progress") {
          downloadedBytes += event.data?.chunkLength || 0;
          view = { kind: "downloading" };
          applyView();
        } else if (event?.event === "Finished") {
          view = { kind: "installing" };
          applyView();
        }
      });
      view = { kind: "relaunching" };
      applyView();
      if (typeof relaunch !== "function") {
        throw new Error("Tauri process plugin is unavailable");
      }
      await relaunch();
    } catch (error) {
      const err = /** @type {unknown} */ (error);
      logger.warn?.("[Updater] Install failed:", err);
      view = { kind: "installFailed" };
      applyView();
      setSidebarLoading(false);
      setSidebarVisible(true);
    } finally {
      installing = false;
    }
  }

  function scheduleSilentChecks() {
    if (silentTimer) clearInterval(silentTimer);
    silentTimer = setInterval(() => {
      if (Date.now() - lastCheckMs >= CHECK_INTERVAL_MS) void checkNow({ silent: true });
    }, CHECK_INTERVAL_MS);
  }

  checkBtn.addEventListener("click", () => {
    if (update) void installUpdate();
    else void checkNow();
  });

  sidebarBtn?.addEventListener("click", () => {
    void installUpdate();
  });

  showIdle();
  onLocaleChange(() => {
    applyView();
    if (sidebarBtn && !sidebarBtn.classList.contains("hidden")) {
      if (sidebarBtn.classList.contains("loading")) setSidebarLoading(true);
      else sidebarBtn.textContent = t("updater.update");
    }
  });
  void checkNow({ silent: true });
  scheduleSilentChecks();

  return { checkNow, installUpdate };
}
