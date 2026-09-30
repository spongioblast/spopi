// ABOUTME: Settings → General row for the folder that holds chats without a project.
// ABOUTME: Empty means `<home>/SPOPI`; the host resolves that per OS user at startup.

import { t } from "../i18n/i18n.js";
import { el } from "../ui/dom.js";
import { row } from "../ui/settings-controls.js";

export const PROJECTS_FOLDER_KEY = "ui.projectsFolder";

/**
 * @typedef {(cmd: string, args?: Record<string, unknown>) => Promise<unknown>} TauriInvoke
 * @typedef {{
 *   get: (key: string) => Promise<unknown>,
 *   set: (key: string, value: unknown) => Promise<unknown>,
 * }} PreferencesLike
 */

/** The host ignores relative paths, so they are refused here instead. */
/** @param {string} value */
export function isAbsoluteFolder(value) {
  return /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(value);
}

/** @returns {TauriInvoke | null} */
function tauriInvoke() {
  const g = /** @type {{ __TAURI__?: { core?: { invoke?: TauriInvoke } } }} */ (globalThis);
  return g.__TAURI__?.core?.invoke ?? null;
}

/**
 * @param {{
 *   preferences?: PreferencesLike | null,
 *   invoke?: TauriInvoke | null,
 *   register?: (load: () => Promise<unknown> | undefined) => void,
 * }} [options]
 * @returns {HTMLElement}
 */
export function projectsFolderRow({
  preferences,
  invoke = tauriInvoke(),
  register = (load) => {
    void load()?.catch(() => {});
  },
} = {}) {
  const input = /** @type {HTMLInputElement} */ (
    el("input", {
      type: "text",
      class: "ui-input settings-projects-folder",
      id: "settings-projects-folder",
      spellcheck: "false",
      autocomplete: "off",
      placeholder: t("settings.projectsFolder.placeholder"),
      "aria-label": "Projects folder",
    })
  );
  input.dataset.i18nPh = "settings.projectsFolder.placeholder";
  input.dataset.i18nAriaLabel = "settings.projectsFolder.title";
  const choose = /** @type {HTMLButtonElement} */ (
    el("button", {
      type: "button",
      class: "ui-button ui-button--secondary settings-value-btn",
      text: "Choose…",
    })
  );
  choose.dataset.i18n = "settings.projectsFolder.choose";
  choose.hidden = !invoke;
  const error = /** @type {HTMLElement} */ (
    el("span", { class: "settings-projects-folder-error", role: "alert" })
  );
  error.hidden = true;

  /** @param {string} value */
  const save = (value) => {
    const next = value.trim();
    if (next && !isAbsoluteFolder(next)) {
      error.textContent = t("settings.projectsFolder.notAbsolute");
      error.hidden = false;
      return;
    }
    error.hidden = true;
    input.value = next;
    preferences?.set(PROJECTS_FOLDER_KEY, next).catch(() => {});
  };

  input.addEventListener("change", () => save(input.value));
  choose.addEventListener("click", async () => {
    if (!invoke) return;
    choose.disabled = true;
    try {
      const picked = await invoke("plugin:dialog|open", {
        options: { directory: true, defaultPath: input.value.trim() || undefined },
      });
      if (typeof picked === "string" && picked) save(picked);
    } catch (cause) {
      console.error("[Settings] folder picker failed:", cause);
    } finally {
      choose.disabled = false;
    }
  });
  register(() =>
    preferences?.get(PROJECTS_FOLDER_KEY).then((value) => {
      if (typeof value === "string" && document.activeElement !== input) input.value = value;
    }),
  );

  return /** @type {HTMLElement} */ (
    row({
      id: "setting-projects-folder",
      label: "Projects folder",
      labelKey: "settings.projectsFolder.title",
      description:
        "A chat that starts without a project gets its own dated folder here. Leave empty for SPOPI in your home folder.",
      descriptionKey: "settings.projectsFolder.description",
      control: el("span", { class: "settings-projects-folder-control" }, [input, choose, error]),
    })
  );
}
