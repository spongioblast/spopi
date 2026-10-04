// ABOUTME: Tests createRuntimeEventHandler and the deferred queue.
// ABOUTME: A lens result is recorded only when that tool execution ends.
import { describe, expect, it, vi } from "vitest";
import { mountProblemsDock } from "../dock/problems-dock.js";
import { createDeferredRuntimeHandler, createRuntimeEventHandler } from "./runtime-events.js";

describe("createDeferredRuntimeHandler", () => {
  it("queues events until start, then flushes them", async () => {
    const handle = createDeferredRuntimeHandler();
    const seen = [];
    handle({ type: "early" });
    handle.start(async (event) => {
      seen.push(event.type);
    });
    await Promise.resolve();
    handle({ type: "late" });
    await Promise.resolve();
    expect(seen).toEqual(["early", "late"]);
  });
});

describe("lens tool results", () => {
  it("renders diagnostics only after tool_execution_end", async () => {
    const root = document.createElement("div");
    const dock = mountProblemsDock(root, { t: (key) => key });
    /** @type {Array<{ name: unknown, result: unknown }>} */
    const noted = [];
    const handle = createRuntimeEventHandler({
      metricsOverlay: { onRuntimeEvent() {}, phase: () => "idle" },
      workbench: {
        noteLensResult(name, result) {
          noted.push({ name, result });
          dock?.noteResult(name, result);
        },
      },
      getTarget: () => ({}),
      sessionStatus: { isWaiting: () => false },
      t: (key) => key,
      toolRenderer: {
        createToolCard() {},
        updateToolCard() {},
        finalizeToolCard() {},
      },
      filePreviewFollow: {
        onToolStart() {},
        onToolEnd() {
          return Promise.resolve();
        },
      },
      textFromResult: () => "",
    });
    const diagnostics = {
      content: [{ type: "text", text: "summary" }, {}],
      details: {
        filePath: "src/a.ts",
        diagnostics: [{ message: "type error", severity: 1, source: "ts", code: "2322" }],
      },
    };
    await handle({
      type: "tool_execution_start",
      toolName: "lens_diagnostics",
      result: diagnostics,
    });
    await handle({
      type: "tool_execution_update",
      toolName: "lens_diagnostics",
      partialResult: diagnostics,
    });
    expect(noted).toEqual([]);
    expect(root.querySelector(".problem-row")).toBeNull();
    await handle({
      type: "tool_execution_end",
      toolName: "lens_diagnostics",
      isError: false,
      result: diagnostics,
    });
    expect(noted).toHaveLength(1);
    expect(noted[0]?.result).toBe(diagnostics);
    expect(root.textContent).toContain("type error");
    expect(root.textContent).not.toContain("[object Object]");
    await handle({ type: "tool_execution_end", toolName: "read", result: diagnostics });
    expect(noted).toHaveLength(1);
  });
});

describe("nested tool calls", () => {
  it("draws a codemode call on its parent card and still follows its write", async () => {
    /** @type {string[]} */
    const seen = [];
    const handle = createRuntimeEventHandler({
      metricsOverlay: { onRuntimeEvent() {}, phase: () => "idle" },
      workbench: {},
      getTarget: () => ({}),
      sessionStatus: { isWaiting: () => false },
      t: (key) => key,
      toolRenderer: {
        createToolCard: () => seen.push("card"),
        updateToolCard: () => seen.push("card"),
        finalizeToolCard: () => seen.push("card"),
        upsertNestedCall: (parentId, call) => seen.push(`${parentId}:${call.id}:${call.status}`),
      },
      filePreviewFollow: {
        onToolStart: () => seen.push("follow-start"),
        onToolEnd: () => {
          seen.push("follow-end");
          return Promise.resolve();
        },
      },
      textFromResult: () => "",
    });
    const nested = { toolCallId: "p/1", toolName: "write", parentToolCallId: "p" };
    await handle({ type: "tool_execution_start", ...nested, args: { path: "a.txt" } });
    await handle({ type: "tool_execution_end", ...nested, result: {}, isError: false });
    expect(seen).toEqual(["p:p/1:pending", "follow-start", "p:p/1:done", "follow-end"]);
  });
});

describe("turn meta", () => {
  it("measures TTFT from turn_start to the first update, and t/s over the decode window", async () => {
    vi.useFakeTimers({ now: 0 });
    try {
      /** @type {Record<string, unknown>[]} */
      const metas = [];
      /** @type {{ element?: unknown, startedAt?: number | null }} */
      let streaming = {};
      const message = { role: "assistant", content: [{ type: "text", text: "hi" }] };
      const handle = createRuntimeEventHandler({
        metricsOverlay: { onRuntimeEvent() {}, phase: () => "idle" },
        workbench: { noteTurnMeta: (_el, meta) => metas.push(meta) },
        getTarget: () => ({}),
        sessionStatus: { isWaiting: () => false },
        t: (key) => key,
        showLiveProcessIndicator() {},
        messageRenderer: {
          renderAssistantMessage: () => document.createElement("div"),
          updateStreamingMessage() {},
          finalizeStreamingMessage() {},
        },
        assistantMessageStream: {
          start: () => message,
          update: () => message,
          finish: () => ({ ...message, usage: { output: 100 } }),
        },
        getStreaming: () => streaming,
        setStreaming: (startedAt, element) => {
          streaming = { startedAt, element };
        },
        contextUsage: { setUsage() {} },
        getCurrentModelContextWindow: () => 0,
        getCurrentModelId: () => "m",
        hydrateHeaderSessionStats() {},
        convNav: { notifyNewMessage() {} },
        showProviderErrorIfNeeded() {},
        getInfoSidebar: () => null,
      });
      await handle({ type: "turn_start" });
      vi.setSystemTime(500);
      await handle({ type: "message_start", message });
      vi.setSystemTime(800);
      await handle({ type: "message_update", message });
      vi.setSystemTime(2800);
      await handle({ type: "message_end", message: { role: "assistant", stopReason: "stop" } });
      expect(metas).toHaveLength(1);
      expect(metas[0]?.ttftMs).toBe(800);
      expect(metas[0]?.tokensPerSec).toBe(50);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("appended custom messages", () => {
  it("shows a displayed custom_message as a system note and skips hidden ones", async () => {
    /** @type {string[]} */
    const notes = [];
    const handle = createRuntimeEventHandler({
      metricsOverlay: { onRuntimeEvent() {}, phase: () => "idle" },
      workbench: {},
      getTarget: () => ({}),
      sessionStatus: { isWaiting: () => false },
      t: (key) => key,
      messageRenderer: { renderSystemMessage: (text) => notes.push(text) },
    });
    await handle({
      type: "entry_appended",
      entry: {
        type: "custom_message",
        customType: "spopi-verify",
        display: true,
        content: "`node check.mjs` failed after your edits (exit 1).",
      },
    });
    await handle({
      type: "entry_appended",
      entry: { type: "custom_message", customType: "x", display: false, content: "hidden" },
    });
    expect(notes).toEqual(["`node check.mjs` failed after your edits (exit 1)."]);
  });
});
