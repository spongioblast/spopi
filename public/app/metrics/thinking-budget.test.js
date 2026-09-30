// ABOUTME: Tests clampThinkingBudget.
// ABOUTME: Includes "keeps the stepper inside the vLLM range".
import { describe, expect, it } from "vitest";
import {
  clampThinkingBudget,
  formatThinkingBudget,
  nextThinkingBudget,
} from "./thinking-budget.js";

describe("clampThinkingBudget", () => {
  it("keeps the stepper inside the vLLM range", () => {
    expect(clampThinkingBudget(-4)).toBe(0);
    expect(clampThinkingBudget(90000)).toBe(65536);
    expect(clampThinkingBudget(32768)).toBe(32768);
  });
});

describe("nextThinkingBudget", () => {
  it("cycles through presets", () => {
    expect(nextThinkingBudget(1024)).toBe(2048);
    expect(nextThinkingBudget(63488)).toBe(1024);
    expect(formatThinkingBudget(32768)).toBe("32,768");
  });
});
