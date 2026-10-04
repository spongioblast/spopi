// ABOUTME: Dock + button profile picker: default-profile create, chevron and
// ABOUTME: right-click/long-press menu of host shell profiles.

import { t } from "../i18n/i18n.js";
import {
  loadAppearanceCookie,
  normalizeTerminalProfile,
  selectedShellProfile,
  shellProfileChoices,
} from "../settings/appearance-preferences.js";
import { openSettingsTab } from "../settings/settings-panel.js";
import { terminalSettingsRefs } from "../settings/terminal-settings.js";
import { registerContextMenuHost, showContextMenu } from "../ui/context-menu.js";

const PROFILE_LABEL_KEYS = Object.freeze({
  default: "terminal.profileDefault",
  "git-bash": "terminal.profileGitBash",
  powershell: "terminal.profilePowerShell",
  "command-prompt": "terminal.profileCommandPrompt",
});

const LONG_PRESS_MS = 450;
const CHEVRON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6"/></svg>';

export function defaultTerminalProfile() {
  return normalizeTerminalProfile(loadAppearanceCookie().terminalDefaultProfile);
}

function openDefaultShellSettings() {
  openSettingsTab("terminal");
  const row = terminalSettingsRefs(document).profileRow;
  if (row && "scrollIntoView" in row && typeof row.scrollIntoView === "function") {
    row.scrollIntoView({ block: "nearest" });
  }
  const selectBtn = row?.querySelector("button.ui-select");
  if (selectBtn && "focus" in selectBtn && typeof selectBtn.focus === "function") {
    selectBtn.focus();
  }
}

/**
 * @param {{ id?: string, label?: string } | null | undefined} profile
 */
function profileLabel(profile) {
  /** @type {Record<string, string>} */
  const keys = PROFILE_LABEL_KEYS;
  const id = profile?.id || "";
  return profile?.label || t(keys[id] || id || "");
}

/**
 * @param {object} [options]
 * @param {Element | null | undefined} [options.button]
 * @param {((profileId: string) => unknown) | null | undefined} [options.create]
 * @param {(() => Promise<unknown>) | null | undefined} [options.listProfiles]
 * @param {(() => boolean) | null | undefined} [options.locked]
 * @returns {() => void}
 */
export function mountTerminalProfileMenu({
  button,
  create,
  listProfiles,
  locked = () => false,
} = {}) {
  if (!button || !("closest" in button) || button.closest(".terminal-new-tab-group")) {
    return () => {};
  }

  const group = document.createElement("div");
  group.className = "terminal-new-tab-group";
  button.replaceWith(group);
  group.appendChild(button);

  const chevron = document.createElement("button");
  chevron.type = "button";
  chevron.className = "terminal-new-tab-menu";
  chevron.dataset.terminalNewTabMenu = "";
  chevron.dataset.dockAction =
    "dataset" in button
      ? /** @type {{ dockAction?: string }} */ (button.dataset).dockAction || ""
      : "";
  chevron.setAttribute("aria-label", t("terminal.newTabMenu"));
  chevron.title = t("terminal.newTabMenu");
  chevron.innerHTML = CHEVRON_SVG;
  group.appendChild(chevron);

  /** @type {ReturnType<typeof setTimeout> | 0} */
  let pressTimer = 0;
  const clearPress = () => {
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = 0;
  };

  /**
   * @param {Event} event
   */
  const openMenu = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    clearPress();
    if (typeof locked === "function" && locked()) return;
    const current = defaultTerminalProfile();
    /** @type {unknown[]} */
    let profiles = [];
    try {
      const listed = await listProfiles?.();
      if (listed && typeof listed === "object" && "profiles" in listed) {
        const fromHost = /** @type {{ profiles?: unknown }} */ (listed).profiles;
        profiles = Array.isArray(fromHost) ? fromHost : [];
      } else if (Array.isArray(listed)) {
        profiles = listed;
      } else {
        profiles = [];
      }
    } catch {
      profiles = [];
    }
    const choices = shellProfileChoices(Array.isArray(profiles) ? profiles : []);
    const selected = selectedShellProfile(current, profiles);
    // Each row opens a new terminal with that shell; the default is marked, not checked,
    // because clicking a row does not change the default.
    /** @type {{ separator?: boolean, label?: string, hint?: string, disabled?: boolean, action?: () => void }[]} */
    const items = choices.map((profile) => ({
      label: profileLabel(profile),
      hint: profile.id === selected ? t("terminal.defaultShellHint") : undefined,
      disabled: profile.available === false,
      action: () => create?.(profile.id),
    }));
    items.push({ separator: true });
    items.push({
      label: t("terminal.changeDefaultShell"),
      action: () => openDefaultShellSettings(),
    });
    showContextMenu({ event, items });
  };

  button.addEventListener("contextmenu", openMenu);
  chevron.addEventListener("click", openMenu);
  chevron.addEventListener("contextmenu", openMenu);
  registerContextMenuHost(button);
  registerContextMenuHost(chevron);
  button.addEventListener("pointerdown", (event) => {
    if (!("button" in event) || event.button !== 0) return;
    clearPress();
    pressTimer = setTimeout(() => openMenu(event), LONG_PRESS_MS);
  });
  button.addEventListener("pointerup", clearPress);
  button.addEventListener("pointerleave", clearPress);
  button.addEventListener("pointercancel", clearPress);

  return () => {
    clearPress();
    chevron.remove();
    group.replaceWith(button);
  };
}
