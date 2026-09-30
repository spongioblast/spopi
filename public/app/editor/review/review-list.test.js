// ABOUTME: Tests the Review file list: status, tags, and keyboard movement.
// ABOUTME: Rows only select a file; there is no approve or reviewed state.

import { expect, test, vi } from "vitest";
import { renderReviewList } from "./review-list.js";

test("shows status, counts, and an outside tag", () => {
  const root = document.createElement("div");
  const onSelect = vi.fn();
  renderReviewList(
    root,
    {
      scopeKey: "turn",
      selectedPath: "src/a.js",
      files: [
        { path: "src/a.js", status: "M", add: 2, del: 1 },
        { path: "D:/other/note.js", status: "A", kind: "outside", add: 0, del: 0 },
      ],
    },
    { onSelect },
  );
  const rows = root.querySelectorAll(".review-file-row");
  expect(rows).toHaveLength(2);
  expect(rows[0].textContent).toContain("src/");
  expect(rows[0].textContent).toContain("a.js");
  expect(rows[0].textContent).toContain("+2");
  expect(rows[0].querySelector(".review-status")?.getAttribute("title")).toBe("review.status.M");
  expect(rows[1].querySelector(".review-tag")?.textContent).toBe("review.tag.outside");
  expect(root.querySelector("input[type='checkbox'], [role='progressbar']")).toBeNull();
  rows[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(onSelect).toHaveBeenCalledWith("D:/other/note.js");
});

test("arrow keys move between rows", () => {
  const root = document.createElement("div");
  document.body.append(root);
  const onSelect = vi.fn();
  renderReviewList(
    root,
    {
      files: [
        { path: "a.js", status: "M" },
        { path: "b.js", status: "A" },
      ],
    },
    { onSelect },
  );
  const first = root.querySelector(".review-file-row");
  first?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  expect(onSelect).toHaveBeenCalledWith("b.js");
  root.remove();
});

test("offers only Pi's scopes: turn and session", () => {
  const root = document.createElement("div");
  renderReviewList(root, { scopeKey: "turn", files: [] });
  expect(
    [...root.querySelectorAll(".review-scope button")].map((b) => b.getAttribute("data-i18n")),
  ).toEqual(["review.scope.turn", "review.scope.session"]);
});
