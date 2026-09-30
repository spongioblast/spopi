// ABOUTME: Key source, key changes, and provider rename, each against a temporary Pi agent folder.
// ABOUTME: Checks that status never carries the key and that a rename moves the credential and prefs.
// @vitest-environment node

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

const tempHomes: string[] = [];

async function setup(files: {
  models?: unknown;
  auth?: unknown;
  settings?: unknown;
  prefs?: unknown;
}) {
  const home = mkdtempSync(join(tmpdir(), "spopi-keys-"));
  tempHomes.push(home);
  vi.resetModules();
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.PI_CODING_AGENT_DIR = join(home, ".pi", "agent");
  process.env.APPDATA = join(home, "AppData", "Roaming");
  const agent = join(home, ".pi", "agent");
  mkdirSync(agent, { recursive: true });
  const write = (name: string, value: unknown) => {
    if (value !== undefined) writeFileSync(join(agent, name), JSON.stringify(value, null, 2));
  };
  write("models.json", files.models);
  write("auth.json", files.auth);
  write("settings.json", files.settings);
  write("spopi-models.json", files.prefs);
  const { handlers } = await import("./provider-keys.ts");
  const call = async (op: string, params: Record<string, unknown>): Promise<SpopiConfigResult> => {
    try {
      const handler = (handlers as Record<string, BridgeHandler>)[op];
      if (!handler) throw new Error(`no ${op}`);
      return await handler({} as ConfigContext, params);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
  const read = (name: string) => JSON.parse(readFileSync(join(agent, name), "utf8"));
  return { call, read, agent };
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const home of tempHomes.splice(0)) rmSync(home, { recursive: true, force: true });
});

const vllm = (extra: Record<string, unknown> = {}) => ({
  providers: {
    VLLM: {
      baseUrl: "http://127.0.0.1:8000/v1",
      api: "openai-completions",
      models: [{ id: "qwen" }],
      ...extra,
    },
  },
});

describe("classifyModelsKey", () => {
  it("follows Pi's config value rules", async () => {
    const { classifyModelsKey } = await import("./provider-keys.ts");
    expect(classifyModelsKey(undefined)).toBe("none");
    expect(classifyModelsKey("!op read key")).toBe("command");
    expect(classifyModelsKey("$VLLM_KEY")).toBe("env");
    expect(classifyModelsKey(["$", "{VLLM_KEY}"].join(""))).toBe("env");
    expect(classifyModelsKey("$$literal")).toBe("literal");
    expect(classifyModelsKey("VLLM_KEY")).toBe("literal");
    expect(classifyModelsKey("none")).toBe("placeholder");
    expect(classifyModelsKey("sk-abc")).toBe("literal");
  });
});

describe("provider key operations", () => {
  it("reports the source and never the key", async () => {
    const { call } = await setup({ models: vllm({ apiKey: "sk-secret-literal" }) });
    const result = await call("get_provider_key_status", { provider: "VLLM" });
    expect(result).toEqual({ ok: true, data: { source: "literal", modelsLiteral: true } });
    expect(JSON.stringify(result)).not.toContain("sk-secret");

    const stored = await setup({
      models: vllm({ apiKey: "none" }),
      auth: { VLLM: { type: "api_key", key: "sk-stored-secret" } },
    });
    const status = await stored.call("get_provider_key_status", { provider: "VLLM" });
    expect(status).toEqual({ ok: true, data: { source: "auth", modelsLiteral: false } });
    expect(JSON.stringify(status)).not.toContain("sk-stored");
  });

  it("moves a literal key out of models.json into auth.json", async () => {
    const { call, read } = await setup({ models: vllm({ apiKey: "sk-literal" }) });
    const result = await call("move_provider_key_to_auth", { provider: "VLLM" });
    expect(result).toEqual({ ok: true, data: { source: "auth", modelsLiteral: false } });
    expect(read("models.json").providers.VLLM.apiKey).toBeUndefined();
    expect(read("auth.json").VLLM).toEqual({ type: "api_key", key: "sk-literal" });
  });

  it("writes a reference to models.json and drops the stored key", async () => {
    const { call, read } = await setup({
      models: vllm(),
      auth: { VLLM: { type: "api_key", key: "sk-old" } },
    });
    const result = await call("set_provider_key", { provider: "VLLM", reference: "$VLLM_KEY" });
    expect(result).toMatchObject({ ok: true, data: { source: "env" } });
    expect(read("models.json").providers.VLLM.apiKey).toBe("$VLLM_KEY");
    expect(read("auth.json").VLLM).toBeUndefined();
  });

  it("stores a replaced key in auth.json and drops a shadowed literal", async () => {
    const { call, read } = await setup({ models: vllm({ apiKey: "sk-old-literal" }) });
    const result = await call("set_provider_key", { provider: "VLLM", apiKey: "sk-new" });
    expect(result).toMatchObject({ ok: true, data: { source: "auth" } });
    expect(read("models.json").providers.VLLM.apiKey).toBeUndefined();
    expect(read("auth.json").VLLM).toEqual({ type: "api_key", key: "sk-new" });
  });

  it("removes both keys and leaves the keyless placeholder", async () => {
    const { call, read } = await setup({
      models: vllm({ apiKey: "sk-literal", authHeader: true }),
      auth: { VLLM: { type: "api_key", key: "sk-stored" } },
    });
    const result = await call("remove_provider_key", { provider: "VLLM" });
    expect(result).toMatchObject({ ok: true, data: { source: "placeholder" } });
    const entry = read("models.json").providers.VLLM;
    expect(entry.apiKey).toBe("none");
    expect(entry.authHeader).toBeUndefined();
    expect(read("auth.json").VLLM).toBeUndefined();
  });
});

describe("test_provider_access", () => {
  it("lists models without sending the keyless placeholder", async () => {
    const { call } = await setup({ models: vllm({ apiKey: "none" }) });
    const fetchMock = vi.fn(async () =>
      Response.json({ object: "list", data: [{ id: "qwen" }, { id: "other" }] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const result = await call("test_provider_access", { provider: "VLLM" });
      expect(result).toMatchObject({
        ok: true,
        data: { ok: true, modelCount: 2, needsKey: false },
      });
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("http://127.0.0.1:8000/v1/models");
      expect(JSON.stringify(init.headers ?? {})).not.toContain("none");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reports that the server wants a key on 401", async () => {
    const { call } = await setup({ models: vllm({ apiKey: "none" }) });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unauthorized", { status: 401 })),
    );
    try {
      const result = await call("test_provider_access", { provider: "VLLM" });
      expect(result).toMatchObject({ ok: true, data: { ok: false, status: 401, needsKey: true } });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("rename_custom_provider", () => {
  it("moves the models.json entry, the credential, prefs, and settings", async () => {
    const { call, read } = await setup({
      models: {
        providers: {
          first: { baseUrl: "https://a.example/v1", models: [] },
          ...vllm().providers,
          last: { baseUrl: "https://b.example/v1", models: [] },
        },
      },
      auth: { VLLM: { type: "api_key", key: "sk-keep" }, other: { type: "api_key", key: "x" } },
      settings: {
        defaultProvider: "VLLM",
        defaultModel: "qwen",
        enabledModels: ["VLLM/qwen", "openai/gpt-5"],
        modelThinkingLevels: { "VLLM/qwen": "high", "openai/gpt-5": "low" },
      },
      prefs: {
        visibility: { "VLLM/qwen": true, "openai/gpt-5": false },
        health: { "VLLM/qwen": { status: "ok" } },
      },
    });

    const result = await call("rename_custom_provider", { from: "VLLM", to: "vllm" });
    expect(result).toEqual({ ok: true, data: { from: "VLLM", to: "vllm", keyMoved: true } });

    const models = read("models.json");
    expect(Object.keys(models.providers)).toEqual(["first", "vllm", "last"]);
    expect(read("auth.json")).toEqual({
      vllm: { type: "api_key", key: "sk-keep" },
      other: { type: "api_key", key: "x" },
    });
    const settings = read("settings.json");
    expect(settings.defaultProvider).toBe("vllm");
    expect(settings.enabledModels).toEqual(["vllm/qwen", "openai/gpt-5"]);
    expect(settings.modelThinkingLevels).toEqual({ "vllm/qwen": "high", "openai/gpt-5": "low" });
    const prefs = read("spopi-models.json");
    expect(prefs.visibility).toEqual({ "openai/gpt-5": false, "vllm/qwen": true });
    expect(Object.keys(prefs.health)).toEqual(["vllm/qwen"]);
  });

  it("refuses an existing id and a bad id", async () => {
    const { call, agent } = await setup({
      models: { providers: { ...vllm().providers, other: { baseUrl: "x", models: [] } } },
    });
    await expect(call("rename_custom_provider", { from: "VLLM", to: "other" })).resolves.toEqual({
      ok: false,
      error: "Provider other already exists",
    });
    await expect(
      call("rename_custom_provider", { from: "VLLM", to: "has space" }),
    ).resolves.toMatchObject({ ok: false });
    expect(existsSync(join(agent, "auth.json"))).toBe(false);
  });
});
