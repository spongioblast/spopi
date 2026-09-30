// ABOUTME: Tests confirmGitAction.
// ABOUTME: Escape and click-outside cancel; the discard button takes focus.

import { afterEach, describe, expect, test } from "vitest";
import { confirmGitAction } from "./git-confirm-dialog.js";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("confirmGitAction", () => {
  test("focuses discard, Escape cancels, and click-outside cancels", async () => {
    const root = document.createElement("div");
    root.id = "dialog-container";
    root.className = "hidden";
    document.body.append(root);
    const pending = confirmGitAction({ message: "Discard a.js?" });
    const discard = document.querySelector(".git-confirm-discard");
    expect(discard).not.toBeNull();
    expect(document.activeElement).toBe(discard);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await expect(pending).resolves.toBe(false);
    expect(document.querySelector(".dialog")).toBeNull();

    const again = confirmGitAction({ message: "Discard b.js?" });
    document
      .getElementById("dialog-container")
      .dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await expect(again).resolves.toBe(false);
    expect(document.querySelector(".dialog")).toBeNull();
  });
});
