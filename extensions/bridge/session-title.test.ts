// ABOUTME: Covers transcript shaping and defensive cleanup of model-generated titles.
// ABOUTME: Prevents title UI wrappers and malformed output from reaching session metadata.

import { describe, expect, it } from "vitest";
import { buildTitleTranscript, parseGeneratedSessionTitle } from "./session-title";

describe("session title generation", () => {
  it("builds a transcript from user and assistant text while excluding tool results", () => {
    expect(
      buildTitleTranscript([
        { type: "message", message: { role: "user", content: "Fix the login redirect" } },
        {
          type: "message",
          message: { role: "assistant", content: [{ type: "text", text: "I'll inspect it." }] },
        },
        { type: "message", message: { role: "toolResult", content: "secret output" } },
      ]),
    ).toBe("User: Fix the login redirect\n\nAssistant: I'll inspect it.");
  });

  it.each([
    ["**ignored?**", "**ignored?**"],
    ['{"title":"Fix Login Redirect"}', "Fix Login Redirect"],
    ["标题：修复登录跳转。", "修复登录跳转"],
    ["```text\n`Improve session naming`\n```", "Improve session naming"],
  ])("cleans model output %s", (raw, expected) => {
    expect(parseGeneratedSessionTitle(raw)).toBe(expected);
  });

  it("rejects output without letters or numbers", () => {
    expect(() => parseGeneratedSessionTitle("---")).toThrow(/usable title/);
  });

  it.each([
    ["<think>\nx\n</think>\nFix Login Redirect", "Fix Login Redirect"],
    ["<thinking>x</thinking>\nDeploy the API", "Deploy the API"],
    ["noise</think>\nReal Title", "Real Title"],
    ["<THINK>x</THINK>\nTitle", "Title"],
  ])("drops reasoning before the title %s", (raw, expected) => {
    expect(parseGeneratedSessionTitle(raw)).toBe(expected);
  });

  it("rejects unfinished reasoning", () => {
    expect(() => parseGeneratedSessionTitle("<think>\nunclosed")).toThrow(/unfinished reasoning/);
  });
});
