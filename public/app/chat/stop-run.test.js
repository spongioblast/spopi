// ABOUTME: Tests stopRun.
// ABOUTME: Includes "clears the queue, aborts the model, then aborts bash".
import { describe, expect, it, vi } from "vitest";
import { cancelQueuedMessage, stopRun } from "./stop-run.js";

const target = { workspaceId: "w", sessionId: "s", instanceId: "i" };

describe("stopRun", () => {
  it("clears the queue, aborts the model, then aborts bash", async () => {
    const calls = [];
    const runtime = {
      request: vi.fn(async (command) => {
        calls.push(command.type);
        if (command.type === "clear_queue") {
          return { data: { steering: ["dont do anything"], followUp: ["summarize"] } };
        }
        if (command.type === "abort_bash") throw new Error("no bash");
        return { success: true };
      }),
    };
    const restored = [];
    const texts = await stopRun({
      runtime,
      target,
      onQueueCleared: (text) => restored.push(text),
    });
    expect(calls).toEqual(["clear_queue", "abort", "abort_bash"]);
    expect(texts).toEqual(["dont do anything", "summarize"]);
    expect(restored).toEqual(["dont do anything\n\nsummarize"]);
  });

  it("reads the queue from the runtime_response envelope", async () => {
    const runtime = {
      request: async (command) => {
        if (command.type === "clear_queue") {
          return { response: { data: { steering: ["later"], followUp: [] } } };
        }
        return { success: true };
      },
    };
    await expect(stopRun({ runtime, target, onQueueCleared: () => {} })).resolves.toEqual([
      "later",
    ]);
  });
});

describe("cancelQueuedMessage", () => {
  it("re-queues every returned message except the cancelled one", async () => {
    const sent = [];
    const runtime = {
      request: async (command, _target, options) => {
        sent.push({ command, options });
        if (command.type === "clear_queue") {
          return {
            response: {
              data: { steering: ["keep", "drop"], followUp: ["later"] },
            },
          };
        }
        return { success: true };
      },
    };
    await cancelQueuedMessage({
      runtime,
      target,
      item: { kind: "steer", message: "drop", index: 1 },
      randomId: () => `key-${sent.length}`,
    });
    expect(sent.map((entry) => entry.command.type)).toEqual(["clear_queue", "steer", "follow_up"]);
    expect(sent[1].command).toEqual({ type: "steer", message: "keep" });
    expect(sent[2].command).toEqual({ type: "follow_up", message: "later" });
    expect(sent[1].options.idempotencyKey).toBeTruthy();
    expect(sent[2].options.idempotencyKey).toBeTruthy();
  });
});
