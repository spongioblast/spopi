// ABOUTME: Settings → General section for the permission mode.
// ABOUTME: The choice writes an Ask, Auto-edit, or Full access recipe.

import { showGuardMode } from "../composer/guard-chip.js";
import { t } from "../i18n/i18n.js";
import { el } from "../ui/dom.js";
import { openPopover } from "../ui/popover.js";
import { enhanceSelect } from "../ui/select-menu.js";
import { row, sectionTitle, select } from "../ui/settings-controls.js";
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
    label: "Mode",
    className: "ui-select",
    value: "ask",
    options: [
      { value: "ask", label: "Ask" },
      { value: "auto-edit", label: "Auto-edit" },
      { value: "full", label: "Full access" },
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
  const section = el("section", { class: "settings-section", id: "settings-guard" }, [
    sectionTitle("Guard", { i18n: "settings.guard.title" }),
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
    liveDebugRow({ preferences: deps?.preferences, register }),
  ]);
  register(() =>
    deps?.configGateway?.call?.("get_permission_mode").then((result) => {
      const data = result?.data;
      if (typeof data?.mode !== "string") return;
      mode.value = data.mode;
      // Setting .value is not a DOM mutation, so the styled menu has to be told.
      enhanceSelect(mode)?.sync();
    }),
  );
  return section;
}
