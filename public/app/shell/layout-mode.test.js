// ABOUTME: Width and pointer map to wide, narrow, or phone.
// ABOUTME: Tests createLayoutMode.

import { describe, expect, it } from "vitest";
import { createLayoutMode, layoutForWidth } from "./layout-mode.js";

describe("layout mode", () => {
  it("maps the three widths", () => {
    expect(layoutForWidth(1440)).toBe("wide");
    expect(layoutForWidth(1100)).toBe("wide");
    expect(layoutForWidth(820)).toBe("narrow");
    expect(layoutForWidth(390)).toBe("phone");
  });

  it("writes the body attributes and updates on resize", () => {
    document.body.innerHTML = "";
    /** @type {Set<() => void>} */
    const listeners = new Set();
    const target = {
      innerWidth: 1440,
      addEventListener: (_type, fn) => listeners.add(fn),
      removeEventListener: (_type, fn) => listeners.delete(fn),
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    };
    const mode = createLayoutMode({
      target: /** @type {Window} */ (/** @type {unknown} */ (target)),
    });
    expect(document.body.dataset.layout).toBe("wide");
    expect(document.body.dataset.pointer).toBe("fine");
    target.innerWidth = 390;
    for (const fn of listeners) fn();
    expect(mode.layout()).toBe("phone");
    mode.destroy();
  });
});
