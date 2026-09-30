// ABOUTME: Copies a terminal selection or tail into the composer as a fenced block.
// ABOUTME: Nothing is sent to Pi until the user submits the draft.

import { insertSelection } from "../composer/composer-actions.js";
import { formatSelectionPrompt } from "../editor/editor-context.js";

/**
 * @typedef {{
 *   terminal?: { getSelection?: () => string },
 *   plainText?: (maxLines: number) => string,
 *   serializeForCheckpoint?: (maxLines: number) => string,
 * }} TerminalContextTab
 *
 * @typedef {{
 *   maxLines?: number,
 *   maxChars?: number,
 * }} TerminalTextForChatOptions
 *
 * @typedef {{
 *   text: string,
 *   truncated: boolean,
 *   source: string,
 * }} CappedTerminalText
 *
 * @typedef {{
 *   label?: string,
 *   text?: string,
 *   truncated?: boolean,
 * }} TerminalPromptOptions
 */

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const CONTROL_PATTERN = new RegExp(
  [
    `${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`,
    `${ESC}\\[[0-?]*[ -/]*[@-~]`,
    `${ESC}[@-Z\\\\-_]`,
  ].join("|"),
  "g",
);

/**
 * Colors, cursor moves, mode switches and window titles.
 * @param {string} text
 * @returns {string}
 */
function stripTerminalControls(text) {
  return String(text ?? "").replace(CONTROL_PATTERN, "");
}

/**
 * @param {TerminalContextTab | null | undefined} tab
 * @param {TerminalTextForChatOptions} [options]
 * @returns {CappedTerminalText}
 */
export function terminalTextForChat(tab, { maxLines = 200, maxChars = 12000 } = {}) {
  const selected = String(tab?.terminal?.getSelection?.() || "");
  if (selected.trim()) {
    return capText(stripTerminalControls(selected).trimEnd(), maxChars, "selection");
  }
  const plain = tab?.plainText?.(maxLines);
  if (typeof plain === "string") return capText(plain, maxChars, "tail");
  const serialized = tab?.serializeForCheckpoint?.(maxLines) || "";
  const lines = stripTerminalControls(serialized).replace(/\n+$/, "").split("\n");
  return capText(lines.slice(-maxLines).join("\n"), maxChars, "tail");
}

/**
 * @param {string} text
 * @param {number} maxChars
 * @param {string} source
 * @returns {CappedTerminalText}
 */
function capText(text, maxChars, source) {
  if (text.length <= maxChars) return { text, truncated: false, source };
  return { text: text.slice(-maxChars), truncated: true, source };
}

/**
 * @param {TerminalPromptOptions} [options]
 * @returns {string}
 */
export function formatTerminalPrompt({ label, text, truncated } = {}) {
  return formatSelectionPrompt({ path: label, text, kind: "terminal", truncated, instruction: "" });
}

/**
 * @param {TerminalPromptOptions} [options]
 * @returns {boolean}
 */
export function dispatchTerminalToChat({ label, text, truncated } = {}) {
  return insertSelection({
    path: label,
    text,
    kind: "terminal",
    truncated: Boolean(truncated),
  });
}
