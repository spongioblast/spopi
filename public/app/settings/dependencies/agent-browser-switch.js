// ABOUTME: Settings switch for the bundled development browser.
// ABOUTME: Unset means on. A change is saved at once and needs an app restart.

import { t } from "../../i18n/i18n.js";
import { el } from "../../ui/dom.js";
import { row, toggle } from "../../ui/settings-controls.js";
import { actionButton } from "./dependency-row.js";

const AGENT_BROWSER_KEY = "ui.agentBrowser.enabled";

/**
 * @param {unknown} stored
 */
function agentBrowserEnabled(stored) {
  return stored !== false;
}

/**
 * @param {{
 *   preferences?: { get: (key: string) => Promise<unknown>, set: (key: string, value: unknown) => Promise<unknown> } | null,
 *   relaunch?: (() => Promise<unknown>) | null,
 *   onChange?: (enabled: boolean) => void,
 * }} [options]
 */
export function agentBrowserSwitch({ preferences, relaunch, onChange } = {}) {
  const note = /** @type {HTMLElement} */ (
    el("span", { class: "dependencies-restart", text: t("settings.dependencies.restart") })
  );
  note.dataset.i18n = "settings.dependencies.restart";
  note.hidden = true;
  const restart = actionButton("settings.dependencies.restartNow", {
    onClick: () => {
      void relaunch?.();
    },
  });
  restart.hidden = true;
  const control = toggle({
    id: "toggle-agent-browser",
    checked: true,
    label: t("settings.dependencies.browser.agentBrowser.label"),
    onChange(next) {
      void preferences?.set(AGENT_BROWSER_KEY, next).catch(() => {});
      note.hidden = false;
      restart.hidden = !relaunch;
      onChange?.(next);
    },
  });
  void preferences
    ?.get(AGENT_BROWSER_KEY)
    .then((stored) => {
      const on = agentBrowserEnabled(stored);
      control.classList.toggle("on", on);
      control.setAttribute("aria-checked", on ? "true" : "false");
    })
    .catch(() => {});
  const actions = el("span", { class: "dependencies-actions" }, [control, note, restart]);
  return row({
    label: t("settings.dependencies.browser.agentBrowser.label"),
    labelKey: "settings.dependencies.browser.agentBrowser.label",
    description: t("settings.dependencies.browser.agentBrowser.help"),
    descriptionKey: "settings.dependencies.browser.agentBrowser.help",
    control: actions,
  });
}
