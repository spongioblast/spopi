// ABOUTME: Tests confirmGitAction.
// ABOUTME: Escape and click-outside cancel; Cancel is first, then the danger confirm.

import { afterEach, describe, expect, test } from "vitest";
import { confirmGitAction } from "./git-confirm-dialog.js";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("confirmGitAction", () => {
  test("Escape and click-outside cancel", async () => {
    const root = document.createElement("div");
    root.id = "dialog-container";
    root.className = "hidden";
    document.body.append(root);
    const pending = confirmGitAction({ message: "Discard a.js?" });
    expect(document.querySelector(".ui-button--danger")).not.toBeNull();
    expect(document.activeElement).toBe(
      document.querySelector(".dialog-actions .ui-button--secondary"),
    );

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
