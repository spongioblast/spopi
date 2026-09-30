// ABOUTME: can() is true when the hello list includes the name.
// ABOUTME: Tests capabilities.js.

import { describe, expect, it } from "vitest";
import { applyCapabilities, can } from "./capabilities.js";

describe("capabilities", () => {
  it("hides nothing until a list arrives", () => {
    expect(can({}, "terminal")).toBe(true);
  });

  it("denies terminal and git writes for a control phone", () => {
    const state = applyCapabilities(["subscribe", "prompt", "git_read"]);
    expect(can(state, "terminal")).toBe(false);
    expect(can(state, "git_write")).toBe(false);
    expect(can(state, "prompt")).toBe(true);
    expect(document.body.dataset.capTerminal).toBe("0");
    expect(document.body.dataset.capGitWrite).toBe("0");
  });
});
