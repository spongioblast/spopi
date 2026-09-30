// ABOUTME: Tests composer auto resize.
// ABOUTME: Includes "grows the textarea up to five rows".
import { describe, expect, it, vi } from "vitest";
import { mountComposerAutoResize } from "./composer-autoresize.js";

describe("composer auto resize", () => {
  it("grows the textarea up to five rows", () => {
    document.body.innerHTML = '<textarea id="message-input" rows="2"></textarea>';
    const input = document.getElementById("message-input");

    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      lineHeight: "20px",
      fontSize: "16px",
      paddingTop: "12px",
      paddingBottom: "4px",
      borderTopWidth: "0px",
      borderBottomWidth: "0px",
    });
    Object.defineProperty(input, "scrollHeight", { configurable: true, value: 116 });

    const controller = mountComposerAutoResize({ input });

    expect(input.style.height).toBe("116px");
    expect(input.style.overflowY).toBe("hidden");

    controller.dispose();
  });

  it("caps the textarea at five rows and enables internal scrolling", () => {
    document.body.innerHTML = '<textarea id="message-input" rows="2"></textarea>';
    const input = document.getElementById("message-input");

    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      lineHeight: "20px",
      fontSize: "16px",
      paddingTop: "12px",
      paddingBottom: "4px",
      borderTopWidth: "0px",
      borderBottomWidth: "0px",
    });
    Object.defineProperty(input, "scrollHeight", { configurable: true, value: 180 });

    mountComposerAutoResize({ input });

    expect(input.style.height).toBe("116px");
    expect(input.style.overflowY).toBe("auto");
  });
});
