// ABOUTME: Tests that the composer ends up showing the model Pi actually runs.
// ABOUTME: Covers the last-model switch, one retry after Pi reloads its list, and stale results.

import { beforeEach, describe, expect, test, vi } from "vitest";

const lastModel = vi.hoisted(() => ({ value: /** @type {object | null} */ (null) }));
vi.mock("./last-model-store.js", () => ({ getLastModel: () => lastModel.value }));

const { createComposerPiSync } = await import("./composer-pi-sync.js");

const QWEN = { provider: "vllm", id: "Qwen3.8-Flash-Next", contextWindow: 262144 };

/**
 * @param {{ setModel?: (call: number) => unknown, state?: () => unknown }} [behaviour]
 */
function setup(behaviour = {}) {
  let setModelCalls = 0;
  let target = { workspaceId: "w", sessionId: "s1" };
  const runtime = {
    request: vi.fn(async (/** @type {{ type: string }} */ cmd) => {
      if (cmd.type === "set_model") {
        setModelCalls += 1;
        const outcome = behaviour.setModel?.(setModelCalls);
        if (outcome instanceof Error) throw outcome;
        return { response: { data: QWEN } };
      }
      if (cmd.type === "get_state") {
        return {
          response: { data: behaviour.state?.() ?? { model: QWEN, thinkingLevel: "xhigh" } },
        };
      }
      return { response: { data: null } };
    }),
  };
  const deps = {
    runtime,
    config: { call: vi.fn(async () => ({ ok: true, data: { refreshed: true } })) },
    getTarget: () => target,
    randomId: () => "id",
    updateComposerModel: vi.fn(),
    updateComposerThinking: vi.fn(),
    notify: vi.fn(),
    openModelPicker: vi.fn(),
    t: (/** @type {string} */ key, /** @type {Record<string, unknown>} */ params) =>
      params?.model ? `${key}:${params.model}` : key,
  };
  return {
    deps,
    runtime,
    sync: createComposerPiSync(deps).sync,
    switchSession(/** @type {string} */ sessionId) {
      target = { workspaceId: "w", sessionId };
    },
  };
}

/** @param {ReturnType<typeof setup>["runtime"]} runtime */
function commandTypes(runtime) {
  return runtime.request.mock.calls.map(([cmd]) => /** @type {{ type: string }} */ (cmd).type);
}

describe("createComposerPiSync", () => {
  beforeEach(() => {
    lastModel.value = { provider: "vllm", modelId: "Qwen3.8-Flash-Next" };
  });

  test("an empty session switches Pi to the last model, then shows what Pi reports", async () => {
    const { deps, runtime, sync } = setup();
    await sync({ piModel: null, inheritLastModel: true });

    expect(commandTypes(runtime)).toEqual(["set_model", "get_state"]);
    expect(deps.updateComposerModel).toHaveBeenCalledWith(QWEN);
    expect(deps.updateComposerThinking).toHaveBeenCalledWith("xhigh");
    expect(deps.config.call).not.toHaveBeenCalled();
    expect(deps.notify).not.toHaveBeenCalled();
  });

  test("a model Pi did not list yet is tried again after Pi reloads its model list", async () => {
    const { deps, runtime, sync } = setup({
      setModel: (call) =>
        call === 1 ? new Error("Model not found: vllm/Qwen3.8-Flash-Next") : null,
    });
    await sync({ piModel: null, inheritLastModel: true });

    expect(deps.config.call).toHaveBeenCalledWith("refresh_models");
    expect(commandTypes(runtime)).toEqual(["set_model", "set_model", "get_state"]);
    expect(deps.updateComposerModel).toHaveBeenCalledWith(QWEN);
    expect(deps.notify).not.toHaveBeenCalled();
  });

  test("a switch that still fails shows Pi's error, and the composer shows Pi has no model", async () => {
    const { deps, sync } = setup({
      setModel: () => new Error("Model not found: vllm/Qwen3.8-Flash-Next"),
      state: () => ({ model: null, thinkingLevel: "off" }),
    });
    await sync({ piModel: null, inheritLastModel: true });

    expect(deps.updateComposerModel).toHaveBeenCalledWith(null);
    expect(deps.notify).toHaveBeenCalledOnce();
    const notice = deps.notify.mock.calls[0][0];
    expect(notice.title).toBe("composer.modelSwitchFailed:vllm/Qwen3.8-Flash-Next");
    expect(notice.message).toBe("Model not found: vllm/Qwen3.8-Flash-Next");
    notice.action.onClick();
    expect(deps.openModelPicker).toHaveBeenCalledOnce();
  });

  test("a session with history keeps Pi's model and only reads it", async () => {
    const { deps, runtime, sync } = setup({
      state: () => ({ model: { provider: "openai", id: "gpt" }, thinkingLevel: "high" }),
    });
    await sync({ piModel: { provider: "openai", id: "gpt" } });

    expect(commandTypes(runtime)).toEqual(["get_state"]);
    expect(deps.updateComposerModel).toHaveBeenCalledWith({
      provider: "openai",
      id: "gpt",
      contextWindow: undefined,
    });
  });

  test("Pi already on the last model is not switched again", async () => {
    const { runtime, sync } = setup();
    await sync({ piModel: QWEN, inheritLastModel: true });
    expect(commandTypes(runtime)).toEqual(["get_state"]);
  });

  test("an older sync that finishes last does not overwrite a newer one", async () => {
    /** @type {Array<(value: unknown) => void>} */
    const pending = [];
    const { deps, runtime, sync } = setup();
    runtime.request.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    const older = sync({});
    const newer = sync({});
    pending[1]({ response: { data: { model: QWEN, thinkingLevel: "xhigh" } } });
    await newer;
    pending[0]({ response: { data: { model: null, thinkingLevel: "off" } } });
    await older;

    expect(deps.updateComposerModel).toHaveBeenCalledOnce();
    expect(deps.updateComposerModel).toHaveBeenCalledWith(QWEN);
  });

  test("a result for a session the user already left is dropped", async () => {
    /** @type {(value: unknown) => void} */
    let resolveState = () => {};
    const { deps, runtime, sync, switchSession } = setup();
    runtime.request.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveState = resolve;
        }),
    );
    const running = sync({});
    switchSession("s2");
    resolveState({ response: { data: { model: QWEN, thinkingLevel: "xhigh" } } });
    await running;

    expect(deps.updateComposerModel).not.toHaveBeenCalled();
  });
});
