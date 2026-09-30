// ABOUTME: Tests the open-session refresh after a models.json save touching the active provider.
// ABOUTME: Covers re-selecting the model, applying the saved level, waiting for a reply, and renames.
import { describe, expect, test, vi } from "vitest";
import { createModelConfigRefresh } from "./model-config-refresh.js";

function harness({ provider = "vllm", modelId = "qwen", streaming = false, level = "high" } = {}) {
  const requests = [];
  const runtime = {
    request: vi.fn(async (payload) => {
      requests.push(payload);
      if (payload.type === "get_state") {
        return {
          response: {
            data: {
              model: { provider: payload.provider ?? "vllm", id: "qwen", contextWindow: 262144 },
              thinkingLevel: level,
            },
          },
        };
      }
      return { response: { data: {} } };
    }),
  };
  const config = { call: vi.fn(async () => ({ ok: true, data: { level } })) };
  const state = { streaming };
  const deps = {
    runtime,
    config,
    getTarget: () => ({ sessionId: "s1" }),
    getSelection: () => ({ provider, modelId }),
    isStreaming: () => state.streaming,
    updateComposerModel: vi.fn(),
    updateComposerThinking: vi.fn(),
    notify: vi.fn(),
    t: (key) => key,
    randomId: () => "id",
  };
  return { refresh: createModelConfigRefresh(deps), deps, requests, state };
}

describe("model config refresh", () => {
  test("re-selects the same model, then applies the saved level", async () => {
    const { refresh, deps, requests } = harness();
    await refresh.apply({ providers: ["vllm"] });
    expect(requests.map((request) => request.type)).toEqual([
      "set_model",
      "set_thinking_level",
      "get_state",
    ]);
    expect(requests[0]).toEqual({ type: "set_model", provider: "vllm", modelId: "qwen" });
    expect(requests[1]).toEqual({ type: "set_thinking_level", level: "high" });
    expect(deps.config.call).toHaveBeenCalledWith("get_model_thinking_level", {
      provider: "vllm",
      modelId: "qwen",
    });
    expect(deps.updateComposerModel).toHaveBeenCalledWith({
      provider: "vllm",
      id: "qwen",
      contextWindow: 262144,
    });
    expect(deps.updateComposerThinking).toHaveBeenCalledWith("high");
  });

  test("ignores changes to other providers and changes without a provider list", async () => {
    const { refresh, requests } = harness();
    refresh.onModelConfigurationChanged({ providers: ["openai"] });
    refresh.onModelConfigurationChanged();
    await Promise.resolve();
    expect(requests).toEqual([]);
  });

  test("waits for a running reply, says so once, and applies when it settles", async () => {
    const { refresh, deps, requests, state } = harness({ streaming: true });
    refresh.onModelConfigurationChanged({ providers: ["vllm"] });
    refresh.onModelConfigurationChanged({ providers: ["vllm"] });
    expect(requests).toEqual([]);
    expect(deps.notify).toHaveBeenCalledTimes(1);
    expect(deps.notify).toHaveBeenCalledWith({
      type: "info",
      title: "composer.modelConfigAfterReply",
    });
    state.streaming = false;
    refresh.onSettled();
    await vi.waitFor(() => expect(requests.map((r) => r.type)).toContain("get_state"));
    refresh.onSettled();
    await Promise.resolve();
    expect(requests.filter((r) => r.type === "set_model")).toHaveLength(1);
  });

  test("follows a provider rename", async () => {
    const { refresh, requests } = harness({ provider: "VLLM" });
    await refresh.apply({ providers: ["VLLM", "vllm"], renamed: { from: "VLLM", to: "vllm" } });
    expect(requests[0]).toEqual({ type: "set_model", provider: "vllm", modelId: "qwen" });
  });

  test("warns when the model is gone and leaves the session as it is", async () => {
    const { refresh, deps } = harness();
    deps.runtime.request.mockRejectedValueOnce(new Error("Model not found"));
    await expect(refresh.apply({ providers: ["vllm"] })).resolves.toBe(false);
    expect(deps.notify).toHaveBeenCalledWith({
      type: "warning",
      title: "composer.modelConfigMissing",
    });
    expect(deps.updateComposerModel).not.toHaveBeenCalled();
  });
});
