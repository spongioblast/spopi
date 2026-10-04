// ABOUTME: Settings → Dependencies lists built-in tools, npm, and Pi's browsers.
// ABOUTME: Status is always read again from the host. Nothing here is remembered as installed.

import { t } from "../../i18n/i18n.js";
import { copyText } from "../../ui/clipboard.js";
import { el } from "../../ui/dom.js";
import { settingsCard, settingsPage } from "../../ui/settings-controls.js";
import { tauriRelaunch } from "../live-debug-setting.js";
import { agentBrowserSwitch } from "./agent-browser-switch.js";
import { actionButton, dependencyRow } from "./dependency-row.js";
import { mountInstallJob } from "./install-job.js";
import { surfCard } from "./surf-card.js";

/**
 * @param {ParentNode | null | undefined} root
 * @param {{
 *   control?: {
 *     checkDependencies?: (options?: { quick?: boolean }) => Promise<Record<string, any> | null>,
 *     openExternal?: (url: string) => Promise<unknown>,
 *     startDependencyInstall?: (kind: string) => Promise<unknown>,
 *     dependencyInstallStatus?: (kind: string) => Promise<unknown>,
 *     cancelDependencyInstall?: (kind: string) => Promise<unknown>,
 *     surfExtensionPath?: () => Promise<string>,
 *     surfConnect?: (id: string, browser: string) => Promise<{ ok?: boolean, lines?: string[] }>,
 *     openBrowserExtensions?: (browser: string) => Promise<unknown>,
 *   } | null,
 *   preferences?: { get: (key: string) => Promise<unknown>, set: (key: string, value: unknown) => Promise<unknown> } | null,
 *   configGateway?: { call: (op: string, params?: Record<string, unknown>) => Promise<unknown> } | null,
 *   relaunch?: (() => Promise<unknown>) | null,
 *   platform?: string,
 * }} [deps]
 */
export function mountDependenciesSettings(root, deps = {}) {
  if (!root || !("append" in root)) return { reload() {}, destroy() {} };
  const host = /** @type {HTMLElement} */ (root);
  const page = /** @type {HTMLElement} */ (el("div", { class: "settings-stack" }));
  host.append(
    ...settingsPage(t("settings.dependencies.title"), "settings.dependencies.title", [page]),
  );
  let destroyed = false;
  let attempt = 0;
  /** @type {Map<string, { destroy?: () => void }>} */
  const jobs = new Map();

  function stopJobs() {
    for (const handle of jobs.values()) handle.destroy?.();
    jobs.clear();
  }

  async function load() {
    if (destroyed) return;
    page.replaceChildren(el("p", { text: t("settings.dependencies.testing") }));
    const report = await deps.control?.checkDependencies?.({ quick: false });
    if (destroyed) return;
    /** @type {Record<string, { state?: string }>} */
    const runningJobs = {};
    for (const kind of ["node", "browser", "surf"]) {
      const status = await deps.control?.dependencyInstallStatus?.(kind);
      if (status && typeof status === "object") {
        runningJobs[kind] = /** @type {{ state?: string }} */ (status);
      }
    }
    if (destroyed) return;
    stopJobs();
    renderDependencies(page, report, {
      ...deps,
      runningJobs,
      onJob(kind, slot) {
        jobs.get(kind)?.destroy?.();
        jobs.set(
          kind,
          mountInstallJob(slot, {
            control: /** @type {never} */ (deps.control),
            kind,
            autostart: true,
            onDone: () => {
              void load();
            },
          }),
        );
      },
      onAttachJob(kind, handle) {
        jobs.set(kind, handle);
      },
      onReload: () => {
        void load();
      },
    });
  }

  function run() {
    Promise.resolve()
      .then(load)
      .catch(() => {
        if (!destroyed && attempt < 10) {
          attempt += 1;
          setTimeout(run, 1000);
        }
      });
  }
  return {
    reload() {
      attempt = 0;
      run();
    },
    destroy() {
      destroyed = true;
      stopJobs();
    },
  };
}

/**
 * @param {HTMLElement} page
 * @param {Record<string, any> | null | undefined} report
 * @param {{
 *   control?: any,
 *   configGateway?: { call: (op: string, params?: Record<string, unknown>) => Promise<unknown> } | null,
 *   preferences?: any,
 *   relaunch?: (() => Promise<unknown>) | null,
 *   platform?: string,
 *   onJob?: (kind: string, host: HTMLElement) => void,
 *   onReload?: () => void,
 *   runningJobs?: Record<string, { state?: string }>,
 *   onAttachJob?: (kind: string, handle: { destroy?: () => void }) => void,
 * }} [deps]
 */
export function renderDependencies(page, report, deps = {}) {
  const relaunch = deps.relaunch === undefined ? tauriRelaunch() : deps.relaunch;
  const pi = report?.pi || { state: "unknown" };
  const agent = report?.agentBrowser || { state: "unknown" };
  const npm = report?.npm || { state: "unknown" };
  const browser = report?.browser || { state: "unknown" };
  const surf = report?.surf || { state: "unknown" };
  const linux = (deps.platform || globalThis.navigator?.userAgent || "").includes("Linux");
  const header = el("div", { class: "settings-intro" }, [
    el("p", { class: "settings-help", text: t("settings.dependencies.intro") }),
    el("div", { class: "settings-intro-actions" }, [
      actionButton("settings.dependencies.testAll", { onClick: () => deps.onReload?.() }),
      actionButton("settings.dependencies.showStartNote", {
        onClick: () => document.dispatchEvent(new CustomEvent("spopi-show-first-run")),
      }),
    ]),
  ]);
  /** @type {Node[]} */
  const builtin = [
    el("p", { class: "settings-help", text: t("settings.dependencies.builtIn.help") }),
    dependencyRow({ labelKey: "settings.dependencies.builtIn.pi", status: pi }),
    dependencyRow({
      labelKey: "settings.dependencies.builtIn.agentBrowser",
      status: agent,
    }),
  ];
  if (pi.state !== "ok" || agent.state !== "ok") {
    builtin.push(
      el("p", { class: "dependencies-warn", text: t("settings.dependencies.builtIn.repair") }),
    );
  }
  const npmRow = dependencyRow({
    labelKey: "settings.dependencies.npm.label",
    descriptionKey: "settings.dependencies.npm.help",
    status: npm,
    actions: npmActions(npm),
  });
  const both =
    agent.enabled !== false && surf.enabled
      ? el("p", { class: "settings-help", text: t("settings.dependencies.browser.both") })
      : null;
  page.replaceChildren(
    header,
    settingsCard(
      t("settings.dependencies.builtIn.title"),
      "settings.dependencies.builtIn.title",
      builtin,
    ),
    settingsCard(t("settings.dependencies.npm.title"), "settings.dependencies.npm.title", [npmRow]),
    settingsCard(t("settings.dependencies.browser.title"), "settings.dependencies.browser.title", [
      agentBrowserSwitch({
        preferences: deps.preferences,
        relaunch,
      }),
      browserRow(browser, linux),
      surfCard({
        report: surf,
        npmOk: npm.state === "ok",
        control: deps.control,
        configGateway: deps.configGateway,
        relaunch,
        onReload: deps.onReload,
        onJob: deps.onJob,
        jobRunning: deps.runningJobs?.surf?.state === "running",
      }),
      both,
    ]),
  );
  resumeRunningJobs(page, deps);

  /**
   * @param {{ state?: string, install?: { oneClick?: boolean, link?: string } }} status
   */
  function npmActions(status) {
    if (status.state === "ok" || status.state === "unknown") return [];
    const install = status.install || {};
    if (install.oneClick) {
      const slot = /** @type {HTMLElement} */ (el("span", { class: "dependencies-job-slot" }));
      slot.dataset.dependencyJob = "node";
      slot.append(
        actionButton("settings.dependencies.npm.install", {
          onClick: () => deps.onJob?.("node", slot),
        }),
      );
      return [slot];
    }
    const nodes = [];
    if (install.link) {
      nodes.push(
        actionButton("settings.dependencies.npm.download", {
          onClick: () => {
            void deps.control?.openExternal?.(install.link);
          },
        }),
      );
    }
    return nodes;
  }

  /**
   * @param {{ state?: string, path?: string, detail?: string, noSandbox?: boolean }} status
   * @param {boolean} isLinux
   */
  function browserRow(status, isLinux) {
    /** @type {Node[]} */
    const actions = [];
    if (status.state === "ok" && status.noSandbox) {
      const note = /** @type {HTMLElement} */ (
        el("span", {
          class: "dependencies-detail",
          text: t("settings.dependencies.browser.chrome.noSandbox"),
        })
      );
      note.dataset.i18n = "settings.dependencies.browser.chrome.noSandbox";
      actions.push(note);
    }
    if (status.state === "missing") {
      const slot = /** @type {HTMLElement} */ (el("span", { class: "dependencies-job-slot" }));
      slot.dataset.dependencyJob = "browser";
      slot.append(
        actionButton("settings.dependencies.browser.chrome.download", {
          onClick: () => deps.onJob?.("browser", slot),
        }),
      );
      actions.push(slot);
      actions.push(
        el("span", {
          class: "dependencies-detail",
          text: t("settings.dependencies.browser.chrome.downloadHelp"),
        }),
      );
      if (isLinux) {
        const command = "agent-browser install --with-deps";
        actions.push(
          el("span", {
            class: "dependencies-detail",
            text: t("settings.dependencies.browser.chrome.linuxDeps"),
          }),
          el("code", { class: "dependencies-path", text: command }),
          actionButton("settings.dependencies.copy", {
            onClick: () => {
              void copyText(command);
            },
          }),
        );
      }
    }
    const shown = {
      ...status,
      detail:
        status.state === "ok" && status.path
          ? t("settings.dependencies.browser.chrome.found", { path: status.path })
          : status.detail,
    };
    return dependencyRow({
      labelKey: "settings.dependencies.browser.chrome.label",
      status: shown,
      actions,
    });
  }
}

/**
 * A job started before this page was opened keeps its last lines and Cancel button.
 * @param {ParentNode} page
 * @param {{
 *   control?: any,
 *   runningJobs?: Record<string, { state?: string }>,
 *   onReload?: () => void,
 *   onAttachJob?: (kind: string, handle: { destroy?: () => void }) => void,
 * }} deps
 */
function resumeRunningJobs(page, deps) {
  if (!deps.control || !deps.runningJobs) return;
  for (const kind of ["node", "browser", "surf"]) {
    if (deps.runningJobs[kind]?.state !== "running") continue;
    const slot = page.querySelector(`[data-dependency-job="${kind}"]`);
    if (!slot || !("replaceChildren" in slot)) continue;
    const handle = mountInstallJob(/** @type {HTMLElement} */ (slot), {
      control: deps.control,
      kind,
      autostart: false,
      onDone: () => deps.onReload?.(),
    });
    deps.onAttachJob?.(kind, handle);
  }
}
