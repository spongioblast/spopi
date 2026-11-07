// ABOUTME: Tests terminal-text: escape codes, carriage-return redraws, and ConPTY row moves become plain lines.
// ABOUTME: Includes "drops a first line the host cut in half".

// @vitest-environment node

import { describe, expect, it } from "vitest";
import { lastLines, terminalText } from "./terminal-text";

const ESC = String.fromCharCode(27);

describe("terminalText", () => {
  it("removes colors, titles, and cursor queries", () => {
    const raw = `${ESC}]0;title${String.fromCharCode(7)}${ESC}[?25l${ESC}[2m$ make${ESC}[0m\r\nok\r\n${ESC}[6n`;
    expect(terminalText(raw)).toBe("$ make\nok");
  });

  it("keeps only what a progress bar drew last", () => {
    expect(terminalText("[1/3] a\r[2/3] b\r[3/3] c\r\ndone\r\n")).toBe("[3/3] c\ndone");
  });

  it("turns ConPTY row moves into line breaks and collapses blank runs", () => {
    expect(terminalText(`one${ESC}[2;1Htwo${ESC}[K\n\n\n\nthree`)).toBe("one\ntwo\n\nthree");
  });
});

describe("lastLines", () => {
  it("returns the newest lines with the total", () => {
    expect(lastLines("a\nb\nc\nd", 2, false)).toEqual({ text: "c\nd", total: 4, shown: 2 });
  });

  it("drops a first line the host cut in half", () => {
    expect(lastLines("half line\nwhole\nlast", 10, true)).toEqual({
      text: "whole\nlast",
      total: 2,
      shown: 2,
    });
  });

  it("reports no lines for empty output", () => {
    expect(lastLines(`${ESC}[?25l`, 5, false)).toEqual({ text: "", total: 0, shown: 0 });
  });
});
