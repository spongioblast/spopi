// ABOUTME: Tests pin text for compact customInstructions.
// ABOUTME: The builder is empty when the session has no pins.

import { describe, expect, it } from "vitest";
import { compactPreserveInstructions, pinContext } from "./context-pins.js";

describe("compactPreserveInstructions", () => {
  it("builds Preserve verbatim lines from the first 500 characters", () => {
    const sessionId = "pins-session";
    pinContext(sessionId, { id: "entry-1", content: `keep ${"x".repeat(600)}` });
    pinContext(sessionId, { entryId: "entry-2", content: [{ text: "second" }] });
    const text = compactPreserveInstructions(sessionId);
    expect(text.startsWith("Preserve verbatim:\n")).toBe(true);
    expect(text).toContain(`entry-1: keep ${"x".repeat(495)}`);
    expect(text).not.toContain("x".repeat(501));
    expect(text).toContain("entry-2: second");
    expect(compactPreserveInstructions("other")).toBe("");
  });
});
