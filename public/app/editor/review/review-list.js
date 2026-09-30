// ABOUTME: Renders the Review sidebar: scope, and one row per changed file.
// ABOUTME: A row click selects the file; Review only shows changes, it never approves them.

import { t } from "../../i18n/i18n.js";
import { el } from "../../ui/dom.js";

const SCOPE_KEY = {
  turn: "review.scope.turn",
  session: "review.scope.session",
};
const TAG_KEY = {
  app: "review.tag.app",
  outside: "review.tag.outside",
  binary: "review.tag.binary",
  tooLarge: "review.tag.tooLarge",
  conflict: "review.tag.conflict",
};
const EMPTY_KEY = {
  turn: "review.empty.turn",
  session: "review.empty.session",
};

/**
 * @param {HTMLElement | null | undefined} root
 * @param {{
 *   scopeKey?: string,
 *   files?: Array<{ path: string, status?: string, kind?: string, add?: number, del?: number }>,
 *   selectedPath?: string,
 *   unavailable?: string,
 * }} view
 * @param {{
 *   onScope?: (scope: string) => void,
 *   onSelect?: (path: string) => void,
 * }} [handlers]
 */
export function renderReviewList(root, view, handlers = {}) {
  if (!(root instanceof HTMLElement)) return;
  root.classList.remove("hidden");
  const files = view.files || [];
  const scope = scopeOf(view.scopeKey);
  const selected = view.selectedPath || files[0]?.path || "";
  root.replaceChildren(
    scopeGroup(scope, handlers.onScope),
    files.length ? fileList(files, selected, handlers) : emptyState(scope, view.unavailable),
  );
  const rows = [...root.querySelectorAll(".review-file-row")];
  for (const row of rows) {
    if (!(row instanceof HTMLElement)) continue;
    row.tabIndex = row.dataset.path === selected ? 0 : -1;
  }
}

/**
 * @param {string} id
 */
function scopeLabel(id) {
  if (id === "session") return SCOPE_KEY.session;
  return SCOPE_KEY.turn;
}

/**
 * @param {string | undefined} scopeKey
 * @returns {"turn" | "session"}
 */
function scopeOf(scopeKey) {
  return scopeKey === "session" ? "session" : "turn";
}

/**
 * @param {string} scope
 * @param {((scope: string) => void) | undefined} onScope
 */
function scopeGroup(scope, onScope) {
  return el(
    "div",
    { class: "review-scope", role: "radiogroup", aria: { label: t("review.scope.label") } },
    ["turn", "session"].map((id) =>
      el("button", {
        type: "button",
        class: "ui-button ui-button--sm ui-button--ghost",
        role: "radio",
        text: t(scopeLabel(id)),
        dataset: { i18n: scopeLabel(id) },
        aria: { checked: id === scope ? "true" : "false" },
        onClick: () => onScope?.(id),
      }),
    ),
  );
}

/**
 * @param {Array<{ path: string, status?: string, kind?: string, add?: number, del?: number }>} files
 * @param {string} selected
 * @param {{ onSelect?: (path: string) => void }} handlers
 */
function fileList(files, selected, handlers) {
  const list = el("ul", {
    class: "review-files",
    role: "listbox",
    aria: { label: t("review.files") },
  });
  list.addEventListener("keydown", (event) => {
    if (event instanceof KeyboardEvent && list instanceof HTMLElement) {
      moveRow(event, list, handlers.onSelect);
    }
  });
  for (const file of files) list.append(fileRow(file, file.path === selected, handlers));
  return list;
}

/**
 * @param {{ path: string, status?: string, kind?: string, add?: number, del?: number }} file
 * @param {boolean} selected
 * @param {{ onSelect?: (path: string) => void }} handlers
 */
function fileRow(file, selected, handlers) {
  const status = file.status === "A" || file.status === "D" ? file.status : "M";
  const parts = splitPath(file.path);
  const kind = file.kind || "text";
  const row = el("li", {
    class: "review-file-row",
    role: "option",
    dataset: { path: file.path, status, kind },
    aria: { selected: selected ? "true" : "false" },
    onClick: () => handlers.onSelect?.(file.path),
    onKeydown: (/** @type {KeyboardEvent} */ event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      handlers.onSelect?.(file.path);
    },
  });
  row.append(
    el("span", {
      class: "review-status",
      text: status,
      title: statusTitle(status),
    }),
    el("span", { class: "review-path" }, [
      parts.dir ? el("span", { class: "review-dir", text: parts.dir }) : null,
      el("span", { class: "review-name", text: parts.name }),
    ]),
    el("span", { class: "review-stat" }, [
      el("span", { class: "add", text: `+${file.add || 0}` }),
      el("span", { class: "del", text: `−${file.del || 0}` }),
    ]),
  );
  const marker = tag(kind);
  if (marker) row.append(marker);
  return row;
}

/**
 * @param {string} status
 */
function statusTitle(status) {
  if (status === "A") return t("review.status.A");
  if (status === "D") return t("review.status.D");
  return t("review.status.M");
}

/**
 * @param {string} kind
 */
function tag(kind) {
  const key = TAG_KEY[/** @type {keyof typeof TAG_KEY} */ (kind)];
  if (!key) return null;
  return el("span", { class: "review-tag", text: t(key) });
}

/**
 * @param {"turn" | "session"} scope
 * @param {string | undefined} unavailable
 */
function emptyState(scope, unavailable) {
  const key =
    unavailable === "noHistory"
      ? "review.noHistory"
      : unavailable === "turnGone"
        ? "review.turnGone"
        : unavailable === "loadFailed"
          ? "review.loadFailed"
          : EMPTY_KEY[scope];
  return el("div", { class: "review-sidebar-empty" }, [el("p", { text: t(key) })]);
}

/**
 * @param {KeyboardEvent} event
 * @param {HTMLElement} list
 * @param {((path: string) => void) | undefined} onSelect
 */
function moveRow(event, list, onSelect) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const rows = [...list.querySelectorAll(".review-file-row")].filter(
    (row) => row instanceof HTMLElement,
  );
  if (!rows.length) return;
  event.preventDefault();
  const current = document.activeElement?.closest(".review-file-row");
  const at = Math.max(0, rows.indexOf(/** @type {HTMLElement} */ (current)));
  const next = event.key === "ArrowDown" ? Math.min(rows.length - 1, at + 1) : Math.max(0, at - 1);
  const row = rows[next];
  if (!(row instanceof HTMLElement)) return;
  for (const item of rows) {
    if (item instanceof HTMLElement) item.tabIndex = item === row ? 0 : -1;
  }
  row.focus();
  const path = row.dataset.path;
  if (path) onSelect?.(path);
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
