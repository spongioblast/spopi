// ABOUTME: Lists registered shortcuts in one dialog.
// ABOUTME: Opened by ? outside a field, or by /hotkeys.

import { t } from "../i18n/i18n.js";
import { openDialog } from "./dialog.js";
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
  if (!body.childElementCount) {
    const empty = document.createElement("p");
    empty.textContent = t("keybindings.empty");
    body.append(empty);
  }
  const container = document.getElementById("dialog-container");
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
