// ABOUTME: Tests model calls.
// ABOUTME: Includes "concatenates text deltas".
import { describe, expect, it } from "vitest";
import { capCommitDiff, collectStreamText, commitMessage } from "./model-calls.ts";

async function* deltas(...parts: string[]) {
  for (const delta of parts) yield { type: "text_delta", delta };
}

describe("model calls", () => {
  it("concatenates text deltas", async () => {
    await expect(collectStreamText(deltas("hel", "lo"), 1000)).resolves.toBe("hello");
  });

  it("rejects when the stream does not finish in time", async () => {
    async function* hung() {
      yield { type: "text_delta", delta: "x" };
      await new Promise(() => {});
    }
    await expect(collectStreamText(hung(), 20)).rejects.toThrow(/timed out/);
  });

  it("marks a commit diff past 32 KiB as truncated", async () => {
    const diff = "a".repeat(32 * 1024 + 10);
    expect(capCommitDiff(diff).truncated).toBe(true);
    const seen: string[] = [];
    const ctx = {
      model: { provider: "local", id: "test" },
      modelRegistry: {
        streamSimple(_model: unknown, context: { messages: Array<{ content: string }> }) {
          seen.push(context.messages[0].content);
          return deltas("fix: trim");
        },
      },
    };
    const result = await commitMessage(ctx, { diff });
    expect(result).toEqual({ text: "fix: trim", truncated: true });
    expect(seen[0]).toContain("[TRUNCATED: omitted changes are unknown]");
  });
});
