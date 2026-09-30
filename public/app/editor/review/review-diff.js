// ABOUTME: Renders one changed file in the editor slot, with a pager and hunk comments.
// ABOUTME: Undo is Pi's /undo for the last turn; Git and commit diffs leave staging to the Git panel.

import { t } from "../../i18n/i18n.js";
import { el } from "../../ui/dom.js";

/** @type {Set<string>} */
const openGaps = new Set();

/**
 * @param {HTMLElement} pane
 * @param {{
 *   label?: string,
 *   scope?: string,
 *   index?: number,
 *   total?: number,
 *   add?: number,
 *   del?: number,
 *   emptyText?: string,
 *   undoAvailable?: boolean,
 *   file?: any,
 * }} view
 * @param {{
 *   onPrev?: () => void,
 *   onNext?: () => void,
 *   onUndoTurn?: () => void,
 *   onRedoTurn?: () => void,
 *   onOpenCustomizations?: () => void,
 *   onComment?: (hunk: any, host: HTMLElement) => void,
 *   onOpen?: () => void,
 *   onChange?: () => void,
 * }} [handlers]
 */
export function renderReviewView(pane, view, handlers = {}) {
  const file = view.file || null;
  const total = view.total || 0;
  pane.replaceChildren(viewHead(view, handlers));
  const body = el("div", { class: "review-body" });
  if (!file) body.append(el("p", { class: "settings-help", text: view.emptyText || "" }));
  else body.append(fileArticle(file, view.index || 0, total, handlers));
  pane.append(body);
}

/**
 * @param {{ label?: string, scope?: string, total?: number, add?: number, del?: number, undoAvailable?: boolean }} view
 * @param {{ onUndoTurn?: () => void, onRedoTurn?: () => void }} handlers
 */
function viewHead(view, handlers) {
  const count = view.total || 0;
  return el("header", { class: "review-view-head" }, [
    el("h2", { class: "review-view-title", text: view.label || t("review.title") }),
    el("span", {
      class: "review-view-sum",
      text: summaryText(count, view.add || 0, view.del || 0),
    }),
    el("span", { class: "review-spacer" }),
    ...headActions(view, handlers),
  ]);
}

/**
 * Git and commit diffs have no undo here: staging and discard stay in the Git panel beside them.
 * @param {{ scope?: string, undoAvailable?: boolean }} view
 * @param {{ onUndoTurn?: () => void, onRedoTurn?: () => void }} handlers
 */
function headActions(view, handlers) {
  if (view.scope === "git" || view.scope === "commit" || !view.undoAvailable) return [];
  return [
    el("button", {
      type: "button",
      class: "ui-button ui-button--sm ui-button--ghost review-undo-turn",
      text: t("review.undoTurn"),
      title: t("review.undoTurnTitle"),
      onClick: () => handlers.onUndoTurn?.(),
    }),
    el("button", {
      type: "button",
      class: "ui-button ui-button--sm ui-button--ghost review-redo-turn",
      text: t("review.redoTurn"),
      title: t("review.redoTurnTitle"),
      onClick: () => handlers.onRedoTurn?.(),
    }),
  ];
}

/**
 * @param {number} count
 * @param {number} add
 * @param {number} del
 */
function summaryText(count, add, del) {
  const key = count === 1 ? "review.summary.one" : "review.summary.other";
  const value = t(key, { count, add, del });
  if (value && value !== key) return value;
  const noun = count === 1 ? "file" : "files";
  return `${count} ${noun} · +${add} −${del}`;
}

/**
 * @param {any} file
 * @param {number} index
 * @param {number} total
 * @param {Record<string, any>} handlers
 */
function fileArticle(file, index, total, handlers) {
  const article = el("article", {
    class: "review-file",
    dataset: { path: file.path || "", status: file.status || "M", kind: file.kind || "text" },
  });
  article.append(fileHead(file, index, total, handlers));
  const notice = noticeText(file);
  if (notice)
    article.append(el("p", { class: "review-file-notice", role: "status", text: notice }));
  if (file.kind === "app") {
    article.append(
      el("button", {
        type: "button",
        class: "ui-button ui-button--sm ui-button--secondary review-open-customizations",
        text: t("review.openCustomizations"),
        onClick: () => handlers.onOpenCustomizations?.(),
      }),
    );
    return article;
  }
  if (
    file.kind === "binary" ||
    file.kind === "outside" ||
    file.kind === "tooLarge" ||
    file.diff?.tooLarge
  ) {
    return article;
  }
  article.append(diffTable(file, handlers));
  return article;
}

/**
 * @param {any} file
 * @param {number} index
 * @param {number} total
 * @param {Record<string, any>} handlers
 */
function fileHead(file, index, total, handlers) {
  const parts = splitPath(file.path || "");
  return el("header", { class: "review-file-head" }, [
    el("span", { class: "review-file-nav" }, [
      stepButton("‹", "review.prev", "spopi-review-step", () => handlers.onPrev?.()),
      el("span", { text: t("review.filePos", { index: index + 1, total }) }),
      stepButton("›", "review.next", "spopi-review-step", () => handlers.onNext?.()),
    ]),
    el("span", { class: "review-file-path" }, [
      parts.dir ? el("span", { class: "review-dir", text: parts.dir }) : null,
      el("span", { class: "review-name", text: parts.name }),
      el("span", { class: "add", text: `+${file.add || 0}` }),
      el("span", { class: "del", text: `−${file.del || 0}` }),
    ]),
    el("span", { class: "review-spacer" }),
    file.kind === "outside" || file.kind === "app"
      ? null
      : el("button", {
          type: "button",
          class: "ui-button ui-button--xs ui-button--ghost review-open-editor",
          text: t("review.openInEditor"),
          onClick: () => handlers.onOpen?.(),
        }),
  ]);
}

/**
 * @param {string} text
 * @param {string} labelKey
 * @param {string} className
 * @param {() => void} onClick
 */
function stepButton(text, labelKey, className, onClick) {
  return el("button", {
    type: "button",
    class: `ui-icon-button ui-icon-button--sm ui-icon-button--ghost ${className}`,
    text,
    "aria-label": t(labelKey),
    onClick,
  });
}

/**
 * @param {any} file
 */
function noticeText(file) {
  if (file.kind === "app") return t("review.notice.app");
  if (file.kind === "outside") return t("review.notice.outside");
  if (file.kind === "binary") return t("review.notice.binary");
  if (file.kind === "tooLarge" || file.diff?.tooLarge) return t("review.notice.tooLarge");
  if (file.status === "A") return t("review.notice.new");
  if (file.status === "D") return t("review.notice.deleted");
  if (!file.before && !file.fromPatch) return t("review.noBaseline");
  return "";
}

/**
 * @param {any} file
 * @param {Record<string, any>} handlers
 */
function diffTable(file, handlers) {
  const table = el("div", {
    class: "review-diff",
    role: "table",
    aria: { label: file.path || "" },
  });
  const hunks = file.diff?.hunks || [];
  const gaps = file.diff?.gaps || [];
  hunks.forEach((/** @type {any} */ hunk, /** @type {number} */ hunkIndex) => {
    table.append(hunkBlock(hunk, handlers));
    const gap = gaps.find((/** @type {any} */ item) => item.afterHunk === hunkIndex);
    if (gap) table.append(gapBlock(file, gap, handlers));
  });
  return table;
}

/**
 * @param {any} hunk
 * @param {Record<string, any>} handlers
 */
function hunkBlock(hunk, handlers) {
  const block = el("div", { class: "review-hunk", dataset: { key: hunk.key } });
  block.append(
    el("div", { class: "review-hunk-head", role: "row" }, [
      el("code", { class: "review-hunk-range", text: hunk.header || "" }),
      el("span", { class: "review-spacer" }),
      el("button", {
        type: "button",
        class: "ui-button ui-button--ghost ui-button--xs spopi-review-comment",
        text: t("review.comment"),
        dataset: { i18n: "review.comment" },
        onClick: (/** @type {Event} */ event) => {
          const target = event.currentTarget;
          const host = target instanceof Element ? target.closest(".review-hunk") : null;
          if (host instanceof HTMLElement) handlers.onComment?.(hunk, host);
        },
      }),
    ]),
  );
  for (const row of hunk.rows || []) block.append(diffRow(row));
  return block;
}

/**
 * @param {any} row
 */
function diffRow(row) {
  const sign = row.kind === "add" ? "+" : row.kind === "del" ? "−" : " ";
  return el("div", { class: "review-row", role: "row", dataset: { kind: row.kind || "ctx" } }, [
    el("span", { class: "review-gutter", text: row.oldNo ? String(row.oldNo) : "" }),
    el("span", { class: "review-gutter", text: row.newNo ? String(row.newNo) : "" }),
    el("span", { class: "review-sign", text: sign }),
    el("code", { class: "review-code", text: row.text || "" }),
  ]);
}

/**
 * @param {any} file
 * @param {any} gap
 * @param {{ onChange?: () => void }} handlers
 */
function gapBlock(file, gap, handlers) {
  const id = `${file.path}:${gap.afterHunk}:${gap.oldFrom}`;
  const open = openGaps.has(id);
  const count = gap.count || 0;
  const key = count === 1 ? "review.gap.one" : "review.gap.other";
  const label = t(key, { count });
  const button = el("button", {
    type: "button",
    class: "review-gap",
    text: open ? label : `⋯ ${label === key ? `${count} unchanged lines` : label}`,
    onClick: () => {
      if (openGaps.has(id)) openGaps.delete(id);
      else openGaps.add(id);
      handlers.onChange?.();
    },
  });
  if (!open) return button;
  const wrap = el("div", { class: "review-gap-open" }, [button]);
  for (const line of gapLines(file.before, gap)) {
    wrap.append(diffRow({ kind: "ctx", oldNo: null, newNo: null, text: line }));
  }
  return wrap;
}

/**
 * @param {string} before
 * @param {{ oldFrom?: number, count?: number }} gap
 */
function gapLines(before, gap) {
  const lines = String(before || "")
    .replace(/\r\n/g, "\n")
    .split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  const start = Math.max(0, (gap.oldFrom || 1) - 1);
  return lines.slice(start, start + (gap.count || 0));
}

/**
 * @param {string} path
 */
function splitPath(path) {
  const normal = path.replaceAll("\\", "/");
  const slash = normal.lastIndexOf("/");
  if (slash < 0) return { dir: "", name: normal };
  return { dir: `${normal.slice(0, slash + 1)}`, name: normal.slice(slash + 1) };
}
