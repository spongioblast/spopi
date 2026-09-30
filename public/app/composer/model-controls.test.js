// ABOUTME: Tests the composer thinking control.
// ABOUTME: The button asks the runtime to cycle and applies the returned level.

import { expect, test, vi } from "vitest";
import { mountModelControls } from "./model-controls.js";

test("thinking button requests cycle_thinking_level and shows the returned level", async () => {
  const thinkingBtn = document.createElement("button");
  thinkingBtn.id = "thinking-btn";
  document.body.append(thinkingBtn);
  const runtime = {
    request: vi.fn(async () => ({ response: { data: { level: "high" } } })),
  };
  const controls = mountModelControls({
    state: { thinkingLevel: "off", available: [], availableLoaded: true },
    thinkingBtn,
    sessionUiState: { saveProfile: vi.fn(async () => {}) },
    contextUsage: { setContextWindowSize() {} },
    runtime,
    getTarget: () => ({ workspaceId: "w", sessionId: "s" }),
    config: {},
    t: (_key, vars) => vars?.level ?? _key,
    onLocaleChange: () => () => {},
    showError: vi.fn(),
  });

  thinkingBtn.click();
  await vi.waitFor(() => expect(thinkingBtn.textContent).toContain("high"));
  expect(runtime.request).toHaveBeenCalledWith(
    { type: "cycle_thinking_level" },
    { workspaceId: "w", sessionId: "s" },
  );
  expect(runtime.request.mock.calls[0][0]).not.toHaveProperty("level");
  controls.destroy();
  thinkingBtn.remove();
});

test("a model without thinking levels says so instead of doing nothing", async () => {
  const thinkingBtn = document.createElement("button");
  document.body.append(thinkingBtn);
  const onThinkingUnavailable = vi.fn();
  const controls = mountModelControls({
    state: { thinkingLevel: "off", available: [], availableLoaded: true },
    thinkingBtn,
    sessionUiState: { saveProfile: vi.fn(async () => {}) },
    contextUsage: { setContextWindowSize() {} },
    runtime: { request: vi.fn(async () => ({ response: { data: null } })) },
    getTarget: () => ({ workspaceId: "w", sessionId: "s" }),
    config: {},
    t: (key) => key,
    onLocaleChange: () => () => {},
    showError: vi.fn(),
    onThinkingUnavailable,
  });

  thinkingBtn.click();
  await vi.waitFor(() => expect(onThinkingUnavailable).toHaveBeenCalledOnce());
  expect(thinkingBtn.title).toBe("composer.noThinkingLevels");
  controls.updateComposerModel({ provider: "vllm", id: "qwen" });
  controls.updateComposerThinking("high");
  expect(thinkingBtn.title).toBe("settings.thinkingTitle");
  controls.destroy();
  thinkingBtn.remove();
});

test("Ctrl+Alt+M requests cycle_model and updates the composer label", async () => {
  const label = document.createElement("span");
  document.body.append(label);
  const runtime = {
    request: vi.fn(async () => ({
      response: { data: { model: { provider: "fake", id: "other" }, thinkingLevel: "low" } },
    })),
  };
  const controls = mountModelControls({
    state: {
      thinkingLevel: "off",
      available: [{ provider: "fake", id: "other" }],
      availableLoaded: true,
    },
    modelDropdownLabel: label,
    sessionUiState: { saveProfile: vi.fn(async () => {}) },
    contextUsage: { setContextWindowSize() {} },
    runtime,
    getTarget: () => ({ workspaceId: "w", sessionId: "s" }),
    config: {},
    t: (key) => key,
    onLocaleChange: () => () => {},
    showError: vi.fn(),
  });
  const { mountAppKeyboardShortcuts } = await import("../utils/keyboard-shortcuts.js");
  mountAppKeyboardShortcuts({ input: null, abort() {}, isWorking: () => false });
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "m", ctrlKey: true, altKey: true, cancelable: true }),
  );
  await vi.waitFor(() => expect(label.textContent).toContain("other"));
  expect(runtime.request).toHaveBeenCalledWith(
    { type: "cycle_model" },
    { workspaceId: "w", sessionId: "s" },
  );
  controls.destroy();
  label.remove();
});

test("the model label says when the picker offers nothing or lost the selection", async () => {
  const label = document.createElement("span");
  const state = { thinkingLevel: "off", available: [], availableLoaded: false };
  const models = [{ provider: "lmstudio", id: "gemma-4-12b-it" }];
  const runtime = {
    request: vi.fn(async () => ({ response: { data: { models } } })),
  };
  let visible = true;
  const config = {
    call: vi.fn(async () => ({
      ok: true,
      data: {
        providers: [
          {
            provider: "lmstudio",
            models: [{ provider: "lmstudio", id: "gemma-4-12b-it", available: true, visible }],
          },
        ],
      },
    })),
  };
  const onModelStatusChange = vi.fn();
  const controls = mountModelControls({
    state,
    modelDropdownLabel: label,
    sessionUiState: { saveProfile: vi.fn(async () => {}) },
    contextUsage: { setContextWindowSize() {} },
    runtime,
    getTarget: () => ({ workspaceId: "w", sessionId: "s" }),
    config,
    t: (key) => key,
    onLocaleChange: () => () => {},
    showError: vi.fn(),
    onModelStatusChange,
  });
  const lastStatus = () => onModelStatusChange.mock.calls.at(-1)?.[0];

  controls.updateComposerModel({ provider: "lmstudio", id: "gemma-4-12b-it" });
  expect(label.textContent).toBe("gemma-4-12b-it");
  expect(lastStatus()).toBe("ready");
  await controls.loadAvailableModels({ force: true });
  expect(label.textContent).toBe("gemma-4-12b-it");
  expect(label.classList.contains("is-unset")).toBe(false);

  visible = false;
  await controls.loadAvailableModels({ force: true });
  expect(label.textContent).toBe("composer.noModel");
  expect(label.classList.contains("is-unset")).toBe(true);
  expect(lastStatus()).toBe("none");

  visible = true;
  await controls.loadAvailableModels({ force: true });
  controls.updateComposerModel({ provider: "vllm", id: "gone" });
  expect(label.textContent).toBe("composer.chooseModel");
  expect(lastStatus()).toBe("unselected");
  controls.destroy();
});

test("Pi running no model reads Choose a model, and Think opens the model picker", async () => {
  const label = document.createElement("span");
  const thinkingBtn = document.createElement("button");
  const menu = document.createElement("div");
  menu.classList.add("hidden");
  const runtime = { request: vi.fn(async () => ({ response: { data: { models: [] } } })) };
  const onModelStatusChange = vi.fn();
  const onThinkingUnavailable = vi.fn();
  const controls = mountModelControls({
    state: { thinkingLevel: "off", available: [], availableLoaded: false },
    thinkingBtn,
    modelDropdownLabel: label,
    modelDropdownMenu: menu,
    sessionUiState: { saveProfile: vi.fn(async () => {}) },
    contextUsage: { setContextWindowSize() {} },
    runtime,
    getTarget: () => ({ workspaceId: "w", sessionId: "s" }),
    config: { call: vi.fn(async () => ({ ok: true, data: { providers: [] } })) },
    t: (key) => key,
    onLocaleChange: () => () => {},
    showError: vi.fn(),
    onModelStatusChange,
    onThinkingUnavailable,
  });

  controls.updateComposerModel(null);
  expect(label.textContent).toBe("composer.chooseModel");
  expect(onModelStatusChange.mock.calls.at(-1)?.[0]).toBe("unselected");

  thinkingBtn.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(runtime.request).not.toHaveBeenCalledWith(
    { type: "cycle_thinking_level" },
    expect.anything(),
  );
  expect(onThinkingUnavailable).not.toHaveBeenCalled();
  controls.destroy();
});

test("thinking_level_changed updates the composer chip", async () => {
  const { applyThinkingLevelChanged } = await import("./model-controls.js");
  /** @type {string[]} */
  const seen = [];
  applyThinkingLevelChanged({ type: "thinking_level_changed", level: "high" }, (level) => {
    seen.push(String(level));
  });
  applyThinkingLevelChanged({ type: "agent_end", level: "low" }, () => {
    seen.push("ignored");
  });
  expect(seen).toEqual(["high"]);
});
