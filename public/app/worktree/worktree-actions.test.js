// ABOUTME: Tests that a dirty worktree is removed only after a second confirmation.
// ABOUTME: The first call is refused. The second one asks git to force it.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { removeWorktreeFlow } from "./worktree-actions.js";

beforeEach(() => {
  document.getElementById("dialog-container")?.remove();
  const dialogs = document.createElement("div");
  dialogs.id = "dialog-container";
  dialogs.className = "hidden";
  document.body.append(dialogs);
});

describe("removeWorktreeFlow", () => {
  it("asks again and then sends force when the worktree is dirty", async () => {
    const removeWorktree = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("dirty"), { code: "worktree_dirty" }))
      .mockResolvedValueOnce({ primaryPath: "D:/repo" });
    const start = vi.fn();
    const sidebar = {
      control: { removeWorktree },
      load: vi.fn(async () => {}),
    };
    const pending = removeWorktreeFlow(
      /** @type {import("../session/session-sidebar.js").SessionSidebar} */ (sidebar),
      { path: "D:/.worktrees/repo/feat", name: "feat", isCurrent: true },
      start,
    );
    const confirm = async (/** @type {string} */ className) => {
      await vi.waitFor(() => {
        const button = document.querySelector(`[role="dialog"] .${className}`);
        if (!(button instanceof HTMLButtonElement)) throw new Error("waiting");
        button.click();
      });
    };
    await confirm("ui-button--primary");
    await confirm("ui-button--danger");
    await pending;
    expect(removeWorktree).toHaveBeenNthCalledWith(1, "D:/.worktrees/repo/feat", { force: false });
    expect(removeWorktree).toHaveBeenNthCalledWith(2, "D:/.worktrees/repo/feat", { force: true });
    expect(start).toHaveBeenCalled();
  });
});
