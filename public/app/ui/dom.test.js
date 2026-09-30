// ABOUTME: Tests dom.
// ABOUTME: Includes "builds an element with class, text, dataset, and a listener".
import { describe, expect, it, vi } from "vitest";
import { clear, el, text } from "./dom.js";

describe("dom", () => {
  it("builds an element with class, text, dataset, and a listener", () => {
    const onClick = vi.fn();
    const node = el(
      "button",
      { class: "settings-toggle", text: "Go", dataset: { panel: "usage" }, onClick },
      [],
    );
    expect(node.tagName).toBe("BUTTON");
    expect(node.className).toBe("settings-toggle");
    expect(node.textContent).toBe("Go");
    expect(node.dataset.panel).toBe("usage");
    node.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("appends element and string children and skips null", () => {
    const child = el("span", { text: "inner" });
    const node = el("div", {}, [child, "tail", null, false]);
    expect(node.childNodes).toHaveLength(2);
    expect(node.textContent).toBe("innertail");
  });

  it("sets and clears text", () => {
    const node = el("p");
    text(node, "hello");
    expect(node.textContent).toBe("hello");
    text(node, null);
    expect(node.textContent).toBe("");
    node.append(el("span"));
    clear(node);
    expect(node.childNodes).toHaveLength(0);
  });
});
