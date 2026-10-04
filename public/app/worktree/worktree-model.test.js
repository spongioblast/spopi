// ABOUTME: Tests nesting a linked worktree under its main checkout.
// ABOUTME: Paths match on Windows despite case and the \\?\ prefix.

import { describe, expect, it } from "vitest";
import { nestWorktreeProjects } from "./worktree-model.js";

describe("nestWorktreeProjects", () => {
  it("moves a worktree under its main checkout", () => {
    const listed = nestWorktreeProjects([
      { path: "D:/repo", name: "repo" },
      { path: "D:/.worktrees/repo/feat-x", name: "feat-x", worktreeOf: "D:\\repo" },
    ]);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.worktrees?.map((item) => item.name)).toEqual(["feat-x"]);
  });

  it("keeps a worktree whose parent is not listed", () => {
    const listed = nestWorktreeProjects([
      { path: "D:/.worktrees/repo/feat-x", name: "feat-x", worktreeOf: "D:/missing" },
    ]);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.name).toBe("feat-x");
  });

  it("matches a \\\\?\\ prefix and different case", () => {
    const listed = nestWorktreeProjects([
      { path: "\\\\?\\D:\\Repo", name: "Repo" },
      { path: "d:/.worktrees/Repo/feat", name: "feat", worktreeOf: "D:/repo" },
    ]);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.worktrees).toHaveLength(1);
  });
});
