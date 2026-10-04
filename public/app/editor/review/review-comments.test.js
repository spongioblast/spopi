// ABOUTME: Tests one review comment, a whole review, and the comment card.
// ABOUTME: The diff fence keeps added lines marked with plus.

import { describe, expect, it, vi } from "vitest";
import {
  formatReviewComment,
  formatReviewPackage,
  mountReviewCommentDraft,
} from "./review-comments.js";

describe("formatReviewComment", () => {
  it("includes the path, the diff, and the note", () => {
    const text = formatReviewComment({
      path: "a.js",
      original: ["old"],
      proposed: ["new"],
      note: "Keep the count.",
    });
    expect(text).toContain("`a.js`");
    expect(text).toContain("+ new");
    expect(text).toContain("- old");
    expect(text).toContain("Keep the count.");
  });
});

describe("formatReviewPackage", () => {
  it("groups by file and numbers every comment", () => {
    const text = formatReviewPackage([
      {
        path: "b.js",
        hunkHeader: "@@ -1,1 +1,1 @@",
        original: ["old"],
        proposed: ["new"],
        note: "Second file.",
      },
      { path: "a.js", hunkHeader: "@@ -2 +2 @@", original: ["a"], proposed: ["b"], note: "" },
      { path: "b.js", hunkHeader: "@@ -4 +4 @@", original: [], proposed: ["x"], note: "Again." },
    ]);
    expect(text.startsWith("Code review: 3 comments on 2 files.")).toBe(true);
    expect(text.indexOf("## b.js")).toBeLessThan(text.indexOf("## a.js"));
    expect(text).toContain("### 1. @@ -1,1 +1,1 @@");
    expect(text).toContain("### 2. @@ -4 +4 @@");
    expect(text).toContain("### 3. @@ -2 +2 @@");
    expect(text).toContain("+ x");
    const third = text.slice(text.indexOf("### 3."));
    expect(third.startsWith("### 3. @@ -2 +2 @@\n```diff\n- a\n+ b\n```")).toBe(true);
  });
});

describe("mountReviewCommentDraft", () => {
  it("adds to the review on the primary button and on Mod+Enter", () => {
    const host = document.createElement("div");
    const onAddToReview = vi.fn();
    const onSendNow = vi.fn();
    const onCancel = vi.fn();
    mountReviewCommentDraft(host, {
      t: (key) => key,
      onAddToReview,
      onSendNow,
      onCancel,
    });
    const note = /** @type {HTMLTextAreaElement} */ (host.querySelector("textarea"));
    note.value = "Keep it";
    note.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true }));
    host
      .querySelector("[data-i18n='review.comments.sendNow']")
      ?.dispatchEvent(new MouseEvent("click"));
    host
      .querySelector("[data-i18n='review.comments.cancel']")
      ?.dispatchEvent(new MouseEvent("click"));
    expect(onAddToReview).toHaveBeenCalledWith("Keep it");
    expect(onSendNow).toHaveBeenCalledWith("Keep it");
    expect(onCancel).toHaveBeenCalled();
  });
});
