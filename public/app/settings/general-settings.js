// ABOUTME: Settings → General lays out the language, projects, guard, agent, and updates sections.
// ABOUTME: Each control mounts from its own module; this page composes them and owns the version rows.

import { t, translateSubtree } from "../i18n/i18n.js";
import { el } from "../ui/dom.js";
import { row, settingsCard, settingsPage } from "../ui/settings-controls.js";
import { createGeneralToggles } from "./general-toggles.js";
import { gitIdentityRow } from "./git-identity-setting.js";
import { guardSettingsSection } from "./guard-settings.js";
import { languageSelectControl, mountLanguageSelector } from "./language-selector.js";
import { projectsFolderRow } from "./projects-folder-setting.js";
import { queueModeControls } from "./queue-modes.js";
import { idleTimeoutField, mountRuntimeIdleTimeout } from "./runtime-idle-timeout.js";
import { mountThinkingEffortControl, thinkingEffortControl } from "./thinking-effort-control.js";

/**
 * @typedef {{
 *   ok?: boolean,
 *   error?: string,
 *   data?: Record<string, unknown>,
 * }} ConfigCallResult
 *
 * @typedef {{
 *   call: (
 *     op: string,
 *     params?: Record<string, unknown>,
 *     options?: Record<string, unknown>
 *   ) => Promise<ConfigCallResult>,
 * }} ConfigGatewayLike
 *
 * @typedef {{
 *   get: (key: string) => Promise<unknown>,
 *   set: (key: string, value: unknown) => Promise<unknown>,
 * }} PreferencesLike
 *
 * @typedef {{
 *   request: (
 *     message: Record<string, unknown>,
 *     target: unknown,
 *     options?: Record<string, unknown>
 *   ) => Promise<unknown>,
 * }} RuntimeLike
 *
 * @typedef {{
 *   configGateway?: ConfigGatewayLike | null,
 *   onError?: ((error: unknown) => void) | null,
 *   preferences?: PreferencesLike | null,
 *   runtime?: RuntimeLike | null,
 *   getTarget?: (() => unknown) | null,
 *   onThinkingLevelChanged?: ((level: string, target: unknown) => void) | null,
 *   control?: import("./git-identity-setting.js").GitIdentityControl | null,
 *   getWorkspaceId?: (() => string | null | undefined) | null,
 * }} GeneralSettingsDeps
 *
 * @typedef {{
 *   piVersion: HTMLElement | null,
 *   appVersion: HTMLElement | null,
 *   updateStatus: HTMLElement | null,
 *   checkUpdates: HTMLElement | null,
 * }} GeneralSettingsRefs
 */

/**
 * @param {string} title
 * @param {string} i18n
 * @param {Array<Node | string | false | null | undefined>} children
 * @param {string} [id]
 * @returns {HTMLElement}
 */
function section(title, i18n, children, id) {
  return settingsCard(title, i18n, children, { id });
}

/**
 * @param {string} id
 * @param {string} text
 * @param {string | null | undefined} i18n
 * @param {boolean} loading
 * @returns {HTMLElement}
 */
function staticValue(id, text, i18n, loading) {
  const node = /** @type {HTMLElement} */ (
    el("span", {
      class: loading ? "settings-static-value ui-loading" : "settings-static-value",
      id,
      role: "status",
      text,
    })
  );
  node.setAttribute("aria-live", "polite");
  if (loading) node.setAttribute("aria-busy", "true");
  if (i18n) node.dataset.i18n = i18n;
  return node;
}

/**
 * @param {ParentNode | null | undefined} root
 * @param {GeneralSettingsDeps | null | undefined} deps
 */
export function mountGeneralSettings(root, deps) {
  if (!root) return { refresh() {}, reload() {}, destroy() {} };
  const switches = createGeneralToggles(deps);
  // The page mounts at startup, before the host connection is open, so a read made
  // then fails. Rows register their loaders: a failed load retries each second for a
  // while, and opening Settings runs every loader again.
  /** @type {Array<() => Promise<unknown> | undefined>} */
  const loaders = [];
  /** @param {() => Promise<unknown> | undefined} load */
  const run = (load, attempt = 0) => {
    Promise.resolve()
      .then(load)
      .catch(() => {
        if (attempt < 10) setTimeout(() => run(load, attempt + 1), 1000);
      });
  };
  /** @param {() => Promise<unknown> | undefined} load */
  const register = (load) => {
    loaders.push(load);
    run(load);
  };
  const languageSelect = languageSelectControl();
  const idle = idleTimeoutField();
  const checkUpdates = /** @type {HTMLElement} */ (
    el("button", {
      type: "button",
      class: "ui-button ui-button--secondary ui-button--sm",
      id: "btn-check-updates",
      text: "Check now",
    })
  );
  checkUpdates.dataset.i18n = "updater.checkNow";
  const updateRow = /** @type {HTMLElement} */ (
    row({
      label: "Updates",
      labelKey: "settings.updates",
      control: el("span", { class: "settings-update-controls" }, [
        staticValue("setting-update-status", "", "", false),
        checkUpdates,
      ]),
    })
  );
  updateRow.classList.add("settings-update-row");
  root.replaceChildren(
    ...settingsPage("General", "settings.general", [
      section("Language", "settings.language.title", [
        row({
          id: "setting-language",
          label: "Language",
          labelKey: "settings.language.title",
          description:
            "Choose the interface language. System Default follows your operating system.",
          descriptionKey: "settings.language.description",
          control: languageSelect,
        }),
      ]),
      section("Projects", "settings.projectsFolder.section", [
        projectsFolderRow({ preferences: deps?.preferences, register }),
        gitIdentityRow({
          control: deps?.control,
          getWorkspaceId: deps?.getWorkspaceId,
          register,
        }),
      ]),
      guardSettingsSection(deps, register),
      section("Agent", "settings.agent", [
        ...queueModeControls(deps),
        row({
          id: "setting-auto-compact",
          label: "Auto-compaction",
          labelKey: "settings.autoCompaction",
          control: switches.byId["toggle-auto-compact"],
        }),
        row({
          id: "setting-auto-retry",
          label: "Auto-retry",
          labelKey: "settings.autoRetry",
          control: switches.byId["toggle-auto-retry"],
        }),
        row({
          id: "setting-thinking",
          label: "Thinking effort",
          labelKey: "settings.thinkingEffort",
          description: "Reasoning depth",
          descriptionKey: "settings.reasoningDepth",
          control: thinkingEffortControl(),
        }),
        row({
          label: "Show thinking",
          labelKey: "settings.showThinking",
          control: switches.byId["toggle-show-thinking"],
        }),
        row({
          label: "Task completion notifications",
          labelKey: "settings.taskNotifications",
          description: "Show an operating system notification when a task finishes.",
          descriptionKey: "settings.taskNotificationsDescription",
          control: switches.byId["toggle-task-notifications"],
        }),
        row({
          id: "setting-runtime-idle-timeout",
          label: "Idle session timeout",
          labelKey: "settings.runtimeIdleTimeout",
          description:
            "Stop a background session's agent after this many minutes with no activity. 0 keeps them until the app exits.",
          descriptionKey: "settings.runtimeIdleTimeoutDescription",
          control: idle,
        }),
      ]),
      section(
        "Updates",
        "settings.updates",
        [
          row({
            id: "setting-pi-version",
            label: "Pi version",
            labelKey: "settings.piVersion",
            control: staticValue(
              "setting-pi-version-value",
              t("settings.config.loading"),
              "settings.config.loading",
              true,
            ),
          }),
          row({
            label: "SPOPI version",
            labelKey: "settings.spopiVersion",
            control: staticValue(
              "setting-app-version-value",
              t("settings.config.loading"),
              "settings.config.loading",
              true,
            ),
          }),
          updateRow,
        ],
        "setting-updater-section",
      ),
    ]),
  );
  translateSubtree(root);
  const language = root.isConnected ? mountLanguageSelector(root) : null;
  const thinking = root.isConnected
    ? mountThinkingEffortControl({
        ...(deps ?? {}),
        onRuntimeLevelChanged: deps?.onThinkingLevelChanged,
      })
    : null;
  if (root.isConnected) mountRuntimeIdleTimeout({ preferences: deps?.preferences });
  return {
    refresh() {
      translateSubtree(root);
    },
    reload() {
      for (const load of loaders) run(load);
    },
    destroy() {
      language?.destroy?.();
      thinking?.destroy?.();
      root.replaceChildren();
    },
    thinkingControl: thinking,
    getToggleState: switches.getToggleState,
    setToggleState: switches.setToggleState,
  };
}

/**
 * Elements this page creates. Callers use the refs instead of looking up ids.
 * @param {ParentNode | null | undefined} root
 * @returns {GeneralSettingsRefs}
 */
export function generalSettingsRefs(root) {
  return {
    piVersion: /** @type {HTMLElement | null} */ (
      root?.querySelector("#setting-pi-version-value") ?? null
    ),
    appVersion: /** @type {HTMLElement | null} */ (
      root?.querySelector("#setting-app-version-value") ?? null
    ),
    updateStatus: /** @type {HTMLElement | null} */ (
      root?.querySelector("#setting-update-status") ?? null
    ),
    checkUpdates: /** @type {HTMLElement | null} */ (
      root?.querySelector("#btn-check-updates") ?? null
    ),
  };
}
