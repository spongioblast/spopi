// ABOUTME: First-launch note: projects folder, a model, Dependencies, and the recommended packages.
// ABOUTME: Got it, Escape, or a backdrop click writes ui.firstRun.dismissed; a Settings button brings it back when Settings closes.

import { t } from "../i18n/i18n.js";
import { getDialogRoot, openDialog } from "../ui/dialog.js";
import { el } from "../ui/dom.js";

export const FIRST_RUN_DISMISSED_KEY = "ui.firstRun.dismissed";
const SETTINGS_CLOSED_EVENT = "spopi-settings-closed";

/** @param {HTMLElement} container */
function noteOpen(container) {
  return Boolean(container.querySelector(".first-run-dialog"));
}

/**
 * @typedef {{
 *   get: (key: string) => Promise<unknown>,
 *   set: (key: string, value: unknown) => Promise<unknown>,
 * }} FirstRunPreferences
 */

/**
 * @param {string} titleKey
 * @param {string} bodyKey
 * @param {string} actionKey
 * @param {string} action
 * @param {() => void} onClick
 */
function section(titleKey, bodyKey, actionKey, action, onClick) {
  return el("section", { class: "first-run-item" }, [
    el("h3", { text: t(titleKey) }),
    el("p", { text: t(bodyKey) }),
    el("button", {
      class: "ui-button ui-button--secondary ui-button--sm",
      type: "button",
      text: t(actionKey),
      dataset: { firstRun: action },
      onClick,
    }),
  ]);
}

/**
 * @typedef {{
 *   preferences?: FirstRunPreferences | null,
 *   control?: { checkDependencies?: (options?: { quick?: boolean }) => Promise<unknown> } | null,
 *   openSettings?: (tab: string) => void,
 *   container?: HTMLElement | null,
 *   sleep?: (ms: number) => Promise<void>,
 *   force?: boolean,
 * }} FirstRunOptions
 */

/**
 * Show the note unless it was already dismissed, or always with `force`.
 * The preference read retries for about ten seconds, because the host socket may
 * still be opening. After that, a failed read leaves it unshown for this launch.
 * @param {FirstRunOptions} [options]
 * @returns {Promise<boolean>}
 */
export async function maybeShowFirstRun(options = {}) {
  const {
    preferences,
    control,
    openSettings,
    container = getDialogRoot(),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    force = false,
  } = options;
  if (!preferences || !container || noteOpen(container)) return false;
  if (!force) {
    let dismissed = false;
    let read = false;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        dismissed = Boolean(await preferences.get(FIRST_RUN_DISMISSED_KEY));
        read = true;
        break;
      } catch {
        if (attempt === 9) return false;
        await sleep(1000);
      }
    }
    if (!read || dismissed || noteOpen(container)) return false;
  }

  let saved = false;
  let leavingForSettings = false;
  const persist = () => {
    if (saved || leavingForSettings) return;
    saved = true;
    void preferences.set(FIRST_RUN_DISMISSED_KEY, true).catch(() => {});
  };

  /** @param {string} tab */
  const open = (tab) => {
    leavingForSettings = true;
    handle.close();
    document.addEventListener(
      SETTINGS_CLOSED_EVENT,
      () => {
        void maybeShowFirstRun({ ...options, container, force: true });
      },
      { once: true },
    );
    openSettings?.(tab);
  };

  const body = el("div", { class: "first-run" }, [
    el("p", { class: "first-run-intro", text: t("firstRun.dialog.intro") }),
    section(
      "firstRun.dialog.projectsTitle",
      "firstRun.dialog.projectsBody",
      "firstRun.dialog.projectsAction",
      "projects",
      () => open("general"),
    ),
    section(
      "firstRun.dialog.modelTitle",
      "firstRun.dialog.modelBody",
      "firstRun.dialog.modelAction",
      "model",
      () => open("models"),
    ),
    toolsSection(() => open("dependencies")),
    section(
      "firstRun.dialog.packagesTitle",
      "firstRun.dialog.packagesBody",
      "firstRun.dialog.packagesAction",
      "packages",
      () => open("extensions"),
    ),
  ]);
  void fillTools(body.querySelector("[data-first-run-tools]"), control);

  /** @type {{ close: () => void }} */
  let handle = { close() {} };
  handle = openDialog({
    container,
    className: "first-run-dialog",
    title: t("firstRun.dialog.title"),
    body,
    closeOnBackdrop: true,
    onClose: persist,
    actions: [
      {
        label: t("firstRun.dialog.done"),
        className: "ui-button ui-button--primary ui-button--sm",
        onClick: () => handle.close(),
      },
    ],
  });
  return true;
}

/**
 * @param {() => void} openDependencies
 */
function toolsSection(openDependencies) {
  return el("section", { class: "first-run-item", dataset: { firstRunTools: "1" } }, [
    el("h3", { text: t("firstRun.dialog.toolsTitle") }),
    el("p", { text: t("firstRun.dialog.checking") }),
    el("button", {
      class: "ui-button ui-button--secondary ui-button--sm",
      type: "button",
      text: t("firstRun.dialog.openDependencies"),
      dataset: { firstRun: "dependencies" },
      onClick: openDependencies,
    }),
  ]);
}

/**
 * @param {Element | null | undefined} host
 * @param {{ checkDependencies?: (options?: { quick?: boolean }) => Promise<unknown> } | null} [control]
 */
async function fillTools(host, control) {
  if (!host) return;
  const paragraph = host.querySelector("p");
  if (!paragraph) return;
  if (!control?.checkDependencies) {
    paragraph.textContent = t("firstRun.dialog.checkLater");
    return;
  }
  /** @type {{ npm?: { state?: string }, browser?: { state?: string } } | null} */
  let report = null;
  try {
    const result = await Promise.race([
      control.checkDependencies({ quick: false }),
      new Promise((resolve) => setTimeout(() => resolve(null), 30000)),
    ]);
    if (result && typeof result === "object") {
      report = /** @type {{ npm?: { state?: string }, browser?: { state?: string } }} */ (result);
    }
  } catch {
    report = null;
  }
  if (!report) {
    paragraph.textContent = t("firstRun.dialog.checkLater");
    return;
  }
  const npm = report.npm?.state;
  const browser = report.browser?.state;
  const npmBad = Boolean(npm && npm !== "ok");
  const browserMissing = browser === "missing";
  let extra = /** @type {HTMLElement | null} */ (host.querySelector("[data-first-run-browser]"));
  if (!extra) {
    extra = document.createElement("p");
    extra.dataset.firstRunBrowser = "1";
    paragraph.after(extra);
  }
  extra.hidden = true;
  if (!npmBad && !browserMissing) {
    paragraph.textContent = t("firstRun.dialog.toolsReady");
    host.classList.remove("is-warn");
    return;
  }
  host.classList.add("is-warn");
  if (npmBad) {
    const title = host.querySelector("h3");
    if (title) title.textContent = t("firstRun.dialog.npmRequired");
    paragraph.textContent = t("firstRun.dialog.npmRequiredBody");
  }
  if (browserMissing) {
    if (npmBad) {
      extra.hidden = false;
      extra.textContent = t("firstRun.dialog.browserMissing");
    } else {
      paragraph.textContent = t("firstRun.dialog.browserMissing");
    }
  }
}
