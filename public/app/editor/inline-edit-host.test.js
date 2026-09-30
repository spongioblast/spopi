// ABOUTME: Tests inline-edit-host.js: one model call, then the edit is applied with no accept step.
// ABOUTME: The editor side is the detail's apply callback; the model call is a stub.
import { afterEach, describe, expect, it, vi } from "vitest";
import { openInlineEdit } from "./inline-edit-host.js";

/** @param {string} answer */
const model = (answer) => vi.fn(async () => ({ text: answer }));

/** @param {Element} parent @param {string} instruction */
async function submit(parent, instruction) {
  const input = /** @type {HTMLTextAreaElement} */ (
    parent.querySelector(".inline-edit-prompt textarea")
  );
  input.value = instruction;
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await vi.waitFor(() => {
    const run = /** @type {HTMLButtonElement | null} */ (
      parent.querySelector(".inline-edit-prompt button")
    );
    expect(run?.disabled ?? false).toBe(false);
  });
}

describe("openInlineEdit", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("applies the fitted answer and closes, with no accept step", async () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const apply = vi.fn(() => true);
    openInlineEdit(
      { path: "a.js", startLine: 1, endLine: 2, text: "function a() {}\n", apply },
      { previewParent: parent, modelCall: model("function b() {}") },
    );
    await submit(parent, "rename");
    expect(apply).toHaveBeenCalledWith("function b() {}\n");
    expect(parent.querySelector(".inline-edit-prompt")).toBeNull();
  });

  it("keeps the prompt open with a message when nothing changed", async () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const apply = vi.fn(() => true);
    openInlineEdit({ text: "a();", apply }, { previewParent: parent, modelCall: model("a();") });
    await submit(parent, "noop");
    expect(apply).not.toHaveBeenCalled();
    expect(parent.querySelector(".inline-edit-message")?.hasAttribute("hidden")).toBe(false);
  });

  it("says so when the selection changed while the model worked", async () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    openInlineEdit(
      { text: "a();", apply: () => false },
      { previewParent: parent, modelCall: model("b();") },
    );
    await submit(parent, "change");
    expect(parent.querySelector(".inline-edit-prompt")).not.toBeNull();
    expect(parent.querySelector(".inline-edit-message")?.textContent).not.toBe("");
  });
});
