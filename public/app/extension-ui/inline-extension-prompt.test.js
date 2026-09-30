// ABOUTME: Tests inline extension prompt.
// ABOUTME: Includes "recognizes rpiv ask-user-question fallback select requests".
import { describe, expect, it } from "vitest";
import {
  isInlineAskUserQuestionRequest,
  showInlineExtensionPrompt,
} from "./inline-extension-prompt.js";

describe("inline extension prompt", () => {
  it("recognizes rpiv ask-user-question fallback select requests", () => {
    expect(
      isInlineAskUserQuestionRequest({
        type: "extension_ui_request",
        id: "q1",
        method: "select",
        title: "[Design] Pick one",
        options: ["1. Dense — Compact layout", "2. Spacious — More room"],
      }),
    ).toBe(true);
  });

  it("renders select requests in the timeline and resolves with the original option", async () => {
    document.body.innerHTML = '<div id="messages"><div class="welcome"></div></div>';
    const container = document.getElementById("messages");
    const promise = showInlineExtensionPrompt(
      {
        type: "extension_ui_request",
        id: "q1",
        method: "select",
        title: "[Design] Pick one\n\n--- 1. Dense preview ---\nA | B",
        options: ["1. Dense — Compact layout", "2. Spacious — More room"],
      },
      { container },
    );

    expect(container.querySelector(".welcome")).toBeNull();
    expect(container.querySelector(".inline-prompt-card")).toBeTruthy();
    expect(container.querySelector(".inline-prompt-preview-body")?.textContent).toBe("A | B");
    container.querySelector(".inline-prompt-option")?.click();

    await expect(promise).resolves.toEqual({ value: "1. Dense — Compact layout" });
    expect(container.querySelector(".inline-prompt-card")?.classList.contains("answered")).toBe(
      true,
    );
  });

  it("reports the answered card once, so the live turn can continue below it", async () => {
    document.body.innerHTML = '<div id="messages"></div>';
    const container = document.getElementById("messages");
    /** @type {HTMLElement[]} */
    const answered = [];
    const promise = showInlineExtensionPrompt(
      {
        type: "extension_ui_request",
        id: "q-answered",
        method: "select",
        title: "[Palette] Which pink?",
        options: ["1. Blush — Soft", "2. Rose — Warm"],
      },
      { container, onAnswered: (card) => answered.push(card) },
    );
    const option = /** @type {HTMLElement} */ (container?.querySelector(".inline-prompt-option"));
    option.click();
    option.click();
    await promise;
    expect(answered).toHaveLength(1);
    expect(answered[0].classList.contains("answered")).toBe(true);
  });

  it("renders multi-select input requests as checkboxes and returns numbered text", async () => {
    document.body.innerHTML = '<div id="messages"></div>';
    const container = document.getElementById("messages");
    const promise = showInlineExtensionPrompt(
      {
        type: "extension_ui_request",
        id: "q2",
        method: "input",
        title:
          '[Testing] Which tests should run?\n\n1. Unit tests — Fast\n2. Integration tests — Broad\n3. E2E — Slow\n\nEnter the numbers of all that apply, comma-separated (e.g. "1,3"), or type a custom answer as plain text.',
        placeholder: "1,3",
      },
      { container },
    );

    const checkboxes = container.querySelectorAll("input[type='checkbox']");
    checkboxes[0].click();
    checkboxes[2].click();
    container.querySelector(".inline-prompt-submit")?.click();

    await expect(promise).resolves.toEqual({ value: "1,3" });
  });

  it("keeps Type something cancellation local and auto-answers the follow-up input", async () => {
    document.body.innerHTML = '<div id="messages"></div>';
    const container = document.getElementById("messages");
    let resolved = false;
    const selectPromise = showInlineExtensionPrompt(
      {
        type: "extension_ui_request",
        id: "q3",
        method: "select",
        title: "[Scope] Pick one",
        options: ["1. Bug fix — Repair behavior", "2. Type something."],
      },
      { container },
    ).then((result) => {
      resolved = true;
      return result;
    });

    container.querySelectorAll(".inline-prompt-option")[1].click();
    expect(container.querySelector(".inline-prompt-custom")).toBeTruthy();
    container.querySelector(".inline-prompt-custom .inline-prompt-cancel")?.click();
    expect(resolved).toBe(false);
    expect(container.querySelector(".inline-prompt-custom")).toBeNull();

    container.querySelectorAll(".inline-prompt-option")[1].click();
    const input = container.querySelector(".inline-prompt-custom .inline-prompt-input");
    input.value = "Ship the smallest useful version";
    container.querySelector(".inline-prompt-custom .inline-prompt-submit")?.click();

    await expect(selectPromise).resolves.toEqual({ value: "2. Type something." });
    const inputResult = showInlineExtensionPrompt(
      {
        type: "extension_ui_request",
        id: "q3-input",
        method: "input",
        title: "[Scope] Pick one\n\nType your answer:",
      },
      { container },
    );

    await expect(inputResult).resolves.toEqual({ value: "Ship the smallest useful version" });
    expect(container.querySelectorAll(".inline-prompt-card")).toHaveLength(1);
  });

  it("resolves as cancelled when dismissed and marks the card so a stale click is a no-op", async () => {
    document.body.innerHTML = '<div id="messages"></div>';
    const container = document.getElementById("messages");
    let triggerDismiss;
    const dismissSignal = new Promise((resolve) => {
      triggerDismiss = resolve;
    });
    const promise = showInlineExtensionPrompt(
      {
        type: "extension_ui_request",
        id: "q4",
        method: "select",
        title: "[Scope] Pick one",
        options: ["1. Bug fix — Repair behavior", "2. Feature — Add behavior"],
      },
      { container, dismissSignal },
    );

    triggerDismiss();
    await expect(promise).resolves.toEqual({ cancelled: true });
    const card = container.querySelector(".inline-prompt-card");
    expect(card.classList.contains("answered")).toBe(true);

    // A stale click after dismissal must not throw or re-mark the card twice.
    card.querySelector(".inline-prompt-option")?.click();
    expect(container.querySelectorAll(".inline-prompt-status")).toHaveLength(1);
  });

  it("returns null for unrelated input dialogs", () => {
    document.body.innerHTML = '<div id="messages"></div>';
    expect(
      showInlineExtensionPrompt(
        {
          type: "extension_ui_request",
          id: "name",
          method: "input",
          title: "Enter a name",
        },
        { container: document.getElementById("messages") },
      ),
    ).toBeNull();
  });
});
