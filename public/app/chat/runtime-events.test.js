// ABOUTME: Tests createRuntimeEventHandler and the deferred queue.
// ABOUTME: A lens result is recorded only when that tool execution ends.
import { describe, expect, it } from "vitest";
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
