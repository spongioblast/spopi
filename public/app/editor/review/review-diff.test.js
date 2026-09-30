// ABOUTME: Tests the one-file review view: pager, comments, gaps, and the header actions.
// ABOUTME: Turn scope offers Pi's /undo and /redo; git scope points to the Git panel.

import { expect, test, vi } from "vitest";
import { renderReviewView } from "./review-diff.js";

const file = {
  path: "src/a.js",
  status: "M",
  kind: "text",
  add: 1,
  del: 0,
  before: "one\ntwo\nthree\nfour\nfive\n",
  diff: {
    tooLarge: false,
    hunks: [
      {
        key: "h1",
        header: "@@ -1,1 +1,1 @@",
        rows: [{ kind: "add", oldNo: null, newNo: 1, text: "next" }],
      },
    ],
    gaps: [{ afterHunk: 0, oldFrom: 1, count: 4 }],
  },
};

test("shows one file with only a Comment action per hunk and expands a gap", () => {
  const pane = document.createElement("section");
  const onComment = vi.fn();
  /** @type {() => void} */
  let paint = () => {};
  paint = () =>
    renderReviewView(
      pane,
      { label: "Turn 14", scope: "turn", index: 1, total: 3, add: 1, del: 0, file },
      { onComment, onChange: () => paint() },
    );
  paint();
  expect(pane.textContent).toContain("src/");
  expect(pane.textContent).not.toContain("review.keep");
  const actions = [...pane.querySelectorAll(".review-hunk-head button")];
  expect(actions.map((button) => button.textContent)).toEqual(["review.comment"]);
  expect(pane.textContent).not.toContain("four");
  pane.querySelector(".review-gap")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(pane.textContent).toContain("four");
  pane.querySelector(".spopi-review-comment")?.dispatchEvent(new MouseEvent("click"));
  expect(onComment).toHaveBeenCalled();
});

test("turn scope runs Pi's undo and redo; without them nothing is offered", () => {
  const pane = document.createElement("section");
  const onUndoTurn = vi.fn();
  const onRedoTurn = vi.fn();
  renderReviewView(
    pane,
    { scope: "turn", total: 1, undoAvailable: true, file },
    { onUndoTurn, onRedoTurn },
  );
  pane.querySelector(".review-undo-turn")?.dispatchEvent(new MouseEvent("click"));
  pane.querySelector(".review-redo-turn")?.dispatchEvent(new MouseEvent("click"));
  expect(onUndoTurn).toHaveBeenCalled();
  expect(onRedoTurn).toHaveBeenCalled();
  renderReviewView(pane, { scope: "turn", total: 1, undoAvailable: false, file });
  expect(pane.querySelector(".review-undo-turn")).toBeNull();
});

test("git and commit diffs offer no undo; the Git panel beside them owns staging", () => {
  const pane = document.createElement("section");
  for (const scope of ["git", "commit"]) {
    renderReviewView(pane, { scope, total: 1, undoAvailable: true, file });
    expect(pane.querySelector(".review-undo-turn")).toBeNull();
    expect(pane.querySelector(".review-view-head button")).toBeNull();
  }
});

test("an outside file has a notice and no editor button", () => {
  const pane = document.createElement("section");
  renderReviewView(pane, {
    total: 1,
    file: {
      path: "D:/other/note.js",
      status: "M",
      kind: "outside",
      before: "",
      diff: { hunks: [], gaps: [] },
    },
  });
  expect(pane.textContent).toContain("review.notice.outside");
  expect(pane.textContent).not.toContain("review.openInEditor");
});

test("a SPOPI UI file says undo skips it and opens Customizations", () => {
  const pane = document.createElement("section");
  const onOpenCustomizations = vi.fn();
  renderReviewView(
    pane,
    { total: 1, file: { path: "SPOPI UI/user.css", status: "M", kind: "app", before: "" } },
    { onOpenCustomizations },
  );
  expect(pane.textContent).toContain("review.notice.app");
  expect(pane.textContent).not.toContain("review.openInEditor");
  pane.querySelector(".review-open-customizations")?.dispatchEvent(new MouseEvent("click"));
  expect(onOpenCustomizations).toHaveBeenCalled();
});
