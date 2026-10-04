// ABOUTME: Codex OAuth login handlers.
// ABOUTME: Each operation is called on its handler with a temporary Pi agent directory.
// @vitest-environment node

import { mkdtempSync, rmSync } from "node:fs";
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
  const { handlers } = await import("./oauth.ts");
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

describe("spopi config oauth operations", () => {
  it("rejects oauth_logout for providers outside the codex whitelist (design §3)", async () => {
    const { handleSpopiConfig } = await loadConfigWithTempHome();
    const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");

    await expect(handleSpopiConfig("oauth_logout", { provider: "anthropic" }, {})).resolves.toEqual(
      { ok: false, error: "Unsupported OAuth provider" },
    );
    await expect(handleSpopiConfig("oauth_logout", {}, {})).resolves.toEqual({
      ok: false,
      error: "Unsupported OAuth provider",
    });
    // Rejected before any runtime is constructed — the op surface never
    // forwards a non-codex provider to runtime.logout().
    expect(ModelRuntime.create).not.toHaveBeenCalled();
  });

  it("reports capabilities and rejects a login that is not Codex device-code", async () => {
    const { handleSpopiConfig } = await loadConfigWithTempHome();
    await expect(handleSpopiConfig("get_oauth_login_capabilities", {}, {})).resolves.toEqual({
      ok: true,
      data: { providers: [] },
    });
    await expect(
      handleSpopiConfig("start_oauth_login", { provider: "anthropic", method: "device_code" }, {}),
    ).resolves.toEqual({ ok: false, error: "Unsupported OAuth provider or method" });
    await expect(handleSpopiConfig("cancel_oauth_login", {}, {})).resolves.toEqual({
      ok: false,
      error: "operationId is required",
    });
  });
});
