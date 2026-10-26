// ABOUTME: Tests stop, queue cancel, reorder, and interrupt-and-send.
// ABOUTME: Each path clears Pi's queue and re-sends what remains, in order.

import { describe, expect, it, vi } from "vitest";
import { cancelQueuedMessage, interruptWithQueued, reorderQueue, stopRun } from "./stop-run.js";

/**
 * @param {(command: { type: string }) => unknown} reply
 */
function runtimeOf(reply) {
  /** @type {Array<{ type: string, message?: string }>} */
  const sent = [];
  const runtime = {
    request: vi.fn(async (command) => {
      sent.push(command);
      return reply(command);
    }),
  };
  return { runtime, sent };
}

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

describe("queue edits", () => {
  it("sends the chosen message now and keeps the rest queued", async () => {
    const { runtime, sent } = runtimeOf((command) => {
      if (command.type === "clear_queue") return { data: { steering: ["a", "b"], followUp: [] } };
      if (command.type === "get_state") return { data: { isStreaming: false } };
      return { success: true };
    });
    await interruptWithQueued({
      runtime,
      target,
      item: { kind: "steer", index: 1, message: "b" },
      randomId: () => "key",
      waitSettled: vi.fn(async () => {}),
    });
    expect(sent.map((command) => command.type)).toEqual([
      "clear_queue",
      "abort",
      "get_state",
      "prompt",
      "steer",
    ]);
    expect(sent[3]?.message).toBe("b");
    expect(sent[4]?.message).toBe("a");
  });

  it("waits for the run to settle when Pi is still streaming", async () => {
    const waitSettled = vi.fn(async () => {});
    const { runtime } = runtimeOf((command) => {
      if (command.type === "clear_queue") return { data: { steering: ["now"], followUp: [] } };
      if (command.type === "get_state") return { data: { isStreaming: true } };
      return { success: true };
    });
    await interruptWithQueued({
      runtime,
      target,
      item: { kind: "steer", index: 0, message: "now" },
      randomId: () => "key",
      waitSettled,
    });
    expect(waitSettled).toHaveBeenCalledOnce();
    const types = runtime.request.mock.calls.map((call) => call[0].type);
    expect(types.indexOf("prompt")).toBeGreaterThan(types.indexOf("get_state"));
  });

  it("gives the text back and keeps the rest queued when the prompt fails", async () => {
    const { runtime, sent } = runtimeOf((command) => {
      if (command.type === "clear_queue") return { data: { steering: ["b", "a"], followUp: [] } };
      if (command.type === "get_state") return { data: { isStreaming: false } };
      if (command.type === "prompt") throw new Error("rejected");
      return { success: true };
    });
    const failed = [];
    await expect(
      interruptWithQueued({
        runtime,
        target,
        item: { kind: "steer", index: 0, message: "b" },
        randomId: () => "key",
        waitSettled: async () => {},
        onFailed: (text) => failed.push(text),
      }),
    ).rejects.toThrow("rejected");
    expect(failed).toEqual(["b"]);
    expect(sent.at(-1)).toEqual({ type: "steer", message: "a" });
  });

  it("gives every message back when Pi takes nothing", async () => {
    const { runtime } = runtimeOf((command) => {
      if (command.type === "clear_queue") return { data: { steering: ["b", "a"], followUp: [] } };
      if (command.type === "get_state") return { data: { isStreaming: false } };
      if (command.type !== "abort") throw new Error("gone");
      return { success: true };
    });
    const failed = [];
    await expect(
      interruptWithQueued({
        runtime,
        target,
        item: { kind: "steer", index: 0, message: "b" },
        randomId: () => "key",
        waitSettled: async () => {},
        onFailed: (text) => failed.push(text),
      }),
    ).rejects.toThrow("gone");
    expect(failed).toEqual(["b\n\na"]);
  });

  it("does not interrupt for a message Pi already delivered", async () => {
    const { runtime, sent } = runtimeOf((command) => {
      if (command.type === "clear_queue") return { data: { steering: ["a"], followUp: [] } };
      return { success: true };
    });
    await interruptWithQueued({
      runtime,
      target,
      item: { kind: "steer", index: 0, message: "gone" },
      randomId: () => "key",
      waitSettled: async () => {},
    });
    expect(sent.map((command) => `${command.type}:${command.message ?? ""}`)).toEqual([
      "clear_queue:",
      "steer:a",
    ]);
  });

  it("moves a follow-up to the front and re-sends steering first", async () => {
    const { runtime, sent } = runtimeOf((command) => {
      if (command.type === "clear_queue") {
        return { data: { steering: ["keep"], followUp: ["x", "y", "z"] } };
      }
      return { success: true };
    });
    await reorderQueue({
      runtime,
      target,
      item: { kind: "follow_up", index: 2, message: "z" },
      to: 0,
      randomId: () => "key",
    });
    expect(sent.map((command) => `${command.type}:${command.message ?? ""}`)).toEqual([
      "clear_queue:",
      "steer:keep",
      "follow_up:z",
      "follow_up:x",
      "follow_up:y",
    ]);
  });
});
