// ABOUTME: Builds a numbered unified diff with context, folded gaps, and stable hunk keys.
// ABOUTME: Review only reads it; files are never patched from here.

import { computeHunks, diffTooLarge } from "../merge-view.js";

const CONTEXT = 3;

/**
 * @param {string} text
 */
export function splitText(text) {
  const raw = String(text ?? "");
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const normalized = raw.replace(/\r\n/g, "\n");
  const finalNewline = normalized.endsWith("\n");
  const lines = normalized.split("\n");
  if (finalNewline) lines.pop();
  return { lines, eol, finalNewline };
}

/**
 * @param {string} text
 */
function fnv(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

/**
 * @param {string} before
 * @param {string} after
 * @param {{ context?: number }} [options]
 */
export function buildDiff(before, after, { context = CONTEXT } = {}) {
  if (diffTooLarge(before, after)) {
    return { add: 0, del: 0, tooLarge: true, hunks: [], gaps: [] };
  }
  const oldLines = splitText(before).lines;
  const newLines = splitText(after).lines;
  const hunks = computeHunks(oldLines.join("\n"), newLines.join("\n"));
  /** @type {Array<{ type: "equal" | "edit", lines: string[], original: string[], proposed: string[], oldNo: number, newNo: number, id: string }>} */
  const placed = [];
  let oldNo = 1;
  let newNo = 1;
  for (const hunk of hunks) {
    placed.push({
      type: hunk.type,
      lines: hunk.lines,
      original: hunk.original,
      proposed: hunk.proposed,
      oldNo,
      newNo,
      id: hunk.id,
    });
    if (hunk.type === "equal") {
      oldNo += hunk.lines.length;
      newNo += hunk.lines.length;
    } else {
      oldNo += hunk.original.length;
      newNo += hunk.proposed.length;
    }
  }

  /** @type {any[]} */
  const display = [];
  /** @type {Array<{ afterHunk: number, oldFrom: number, newFrom: number, count: number }>} */
  const gaps = [];
  let index = 0;
  while (index < placed.length) {
    const part = placed[index];
    if (part.type === "equal") {
      const count = part.lines.length;
      if (count > context * 2 && display.length) {
        gaps.push({
          afterHunk: display.length - 1,
          oldFrom: part.oldNo + context,
          newFrom: part.newNo + context,
          count: count - context * 2,
        });
      }
      index += 1;
      continue;
    }
    const group = [part];
    let cursor = index + 1;
    while (cursor < placed.length) {
      const between = placed[cursor];
      if (
        between.type === "equal" &&
        between.lines.length <= context * 2 &&
        placed[cursor + 1]?.type === "edit"
      ) {
        group.push(between, placed[cursor + 1]);
        cursor += 2;
        continue;
      }
      break;
    }
    const first = group[0];
    const lead = placed[index - 1];
    const trail = placed[cursor];
    const leadLines = lead?.type === "equal" ? lead.lines.slice(-context) : [];
    const trailLines = trail?.type === "equal" ? trail.lines.slice(0, context) : [];
    const rows = [];
    let rowOld = first.oldNo - leadLines.length;
    let rowNew = first.newNo - leadLines.length;
    for (const line of leadLines) {
      rows.push({ kind: "ctx", oldNo: rowOld, newNo: rowNew, text: line });
      rowOld += 1;
      rowNew += 1;
    }
    const original = [];
    const proposed = [];
    for (const item of group) {
      if (item.type === "equal") {
        for (const line of item.lines) {
          rows.push({ kind: "ctx", oldNo: rowOld, newNo: rowNew, text: line });
          original.push(line);
          proposed.push(line);
          rowOld += 1;
          rowNew += 1;
        }
      } else {
        for (const line of item.original) {
          rows.push({ kind: "del", oldNo: rowOld, newNo: null, text: line });
          original.push(line);
          rowOld += 1;
        }
        for (const line of item.proposed) {
          rows.push({ kind: "add", oldNo: null, newNo: rowNew, text: line });
          proposed.push(line);
          rowNew += 1;
        }
      }
    }
    for (const line of trailLines) {
      rows.push({ kind: "ctx", oldNo: rowOld, newNo: rowNew, text: line });
      rowOld += 1;
      rowNew += 1;
    }
    const oldLinesCount = rows.filter((row) => row.oldNo != null).length;
    const newLinesCount = rows.filter((row) => row.newNo != null).length;
    const oldStart = oldLinesCount === 0 ? 0 : first.oldNo - leadLines.length;
    const newStart = newLinesCount === 0 ? 0 : first.newNo - leadLines.length;
    const header = `@@ -${oldStart},${oldLinesCount} +${newStart},${newLinesCount} @@`;
    display.push({
      key: `${oldStart},${oldLinesCount},${newStart},${newLinesCount}:${fnv(proposed.join("\n"))}`,
      editIds: group.filter((item) => item.type === "edit").map((item) => item.id),
      oldStart,
      oldLines: oldLinesCount,
      newStart,
      newLines: newLinesCount,
      header,
      rows,
      original,
      proposed,
      before: leadLines,
      after: trailLines,
      atStart: oldStart <= 1,
      atEnd: oldLinesCount === 0 || oldStart + oldLinesCount - 1 >= oldLines.length,
    });
    index = cursor;
  }
  const add = display.reduce(
    (/** @type {number} */ sum, /** @type {any} */ hunk) =>
      sum + hunk.rows.filter((/** @type {any} */ row) => row.kind === "add").length,
    0,
  );
  const del = display.reduce(
    (/** @type {number} */ sum, /** @type {any} */ hunk) =>
      sum + hunk.rows.filter((/** @type {any} */ row) => row.kind === "del").length,
    0,
  );
  return { add, del, tooLarge: false, hunks: display, gaps };
}

/**
 * The same model from a unified git patch, for commits where only the patch is known.
 * Gaps between hunks stay folded: the text around them is not in the patch.
 * @param {string} patch
 */
export function diffFromPatch(patch) {
  /** @type {any[]} */
  const hunks = [];
  /** @type {any} */
  let hunk = null;
  let oldNo = 0;
  let newNo = 0;
  for (const line of String(patch || "")
    .replace(/\r\n/g, "\n")
    .split("\n")) {
    const head = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (head) {
      oldNo = Number(head[1]);
      newNo = Number(head[3]);
      hunk = {
        oldStart: oldNo,
        oldLines: Number(head[2] ?? 1),
        newStart: newNo,
        newLines: Number(head[4] ?? 1),
        header: head[0],
        rows: [],
        original: [],
        proposed: [],
        editIds: [],
        before: [],
        after: [],
        atStart: oldNo <= 1,
        atEnd: false,
      };
      hunks.push(hunk);
      continue;
    }
    if (!hunk || line.startsWith("\\")) continue;
    const text = line.slice(1);
    if (line.startsWith("+")) {
      hunk.rows.push({ kind: "add", oldNo: null, newNo: newNo++, text });
      hunk.proposed.push(text);
    } else if (line.startsWith("-")) {
      hunk.rows.push({ kind: "del", oldNo: oldNo++, newNo: null, text });
      hunk.original.push(text);
    } else if (line.startsWith(" ")) {
      hunk.rows.push({ kind: "ctx", oldNo: oldNo++, newNo: newNo++, text });
      hunk.original.push(text);
      hunk.proposed.push(text);
    }
  }
  let add = 0;
  let del = 0;
  for (const item of hunks) {
    item.key = `${item.oldStart},${item.oldLines},${item.newStart},${item.newLines}:${fnv(item.proposed.join("\n"))}`;
    add += item.rows.filter((/** @type {any} */ row) => row.kind === "add").length;
    del += item.rows.filter((/** @type {any} */ row) => row.kind === "del").length;
  }
  return { add, del, tooLarge: false, hunks, gaps: [] };
}
