// ABOUTME: Reads the CodeMirror selection and turns it into a chat context payload.
// ABOUTME: Ctrl+L (Mod-L) in the editor inserts the selection into the composer.

import { insertSelection } from "../composer/composer-actions.js";

/**
 * @typedef {{ view?: import("@codemirror/view").EditorView }} EditorLike
 *
 * @typedef {{
 *   path?: string,
 *   startLine?: number,
 *   endLine?: number,
 *   kind?: string,
 * }} ContextChipOptions
 *
 * @typedef {{
 *   path?: string,
 *   startLine?: number,
 *   endLine?: number,
 *   text?: string,
 *   instruction?: string,
 *   kind?: string,
 *   truncated?: boolean,
 * }} SelectionPromptOptions
 *
 * @typedef {{
 *   path?: string,
 *   instruction?: string,
 * }} SendSelectionOptions
 */

/**
 * @param {EditorLike | null | undefined} editor
 * @returns {{ startLine: number, endLine: number, text: string } | null}
 */
export function selectionFromEditor(editor) {
  const view = editor?.view;
  if (!view) return null;
  const range = view.state.selection.main;
  if (range.from === range.to) return null;
  const startLine = view.state.doc.lineAt(range.from).number;
  const endLine = view.state.doc.lineAt(range.to > range.from ? range.to - 1 : range.to).number;
  return {
    startLine,
    endLine,
    text: view.state.sliceDoc(range.from, range.to),
  };
}

/**
 * @param {ContextChipOptions} [options]
 * @returns {string}
 */
export function formatContextChip({ path = "", startLine, endLine, kind } = {}) {
  const name = String(path).split(/[\\/]/).pop() || "selection";
  if (kind === "terminal" || !startLine) return name;
  return startLine === endLine ? `${name}:${startLine}` : `${name}:${startLine}-${endLine}`;
}

/**
 * The composer @-mention for an editor selection: the file and its line range, which Pi
 * reads itself. A path the plain @-token cannot carry is quoted, as `@` completion does.
 * @param {{ path?: string, startLine?: number, endLine?: number }} selection
 * @returns {string}
 */
export function formatSelectionMention({ path = "", startLine, endLine } = {}) {
  const target = /^[A-Za-z0-9_./\\-]+$/.test(path) ? path : `"${path}"`;
  if (!startLine) return `@${target}`;
  const range = !endLine || endLine === startLine ? `${startLine}` : `${startLine}-${endLine}`;
  return `@${target}:${range}`;
}

/**
 * @param {SelectionPromptOptions} [options]
 * @returns {string}
 */
export function formatSelectionPrompt({
  path,
  startLine,
  endLine,
  text,
  instruction,
  kind,
  truncated,
} = {}) {
  const body = typeof text === "string" ? text : "";
  if (kind === "terminal") {
    const label = formatContextChip({ path, kind });
    const note = truncated ? "… (truncated)\n" : "";
    return `${note}${label}\n\`\`\`text\n${body}\n\`\`\``;
  }
  const chip = formatContextChip({ path, startLine, endLine });
  const lead = instruction ?? "Look at this selection.";
  const prefix = lead ? `${lead}\n\n` : "";
  return `${prefix}${chip}\n\`\`\`\n${body}\n\`\`\``;
}

/**
 * @param {Record<string, unknown>} detail
 * @returns {boolean}
 */
export function dispatchSelectionToChat(detail) {
  return insertSelection(detail);
}

/**
 * @param {EditorLike | null | undefined} editor
 * @param {SendSelectionOptions} [options]
 * @returns {boolean}
 */
export function sendEditorSelectionToChat(editor, { path, instruction } = {}) {
  const selection = selectionFromEditor(editor);
  if (!selection) return false;
  return dispatchSelectionToChat({
    path: path || "",
    instruction,
    ...selection,
  });
}
