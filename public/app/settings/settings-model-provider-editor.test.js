// ABOUTME: Tests models provider editor.
// ABOUTME: Includes "opens the advanced JSON editor in a modal dialog".
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { changedProviders } from "./models/provider-editor.js";
import { isKeyReference } from "./models/provider-key-row.js";
import { isStandaloneAuthProvider, mountModelsPage } from "./models-page.js";

test("isStandaloneAuthProvider keeps stored keys and drops a deleted custom provider", () => {
  expect(isStandaloneAuthProvider({ configured: true, source: "stored" })).toBe(true);
  expect(isStandaloneAuthProvider({ configured: true, source: "environment" })).toBe(true);
  expect(isStandaloneAuthProvider({ configured: true, source: "oauth" })).toBe(true);
  expect(isStandaloneAuthProvider({ configured: true, source: "models_json_key" })).toBe(false);
  expect(isStandaloneAuthProvider({ configured: true, source: "fallback" })).toBe(false);
  expect(isStandaloneAuthProvider({ configured: false, source: "stored" })).toBe(false);
});

test("changedProviders lists edited, added, and removed providers only", () => {
  expect(
    changedProviders(
      { providers: { a: { x: 1 }, b: { y: 1 }, c: {} } },
      { providers: { a: { x: 1 }, b: { y: 2 }, d: {} } },
    ),
  ).toEqual(["b", "c", "d"]);
  expect(changedProviders(null, { providers: {} })).toEqual([]);
});

test("isKeyReference matches what Pi resolves as env or command", () => {
  expect(isKeyReference("$VLLM_KEY")).toBe(true);
  expect(isKeyReference("!op read vllm")).toBe(true);
  expect(isKeyReference("sk-abc$")).toBe(false);
  expect(isKeyReference("VLLM_KEY")).toBe(false);
  expect(isKeyReference("$$literal")).toBe(false);
});

/** @param {string} label English text or the i18n key when no locale is loaded */
function clickRowMenuItem(label) {
  document.querySelector(".models-model-more").click();
  const keys = { Delete: "models.delete", "Set up model": "models.setup.button" };
  const item = [...document.querySelectorAll(".context-menu-item")].find((row) =>
    [label, keys[label]].includes(row.textContent),
  );
  if (!item) throw new Error(`menu item ${label} not found`);
  item.click();
}

describe("models provider editor", () => {
  let dom;
  let call;

  beforeEach(() => {
    dom = new JSDOM(`
      <div id="settings-api-keys"></div>
      <span id="inline-models-path"></span>
      <textarea id="inline-models-textarea"></textarea>
      <div id="inline-models-error" class="hidden"></div>
      <button id="inline-models-save">Save</button>
      <button id="inline-models-insert-example">Example</button>
      <a id="models-config-docs-link"></a>
      <div id="dialog-container" class="hidden"></div>
    `);
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.confirm = vi.fn(() => true);
    call = vi.fn(async (operation) => {
      if (operation === "read_models_config") {
        return {
          ok: true,
          data: {
            path: "/home/.pi/agent/models.json",
            content: JSON.stringify({
              providers: {
                gateway: {
                  baseUrl: "https://gateway.example/v1",
                  api: "openai-completions",
                  models: [{ id: "gpt-5.5" }],
                },
                local: {
                  baseUrl: "http://localhost:11434/v1",
                  api: "openai-completions",
                  models: [{ id: "qwen" }],
                },
              },
            }),
          },
        };
      }
      if (operation === "write_models_config") return { ok: true };
      if (operation === "get_provider_key_status") {
        return { ok: true, data: { source: "placeholder", modelsLiteral: false } };
      }
      if (operation === "get_model_thinking_level") return { ok: true, data: { level: null } };
      if (operation === "set_model_thinking_level") return { ok: true, data: {} };
      if (operation === "list_model_catalog") {
        return {
          ok: true,
          data: {
            providers: [
              {
                provider: "anthropic",
                displayName: "Anthropic",
                configured: true,
                source: "stored",
                models: [
                  {
                    provider: "anthropic",
                    id: "claude-sonnet",
                    available: true,
                    visible: true,
                    health: { status: "healthy" },
                  },
                ],
              },
            ],
          },
        };
      }
      throw new Error(`Unexpected operation: ${operation}`);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    dom.window.close();
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.confirm;
  });

  test("opens the advanced JSON editor in a modal dialog", async () => {
    const editor = mountModelsPage({ configGateway: { call } });
    await editor.loadInlineModelsEditor();

    const trigger = document.querySelector(".models-config-source-button");
    const backdrop = document.querySelector(".models-json-dialog-backdrop");
    expect(backdrop.classList.contains("hidden")).toBe(true);
    expect(backdrop.querySelector('[role="dialog"][aria-modal="true"]')).not.toBeNull();

    trigger.click();
    expect(backdrop.classList.contains("hidden")).toBe(false);
    expect(backdrop.contains(document.getElementById("inline-models-textarea"))).toBe(true);

    backdrop.querySelector('[aria-label="models.closeAdvancedJson"]').click();
    expect(backdrop.classList.contains("hidden")).toBe(true);
  });

  test("provider edits stay a draft until Save provider, and keep siblings", async () => {
    const onModelConfigurationChanged = vi.fn();
    const editor = mountModelsPage({ configGateway: { call }, onModelConfigurationChanged });
    await editor.loadInlineModelsEditor();

    const providerButtons = document.querySelectorAll(".models-provider-item");
    expect(providerButtons).toHaveLength(2);
    providerButtons[1].click();

    const save = document.querySelector(".models-provider-save");
    expect(save.disabled).toBe(true);
    const baseUrl = document.querySelector(".models-provider-base-url");
    expect(baseUrl.value).toBe("http://localhost:11434/v1");
    baseUrl.value = "http://127.0.0.1:11434/v1";
    baseUrl.dispatchEvent(new window.Event("input", { bubbles: true }));

    expect(
      JSON.parse(document.getElementById("inline-models-textarea").value).providers.local.baseUrl,
    ).toBe("http://localhost:11434/v1");
    expect(save.disabled).toBe(false);
    expect(document.querySelector(".models-config-dirty").hidden).toBe(false);
    expect(editor.hasUnsavedChanges()).toBe(true);

    save.click();
    await vi.waitFor(() =>
      expect(onModelConfigurationChanged).toHaveBeenCalledWith({ providers: ["local"] }),
    );
    const write = call.mock.calls.find(([operation]) => operation === "write_models_config");
    const saved = JSON.parse(write[1].content);
    expect(Object.keys(saved.providers)).toEqual(["gateway", "local"]);
    expect(saved.providers.local.baseUrl).toBe("http://127.0.0.1:11434/v1");
    expect(editor.hasUnsavedChanges()).toBe(false);
    expect(document.querySelector(".models-config-toolbar-save")).toBeNull();
  });

  test("asks before leaving a provider with unsaved edits", async () => {
    const editor = mountModelsPage({ configGateway: { call } });
    await editor.loadInlineModelsEditor();

    const baseUrl = document.querySelector(".models-provider-base-url");
    baseUrl.value = "https://other.example/v1";
    baseUrl.dispatchEvent(new window.Event("input", { bubbles: true }));
    document.querySelectorAll(".models-provider-item")[1].click();

    const container = document.getElementById("dialog-container");
    await vi.waitFor(() => expect(container.querySelector(".ui-button--danger")).not.toBeNull());
    container.querySelector(".ui-button--secondary").click();
    await Promise.resolve();
    expect(document.querySelector(".models-config-provider-title").textContent).toBe("gateway");

    document.querySelectorAll(".models-provider-item")[1].click();
    await vi.waitFor(() => expect(container.querySelector(".ui-button--danger")).not.toBeNull());
    container.querySelector(".ui-button--danger").click();
    await vi.waitFor(() =>
      expect(document.querySelector(".models-config-provider-title").textContent).toBe("local"),
    );
    expect(call.mock.calls.some(([operation]) => operation === "write_models_config")).toBe(false);
  });

  test("combines stored API-key and custom providers in one master-detail layout", async () => {
    const editor = mountModelsPage({ configGateway: { call } });
    await editor.loadInlineModelsEditor();
    await editor.loadApiKeysPanel();

    const labels = [...document.querySelectorAll(".models-provider-item")].map((item) =>
      item.textContent.trim(),
    );
    expect(labels).toEqual(["Anthropic", "gateway", "local"]);

    document.querySelector(".models-auth-provider-item").click();
    expect(document.querySelector(".models-config-main .api-key-row-name").textContent).toBe(
      "Anthropic",
    );
    expect(document.querySelector(".models-config-main .api-model-name").textContent).toBe(
      "claude-sonnet",
    );
  });

  test("custom provider model rows carry the picker switch, in one list", async () => {
    let visible = false;
    const customCall = vi.fn(async (operation, params) => {
      if (operation === "read_models_config") {
        return {
          ok: true,
          data: {
            path: "/home/.pi/agent/models.json",
            content: JSON.stringify({
              providers: {
                gateway: {
                  baseUrl: "https://gateway.example/v1",
                  api: "openai-completions",
                  models: [{ id: "gpt-5.5" }, { id: "qwen" }, { id: "not-loaded" }],
                },
              },
            }),
          },
        };
      }
      if (operation === "list_model_catalog") {
        return {
          ok: true,
          data: {
            providers: [
              {
                provider: "gateway",
                displayName: "gateway",
                configured: true,
                models: [
                  {
                    provider: "gateway",
                    id: "gpt-5.5",
                    available: true,
                    visible: true,
                    health: { status: "healthy", latencyMs: 42 },
                  },
                  { provider: "gateway", id: "qwen", available: true, visible },
                ],
              },
            ],
          },
        };
      }
      if (operation === "set_model_visibility") {
        visible = params.visible;
        return { ok: true };
      }
      if (operation === "get_provider_key_status") {
        return { ok: true, data: { source: "placeholder", modelsLiteral: false } };
      }
      throw new Error(`Unexpected operation: ${operation}`);
    });
    const onModelConfigurationChanged = vi.fn();
    const editor = mountModelsPage({
      configGateway: { call: customCall },
      onModelConfigurationChanged,
    });
    await editor.loadInlineModelsEditor();
    await editor.loadApiKeysPanel();

    expect(document.querySelector(".provider-manager-health")).toBeNull();
    expect(document.querySelectorAll(".api-model-row")).toHaveLength(0);
    const switches = () => [...document.querySelectorAll(".models-model-enabled")];
    expect(switches().map((toggle) => [toggle.checked, toggle.disabled])).toEqual([
      [true, false],
      [false, false],
      [false, true],
    ]);
    expect(document.querySelector(".models-config-models-summary").textContent).toBe(
      "models.enabledCount",
    );
    expect(
      document.querySelector(".models-config-model-label .api-model-health-dot"),
    ).not.toBeNull();
    expect(document.querySelector(".models-model-check-health").disabled).toBe(false);

    const qwen = switches()[1];
    qwen.checked = true;
    qwen.dispatchEvent(new window.Event("change", { bubbles: true }));
    await vi.waitFor(() =>
      expect(document.querySelector(".api-model-select-all-toggle").checked).toBe(true),
    );
    expect(customCall.mock.calls.find(([op]) => op === "set_model_visibility")?.[1]).toEqual({
      provider: "gateway",
      modelId: "qwen",
      visible: true,
    });
    expect(onModelConfigurationChanged).toHaveBeenCalled();
    expect(switches()[1].checked).toBe(true);
  });

  test("renders authenticated providers while models.json is still loading", async () => {
    let resolveModelsConfig;
    const pendingModelsConfig = new Promise((resolve) => {
      resolveModelsConfig = resolve;
    });
    const delayedCall = vi.fn(async (operation) => {
      if (operation === "read_models_config") return pendingModelsConfig;
      return call(operation);
    });
    const editor = mountModelsPage({ configGateway: { call: delayedCall } });
    const modelsLoad = editor.loadInlineModelsEditor();

    await editor.loadApiKeysPanel();
    expect(document.querySelector(".models-config-layout")).not.toBeNull();
    expect(document.querySelector(".models-auth-provider-item")?.textContent).toContain(
      "Anthropic",
    );

    resolveModelsConfig({
      ok: true,
      data: { path: "/home/.pi/agent/models.json", content: '{"providers":{}}' },
    });
    await modelsLoad;
  });

  test("an empty models.json does not keep a deleted keyless custom provider", async () => {
    const leftoverCall = vi.fn(async (operation) => {
      if (operation === "read_models_config") {
        return {
          ok: true,
          data: { path: "/home/.pi/agent/models.json", content: '{"providers":{}}' },
        };
      }
      if (operation === "list_model_catalog") {
        return {
          ok: true,
          data: {
            providers: [
              {
                provider: "lmstudio",
                displayName: "lmstudio",
                configured: true,
                source: "models_json_key",
                models: [
                  {
                    provider: "lmstudio",
                    id: "gemma-4-12b-it",
                    available: true,
                    visible: false,
                    health: { status: "unknown" },
                  },
                ],
              },
              {
                provider: "anthropic",
                displayName: "Anthropic",
                configured: true,
                source: "stored",
                models: [],
              },
            ],
          },
        };
      }
      return call(operation);
    });
    const editor = mountModelsPage({ configGateway: { call: leftoverCall } });
    await editor.loadInlineModelsEditor();
    await editor.loadApiKeysPanel();

    const labels = [...document.querySelectorAll(".models-provider-item")].map((item) =>
      item.textContent.trim(),
    );
    expect(labels).toEqual(["Anthropic"]);
    expect(document.querySelector(".api-model-name")).toBeNull();
  });

  test("Add model saves at once and returns to the provider with the row highlighted", async () => {
    const onModelConfigurationChanged = vi.fn();
    const editor = mountModelsPage({
      configGateway: { call },
      onModelConfigurationChanged,
    });
    await editor.loadInlineModelsEditor();

    document.querySelector(".models-model-add").click();
    expect(document.querySelector(".models-config-crumb-current").textContent).toBe(
      "models.newModel",
    );
    const modelId = document.querySelector(".models-model-id-input");
    modelId.value = "claude-sonnet";
    modelId.dispatchEvent(new window.Event("input", { bubbles: true }));
    document.querySelector(".models-model-save").click();
    await vi.waitFor(() => expect(onModelConfigurationChanged).toHaveBeenCalledOnce());

    const write = call.mock.calls.find(([operation]) => operation === "write_models_config");
    const saved = JSON.parse(write[1].content);
    expect(saved.providers.gateway.models.map((model) => model.id)).toEqual([
      "gpt-5.5",
      "claude-sonnet",
    ]);
    expect(saved.providers.local.models[0].id).toBe("qwen");
    expect(document.querySelector(".models-model-form")).toBeNull();
    expect(document.querySelector(".models-config-models-row.is-highlighted").dataset.modelId).toBe(
      "claude-sonnet",
    );
    expect(call).toHaveBeenCalledWith(
      "set_model_thinking_level",
      {
        provider: "gateway",
        modelId: "claude-sonnet",
        level: null,
      },
      undefined,
    );
  });

  test("editing a model writes thinking, images, and level, then returns", async () => {
    const onModelConfigurationChanged = vi.fn();
    const editor = mountModelsPage({ configGateway: { call }, onModelConfigurationChanged });
    await editor.loadInlineModelsEditor();
    document.querySelectorAll(".models-provider-item")[1].click();
    document.querySelector(".models-model-edit").click();

    expect(document.querySelector(".models-config-back").textContent).toContain("local");
    const [thinking] = document.querySelectorAll(".models-model-capabilities .settings-toggle");
    thinking.click();
    const control = document.querySelector("select.models-thinking-control");
    control.value = "qwen-chat-template";
    control.dispatchEvent(new window.Event("change"));
    const level = document.querySelector("select.models-default-level");
    expect(level.value).toBe("high");
    level.value = "medium";
    level.dispatchEvent(new window.Event("change"));
    const toggles = document.querySelectorAll(".models-model-capabilities .settings-toggle");
    toggles[toggles.length - 1].click();
    expect(document.querySelector('[data-resize="maxBytes"]').value).toBe("512");

    document.querySelector(".models-model-save").click();
    await vi.waitFor(() =>
      expect(onModelConfigurationChanged).toHaveBeenCalledWith({ providers: ["local"] }),
    );
    const write = call.mock.calls.find(([operation]) => operation === "write_models_config");
    const model = JSON.parse(write[1].content).providers.local.models[0];
    expect(model).toEqual({
      id: "qwen",
      reasoning: true,
      compat: { thinkingFormat: "qwen-chat-template" },
      input: ["text", "image"],
      inputLimits: {
        images: { resize: { maxWidth: 1280, maxHeight: 1280, maxBytes: 524288, jpegQuality: 80 } },
      },
    });
    expect(call).toHaveBeenCalledWith(
      "set_model_thinking_level",
      {
        provider: "local",
        modelId: "qwen",
        level: "medium",
      },
      undefined,
    );
    const levelCall = call.mock.calls.findIndex(([op]) => op === "set_model_thinking_level");
    const writeCall = call.mock.calls.findIndex(([op]) => op === "write_models_config");
    expect(levelCall).toBeGreaterThan(writeCall);
    expect(
      document.querySelector(".models-config-models-row .models-badge-thinking"),
    ).not.toBeNull();
    expect(document.querySelector(".models-config-models-row .models-badge-images")).not.toBeNull();
  });

  test("Back with an unchanged model returns without asking; Delete asks first", async () => {
    const editor = mountModelsPage({ configGateway: { call } });
    await editor.loadInlineModelsEditor();
    document.querySelector(".models-model-edit").click();
    document.querySelector(".models-config-back").click();
    await vi.waitFor(() => expect(document.querySelector(".models-provider-save")).not.toBeNull());
    expect(document.getElementById("dialog-container").querySelector(".dialog")).toBeNull();

    clickRowMenuItem("Delete");
    const container = document.getElementById("dialog-container");
    await vi.waitFor(() => expect(container.querySelector(".ui-button--danger")).not.toBeNull());
    container.querySelector(".ui-button--danger").click();
    await vi.waitFor(() =>
      expect(call.mock.calls.some(([operation]) => operation === "write_models_config")).toBe(true),
    );
    const write = call.mock.calls.find(([operation]) => operation === "write_models_config");
    expect(JSON.parse(write[1].content).providers.gateway.models).toEqual([]);
  });

  test("Set up model fills the draft from the checks", async () => {
    const base = call.getMockImplementation();
    call.mockImplementation(async (operation, params, options) => {
      if (operation === "setup_custom_model") {
        return {
          ok: true,
          data: {
            modelId: params.modelId,
            server: "vllm",
            checks: [
              { id: "context", ok: true, detail: "262144" },
              { id: "thinking", ok: true, detail: "switchable" },
              { id: "images", ok: true, detail: "accepted" },
              { id: "budget", ok: true, detail: "accepted" },
            ],
            suggestion: {
              reasoning: true,
              thinkingMode: "switchable",
              thinkingFormat: "qwen-chat-template",
              thinkingLevelMap: { minimal: "minimal", high: "high", max: "max" },
              input: ["text", "image"],
              contextWindow: 262144,
              thinkingTokenBudgetField: "thinking_token_budget",
            },
          },
        };
      }
      return base(operation, params, options);
    });
    const editor = mountModelsPage({ configGateway: { call } });
    await editor.loadInlineModelsEditor();
    document.querySelectorAll(".models-provider-item")[1].click();
    clickRowMenuItem("Set up model");

    await vi.waitFor(() => expect(document.querySelectorAll(".model-setup-check")).toHaveLength(4));
    expect(call).toHaveBeenCalledWith(
      "setup_custom_model",
      { provider: "local", modelId: "qwen" },
      { timeoutMs: 150000 },
    );
    expect(document.querySelector("select.models-thinking-control").value).toBe(
      "qwen-chat-template",
    );
    expect(
      [...document.querySelector("select.models-default-level").options].map((o) => o.value),
    ).toEqual(["off", "minimal", "low", "medium", "high", "max"]);
    expect(editor.hasUnsavedChanges()).toBe(true);
  });

  test("renaming a provider goes through the bridge and reloads", async () => {
    const onModelConfigurationChanged = vi.fn();
    const base = call.getMockImplementation();
    call.mockImplementation(async (operation, params, options) => {
      if (operation === "rename_custom_provider") return { ok: true, data: { ...params } };
      return base(operation, params, options);
    });
    const editor = mountModelsPage({ configGateway: { call }, onModelConfigurationChanged });
    await editor.loadInlineModelsEditor();

    const name = document.querySelector(".models-provider-name");
    name.value = "relay";
    name.dispatchEvent(new window.Event("input"));
    document.querySelector(".models-provider-rename-button").click();
    await vi.waitFor(() =>
      expect(onModelConfigurationChanged).toHaveBeenCalledWith({
        providers: ["gateway", "relay"],
        renamed: { from: "gateway", to: "relay" },
      }),
    );
    expect(call).toHaveBeenCalledWith(
      "rename_custom_provider",
      { from: "gateway", to: "relay" },
      undefined,
    );
    expect(
      call.mock.calls.filter(([operation]) => operation === "read_models_config"),
    ).toHaveLength(2);
  });

  test("the Key row shows only the source and offers Move for a plain-text key", async () => {
    const base = call.getMockImplementation();
    call.mockImplementation(async (operation, params, options) => {
      if (operation === "get_provider_key_status") {
        return { ok: true, data: { source: "literal", modelsLiteral: true } };
      }
      if (operation === "move_provider_key_to_auth") {
        return { ok: true, data: { source: "auth", modelsLiteral: false } };
      }
      return base(operation, params, options);
    });
    const editor = mountModelsPage({ configGateway: { call } });
    await editor.loadInlineModelsEditor();

    await vi.waitFor(() =>
      expect(document.querySelector(".provider-key-row").dataset.source).toBe("literal"),
    );
    expect(document.querySelector(".provider-key-source").textContent).toBe(
      "models.key.source.literal",
    );
    document.querySelector(".provider-key-move").click();
    await vi.waitFor(() =>
      expect(call).toHaveBeenCalledWith(
        "move_provider_key_to_auth",
        { provider: "gateway" },
        undefined,
      ),
    );
  });

  test("a keyless provider says no key is needed and Test connection confirms it", async () => {
    const base = call.getMockImplementation();
    call.mockImplementation(async (operation, params, options) => {
      if (operation === "test_provider_access") {
        return {
          ok: true,
          data: { ok: true, status: 200, latencyMs: 12, modelCount: 3, needsKey: false },
        };
      }
      return base(operation, params, options);
    });
    const editor = mountModelsPage({ configGateway: { call } });
    await editor.loadInlineModelsEditor();

    await vi.waitFor(() =>
      expect(document.querySelector(".provider-key-row").dataset.source).toBe("placeholder"),
    );
    expect(document.querySelector(".provider-key-replace").textContent).toBe(
      "models.key.addOptional",
    );

    document.querySelector(".provider-key-test-button").click();
    await vi.waitFor(() =>
      expect(document.querySelector(".provider-key-test").dataset.state).toBe("ok"),
    );
    expect(document.querySelector(".provider-key-test").textContent).toBe(
      "models.key.testOkKeyless",
    );
    expect(call).toHaveBeenCalledWith(
      "test_provider_access",
      { provider: "gateway" },
      { timeoutMs: 30_000 },
    );

    document.querySelector(".provider-key-replace").click();
    expect(document.querySelector(".provider-key-input").placeholder).toBe(
      "models.key.optionalPlaceholder",
    );
  });

  test("Test connection on a keyless provider reports when the server wants a key", async () => {
    const base = call.getMockImplementation();
    call.mockImplementation(async (operation, params, options) => {
      if (operation === "test_provider_access") {
        return { ok: true, data: { ok: false, status: 401, latencyMs: 5, needsKey: true } };
      }
      return base(operation, params, options);
    });
    const editor = mountModelsPage({ configGateway: { call } });
    await editor.loadInlineModelsEditor();
    await vi.waitFor(() =>
      expect(document.querySelector(".provider-key-test-button")).not.toBeNull(),
    );

    document.querySelector(".provider-key-test-button").click();
    await vi.waitFor(() =>
      expect(document.querySelector(".provider-key-test").dataset.state).toBe("fail"),
    );
    expect(document.querySelector(".provider-key-test").textContent).toBe(
      "models.key.testNeedsKey",
    );
  });

  test("Escape in the Key input cancels the edit without reaching Settings", async () => {
    const base = call.getMockImplementation();
    call.mockImplementation(async (operation, params, options) => {
      if (operation === "get_provider_key_status") {
        return { ok: true, data: { source: "auth", modelsLiteral: false } };
      }
      return base(operation, params, options);
    });
    const editor = mountModelsPage({ configGateway: { call } });
    await editor.loadInlineModelsEditor();
    await vi.waitFor(() => expect(document.querySelector(".provider-key-replace")).not.toBeNull());

    document.querySelector(".provider-key-replace").click();
    const input = document.querySelector(".provider-key-input");
    const escapeKey = new window.KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(escapeKey);

    expect(escapeKey.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(document.querySelector(".provider-key-input")).toBeNull());
    expect(call.mock.calls.some(([operation]) => operation === "set_provider_key")).toBe(false);
  });

  test("add-provider dialog uses themed overlay primitives", async () => {
    const editor = mountModelsPage({ configGateway: { call } });
    await editor.loadInlineModelsEditor();
    await editor.loadApiKeysPanel();

    document.querySelector(".models-provider-add").click();
    const dialog = document.querySelector(".provider-picker-dialog");
    expect(dialog.classList.contains("ui-dialog")).toBe(true);
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.closest(".ui-overlay.provider-picker-backdrop")).not.toBeNull();
    expect(dialog.querySelector(".ui-input.provider-picker-search")).not.toBeNull();
    expect(dialog.querySelector("#provider-picker-title").textContent).toBe(
      "settings.models.addProvider",
    );
    const sections = [...dialog.querySelectorAll(".provider-picker-section-title")].map(
      (el) => el.dataset.section,
    );
    expect(sections).toEqual(["apiKey"]);
    expect(dialog.querySelector(".provider-picker-toolbar .provider-picker-search")).not.toBeNull();
    expect(dialog.querySelector(".provider-picker-body")).not.toBeNull();
    expect(dialog.querySelector(".provider-picker-featured .provider-picker-card")).not.toBeNull();
    expect(dialog.querySelector(".provider-picker-grid .provider-picker-card").textContent).toMatch(
      /models\.count(One|Other)|1 model|\d+ models/,
    );
    expect(
      dialog.querySelector(".provider-picker-grid .provider-picker-card").textContent,
    ).not.toContain("0 models");

    expect(document.activeElement).toBe(dialog.querySelector(".provider-picker-search"));

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".provider-picker-dialog")).toBeNull();

    document.querySelector(".models-provider-add").click();
    document
      .getElementById("dialog-container")
      .dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true }));
    expect(document.querySelector(".provider-picker-dialog")).toBeNull();
  });

  test("add-provider catalog cards hide empty model counts", async () => {
    call.mockImplementation(async (operation) => {
      if (operation === "list_model_catalog") {
        return {
          ok: true,
          data: {
            providers: [
              {
                provider: "amazon-bedrock",
                displayName: "Amazon Bedrock",
                configured: false,
                source: "stored",
                models: [],
              },
              {
                provider: "anthropic",
                displayName: "Anthropic",
                configured: true,
                source: "stored",
                models: [{ id: "claude-sonnet" }, { id: "claude-opus" }],
              },
            ],
          },
        };
      }
      if (operation === "read_models_config") {
        return { ok: true, data: { path: "/home/.pi/agent/models.json", content: "{}" } };
      }
      throw new Error(`Unexpected operation: ${operation}`);
    });
    const editor = mountModelsPage({ configGateway: { call } });
    await editor.loadApiKeysPanel();
    document.querySelector(".models-provider-add").click();
    const cards = [...document.querySelectorAll(".provider-picker-grid .provider-picker-card")].map(
      (card) => card.textContent,
    );
    expect(cards.find((text) => text.includes("Amazon Bedrock"))).not.toContain("Needs API key");
    expect(cards.find((text) => text.includes("Amazon Bedrock"))).not.toContain("0 models");
    expect(cards.find((text) => text.includes("Anthropic"))).toMatch(/models\.countOther|2 models/);
  });
});

test("keeps provider keyboard focus inside the clipped sidebar", () => {
  const css = readFileSync("public/app/settings/settings-config.css", "utf8");
  const focusRule = css.match(
    /\.models-provider-item:focus-visible[^{]*\{(?<declarations>[^}]*)\}/,
  );

  expect(focusRule?.groups?.declarations).toMatch(/outline:\s*none/);
  expect(focusRule?.groups?.declarations).toMatch(/background:\s*var\(--bg-glass-hover\)/);
});

test("provider picker dialog does not fall back to a light-theme surface", () => {
  const css = readFileSync("public/app/settings/settings-config.css", "utf8");
  expect(css).not.toMatch(/--bg-primary/);
  expect(css).toMatch(/\.provider-picker-dialog[\s\S]*?color:\s*var\(--text-primary\)/);
  expect(css).toMatch(/\.provider-picker-dialog[\s\S]*?overflow:\s*hidden/);
  const toolbarRule = css.match(/\.provider-picker-toolbar\s*\{(?<declarations>[^}]*)\}/);
  expect(toolbarRule?.groups?.declarations).not.toMatch(/background/);
  expect(css).toMatch(/\.provider-picker-body[\s\S]*?overflow:\s*auto/);
  expect(css).toMatch(/\.provider-picker-card[\s\S]*?background:\s*var\(--bg-glass\)/);
  expect(css).toMatch(
    /\.provider-picker-featured[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/,
  );
});

test("does not draw a curved inset border on the selected provider or model", () => {
  const css = readFileSync("public/app/settings/settings-config.css", "utf8");
  const selectedRules = [...css.matchAll(/[^{}]*\.selected[^{}]*\{(?<declarations>[^}]*)\}/g)];
  const providerSelectionRules = selectedRules.filter((rule) =>
    /\.models-(?:provider|model)-item\.selected/.test(rule[0]),
  );

  expect(providerSelectionRules).not.toHaveLength(0);
  for (const rule of providerSelectionRules) {
    expect(rule.groups.declarations).not.toMatch(/box-shadow/);
  }
});
