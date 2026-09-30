// ABOUTME: Shows what Pi changed, one file at a time, for a turn, the session, or git.
// ABOUTME: It never writes files: undo is Pi's /undo, and git discards stay in the Git panel.

import { previewFile } from "../chat/file-actions.js";
import { chatChangedPaths } from "../chat/turn-block.js";
import { insertSelection } from "../composer/composer-actions.js";
import { t } from "../i18n/i18n.js";
import { filePreviewRefs } from "../shell/chrome/file-preview.js";
import { el } from "../ui/dom.js";
import { appKeybindings } from "../ui/keybindings.js";
import { centerReviewOpen, setCenterReview } from "./center-mode.js";
import { leaveLeadTab, setLeadTab } from "./lead-tab.js";
import { formatReviewComment, mountReviewCommentDraft } from "./review/review-comments.js";
import { renderReviewView } from "./review/review-diff.js";
import { buildDiff, diffFromPatch } from "./review/review-diff-model.js";
import { renderReviewList } from "./review/review-list.js";

/**
 * Turn and session are Pi's changes and belong to the Review panel.
 * Git (the working tree) and commit are opened from the Git panel, which stays in the sidebar.
 * @typedef {"turn" | "session" | "git" | "commit"} ReviewScope
 * @typedef {{ path: string, status?: string, kind?: string, before?: string, after?: string, diff?: any }} ReviewFile
 * @typedef {{ load: (scopeKey: string, options?: { extraPaths?: string[] }) => Promise<{ files?: ReviewFile[], unavailable?: string, label?: string, turn?: { latest?: boolean } }> }} ReviewSources
 * @typedef {{ run: (command: string) => unknown, has: (name: string) => boolean }} ReviewCommands
 */

/** @type {ReviewScope} */
let scope = "turn";
let index = 0;
let label = "";
let turnKey = "turn";
let turnLatest = false;
/** @type {string[]} */
let turnPaths = [];
let turnTitle = "";
let opened = false;
/** @type {Record<ReviewScope, ReviewFile[]>} */
const scopeFiles = { turn: [], session: [], git: [], commit: [] };
/** @type {Record<ReviewScope, boolean>} */
const scopeLoaded = { turn: false, session: false, git: false, commit: false };
/** Why a scope has nothing to show: noHistory, turnGone, noGit, or loadFailed. */
/** @type {Record<ReviewScope, string>} */
const scopeUnavailable = { turn: "", session: "", git: "", commit: "" };
/** The loader's name for each scope: "Turn 14", "This session", "Working tree", a commit. */
/** @type {Record<ReviewScope, string>} */
const scopeLabel = { turn: "", session: "", git: "", commit: "" };

/** @param {ReviewScope} which */
function isPiScope(which) {
  return which === "turn" || which === "session";
}

/** @type {ReviewSources | null} */
let sources = null;
/** @type {null | ((message: string, options: { queue?: boolean }) => unknown)} */
let reviewSend = null;
/** @type {ReviewCommands | null} */
let commands = null;

/** @param {typeof reviewSend} send */
export function setReviewSend(send) {
  reviewSend = send;
}

/**
 * Turn, session, and git lists. Git is HEAD against the working tree.
 * @param {ReviewSources | null} next
 */
export function setReviewSources(next) {
  sources = next;
}

/**
 * Pi commands Review can run. /undo and /redo come from pi-workspace-history.
 * @param {ReviewCommands | null} next
 */
export function setReviewCommands(next) {
  commands = next;
}

/**
 * @param {ReviewScope} which
 * @param {string} [key]
 */
async function loadScope(which, key = which) {
  if (!sources) return;
  try {
    const loaded =
      which === "turn"
        ? await sources.load(key, { extraPaths: turnPaths })
        : which === "session"
          ? await sources.load(key, { extraPaths: chatChangedPaths() })
          : await sources.load(key);
    if (which === "turn" && key !== turnKey) return;
    if (which === "turn") turnLatest = loaded.turn?.latest === true;
    scopeFiles[which] = loaded.files || [];
    scopeUnavailable[which] = loaded.unavailable || "";
    scopeLabel[which] = loaded.label || "";
  } catch {
    scopeFiles[which] = [];
    scopeUnavailable[which] = "loadFailed";
  }
  scopeLoaded[which] = true;
  if (opened) paintReview();
}

/**
 * The chat's turn number names the turn; the history's own count restarts when it prunes.
 * Card paths outside the project are listed too, since the history only tracks the project.
 * @param {{ files?: { path?: string, before?: string, after?: string }[], userEntryId?: string, number?: number }} turn
 */
export function openTurnReview(turn) {
  turnKey = turn?.userEntryId ? `turn:${turn.userEntryId}` : "turn";
  turnPaths = (turn?.files || []).map((file) => file.path || "").filter(Boolean);
  turnTitle = turn?.number ? t("review.label.turn", { n: turn.number }) : "";
  openReview({
    label: t("review.title"),
    scope: "turn",
    files: (turn?.files || []).map((file) => ({
      path: file.path || "",
      before: file.before || "",
      after: file.after || "",
    })),
  });
  if (scopeLoaded.turn) void loadScope("turn", turnKey);
}

/**
 * @param {{ label?: string, scope?: ReviewScope, files?: ReviewFile[], sessionFiles?: ReviewFile[], gitFiles?: ReviewFile[] }} payload
 */
export function openReview(payload) {
  label = payload.label || t("review.title");
  scope = payload.scope || "turn";
  index = 0;
  scopeFiles.turn = payload.files || [];
  scopeFiles.session = payload.sessionFiles || [];
  scopeFiles.git = payload.gitFiles || [];
  scopeLoaded.turn = Boolean(payload.files?.length);
  scopeLoaded.session = Boolean(payload.sessionFiles?.length);
  scopeLoaded.git = Boolean(payload.gitFiles?.length);
  turnLatest = false;
  for (const which of /** @type {ReviewScope[]} */ (["turn", "session", "git", "commit"])) {
    scopeLabel[which] = "";
    scopeUnavailable[which] = "";
  }
  showReview();
}

/** The Review rail and /review show Pi's changes, even if the tab last held a Git diff. */
export function showPiReview() {
  if (!isPiScope(scope)) {
    scope = "turn";
    index = 0;
  }
  showReview();
}

/**
 * Opens the diff tab, or brings it to the front.
 * For Pi's scopes the shell moves the sidebar to the Review list; Git diffs keep the Git panel.
 */
function showReview() {
  leaveLeadTab("review");
  opened = true;
  if (!label) label = t("review.title");
  // The hidden editor must not keep focus, or Review's n/p/j/k keys type into the file.
  const focused = document.activeElement;
  if (focused instanceof HTMLElement && focused.closest("#file-preview-content")) focused.blur();
  setCenterReview(true);
  document.body.classList.add("review-open");
  if (!scopeLoaded[scope]) void loadScope(scope, scope === "turn" ? turnKey : scope);
  paintReview();
  document.dispatchEvent(new CustomEvent("spopi-center-repaint"));
  // The shell shows the diff; on a narrow window that means the center drawer.
  document.dispatchEvent(
    new CustomEvent("spopi-review-shown", {
      detail: { list: isPiScope(scope) ? "review" : "git" },
    }),
  );
}

/** A file or diff tab took the center. The Review tab stays and keeps its place. */
function stepAside() {
  if (!centerReviewOpen()) return;
  setCenterReview(false);
  document.body.classList.remove("review-open");
  reviewPaneElement()?.classList.remove("is-visible");
  syncLeadTab();
  document.dispatchEvent(new CustomEvent("spopi-center-repaint"));
}

function closeReview() {
  opened = false;
  setCenterReview(false);
  document.body.classList.remove("review-open");
  reviewPaneElement()?.classList.remove("is-visible");
  reviewListElement()?.classList.add("hidden");
  setLeadTab("review", null);
  document.dispatchEvent(new CustomEvent("spopi-center-repaint"));
  document.dispatchEvent(new CustomEvent("spopi-review-hidden"));
}

function viewTitle() {
  return (
    (scope === "turn" && turnTitle) ||
    scopeLabel[scope] ||
    (scope === "git" ? t("review.label.git") : label)
  );
}

function syncLeadTab() {
  if (!opened) return;
  setLeadTab("review", {
    label: viewTitle(),
    icon: "review",
    active: centerReviewOpen(),
    onSelect: showReview,
    onClose: closeReview,
    onLeave: stepAside,
  });
}

/** The list and the tab bring Review back to the front when it stepped aside. */
function reveal() {
  if (centerReviewOpen()) paintReview();
  else showReview();
}

export function reviewPaneElement() {
  return document.getElementById("spopi-review");
}

export function reviewListElement() {
  return document.getElementById("spopi-review-list");
}

/**
 * @param {ParentNode | null | undefined} center
 */
export function ensureReviewHosts(center) {
  if (!reviewPaneElement() && center && "append" in center) {
    const pane = el("section", { class: "spopi-review", id: "spopi-review" });
    const preview = center.querySelector?.("#file-preview-panel");
    if (preview?.nextSibling) center.insertBefore(pane, preview.nextSibling);
    else if (preview) preview.after(pane);
    else center.append(pane);
  }
  const existing = reviewPaneElement();
  const preview = center?.querySelector?.("#file-preview-panel");
  if (existing && preview && center && existing.previousElementSibling !== preview) {
    if (preview.nextSibling) center.insertBefore(existing, preview.nextSibling);
    else preview.after(existing);
  }
  const host = reviewListHost();
  let list = reviewListElement();
  if (!list && host instanceof HTMLElement) {
    const created = /** @type {HTMLElement} */ (
      el("aside", { class: "spopi-review-list hidden", id: "spopi-review-list" })
    );
    host.append(created);
    list = created;
  }
  if (list && host instanceof HTMLElement && list.parentElement !== host) host.append(list);
}

/** The change list belongs to the Review rail panel, not the session list. */
function reviewListHost() {
  return document.getElementById("review-sidebar");
}

export function paintReview() {
  const pane = reviewPaneElement();
  if (!opened || !(pane instanceof HTMLElement)) return;
  const files = scopeFiles[scope];
  if (index >= files.length) index = 0;
  const file = files[index] || null;
  syncLeadTab();
  if (!centerReviewOpen()) {
    const list = reviewListElement();
    if (list instanceof HTMLElement) renderListInto(list, files, file);
    return;
  }
  pane.classList.add("is-visible");
  const shown = file ? presentFile(file) : null;
  const totals = scopeTotals(files);
  renderReviewView(
    pane,
    {
      label: viewTitle(),
      scope,
      index,
      total: files.length,
      add: totals.add,
      del: totals.del,
      undoAvailable: undoAvailable(),
      emptyText: emptyText(),
      file: shown,
    },
    {
      onPrev: () => step(-1),
      onNext: () => step(1),
      onUndoTurn: () => runPiCommand("/undo"),
      onRedoTurn: () => runPiCommand("/redo"),
      onOpenCustomizations: () => {
        closeReview();
        document.dispatchEvent(
          new CustomEvent("spopi-open-settings", { detail: { tab: "customizations" } }),
        );
      },
      onOpen: () => {
        if (!file) return;
        stepAside();
        previewFile(file.path, firstChangedLine(shown?.diff));
      },
      onComment: (hunk, host) => {
        if (!file) return;
        mountReviewCommentDraft(host, {
          t,
          onAdd: (note) => sendReviewComment(file, hunk, note, false),
          onSend: (note, queue) => sendReviewComment(file, hunk, note, queue),
        });
      },
      onChange: () => paintReview(),
    },
  );
  paintList(files, file);
}

/** `/undo` rolls back the newest turn, so it is offered only while that turn or the session is shown. */
function undoAvailable() {
  if (!commands?.has("undo") || scopeUnavailable[scope]) return false;
  if (scope === "session") return scopeLoaded.session;
  return scope === "turn" && turnLatest;
}

function emptyText() {
  const reason = scopeUnavailable[scope];
  if (reason === "noGit") return t("review.noGit");
  if (reason === "noHistory") return t("review.noHistory");
  if (reason === "turnGone") return t("review.turnGone");
  if (reason === "loadFailed") return t("review.loadFailed");
  if (scope === "git" || scope === "commit") return t("review.empty.git");
  if (scope === "session") return t("review.empty.session");
  return t("review.empty.turn");
}

/**
 * Pi owns the rollback. Review closes, so the undone turn is not shown as current.
 * @param {string} command
 */
function runPiCommand(command) {
  closeReview();
  scopeLoaded.turn = false;
  scopeLoaded.session = false;
  commands?.run(command);
}

/**
 * @param {any} diff
 */
function firstChangedLine(diff) {
  for (const hunk of diff?.hunks || []) {
    const row = (hunk.rows || []).find((/** @type {any} */ item) => item.kind === "add");
    if (row?.newNo) return row.newNo;
  }
  return undefined;
}

/**
 * @param {ReviewFile} file
 */
function presentFile(file) {
  const diff = fileDiff(file);
  return {
    path: file.path,
    status: file.status || "M",
    kind: file.kind && file.kind !== "text" ? file.kind : diff.tooLarge ? "tooLarge" : "text",
    add: diff.add,
    del: diff.del,
    before: file.before || "",
    after: file.after || "",
    fromPatch: Boolean(file.diff),
    diff,
  };
}

/**
 * A commit file brings its diff from the patch; everything else is built from before and after.
 * @param {ReviewFile} file
 * @returns {any}
 */
function fileDiff(file) {
  return file.diff || buildDiff(file.before || "", file.after || "");
}

/** @param {number} delta */
function step(delta) {
  const files = scopeFiles[scope];
  if (!files.length) return;
  index = (index + delta + files.length) % files.length;
  paintReview();
}

/**
 * @param {ReviewFile} file
 * @param {{ original?: string[], proposed?: string[] }} hunk
 * @param {string} note
 * @param {boolean} queue
 */
function sendReviewComment(file, hunk, note, queue) {
  const text = formatReviewComment({
    path: file.path,
    original: hunk.original || [],
    proposed: hunk.proposed || [],
    note,
  });
  if (reviewSend) {
    void reviewSend(text, { queue });
    return;
  }
  insertSelection({ path: file.path, text, startLine: 1, kind: "hunk" });
}

/**
 * @param {ReviewFile[]} files
 * @param {ReviewFile | null} file
 */
function paintList(files, file) {
  // A Git diff is listed by the Git panel; the Review list keeps Pi's last scope.
  if (!isPiScope(scope)) return;
  const list = reviewListElement();
  if (list instanceof HTMLElement) renderListInto(list, files, file);
  // A narrow window shows only the diff, so the scope and files also sit above it.
  const pane = reviewPaneElement();
  const header = pane?.querySelector(".review-view-head");
  if (header) {
    const inline = /** @type {HTMLElement} */ (el("div", { class: "review-inline-list" }));
    header.after(inline);
    renderListInto(inline, files, file);
  }
}

/**
 * @param {HTMLElement} root
 * @param {ReviewFile[]} files
 * @param {ReviewFile | null} file
 */
function renderListInto(root, files, file) {
  renderReviewList(
    root,
    {
      scopeKey: scope,
      unavailable: scopeUnavailable[scope],
      selectedPath: file?.path || "",
      files: files.map((entry) => {
        const totals = fileTotals(entry);
        return {
          path: entry.path,
          status: entry.status || "M",
          kind: entry.kind || "text",
          add: totals.add,
          del: totals.del,
        };
      }),
    },
    {
      onScope: (next) => {
        scope = next === "session" ? "session" : "turn";
        index = 0;
        if (!scopeLoaded[scope] || scope !== "turn")
          void loadScope(scope, scope === "turn" ? turnKey : scope);
        reveal();
      },
      onSelect: (path) => {
        const at = files.findIndex((entry) => entry.path === path);
        if (at >= 0) index = at;
        reveal();
      },
    },
  );
}

/**
 * @param {ReviewFile[]} files
 */
function scopeTotals(files) {
  return files.reduce(
    (/** @type {{ add: number, del: number }} */ sum, /** @type {ReviewFile} */ entry) => {
      const totals = fileTotals(entry);
      return { add: sum.add + totals.add, del: sum.del + totals.del };
    },
    { add: 0, del: 0 },
  );
}

/**
 * @param {ReviewFile} entry
 */
function fileTotals(entry) {
  const diff = fileDiff(entry);
  return { add: diff.add, del: diff.del };
}

document.addEventListener("spopi-review-git-file", (event) => {
  const path = /** @type {CustomEvent} */ (event).detail?.path;
  void openGitFile(typeof path === "string" ? path : "");
});

/**
 * @param {string} path
 */
async function openGitFile(path) {
  scope = "git";
  index = 0;
  opened = true;
  await loadScope("git");
  showReview();
  if (!path) return;
  const at = scopeFiles.git.findIndex((file) => file.path === path);
  if (at >= 0) index = at;
  paintReview();
}

document.addEventListener("spopi-review-commit-file", (event) => {
  openCommitFile(/** @type {CustomEvent} */ (event).detail || {});
});

/**
 * One file of a commit, from the History tab. The patch is all the host sends.
 * @param {{ commitOid?: string, subject?: string, path?: string, status?: string, patch?: string, binary?: boolean, truncated?: boolean }} commit
 */
export function openCommitFile(commit) {
  const short = String(commit.commitOid || "").slice(0, 7);
  scope = "commit";
  index = 0;
  scopeFiles.commit = [
    {
      path: commit.path || "",
      status: commit.status || "M",
      kind: commit.binary ? "binary" : commit.truncated ? "tooLarge" : "text",
      diff: diffFromPatch(commit.patch || ""),
    },
  ];
  scopeLoaded.commit = true;
  scopeUnavailable.commit = "";
  scopeLabel.commit = [short, commit.subject].filter(Boolean).join(" ");
  showReview();
}

document.addEventListener("spopi-show-review", () => {
  ensureReviewHosts(filePreviewRefs().panel?.parentElement);
  showPiReview();
});

const reviewKeys = appKeybindings();
/** @param {KeyboardEvent} event */
const reviewKeysApply = (event) => {
  const target = event.target;
  if (
    target instanceof HTMLElement &&
    target.closest("input, textarea, select, [contenteditable='true']")
  ) {
    return false;
  }
  return centerReviewOpen();
};

/** @type {number} */
let hunkIndex = 0;

/** @returns {HTMLElement[]} */
function reviewHunkElements() {
  return [...(reviewPaneElement()?.querySelectorAll(".review-hunk") || [])].filter(
    (node) => node instanceof HTMLElement,
  );
}

/** @param {number} delta */
function moveHunk(delta) {
  const hunks = reviewHunkElements();
  if (!hunks.length) return;
  hunkIndex = (hunkIndex + delta + hunks.length) % hunks.length;
  const head = hunks[hunkIndex]?.querySelector(".review-hunk-head");
  if (head instanceof HTMLElement) {
    head.tabIndex = -1;
    head.focus();
    head.scrollIntoView({ block: "nearest" });
  }
}

reviewKeys.register({
  id: "review.nextFile",
  keys: "n",
  labelKey: "review.next",
  when: reviewKeysApply,
  run: () => step(1),
});
reviewKeys.register({
  id: "review.prevFile",
  keys: "p",
  labelKey: "review.prev",
  when: reviewKeysApply,
  run: () => step(-1),
});
reviewKeys.register({
  id: "review.nextHunk",
  keys: "j",
  labelKey: "review.next",
  when: reviewKeysApply,
  run: () => moveHunk(1),
});
reviewKeys.register({
  id: "review.prevHunk",
  keys: "k",
  labelKey: "review.prev",
  when: reviewKeysApply,
  run: () => moveHunk(-1),
});
reviewKeys.register({
  id: "review.commentHunk",
  keys: "c",
  labelKey: "review.comment",
  when: reviewKeysApply,
  run: () => {
    const button = reviewHunkElements()[hunkIndex]?.querySelector(".spopi-review-comment");
    if (button instanceof HTMLElement) button.click();
  },
});
reviewKeys.register({
  id: "review.close",
  keys: "Escape",
  labelKey: "review.close",
  when: reviewKeysApply,
  run: () => closeReview(),
});
