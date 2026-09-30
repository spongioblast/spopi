// ABOUTME: Guided Surf setup: install, load the extension, connect, and test.
// ABOUTME: The on/off switch is Pi's package state, shared with the terminal.

import { t } from "../../i18n/i18n.js";
import { copyText } from "../../ui/clipboard.js";
import { el } from "../../ui/dom.js";
import { row, select, toggle } from "../../ui/settings-controls.js";
import { actionButton, dependencyRow } from "./dependency-row.js";

const EXTENSION_ID = /^[a-p]{32}$/;

/**
 * @param {{
 *   report?: { state?: string, installed?: boolean, enabled?: boolean, detail?: string, browsers?: Array<{ id: string, name: string, snap?: boolean }> },
 *   npmOk?: boolean,
 *   control?: {
 *     startDependencyInstall?: (kind: string) => Promise<unknown>,
 *     dependencyInstallStatus?: (kind: string) => Promise<unknown>,
 *     cancelDependencyInstall?: (kind: string) => Promise<unknown>,
 *     surfExtensionPath?: () => Promise<string>,
 *     surfConnect?: (id: string, browser: string) => Promise<{ ok?: boolean, lines?: string[] }>,
 *     openBrowserExtensions?: (browser: string) => Promise<unknown>,
 *   },
 *   configGateway?: { call: (op: string, params?: Record<string, unknown>) => Promise<unknown> } | null,
 *   relaunch?: (() => Promise<unknown>) | null,
 *   onReload?: () => void,
 *   onJob?: (kind: string, host: HTMLElement) => void,
 *   jobRunning?: boolean,
 * }} [options]
 */
export function surfCard({
  report = {},
  npmOk = true,
  control,
  configGateway,
  relaunch,
  onReload,
  onJob,
  jobRunning = false,
} = {}) {
  const browsers = Array.isArray(report.browsers) ? report.browsers : [];
  const block = /** @type {HTMLElement} */ (el("div", { class: "dependencies-surf" }));
  const status = dependencyRow({
    labelKey: "settings.dependencies.browser.surf.label",
    descriptionKey: "settings.dependencies.browser.surf.help",
    status: report,
  });
  block.append(status);
  if (browsers.some((browser) => browser.snap)) {
    block.append(
      el("p", { class: "dependencies-warn", text: t("settings.dependencies.browser.surf.snap") }),
    );
  }
  const steps = /** @type {HTMLElement} */ (el("ol", { class: "dependencies-steps" }));
  steps.hidden = !report.installed && !jobRunning;
  if (report.state !== "unknown" && !report.installed) {
    const setup = actionButton("settings.dependencies.browser.surf.setup", {
      onClick: () => {
        steps.hidden = false;
      },
    });
    block.append(setup);
  }
  if (!report.installed) {
    steps.append(step("settings.dependencies.browser.surf.step1", installActions()));
  }
  steps.append(
    step("settings.dependencies.browser.surf.step2", extensionActions(browsers)),
    step("settings.dependencies.browser.surf.step3", connectActions(browsers)),
    step("settings.dependencies.browser.surf.step4", [
      actionButton("settings.dependencies.browser.surf.test", { onClick: () => onReload?.() }),
    ]),
  );
  if (report.installed) {
    block.append(installedSwitch(), steps);
  } else {
    block.append(steps);
  }
  return block;

  function installActions() {
    const host = /** @type {HTMLElement} */ (el("span", { class: "dependencies-actions" }));
    host.dataset.dependencyJob = "surf";
    const button = actionButton("settings.dependencies.browser.surf.install", {
      disabled: !npmOk,
      onClick: () => onJob?.("surf", host),
    });
    host.append(button);
    if (!npmOk) {
      host.append(
        el("span", {
          class: "dependencies-detail",
          text: t("settings.dependencies.browser.surf.needsNpm"),
        }),
      );
    }
    return [host];
  }

  /**
   * @param {Array<{ id: string, name: string }>} found
   */
  function extensionActions(found) {
    const nodes = [];
    if (found.length === 0) {
      nodes.push(
        el("p", {
          class: "dependencies-warn",
          text: t("settings.dependencies.browser.surf.noBrowser"),
        }),
      );
    }
    for (const browser of found) {
      const open = actionButton("settings.dependencies.browser.surf.openExtensions", {
        disabled: found.length === 0,
        onClick: () => {
          void control?.openBrowserExtensions?.(browser.id);
        },
      });
      open.textContent = t("settings.dependencies.browser.surf.openExtensions", {
        browser: browser.name,
      });
      delete open.dataset.i18n;
      nodes.push(open);
    }
    const path = el("code", { class: "dependencies-path", text: "" });
    const copy = actionButton("settings.dependencies.copy", {
      onClick: () => {
        void copyText(path.textContent || "");
      },
    });
    copy.disabled = true;
    if (report.installed) void loadPath();
    nodes.push(path, copy);
    return nodes;

    async function loadPath() {
      try {
        const folder = await control?.surfExtensionPath?.();
        if (!folder) return;
        path.textContent = folder;
        copy.disabled = false;
      } catch {
        path.textContent = "";
      }
    }
  }

  /**
   * @param {Array<{ id: string, name: string }>} found
   */
  function connectActions(found) {
    const input = /** @type {HTMLInputElement} */ (
      el("input", {
        class: "ui-input",
        type: "text",
        "aria-label": t("settings.dependencies.browser.surf.extensionId"),
      })
    );
    input.dataset.i18nAriaLabel = "settings.dependencies.browser.surf.extensionId";
    const error = /** @type {HTMLElement} */ (
      el("span", {
        class: "dependencies-warn",
        text: t("settings.dependencies.browser.surf.invalidId"),
      })
    );
    error.hidden = true;
    const browserSelect =
      found.length > 1
        ? select({
            id: "dependencies-surf-browser",
            label: t("settings.dependencies.browser.surf.label"),
            options: found.map((browser) => ({ value: browser.id, label: browser.name })),
            value: found[0]?.id,
          })
        : null;
    const output = /** @type {HTMLElement} */ (el("p", { class: "dependencies-job-line" }));
    output.hidden = true;
    const connect = actionButton(
      report.installed
        ? "settings.dependencies.browser.surf.connectAgain"
        : "settings.dependencies.browser.surf.connect",
      {
        disabled: found.length === 0,
        onClick: () => {
          const id = input.value.trim();
          error.hidden = EXTENSION_ID.test(id);
          if (!EXTENSION_ID.test(id)) return;
          const browser = browserSelect?.value || found[0]?.id || "";
          void control?.surfConnect?.(id, browser).then((result) => {
            output.hidden = Boolean(result?.ok);
            output.textContent = (result?.lines || []).join("\n");
            if (result?.ok) onReload?.();
          });
        },
      },
    );
    return [input, browserSelect, error, connect, output].filter(Boolean);
  }

  function installedSwitch() {
    const note = /** @type {HTMLElement} */ (
      el("span", { class: "dependencies-restart", text: t("settings.dependencies.restart") })
    );
    note.hidden = true;
    const restart = actionButton("settings.dependencies.restartNow", {
      onClick: () => {
        void relaunch?.();
      },
    });
    restart.hidden = true;
    const controlNode = toggle({
      id: "toggle-surf",
      checked: Boolean(report.enabled),
      label: t("settings.dependencies.browser.surf.label"),
      onChange(next) {
        void configGateway
          ?.call("set_package_enabled", {
            source: "npm:surf-cli",
            scope: "global",
            enabled: next,
          })
          .then((result) => {
            const payload = /** @type {{ ok?: boolean, data?: { reloaded?: boolean } } | null} */ (
              result
            );
            const reloaded = Boolean(payload?.ok && payload.data?.reloaded);
            note.hidden = reloaded;
            restart.hidden = reloaded || !relaunch;
          })
          .catch(() => {
            note.hidden = false;
            restart.hidden = !relaunch;
          });
      },
    });
    return row({
      label: t("settings.dependencies.browser.surf.label"),
      labelKey: "settings.dependencies.browser.surf.label",
      control: el("span", { class: "dependencies-actions" }, [controlNode, note, restart]),
    });
  }
}

/**
 * @param {string} key
 * @param {Array<Node | null | undefined | false>} children
 */
function step(key, children) {
  return el("li", {}, [el("p", { text: t(key) }), ...children.flat()]);
}
