// ABOUTME: Tests copyText against navigator.clipboard.writeText.
// ABOUTME: Covers public/app/ui/clipboard.js.

import { describe, expect, test, vi } from "vitest";
import { copyText } from "./clipboard.js";

describe("copyText", () => {
  test("writes the string through the clipboard API", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await copyText("hello");
    expect(writeText).toHaveBeenCalledWith("hello");
    vi.unstubAllGlobals();
  });
});
