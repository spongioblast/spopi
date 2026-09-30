// ABOUTME: Tests the custom provider editor: detect, test, save, keyless local servers.
// ABOUTME: The case titles in this file name what it checks.
import { afterEach, describe, expect, test, vi } from "vitest";
import { formatContextTokens, openCustomProviderEditor } from "./settings-custom-provider.js";

function setupDialog(title, subtitle) {
  const backdrop = document.createElement("div");
  const dialog = document.createElement("div");
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);
  const heading = document.createElement("h2");
  heading.textContent = title;
  const caption = document.createElement("p");
  caption.textContent = subtitle;
  dialog.append(heading, caption);
  return { backdrop, dialog };
}

/** @param {Record<string, (params: any) => unknown>} replies */
function fakeCall(replies) {
  return vi.fn(async (op, params) => {
    const reply = replies[op];
    if (!reply) throw new Error(`Unexpected op: ${op}`);
    return reply(params);
  });
}

function fields() {
  const inputs = document.querySelectorAll(".provider-setup-form input");
  return { baseUrl: inputs[0], apiKey: inputs[1], providerId: inputs[2] };
}

const click = (selector) => document.querySelector(selector).click();

describe("custom provider editor", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  test("detects protocol, lists models, tests connectivity, and saves via spopi-config", async () => {
    const call = fakeCall({
      detect_custom_provider: () => ({
        ok: true,
        data: {
          protocol: "openai-completions",
          suggestedId: "example-com",
          models: [{ id: "gpt-4o-mini", contextWindow: 32768 }, { id: "deepseek-v3" }],
        },
      }),
      test_custom_provider: () => ({ ok: true, data: { ok: true, latencyMs: 42 } }),
      save_custom_provider: () => ({
        ok: true,
        data: { providerId: "example-com", modelCount: 2, keyStored: true },
      }),
    });
    const onSaved = vi.fn();
    openCustomProviderEditor({ call, setupDialog, onSaved });

    const { baseUrl, apiKey, providerId } = fields();
    baseUrl.value = "https://api.example.com/v1";
    apiKey.value = "sk-test";
    click(".custom-provider-detect");

    await vi.waitFor(() =>
      expect(document.querySelectorAll(".custom-provider-model-toggle")).toHaveLength(2),
    );
    expect(document.querySelector("select").value).toBe("openai-completions");
    expect(document.querySelector(".ui-select-value")?.textContent).toBe(
      "settings.customProvider.protocolOpenAi",
    );
    expect(providerId.value).toBe("example-com");
    expect(document.querySelector(".custom-provider-model-meta")?.dataset.contextWindow).toBe(
      "32768",
    );

    click(".custom-provider-test");
    await vi.waitFor(() =>
      expect(call).toHaveBeenCalledWith(
        "test_custom_provider",
        expect.objectContaining({ protocol: "openai-completions", modelId: "gpt-4o-mini" }),
        expect.any(Object),
      ),
    );

    click(".custom-provider-save");
    await vi.waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith("example-com", {
        server: undefined,
        modelIds: ["gpt-4o-mini", "deepseek-v3"],
      }),
    );
    const saveCall = call.mock.calls.find(([op]) => op === "save_custom_provider");
    expect(saveCall[1]).toMatchObject({
      protocol: "openai-completions",
      apiKey: "sk-test",
      storeKey: true,
      includeApiKeyInFile: false,
    });
    expect(saveCall[1].models.map((model) => model.id)).toEqual(["gpt-4o-mini", "deepseek-v3"]);
  });

  test("Save with Auto-detect runs Detect first and saves a keyless local server", async () => {
    const call = fakeCall({
      detect_custom_provider: () => ({
        ok: true,
        data: {
          protocol: "openai-completions",
          server: "vllm",
          suggestedId: "vllm",
          models: [{ id: "Qwen3.8-Flash-Next", contextWindow: 262144, reasoning: true }],
        },
      }),
      save_custom_provider: (params) => ({
        ok: true,
        data: { providerId: params.providerId, modelCount: 1, keyStored: false },
      }),
    });
    const onSaved = vi.fn();
    openCustomProviderEditor({ call, setupDialog, onSaved });

    fields().baseUrl.value = "http://127.0.0.1:8000/v1";
    click(".custom-provider-save");

    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(call.mock.calls.map(([op]) => op)).toEqual([
      "detect_custom_provider",
      "save_custom_provider",
    ]);
    expect(call.mock.calls[0][1]).toMatchObject({ apiKey: "", preferred: "auto" });
    const saveParams = call.mock.calls[1][1];
    expect(saveParams).toMatchObject({
      providerId: "vllm",
      apiKey: "",
      storeKey: false,
      server: "vllm",
      protocol: "openai-completions",
    });
    expect(saveParams.models[0]).toMatchObject({
      id: "Qwen3.8-Flash-Next",
      contextWindow: 262144,
      reasoning: true,
    });
    expect(onSaved).toHaveBeenCalledWith("vllm", {
      server: "vllm",
      modelIds: ["Qwen3.8-Flash-Next"],
    });
  });

  test("the Thinking switch on a model row is sent with the save", async () => {
    const call = fakeCall({
      detect_custom_provider: () => ({
        ok: true,
        data: {
          protocol: "openai-completions",
          models: [{ id: "llama-3.1-8b", reasoning: false }],
        },
      }),
      save_custom_provider: () => ({ ok: true, data: { providerId: "local-8000", modelCount: 1 } }),
    });
    openCustomProviderEditor({ call, setupDialog, onSaved: vi.fn() });
    fields().baseUrl.value = "http://127.0.0.1:8000/v1";
    click(".custom-provider-detect");
    await vi.waitFor(() =>
      expect(document.querySelector(".custom-provider-model-thinking .settings-toggle")).not.toBe(
        null,
      ),
    );
    click(".custom-provider-model-thinking .settings-toggle");
    click(".custom-provider-save");
    await vi.waitFor(() =>
      expect(call).toHaveBeenCalledWith("save_custom_provider", expect.any(Object)),
    );
    const saveParams = call.mock.calls.find(([op]) => op === "save_custom_provider")[1];
    expect(saveParams.models[0]).toMatchObject({ id: "llama-3.1-8b", reasoning: true });
  });

  test("a context the server does not report is asked for and saved", async () => {
    const call = fakeCall({
      detect_custom_provider: () => ({
        ok: true,
        data: {
          protocol: "openai-completions",
          server: "lmstudio",
          models: [{ id: "qwen3-8b" }, { id: "gemma-3-12b", contextWindow: 131072 }],
        },
      }),
      save_custom_provider: () => ({ ok: true, data: { providerId: "lmstudio", modelCount: 2 } }),
    });
    openCustomProviderEditor({ call, setupDialog, onSaved: vi.fn() });
    fields().baseUrl.value = "http://127.0.0.1:1234/v1";
    click(".custom-provider-detect");
    await vi.waitFor(() =>
      expect(document.querySelectorAll(".custom-provider-model-context")).toHaveLength(1),
    );
    const context = document.querySelector(".custom-provider-model-context");
    context.value = "32768";
    context.dispatchEvent(new Event("input"));
    click(".custom-provider-save");
    await vi.waitFor(() =>
      expect(call).toHaveBeenCalledWith("save_custom_provider", expect.any(Object)),
    );
    const saved = call.mock.calls.find(([op]) => op === "save_custom_provider")[1].models;
    expect(saved[0]).toMatchObject({ id: "qwen3-8b", contextWindow: 32768 });
    expect(saved[1]).toMatchObject({ id: "gemma-3-12b", contextWindow: 131072 });
  });

  test("a failed detection shows the endpoint and does not save", async () => {
    const call = fakeCall({
      detect_custom_provider: () => ({
        ok: true,
        data: {
          protocol: "unknown",
          error: "http://127.0.0.1:9/v1/models → connect ECONNREFUSED",
        },
      }),
    });
    const onSaved = vi.fn();
    openCustomProviderEditor({ call, setupDialog, onSaved });
    fields().baseUrl.value = "http://127.0.0.1:9/v1";
    click(".custom-provider-save");
    await vi.waitFor(() =>
      expect(
        document.querySelector(".custom-provider-status")?.classList.contains("is-error"),
      ).toBe(true),
    );
    expect(document.querySelector(".custom-provider-status")?.textContent).toContain(
      "settings.customProvider.detectFailedWith",
    );
    expect(call.mock.calls.map(([op]) => op)).toEqual(["detect_custom_provider"]);
    expect(onSaved).not.toHaveBeenCalled();
  });

  test("Base URL blur runs Detect once per URL", async () => {
    const call = fakeCall({
      detect_custom_provider: () => ({
        ok: true,
        data: { protocol: "openai-completions", models: [{ id: "m" }] },
      }),
    });
    openCustomProviderEditor({ call, setupDialog });
    const { baseUrl } = fields();
    baseUrl.value = "http://127.0.0.1:8000/v1";
    baseUrl.dispatchEvent(new Event("blur"));
    await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(1));
    baseUrl.dispatchEvent(new Event("blur"));
    await Promise.resolve();
    expect(call).toHaveBeenCalledTimes(1);
  });

  test("formats context windows the way servers state them", () => {
    expect(formatContextTokens(262144)).toBe("256k");
    expect(formatContextTokens(128000)).toBe("128k");
    expect(formatContextTokens(131072)).toBe("128k");
    expect(formatContextTokens(512)).toBe("512");
  });
});
