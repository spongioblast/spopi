// ABOUTME: Tests mountContextInspector.
// ABOUTME: Includes "buckets messages and exposes compact".
import { describe, expect, it } from "vitest";
import { mountContextInspector } from "./context-inspector-tab.js";

describe("mountContextInspector", () => {
  it("buckets messages and exposes compact", () => {
    const root = document.createElement("div");
    let compacted = false;
    mountContextInspector(root, {
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "hi" },
      ],
      onCompact: () => {
        compacted = true;
      },
    });
    expect(root.querySelector('[data-bucket="system"]')).toBeTruthy();
    root.querySelector(".ui-button").click();
    expect(compacted).toBe(true);
  });
});
