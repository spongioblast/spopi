// ABOUTME: Tests the composer submit path against the model gate.
// ABOUTME: A held prompt keeps its draft; a slash command still runs without a model.

import { expect, test, vi } from "vitest";
import { mountComposer } from "./mount-composer.js";

/** @param {{ allowPrompt?: () => boolean, catalog?: Map<string, any> }} [options] */
function makeComposer({ allowPrompt, catalog = new Map() } = {}) {
  const input = document.createElement("textarea");
  const form = document.createElement("form");
  form.append(input);
  const runtime = { request: vi.fn(async () => ({})) };
  const { sendComposerInput } = mountComposer({
    input,
    form,
    imageAttachments: { getImages: () => [], clear() {}, setImages() {} },
    composerAutoResize: { sync() {} },
    commandCompatibility: { beginCommand() {} },
    runtime,
    messageRenderer: { renderSystemMessage() {} },
    showError: vi.fn(),
    isWorking: () => false,
    getTarget: () => ({ workspaceId: "w", sessionId: "s" }),
    getCommandCatalog: () => catalog,
    clearPendingFork() {},
    allowPrompt,
  });
  return { input, runtime, sendComposerInput };
}

test("a prompt without a usable model stays in the box and never reaches Pi", async () => {
  const allowPrompt = vi.fn(() => false);
  const { input, runtime, sendComposerInput } = makeComposer({ allowPrompt });
  input.value = "hello";
  await sendComposerInput({ altKey: false });
  expect(allowPrompt).toHaveBeenCalledOnce();
  expect(runtime.request).not.toHaveBeenCalled();
  expect(input.value).toBe("hello");
});

test("a slash command still runs while no model is usable", async () => {
  const allowPrompt = vi.fn(() => false);
  const catalog = new Map([["login", { type: "extension", capabilityState: "enabled" }]]);
  const { input, runtime, sendComposerInput } = makeComposer({ allowPrompt, catalog });
  input.value = "/login";
  await sendComposerInput({ altKey: false });
  expect(allowPrompt).not.toHaveBeenCalled();
  expect(runtime.request).toHaveBeenCalledOnce();
  expect(runtime.request.mock.calls[0][0]).toMatchObject({ type: "prompt", message: "/login" });
});

test("bare /mcp sends nothing to the runtime", async () => {
  const catalog = new Map([
    ["mcp", { type: "builtin", action: "mcp", capabilityState: "enabled", passArgsToPi: true }],
  ]);
  const { input, runtime, sendComposerInput } = makeComposer({ catalog });
  input.value = "/mcp";
  await sendComposerInput({ altKey: false });
  expect(runtime.request).not.toHaveBeenCalled();
});

test("an allowed prompt is sent and the box clears", async () => {
  const { input, runtime, sendComposerInput } = makeComposer({ allowPrompt: () => true });
  input.value = "hello";
  await sendComposerInput({ altKey: false });
  expect(runtime.request.mock.calls[0][0]).toMatchObject({ type: "prompt", message: "hello" });
  expect(input.value).toBe("");
});
