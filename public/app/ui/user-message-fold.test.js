// ABOUTME: Tests the overflow check that shows or hides the fold on long user prompts.
// ABOUTME: Covers public/app/ui/user-message-fold.js with a stubbed ResizeObserver and layout sizes.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { foldLongUserMessage, setUserMessageExpanded } from "./user-message-fold.js";

/** @type {((entries: { target: Element }[]) => void) | null} */
let resizeCallback = null;

/**
 * @param {HTMLElement} el
 * @param {number} clientHeight
 * @param {number} scrollHeight
 */
function layout(el, clientHeight, scrollHeight) {
  Object.defineProperty(el, "clientHeight", { configurable: true, value: clientHeight });
  Object.defineProperty(el, "scrollHeight", { configurable: true, value: scrollHeight });
  resizeCallback?.([{ target: el }]);
}

describe("user message fold", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        /** @param {(entries: { target: Element }[]) => void} callback */
        constructor(callback) {
          resizeCallback = callback;
        }
        observe() {}
        unobserve() {}
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  function foldedContent() {
    const content = document.createElement("div");
    content.textContent = "a".repeat(400);
    document.body.appendChild(content);
    expect(foldLongUserMessage(content, "a".repeat(400))).toBe(true);
    return content;
  }

  it("hides the control and the fade when the prompt fits", () => {
    const content = foldedContent();
    layout(content, 200, 200);

    expect(content.classList.contains("user-message-overflowing")).toBe(false);
    expect(content.querySelector(".message-user-collapse-toggle").hidden).toBe(true);
  });

  it("shows the control again when a narrower column makes it overflow", () => {
    const content = foldedContent();
    layout(content, 200, 200);
    layout(content, 200, 480);

    expect(content.classList.contains("user-message-overflowing")).toBe(true);
    expect(content.querySelector(".message-user-collapse-toggle").hidden).toBe(false);
  });

  it("keeps the fold as rendered while there is no layout", () => {
    const content = foldedContent();
    layout(content, 0, 0);

    expect(content.classList.contains("user-message-overflowing")).toBe(true);
    expect(content.querySelector(".message-user-collapse-toggle").hidden).toBe(false);
  });

  it("leaves an open prompt open while it resizes", () => {
    const content = foldedContent();
    setUserMessageExpanded(content, true);
    layout(content, 900, 900);

    expect(content.classList.contains("expanded")).toBe(true);
    expect(content.querySelector(".message-user-collapse-toggle").hidden).toBe(false);
  });
});
