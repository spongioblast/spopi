// ABOUTME: Model catalog, visibility, and models.json handlers.
// ABOUTME: Each operation is called on its handler with a temporary Pi agent directory.
// @vitest-environment node

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigContext, SpopiConfigResult } from "./paths";
import type { BridgeHandler } from "./types";

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  createAgentSession: vi.fn(),
  ModelRuntime: { create: vi.fn() },
  SessionManager: { inMemory: vi.fn(), listAll: vi.fn(), open: vi.fn() },
  getAgentDir: () =>
    process.env.PI_CODING_AGENT_DIR?.trim() || join(process.env.HOME || "", ".pi", "agent"),
  SettingsManager: (await importOriginal<typeof import("@earendil-works/pi-coding-agent")>())
    .SettingsManager,
}));
vi.mock("./session-title", () => ({
  generateTitleForSession: vi.fn().mockResolvedValue("Generated title"),
}));
const tempHomes: string[] = [];

async function loadConfigWithTempHome() {
  const home = mkdtempSync(join(tmpdir(), "spopi-handler-"));
  tempHomes.push(home);
  vi.resetModules();
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.PI_CODING_AGENT_DIR = join(home, ".pi", "agent");
  process.env.APPDATA = join(home, "AppData", "Roaming");
  const { handlers } = await import("./models.ts");
  async function handleSpopiConfig(
    op: string,
    params: unknown,
    ctx: unknown,
  ): Promise<SpopiConfigResult> {
    try {
      const table = handlers as Record<string, BridgeHandler>;
      const handler = table[op];
      if (!handler) return { ok: false, error: `Unknown configuration operation: ${op}` };
      return await handler((ctx ?? {}) as ConfigContext, (params ?? {}) as Record<string, unknown>);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: message };
    }
  }
  return { home, handleSpopiConfig, handlers };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  for (const home of tempHomes.splice(0)) {
    rmSync(home, { recursive: true, force: true });
  }
});

describe("model handlers", () => {
  it("updates scoped models atomically while preserving unrelated settings", async () => {
    const { home, handleSpopiConfig } = await loadConfigWithTempHome();
    const settingsPath = join(home, ".pi", "agent", "settings.json");
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(
      settingsPath,
      JSON.stringify({ enabledModels: ["anthropic/old:high", "openai/keep"], unknown: true }),
      "utf8",
    );

    await expect(
      handleSpopiConfig(
        "set_scoped_model",
        { provider: "anthropic", modelId: "new", enabled: true },
        {},
      ),
    ).resolves.toEqual({
      ok: true,
      data: {
        provider: "anthropic",
        modelId: "new",
        enabled: true,
        // Persisted thinking-level suffixes are stripped from the ids the
        // composer consumes.
        modelIds: ["anthropic/old", "openai/keep", "anthropic/new"],
      },
    });
    // The unrelated key and the existing suffix survive untouched.
    expect(JSON.parse(readFileSync(settingsPath, "utf8"))).toEqual({
      enabledModels: ["anthropic/old:high", "openai/keep", "anthropic/new"],
      unknown: true,
    });

    await expect(handleSpopiConfig("list_scoped_models", {}, {})).resolves.toEqual({
      ok: true,
      data: { modelIds: ["anthropic/old", "openai/keep", "anthropic/new"] },
    });

    // Removal matches provider/model even with a persisted suffix.
    await expect(
      handleSpopiConfig(
        "set_scoped_model",
        { provider: "anthropic", modelId: "old", enabled: false },
        {},
      ),
    ).resolves.toEqual({
      ok: true,
      data: {
        provider: "anthropic",
        modelId: "old",
        enabled: false,
        modelIds: ["openai/keep", "anthropic/new"],
      },
    });

    // Removing the final entry deletes the key instead of persisting [].
    await expect(
      handleSpopiConfig(
        "set_scoped_model",
        { provider: "openai", modelId: "keep", enabled: false },
        {},
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      handleSpopiConfig(
        "set_scoped_model",
        { provider: "anthropic", modelId: "new", enabled: false },
        {},
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(JSON.parse(readFileSync(settingsPath, "utf8"))).toEqual({ unknown: true });
  });
  it("saves models.json even when registry refresh does not finish", async () => {
    const { home, handleSpopiConfig } = await loadConfigWithTempHome();
    const modelsPath = join(home, ".pi", "agent", "models.json");
    const registry = {
      refresh: vi.fn(() => new Promise(() => undefined)),
    };
    const content = JSON.stringify({ providers: { local: { models: [{ id: "qwen" }] } } });

    vi.useFakeTimers();
    try {
      const result = handleSpopiConfig(
        "write_models_config",
        { content },
        { modelRegistry: registry as never },
      );
      await vi.advanceTimersByTimeAsync(2_000);
      await expect(result).resolves.toEqual({
        ok: true,
        data: { path: modelsPath, refreshed: false },
      });
    } finally {
      vi.useRealTimers();
    }

    expect(registry.refresh).toHaveBeenCalledTimes(1);
    expect(JSON.parse(readFileSync(modelsPath, "utf8"))).toEqual({
      providers: { local: { models: [{ id: "qwen" }] } },
    });
  });

  it("backs up the previous models.json before overwriting it", async () => {
    const { home, handleSpopiConfig } = await loadConfigWithTempHome();
    const modelsPath = join(home, ".pi", "agent", "models.json");
    mkdirSync(dirname(modelsPath), { recursive: true });
    writeFileSync(modelsPath, JSON.stringify({ providers: { old: {} } }), "utf8");
    const content = JSON.stringify({ providers: { local: { models: [{ id: "qwen" }] } } });

    await handleSpopiConfig("write_models_config", { content }, {});

    // The pre-save content is preserved as a rollback copy.
    expect(JSON.parse(readFileSync(`${modelsPath}.bak`, "utf8"))).toEqual({
      providers: { old: {} },
    });
    // The live file carries the new content.
    expect(JSON.parse(readFileSync(modelsPath, "utf8"))).toEqual({
      providers: { local: { models: [{ id: "qwen" }] } },
    });
  });

  it("health-checks custom providers over HTTP instead of creating an agent session", async () => {
    const { handleSpopiConfig } = await loadConfigWithTempHome();
    const { createAgentSession } = await import("@earendil-works/pi-coding-agent");
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl as unknown as typeof fetch;
    const registry = {
      getAll: () => [
        {
          provider: "my-relay",
          id: "gpt-4o-mini",
          api: "openai-completions",
          baseUrl: "https://relay.example.com/v1",
        },
      ],
      getAvailable: async () => [{ provider: "my-relay", id: "gpt-4o-mini" }],
      getProviderAuthStatus: () => ({ configured: true }),
      getProviderDisplayName: () => "my-relay",
      refresh: vi.fn(),
      getApiKeyForProvider: async () => "sk-test",
    };
    try {
      const result = await handleSpopiConfig(
        "check_model_health",
        { provider: "my-relay", modelId: "gpt-4o-mini" },
        { modelRegistry: registry },
      );
      expect(result.ok).toBe(true);
      expect(result).toMatchObject({
        data: { results: [expect.objectContaining({ provider: "my-relay", status: "healthy" })] },
      });
      expect(createAgentSession).not.toHaveBeenCalled();
      expect(fetchImpl).toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("starts a models.json model on and a built-in model off, and a switch wins", async () => {
    const { home, handleSpopiConfig } = await loadConfigWithTempHome();
    const modelsPath = join(home, ".pi", "agent", "models.json");
    mkdirSync(dirname(modelsPath), { recursive: true });
    writeFileSync(
      modelsPath,
      JSON.stringify({ providers: { local: { models: [{ id: "qwen" }] } } }),
      "utf8",
    );
    const models = [
      { provider: "local", id: "qwen" },
      { provider: "openai", id: "gpt" },
    ];
    const registry = {
      getAll: () => models,
      getAvailable: async () => models,
      getProviderAuthStatus: () => ({ configured: true }),
      getProviderDisplayName: (provider: string) => provider,
      refresh: vi.fn(),
    };
    const visibility = async () => {
      const result = await handleSpopiConfig(
        "list_model_catalog",
        {},
        { modelRegistry: registry as never },
      );
      const providers = (
        result as {
          data: { providers: Array<{ models: Array<{ id: string; visible: boolean }> }> };
        }
      ).data.providers;
      return Object.fromEntries(
        providers.flatMap((provider) => provider.models.map((model) => [model.id, model.visible])),
      );
    };

    await expect(visibility()).resolves.toEqual({ qwen: true, gpt: false });
    await handleSpopiConfig(
      "set_model_visibility",
      { provider: "local", modelId: "qwen", visible: false },
      {},
    );
    await expect(visibility()).resolves.toEqual({ qwen: false, gpt: false });
  });

  it("refresh_models reloads Pi's model list, and says so when there is no registry", async () => {
    const { handleSpopiConfig } = await loadConfigWithTempHome();
    const registry = { refresh: vi.fn(async () => {}) };
    await expect(
      handleSpopiConfig("refresh_models", {}, { modelRegistry: registry as never }),
    ).resolves.toEqual({ ok: true, data: { refreshed: true } });
    expect(registry.refresh).toHaveBeenCalledOnce();
    await expect(handleSpopiConfig("refresh_models", {}, {})).resolves.toEqual({
      ok: true,
      data: { refreshed: false },
    });
  });

  it("reads models.json, hides a model, and reports a missing catalog", async () => {
    const { handleSpopiConfig } = await loadConfigWithTempHome();
    await expect(handleSpopiConfig("read_models_config", {}, {})).resolves.toMatchObject({
      ok: true,
    });
    await expect(
      handleSpopiConfig(
        "set_model_visibility",
        { provider: "openai", modelId: "gpt", visible: false },
        {},
      ),
    ).resolves.toEqual({
      ok: true,
      data: { provider: "openai", modelId: "gpt", visible: false },
    });
    await expect(handleSpopiConfig("list_model_catalog", {}, {})).resolves.toEqual({
      ok: false,
      error: "Model registry not ready yet — try again in a moment.",
    });
  });
});
