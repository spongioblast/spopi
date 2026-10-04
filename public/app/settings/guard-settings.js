// ABOUTME: Settings → General section for the permission mode.
// ABOUTME: The choice writes an Ask, Auto-edit, or Full access recipe.

import { showGuardMode } from "../composer/guard-chip.js";
import { t } from "../i18n/i18n.js";
import { el } from "../ui/dom.js";
import { openPopover } from "../ui/popover.js";
import { enhanceSelect } from "../ui/select-menu.js";
import { row, select, settingsCard } from "../ui/settings-controls.js";
import { containerHelpBody } from "./container-help.js";
import { liveDebugRow } from "./live-debug-setting.js";

/**
 * @typedef {import("./general-settings.js").GeneralSettingsDeps & {
 *   openExternal?: ((url: string) => unknown) | null,
 *   control?: { openExternal?: ((url: string) => unknown) | null } | null,
 * }} GuardSettingsDeps
 */

/**
 * @param {GuardSettingsDeps | null | undefined} deps
 * @param {HTMLSelectElement} mode
 */
async function save(deps, mode) {
  const result = await deps?.configGateway?.call?.("set_permission_mode", { mode: mode.value });
  showGuardMode(result?.data?.mode);
}

/**
 * @param {GuardSettingsDeps | null | undefined} deps
 */
function hostOpenExternal(deps) {
  if (typeof deps?.openExternal === "function") return deps.openExternal;
  if (typeof deps?.control?.openExternal === "function") return deps.control.openExternal;
  return null;
}

/**
 * @param {GuardSettingsDeps | null | undefined} deps
 * @param {(load: () => Promise<unknown> | undefined) => void} [register] runs a loader now and again each time Settings opens
 */
export function guardSettingsSection(
  deps,
  register = (load) => {
    void load()?.catch(() => {});
  },
) {
  const mode = select({
    id: "settings-guard-mode",
    label: t("settings.guard.mode"),
    className: "ui-select",
    value: "ask",
    options: [
      { value: "ask", label: t("composer.guardAsk") },
      { value: "auto-edit", label: t("composer.guardAuto") },
      { value: "full", label: t("composer.guardFull") },
    ],
    onChange: () => {
      void save(deps, mode);
    },
  });
  mode.dataset.i18nAriaLabel = "settings.guard.mode";
  const help = /** @type {HTMLButtonElement} */ (
    el("button", {
      type: "button",
      class: "ui-button ui-button--secondary ui-button--sm settings-value-btn",
      id: "settings-guard-container",
      text: t("settings.guard.containerLink"),
      "aria-expanded": "false",
      "aria-haspopup": "dialog",
    })
  );
  help.dataset.i18n = "settings.guard.containerLink";
  help.addEventListener("click", () => {
    openPopover(help, {
      title: t("settings.guard.containerLink"),
      body: containerHelpBody({ openExternal: hostOpenExternal(deps) }),
    });
  });
  const repair = /** @type {HTMLButtonElement} */ (
    el("button", {
      type: "button",
      class: "ui-button ui-button--secondary ui-button--sm",
      id: "settings-guard-repair",
      text: t("settings.guard.repair"),
    })
  );
  repair.dataset.i18n = "settings.guard.repair";
  const repairRow = /** @type {HTMLElement} */ (
    row({
      id: "setting-guard-stale",
      label: t("settings.guard.stale"),
      labelKey: "settings.guard.stale",
      description: t("settings.guard.staleDescription"),
      descriptionKey: "settings.guard.staleDescription",
      control: repair,
    })
  );
  repairRow.hidden = true;
  repair.addEventListener("click", () => {
    repair.disabled = true;
    void save(deps, mode)
      .then(() => {
        repairRow.hidden = true;
      })
      .finally(() => {
        repair.disabled = false;
      });
  });
  const section = settingsCard(
    t("settings.guard.title"),
    "settings.guard.title",
    [
      row({
        id: "setting-guard-disclaimer",
        label:
          "The guard asks before risky actions. It is not a sandbox: Pi runs with your user's permissions. For real isolation, run Pi in a container or VM.",
        labelKey: "settings.guard.disclaimer",
        control: help,
      }),
      row({
        id: "setting-guard-mode",
        label: "Mode",
        labelKey: "settings.guard.mode",
        // pi-permission-system reads one recipe per agent folder, so there is no per-session mode.
        description:
          "One mode for every session and for Pi in a terminal. A change applies to the next tool call. A new install starts in Ask.",
        descriptionKey: "settings.guard.modeDescription",
        control: mode,
      }),
      repairRow,
      liveDebugRow({ preferences: deps?.preferences, register }),
    ],
    { id: "settings-guard" },
  );
  register(() =>
    deps?.configGateway?.call?.("get_permission_mode").then((result) => {
      const data = /** @type {{ mode?: unknown, stale?: unknown } | undefined} */ (result?.data);
      if (typeof data?.mode !== "string") return;
      repairRow.hidden = data.stale !== true;
      mode.value = data.mode;
      // Setting .value is not a DOM mutation, so the styled menu has to be told.
      enhanceSelect(mode)?.sync();
    }),
  );
  return section;
}
