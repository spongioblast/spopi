// ABOUTME: Tests formatReviewComment.
// ABOUTME: The diff fence keeps added lines marked with plus.

import { describe, expect, it } from "vitest";
import { formatReviewComment } from "./review-comments.js";

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
