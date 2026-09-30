// ABOUTME: Flattens a unified diff into display lines.
// ABOUTME: It does not apply the patch.

/**
 * Unified diff patch parser.
 *
 * Converts a unified diff string into a structured array of files and rows
 * suitable for rendering a split diff or inline diff view.
 *
 * Ported from pi-web/lib/patch.ts — adapted to plain ES module style.
 */

/**
 * @typedef {"context" | "removed" | "added" | "empty"} SplitDiffCellType
 *
 * @typedef {{ type: SplitDiffCellType; text: string; lineNo: number | null }} SplitDiffCell
 *
 * @typedef {{ type: "hunk"; header: string } | { type: "line"; left: SplitDiffCell; right: SplitDiffCell }} SplitDiffRow
 *
 * @typedef {{ oldPath: string; newPath: string; rows: SplitDiffRow[] }} SplitDiffFile
 */

/**
 * @param {string} text  Raw unified diff text
 * @returns {SplitDiffFile[]}
 */
function parseUnifiedPatch(text) {
  if (!text) return [];

  const lines = text.split("\n");
  /** @type {SplitDiffFile[]} */
  const files = [];
  /** @type {SplitDiffFile | null} */
  let currentFile = null;

  let oldLineNo = 0;
  let newLineNo = 0;
  /** @type {SplitDiffCell[]} */
  let pendingRemoved = [];
  /** @type {SplitDiffCell[]} */
  let pendingAdded = [];

  function flushPendingLines() {
    if (!currentFile) return;
    const count = Math.max(pendingRemoved.length, pendingAdded.length);
    for (let i = 0; i < count; i++) {
      const left = pendingRemoved[i] ?? { type: "empty", text: "", lineNo: null };
      const right = pendingAdded[i] ?? { type: "empty", text: "", lineNo: null };
      currentFile.rows.push({ type: "line", left, right });
    }
    pendingRemoved = [];
    pendingAdded = [];
  }

  for (const line of lines) {
    if (line.startsWith("diff ")) {
      flushPendingLines();
      currentFile = { oldPath: "", newPath: "", rows: [] };
      files.push(currentFile);
      continue;
    }

    if (line.startsWith("--- ")) {
      if (!currentFile) {
        currentFile = { oldPath: "", newPath: "", rows: [] };
        files.push(currentFile);
      }
      // Strip "--- a/" prefix (or "--- /dev/null")
      currentFile.oldPath = line.slice(4).replace(/^a\//, "");
      continue;
    }

    if (line.startsWith("+++ ")) {
      if (!currentFile) {
        currentFile = { oldPath: "", newPath: "", rows: [] };
        files.push(currentFile);
      }
      currentFile.newPath = line.slice(4).replace(/^b\//, "");
      continue;
    }

    if (line.startsWith("@@ ")) {
      flushPendingLines();
      // Parse @@ -oldStart[,oldCount] +newStart[,newCount] @@
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLineNo = Number(match[1]);
        newLineNo = Number(match[2]);
      }
      if (currentFile) {
        currentFile.rows.push({ type: "hunk", header: line });
      }
      continue;
    }

    if (!currentFile) continue;

    if (line.startsWith("-")) {
      const text = line.slice(1);
      pendingRemoved.push({ type: "removed", text, lineNo: oldLineNo++ });
    } else if (line.startsWith("+")) {
      const text = line.slice(1);
      pendingAdded.push({ type: "added", text, lineNo: newLineNo++ });
    } else if (line.startsWith(" ") || line === "") {
      flushPendingLines();
      const text = line.startsWith(" ") ? line.slice(1) : "";
      /** @type {SplitDiffRow} */
      const row = {
        type: "line",
        left: { type: "context", text, lineNo: oldLineNo++ },
        right: { type: "context", text, lineNo: newLineNo++ },
      };
      currentFile.rows.push(row);
    }
    // skip "index ...", "new file mode", etc.
  }

  flushPendingLines();
  return files;
}

/**
 * Flatten parsed diff files into a simple linear list of diff lines
 * (unchanged / removed / added), similar to the inline view used by
 * pi-web's DiffView component.
 *
 * @param {string} patch
 * @returns {Array<{ type: "unchanged"|"removed"|"added"; text: string; oldLineNo: number|null; newLineNo: number|null }>}
 */
export function flattenDiffLines(patch) {
  const files = parseUnifiedPatch(patch);
  /** @type {Array<{ type: "unchanged" | "removed" | "added"; text: string; oldLineNo: number | null; newLineNo: number | null }>} */
  const result = [];

  for (const file of files) {
    for (const row of file.rows) {
      if (row.type === "hunk") continue;
      const { left, right } = row;
      if (left.type === "context" && right.type === "context") {
        result.push({
          type: "unchanged",
          text: right.text,
          oldLineNo: left.lineNo,
          newLineNo: right.lineNo,
        });
      } else {
        if (left.type === "removed") {
          result.push({
            type: "removed",
            text: left.text,
            oldLineNo: left.lineNo,
            newLineNo: null,
          });
        }
        if (right.type === "added") {
          result.push({
            type: "added",
            text: right.text,
            oldLineNo: null,
            newLineNo: right.lineNo,
          });
        }
      }
    }
  }

  return result;
}
