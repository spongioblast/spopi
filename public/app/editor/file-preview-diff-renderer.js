// ABOUTME: Renders a file's git patch as an inline colour-coded diff with collapsed unchanged runs.
// ABOUTME: Takes the patch text; fetching it is the panel's job.

import { flattenDiffLines } from "../files/patch-utils.js";
import { t } from "../i18n/i18n.js";

/**
 * @typedef {ReturnType<typeof flattenDiffLines>[number]} DiffDisplayLine
 *
 * @typedef {object} DiffRendererOptions
 * @property {string} [patch]
 */

const CONTEXT_LINES = 3;

/**
 * Render a unified diff patch as an inline colour-coded diff.
 * Exposes the same mount/update/destroy interface as the other renderers.
 *
 * @param {DiffRendererOptions} [options]
 */
export function createDiffRenderer({ patch = "" } = {}) {
  /** @type {Element | null} */
  let containerEl = null;

  /** @param {Element} container */
  function renderDiff(container) {
    container.replaceChildren();
    const wrap = document.createElement("div");
    wrap.className = "file-diff-view";
    container.appendChild(wrap);

    if (!patch?.trim()) {
      const empty = document.createElement("div");
      empty.className = "file-diff-empty";
      empty.textContent = t("editor.noChanges");
      wrap.appendChild(empty);
      return;
    }

    const lines = flattenDiffLines(patch);
    const hasChanges = lines.some((l) => l.type !== "unchanged");
    if (!hasChanges) {
      const empty = document.createElement("div");
      empty.className = "file-diff-empty";
      empty.textContent = t("editor.noChanges");
      wrap.appendChild(empty);
      return;
    }

    // Determine which line indices are visible (changed ± CONTEXT_LINES)
    const changed = new Set();
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].type !== "unchanged") changed.add(i);
    }
    const visible = new Set();
    for (const ci of changed) {
      for (
        let j = Math.max(0, ci - CONTEXT_LINES);
        j <= Math.min(lines.length - 1, ci + CONTEXT_LINES);
        j++
      ) {
        visible.add(j);
      }
    }

    let i = 0;
    while (i < lines.length) {
      if (visible.has(i)) {
        // Emit a block of visible lines
        while (i < lines.length && visible.has(i)) {
          wrap.appendChild(makeDiffLineEl(lines[i]));
          i++;
        }
      } else {
        // Count collapsed lines
        let count = 0;
        while (i < lines.length && !visible.has(i)) {
          count++;
          i++;
        }
        const collapseEl = document.createElement("div");
        collapseEl.className = "file-diff-collapse";
        collapseEl.textContent = t(
          count === 1 ? "files.preview.unchangedOne" : "files.preview.unchangedOther",
          {
            count,
          },
        );
        wrap.appendChild(collapseEl);
      }
    }
  }

  /** @param {DiffDisplayLine} line */
  function makeDiffLineEl(line) {
    const row = document.createElement("div");
    let cls = "file-diff-line";
    if (line.type === "added") cls += " file-diff-line--added";
    else if (line.type === "removed") cls += " file-diff-line--removed";
    row.className = cls;

    const gutter = document.createElement("span");
    gutter.className = "file-diff-gutter";
    gutter.textContent =
      line.type === "removed" ? String(line.oldLineNo ?? "") : String(line.newLineNo ?? "");

    const sign = document.createElement("span");
    sign.className = "file-diff-sign";
    sign.setAttribute("aria-hidden", "true");
    sign.textContent = line.type === "added" ? "+" : line.type === "removed" ? "\u2212" : " ";

    const content = document.createElement("span");
    content.className = "file-diff-content";
    content.textContent = line.text || "\u00a0";

    row.appendChild(gutter);
    row.appendChild(sign);
    row.appendChild(content);
    return row;
  }

  return {
    /** @param {Element} container */
    mount(container) {
      containerEl = container;
      renderDiff(container);
    },

    /**
     * @param {DiffRendererOptions} [props]
     */
    update({ patch: newPatch } = {}) {
      if (newPatch !== undefined) patch = newPatch;
      if (containerEl) renderDiff(containerEl);
    },

    destroy() {
      if (containerEl) containerEl.replaceChildren();
      containerEl = null;
    },

    get contentType() {
      return "diff";
    },
  };
}
