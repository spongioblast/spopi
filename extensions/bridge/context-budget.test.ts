// ABOUTME: The context line names the window and compaction point, once, and follows model changes.
// ABOUTME: A model without a known window gets no line.

import { describe, expect, it } from "vitest";
import { contextBudgetLine, registerContextBudget } from "./context-budget";

type Handler = (event: unknown, ctx: unknown) => unknown;

function setup(compaction = { enabled: true, reserveTokens: 16384 }) {
  const handlers = new Map<string, Handler>();
  const pi = { on: (event: string, handler: Handler) => handlers.set(event, handler) };
  registerContextBudget(pi as never, () => compaction);
  const options = { promptGuidelines: ["other guideline"] as string[] };
  const run = (model: unknown) =>
    handlers.get("before_agent_start")?.({ systemPromptOptions: options }, { cwd: "D:/p", model });
  return { options, run };
}

describe("context budget", () => {
  it("names the window and the compaction point", () => {
    const line = contextBudgetLine(262144, { enabled: true, reserveTokens: 16384 });
    expect(line).toContain("262,144 tokens");
    expect(line).toContain("about 245,760 tokens");
    expect(line).toContain("never stop");
    const off = contextBudgetLine(262144, { enabled: false, reserveTokens: 16384 });
    expect(off).toContain("Auto-compaction is off");
    expect(off).not.toContain("245,760");
  });

  it("adds the line once and replaces it when the model changes", () => {
    const { options, run } = setup();
    const big = { provider: "ninfer", id: "q", contextWindow: 262144 };
    run(big);
    run(big);
    expect(options.promptGuidelines).toEqual([
      "other guideline",
      contextBudgetLine(262144, { enabled: true, reserveTokens: 16384 }),
    ]);
    run({ provider: "x", id: "small", contextWindow: 128000 });
    expect(options.promptGuidelines).toEqual([
      "other guideline",
      contextBudgetLine(128000, { enabled: true, reserveTokens: 16384 }),
    ]);
  });

  it("drops the line when the model has no known window", () => {
    const { options, run } = setup();
    run({ provider: "ninfer", id: "q", contextWindow: 262144 });
    run({ provider: "x", id: "unknown" });
    expect(options.promptGuidelines).toEqual(["other guideline"]);
  });
});
