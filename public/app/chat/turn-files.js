// ABOUTME: Files one prompt wrote or edited, from rebuilt history or from the live turns.
// ABOUTME: Counts are line estimates for the Review card; the diff text comes from the host.

/**
 * @typedef {{
 *   role?: string,
 *   content?: unknown,
 *   toolCallId?: string,
 *   isError?: boolean,
 * }} TurnFileMessage
 */

/** @param {unknown} text */
function lineCount(text) {
  return typeof text === "string" ? text.split("\n").filter((line) => line.length > 0).length : 0;
}

/**
 * Line estimate for one write or edit call: a write adds its content, an edit adds its
 * `newText` lines and removes its `oldText` lines (`edits[]`, or the single-edit form).
 * @param {"write" | "edit"} name
 * @param {Record<string, unknown>} args
 * @returns {{ add: number, del: number }}
 */
export function toolLineCounts(name, args) {
  if (name === "write") return { add: lineCount(args.content), del: 0 };
  /** @type {{ oldText?: unknown, newText?: unknown }[]} */
  const edits = Array.isArray(args.edits) ? args.edits : [args];
  return {
    add: edits.reduce((sum, edit) => sum + lineCount(edit?.newText), 0),
    del: edits.reduce((sum, edit) => sum + lineCount(edit?.oldText), 0),
  };
}

/**
 * @param {TurnFileMessage[]} messages
 * @param {number} start
 * @param {number} end
 * @param {Map<string | undefined, TurnFileMessage>} toolResults
 * @returns {{ path: string, add: number, del: number }[]}
 */
export function changedFilesInRange(messages, start, end, toolResults) {
  /** @type {Map<string, { path: string, add: number, del: number }>} */
  const files = new Map();
  for (let i = start; i < end; i++) {
    const content = messages[i]?.role === "assistant" ? messages[i].content : null;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type !== "toolCall" || (block.name !== "write" && block.name !== "edit")) continue;
      if (toolResults.get(block.id)?.isError) continue;
      const args = block.arguments || {};
      if (typeof args.path !== "string" || !args.path) continue;
      const { add, del } = toolLineCounts(block.name, args);
      const entry = files.get(args.path) || { path: args.path, add: 0, del: 0 };
      entry.add += add;
      entry.del += del;
      files.set(args.path, entry);
    }
  }
  return [...files.values()];
}

/**
 * Pi opens a turn per model step, so one prompt's files are spread over several turns.
 * @param {{ files?: { path: string, add: number, del: number }[] }[]} turns
 * @returns {{ path: string, add: number, del: number }[]}
 */
export function mergeTurnFiles(turns) {
  /** @type {Map<string, { path: string, add: number, del: number }>} */
  const files = new Map();
  for (const file of turns.flatMap((turn) => turn.files || [])) {
    const entry = files.get(file.path) || { path: file.path, add: 0, del: 0 };
    entry.add += file.add;
    entry.del += file.del;
    files.set(file.path, entry);
  }
  return [...files.values()];
}
