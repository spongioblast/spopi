// ABOUTME: API key and custom provider handlers.
// ABOUTME: Each operation is called on its handler with a temporary Pi agent directory.
// @vitest-environment node

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigContext, SpopiConfigResult } from "./paths";
import type { BridgeHandler } from "./types";

vi.mock("@earendil-works/pi-coding-agent", () => ({
  createAgentSession: vi.fn(),
  ModelRuntime: { create: vi.fn() },
  SessionManager: { inMemory: vi.fn(), listAll: vi.fn(), open: vi.fn() },
  getAgentDir: () =>
    process.env.PI_CODING_AGENT_DIR?.trim() || join(process.env.HOME || "", ".pi", "agent"),
  SettingsManager: { create: vi.fn() },
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
  const { handlers } = await import("./providers.ts");
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

describe("spopi config auth operations", () => {
  it("stores and removes API keys without requiring registry authStorage", async () => {
    vi.stubEnv("HOME", "");
    const { home, handleSpopiConfig } = await loadConfigWithTempHome();
    const authPath = join(home, ".pi", "agent", "auth.json");

    await expect(
      handleSpopiConfig("set_api_key", { provider: "openai", apiKey: "sk-test" }, {}),
    ).resolves.toEqual({ ok: true, data: { provider: "openai" } });

    expect(JSON.parse(readFileSync(authPath, "utf8"))).toEqual({
      openai: { type: "api_key", key: "sk-test" },
    });

    await expect(handleSpopiConfig("remove_api_key", { provider: "openai" }, {})).resolves.toEqual({
      ok: true,
      data: { provider: "openai" },
    });

    expect(existsSync(authPath)).toBe(true);
    expect(JSON.parse(readFileSync(authPath, "utf8"))).toEqual({});
  });

  it("updates the active registry credential store before refreshing", async () => {
    const { handleSpopiConfig } = await loadConfigWithTempHome();
    const credentials = {
      modify: vi.fn(
        async (_provider: string, _mutate: (store: unknown) => Promise<unknown>) => undefined,
      ),
      delete: vi.fn(async (_provider: string) => undefined),
    };
    const registry = {
      runtime: { credentials },
      refresh: vi.fn(async () => undefined),
    };

    await expect(
      handleSpopiConfig(
        "set_api_key",
        { provider: "anthropic", apiKey: "sk-ant-test" },
        {
          modelRegistry: registry as never,
        },
      ),
    ).resolves.toEqual({ ok: true, data: { provider: "anthropic" } });

    expect(credentials.modify).toHaveBeenCalledWith("anthropic", expect.any(Function));
    const [, applyMutation] = credentials.modify.mock.calls[0] ?? [];
    expect(applyMutation).toBeTypeOf("function");
    await expect(applyMutation?.(undefined)).resolves.toEqual({
      type: "api_key",
      key: "sk-ant-test",
    });
    expect(registry.refresh).toHaveBeenCalledTimes(1);

    await expect(
      handleSpopiConfig(
        "remove_api_key",
        { provider: "anthropic" },
        {
          modelRegistry: registry as never,
        },
      ),
    ).resolves.toEqual({ ok: true, data: { provider: "anthropic" } });

    expect(credentials.delete).toHaveBeenCalledWith("anthropic");
    expect(registry.refresh).toHaveBeenCalledTimes(2);
  });
});

describe("spopi config custom provider operations", () => {
  it("saves a relay provider into models.json and stores the API key", async () => {
    const { home, handleSpopiConfig } = await loadConfigWithTempHome();
    const credentials = {
      modify: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    };
    const registry = {
      runtime: { credentials },
      refresh: vi.fn(async () => undefined),
      // Remaining CatalogRegistry surface is irrelevant to this operation but
      // must be present for the type.
      getAll: vi.fn(() => []),
      getAvailable: vi.fn(async () => []),
      getProviderAuthStatus: vi.fn(() => ({ configured: false, source: "none", label: "" })),
      getProviderDisplayName: vi.fn((provider: string) => provider),
    };

    const result = await handleSpopiConfig(
      "save_custom_provider",
      {
        providerId: "My Relay",
        baseUrl: "https://relay.example.com/v1",
        apiKey: "sk-test",
        protocol: "openai-completions",
        models: [{ id: "gpt-4o-mini", contextWindow: 32768, maxTokens: 4096 }],
      },
      { modelRegistry: registry as never },
    );

    expect(result).toMatchObject({
      ok: true,
      data: {
        providerId: "my-relay",
        protocol: "openai-completions",
        modelCount: 1,
        keyStored: true,
      },
    });
    const saved = JSON.parse(readFileSync(join(home, ".pi", "agent", "models.json"), "utf8"));
    expect(saved.providers["my-relay"]).toMatchObject({
      baseUrl: "https://relay.example.com/v1",
      api: "openai-completions",
      models: [
        expect.objectContaining({ id: "gpt-4o-mini", contextWindow: 32768, maxTokens: 4096 }),
      ],
    });
    expect(saved.providers["my-relay"].apiKey).toBeUndefined();
    expect(credentials.modify).toHaveBeenCalledWith("my-relay", expect.any(Function));
  });

  it("detects an OpenAI-compatible relay", async () => {
    const { handleSpopiConfig } = await loadConfigWithTempHome();
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes("/v1/models")) {
        return new Response(
          JSON.stringify({
            object: "list",
            data: [{ id: "gpt-4o-mini", context_window: 32768 }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("{}", { status: 404 });
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl as unknown as typeof fetch;
    try {
      const result = await handleSpopiConfig(
        "detect_custom_provider",
        { baseUrl: "https://relay.example.com/v1", apiKey: "sk-test" },
        {},
      );
      expect(result.ok).toBe(true);
      expect(result).toMatchObject({
        data: {
          protocol: "openai-completions",
          models: [expect.objectContaining({ id: "gpt-4o-mini" })],
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects a custom-provider test that has no protocol", async () => {
    const { handleSpopiConfig } = await loadConfigWithTempHome();
    const error = {
      ok: false,
      error: "protocol must be openai-completions or anthropic-messages",
    };
    await expect(handleSpopiConfig("test_custom_provider", {}, {})).resolves.toEqual(error);
  });
});
