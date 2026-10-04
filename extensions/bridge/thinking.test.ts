// ABOUTME: Thinking level, budgets, and auto-compaction handlers.
// ABOUTME: Each operation is called on its handler with a temporary Pi agent directory.
// @vitest-environment node

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  const { handlers } = await import("./thinking.ts");
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

describe("thinking handlers", () => {
  it("writes global default thinking level while preserving unknown settings", async () => {
    const { home, handleSpopiConfig } = await loadConfigWithTempHome();
    const settingsPath = join(home, ".pi", "agent", "settings.json");
    mkdirSync(join(home, ".pi", "agent"), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify({ thinkingLevel: "low", unknown: 7 }), "utf8");

    await expect(
      handleSpopiConfig("set_default_thinking_level", { level: "medium" }, {}),
    ).resolves.toEqual({
      ok: true,
      data: { level: "medium", scope: "global", path: settingsPath },
    });

    expect(JSON.parse(readFileSync(settingsPath, "utf8"))).toEqual({
      thinkingLevel: "low",
      unknown: 7,
      defaultThinkingLevel: "medium",
    });
  });

  it("merges thinking budgets with vLLM fallbacks and writes one level", async () => {
    const { home, handleSpopiConfig } = await loadConfigWithTempHome();
    const settingsPath = join(home, ".pi", "agent", "settings.json");
    mkdirSync(join(home, ".pi", "agent"), { recursive: true });
    writeFileSync(
      settingsPath,
      JSON.stringify({ defaultThinkingLevel: "high", thinkingBudgets: { high: 8192 } }),
      "utf8",
    );

    await expect(handleSpopiConfig("get_thinking_budgets", {}, {})).resolves.toEqual({
      ok: true,
      data: {
        level: "high",
        budgets: {
          minimal: 1024,
          low: 4096,
          medium: 12288,
          high: 8192,
          xhigh: 49152,
          max: 63488,
        },
      },
    });

    await expect(
      handleSpopiConfig("set_thinking_budget", { level: "high", tokens: 32768 }, {}),
    ).resolves.toEqual({
      ok: true,
      data: { level: "high", tokens: 32768, path: settingsPath },
    });

    expect(JSON.parse(readFileSync(settingsPath, "utf8")).thinkingBudgets.high).toBe(32768);
    expect(JSON.parse(readFileSync(settingsPath, "utf8")).defaultThinkingLevel).toBe("high");
  });

  it("rejects unsupported default thinking levels", async () => {
    const { handleSpopiConfig } = await loadConfigWithTempHome();

    await expect(
      handleSpopiConfig("set_default_thinking_level", { level: "turbo" }, {}),
    ).resolves.toEqual({ ok: false, error: "Unsupported thinking level: turbo" });
  });

  it("writes global default auto-compaction while preserving compaction settings", async () => {
    const { home, handleSpopiConfig } = await loadConfigWithTempHome();
    const settingsPath = join(home, ".pi", "agent", "settings.json");
    mkdirSync(join(home, ".pi", "agent"), { recursive: true });
    writeFileSync(
      settingsPath,
      JSON.stringify({ compaction: { reserveTokens: 8192 }, unknown: true }),
      "utf8",
    );

    await expect(
      handleSpopiConfig("set_default_auto_compaction", { enabled: false }, {}),
    ).resolves.toEqual({ ok: true, data: { enabled: false, scope: "global", path: settingsPath } });

    expect(JSON.parse(readFileSync(settingsPath, "utf8"))).toEqual({
      compaction: { reserveTokens: 8192, enabled: false },
      unknown: true,
    });
  });

  it("reads the default thinking level and auto-compaction", async () => {
    const { handleSpopiConfig } = await loadConfigWithTempHome();
    await expect(handleSpopiConfig("get_default_thinking_level", {}, {})).resolves.toMatchObject({
      ok: true,
    });
    await expect(handleSpopiConfig("get_default_auto_compaction", {}, {})).resolves.toMatchObject({
      ok: true,
    });
  });

  it("writes retry.enabled without dropping other retry fields", async () => {
    const { home, handleSpopiConfig } = await loadConfigWithTempHome();
    const settingsPath = join(home, ".pi", "agent", "settings.json");
    mkdirSync(join(home, ".pi", "agent"), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify({ retry: { maxRetries: 2 } }), "utf8");
    await expect(
      handleSpopiConfig("set_default_auto_retry", { enabled: false }, {}),
    ).resolves.toMatchObject({ ok: true, data: { enabled: false } });
    expect(JSON.parse(readFileSync(settingsPath, "utf8"))).toEqual({
      retry: { maxRetries: 2, enabled: false },
    });
  });
});
