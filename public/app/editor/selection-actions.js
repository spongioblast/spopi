// ABOUTME: Edit and Ask Pi buttons that float beside a non-empty editor selection.
// ABOUTME: They run the same actions as Mod+K and Mod+L; the editor wires the callbacks.

import { StateField } from "@codemirror/state";
import { showTooltip } from "@codemirror/view";
import { formatChord } from "../ui/keybindings.js";

/**
 * @typedef {{
 *   onEdit: () => unknown,
 *   onAsk: () => unknown,
 *   t: (key: string) => string,
 * }} SelectionActionsOptions
 */

/**
 * @param {string} label
 * @param {string} title
 * @param {() => unknown} run
 */
function actionButton(label, title, run) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ui-button ui-button--secondary ui-button--sm";
  button.textContent = label;
  button.title = title;
  // Keeps the editor's selection; a normal mousedown would move it to the click point.
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", () => {
    run();
  });
  return button;
}

/**
 * @param {SelectionActionsOptions} options
 * @returns {import("@codemirror/state").Extension}
 */
export function selectionActions({ onEdit, onAsk, t }) {
  const bar = () => {
    const dom = document.createElement("div");
    dom.className = "spopi-selection-actions";
    dom.append(
      actionButton(
        t("editor.inlineEditRun"),
        `${t("keybindings.inlineEdit")} (${formatChord("Mod+K")})`,
        onEdit,
      ),
      actionButton(
        t("editor.selectionAsk"),
        `${t("keybindings.selection")} (${formatChord("Mod+L")})`,
        onAsk,
      ),
    );
    return { dom };
  };
  /** @param {import("@codemirror/state").EditorState} state */
  const tooltipFor = (state) => {
    const range = state.selection.main;
    if (range.empty) return null;
    // Below the selection's end: above its start would sit under the tab bar on line 1.
    return { pos: range.to, above: false, arrow: false, create: bar };
  };
  return StateField.define({
    create: tooltipFor,
    update: (value, tr) => (tr.docChanged || tr.selection ? tooltipFor(tr.state) : value),
    provide: (field) => showTooltip.from(field),
  });
}
