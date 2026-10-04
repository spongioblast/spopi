// ABOUTME: Lists registered shortcuts in one dialog.
// ABOUTME: Opened by ? outside a field, or by /hotkeys.

import { SPOPI_COMMANDS } from "../composer/slash-sources.js";
import { t } from "../i18n/i18n.js";
import { getDialogRoot, openDialog } from "./dialog.js";
import { appKeybindings, formatChord } from "./keybindings.js";

export function showKeybindingHelp() {
  const body = document.createElement("div");
  body.className = "keybinding-help";
  const seen = new Set();
  for (const binding of appKeybindings().list()) {
    if (!binding.keys) continue;
    if (seen.has(binding.labelKey)) continue;
    seen.add(binding.labelKey);
    const row = document.createElement("div");
    row.className = "keybinding-help-row";
    const label = document.createElement("span");
    label.textContent = t(binding.labelKey);
    const chord = document.createElement("kbd");
    chord.textContent = formatChord(binding.keys);
    row.append(label, chord);
    body.append(row);
  }
  const slashHeading = document.createElement("h3");
  slashHeading.className = "keybinding-help-heading";
  slashHeading.textContent = t("keybindings.slashCommands");
  body.append(slashHeading);
  for (const command of SPOPI_COMMANDS) {
    if (!command.name) continue;
    const row = document.createElement("div");
    row.className = "keybinding-help-row";
    const label = document.createElement("span");
    label.textContent = command.descriptionKey ? t(command.descriptionKey) : command.name;
    const chord = document.createElement("kbd");
    chord.textContent = `/${command.name}`;
    row.append(label, chord);
    body.append(row);
  }
  if (!body.childElementCount) {
    const empty = document.createElement("p");
    empty.textContent = t("keybindings.empty");
    body.append(empty);
  }
  const container = getDialogRoot();
  if (!container) return false;
  /** @type {{ close: () => void }} */
  let handle = { close() {} };
  handle = openDialog({
    container,
    title: t("keybindings.title"),
    body,
    closeOnBackdrop: true,
    actions: [{ label: t("keybindings.close"), onClick: () => handle.close() }],
  });
  return true;
}
