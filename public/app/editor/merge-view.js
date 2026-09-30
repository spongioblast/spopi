// ABOUTME: Line-diff hunk model and a read-only hunk list for tool cards and review.
// ABOUTME: Nothing here applies a change; edits go through the editor, Pi, or Git.

/**
 * @typedef {{ type: "equal" | "add" | "del", line: string }} DiffOp
 *
 * @typedef {{
 *   id: string,
 *   type: "equal" | "edit",
 *   lines: string[],
 *   original: string[],
 *   proposed: string[],
 * }} MergeHunk
 */

/**
 * @param {string} [original]
 * @param {string} [proposed]
 * @returns {boolean}
 */
export function diffTooLarge(original = "", proposed = "") {
  const { midA, midB } = trimmedSides(original, proposed);
  return (midA.length + 1) * (midB.length + 1) > 4_000_000;
}

/**
 * @param {unknown} text
 * @returns {string[]}
 */
function toLines(text) {
  const value = String(text ?? "");
  if (value === "") return [];
  return value.split("\n");
}

/**
 * @param {string} [original]
 * @param {string} [proposed]
 * @returns {{ midA: string[], midB: string[], prefix: string[], suffix: string[] }}
 */

function trimmedSides(original = "", proposed = "") {
  const a = toLines(original);
  const b = toLines(proposed);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let aEnd = a.length;
  let bEnd = b.length;
  while (aEnd > start && bEnd > start && a[aEnd - 1] === b[bEnd - 1]) {
    aEnd -= 1;
    bEnd -= 1;
  }
  return {
    prefix: a.slice(0, start),
    suffix: a.slice(aEnd),
    midA: a.slice(start, aEnd),
    midB: b.slice(start, bEnd),
  };
}

export function computeHunks(original = "", proposed = "") {
  const { prefix, suffix, midA, midB } = trimmedSides(original, proposed);
  /** @type {DiffOp[]} */
  const ops = [];
  for (const line of prefix) ops.push({ type: "equal", line });
  ops.push(...diffOps(midA, midB));
  for (const line of suffix) ops.push({ type: "equal", line });
  return groupHunks(ops);
}

/**
 * @param {string[]} a
 * @param {string[]} b
 * @returns {DiffOp[]}
 */
function diffOps(a, b) {
  const matrix = lcsMatrix(a, b);
  /** @type {DiffOp[]} */
  const ops = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.push({ type: "equal", line: a[i - 1] });
      i -= 1;
      j -= 1;
    } else if (j > 0 && (i === 0 || matrix[i][j - 1] >= matrix[i - 1][j])) {
      ops.push({ type: "add", line: b[j - 1] });
      j -= 1;
    } else {
      ops.push({ type: "del", line: a[i - 1] });
      i -= 1;
    }
  }
  ops.reverse();
  return ops;
}

/**
 * Removed lines, then added lines, per edit hunk. The sign is drawn by CSS from
 * `data-sign`, so a copied line is the code alone.
 * @param {Element | null | undefined} container
 * @param {MergeHunk[]} hunks
 */
export function renderHunkList(container, hunks) {
  if (!container) return;
  container.replaceChildren();
  container.classList.add("merge-hunk-list");
  for (const hunk of hunks) {
    if (hunk.type === "equal") continue;
    const row = document.createElement("div");
    row.className = "merge-hunk";
    for (const line of hunk.original) row.appendChild(diffLine("del", line));
    for (const line of hunk.proposed) row.appendChild(diffLine("add", line));
    container.appendChild(row);
  }
}

/**
 * @param {"add" | "del"} kind
 * @param {string} text
 */
function diffLine(kind, text) {
  const el = document.createElement("div");
  el.className = `merge-line merge-line-${kind}`;
  el.dataset.sign = kind === "add" ? "+" : "-";
  el.textContent = text;
  return el;
}

/**
 * @param {string[]} a
 * @param {string[]} b
 * @returns {Uint32Array[]}
 */
function lcsMatrix(a, b) {
  const matrix = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      matrix[i][j] =
        a[i - 1] === b[j - 1]
          ? matrix[i - 1][j - 1] + 1
          : Math.max(matrix[i - 1][j], matrix[i][j - 1]);
    }
  }
  return matrix;
}

/**
 * @param {DiffOp[]} ops
 * @returns {MergeHunk[]}
 */
function groupHunks(ops) {
  /** @type {MergeHunk[]} */
  const hunks = [];
  let nextId = 1;
  /** @type {MergeHunk | null} */
  let current = null;
  const flush = () => {
    if (!current) return;
    hunks.push(current);
    current = null;
  };
  for (const op of ops) {
    if (op.type === "equal") {
      if (current?.type !== "equal") {
        flush();
        current = { id: `eq-${nextId}`, type: "equal", lines: [], original: [], proposed: [] };
        nextId += 1;
      }
      current.lines.push(op.line);
      current.original.push(op.line);
      current.proposed.push(op.line);
    } else {
      if (!current || current.type === "equal") {
        flush();
        current = {
          id: `h-${nextId}`,
          type: "edit",
          lines: [],
          original: [],
          proposed: [],
        };
        nextId += 1;
      }
      if (op.type === "del") current.original.push(op.line);
      if (op.type === "add") current.proposed.push(op.line);
    }
  }
  flush();
  return hunks;
}
