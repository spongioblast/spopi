// ABOUTME: Tests the anchored popover open and close behavior.
// ABOUTME: Click, Escape, and an outside click dismiss it and return focus.

import { afterEach, describe, expect, it } from "vitest";
import { openPopover } from "./popover.js";

/**
 * @param {string} label
 */
function anchor(label) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  document.body.append(button);
  button.addEventListener("click", () => {
    openPopover(button, {
      title: label,
      body: document.createTextNode(`${label} body`),
    });
  });
  return button;
}

afterEach(() => {
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );
  document.body.innerHTML = "";
});

describe("openPopover", () => {
  it("opens on click and closes when the anchor is clicked again", () => {
    const button = anchor("Isolation");
    button.click();
    const dialog = document.querySelector("[role='dialog']");
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("aria-labelledby")).toBeTruthy();
    const titleId = dialog?.getAttribute("aria-labelledby") ?? "";
    expect(document.getElementById(titleId)?.textContent).toBe("Isolation");
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(button.getAttribute("aria-controls")).toBe(dialog?.id);
    expect(document.activeElement).toBe(dialog);

    button.click();
    expect(document.querySelector("[role='dialog']")).toBeNull();
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.hasAttribute("aria-controls")).toBe(false);
    expect(document.activeElement).toBe(button);
  });

  it("closes on Escape and returns focus to the anchor", () => {
    const button = anchor("Isolation");
    button.click();
    expect(document.querySelector("[role='dialog']")).not.toBeNull();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    expect(document.querySelector("[role='dialog']")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("closes on an outside click and keeps a single popover", async () => {
    const first = anchor("First");
    const second = anchor("Second");
    first.click();
    await Promise.resolve();
    second.click();
    expect(document.querySelectorAll("[role='dialog']")).toHaveLength(1);
    expect(document.querySelector("[role='dialog']")?.textContent).toContain("Second");
    expect(first.getAttribute("aria-expanded")).toBe("false");

    await Promise.resolve();
    const dialog = document.querySelector("[role='dialog']");
    dialog?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.querySelector("[role='dialog']")).not.toBeNull();

    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.querySelector("[role='dialog']")).toBeNull();
    expect(document.activeElement).toBe(second);
  });
});
