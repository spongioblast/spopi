// ABOUTME: Tests file text.
// ABOUTME: Includes "treats CRLF and LF as the same text".
import { describe, expect, it } from "vitest";
import { applyNewlineStyle, newlineStyle, sameFileText } from "./file-text.js";

describe("file text", () => {
  it("treats CRLF and LF as the same text", () => {
    expect(sameFileText("a\r\nb\r\n", "a\nb\n")).toBe(true);
    expect(sameFileText("a\nb", "a\nc")).toBe(false);
  });

  it("keeps the dominant newline style when writing back", () => {
    expect(newlineStyle("a\r\nb\r\n")).toBe("\r\n");
    expect(newlineStyle("a\nb\n")).toBe("\n");
    expect(applyNewlineStyle("a\nb\n", "\r\n")).toBe("a\r\nb\r\n");
  });
});
