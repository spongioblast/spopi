// ABOUTME: Extension, skill, prompt, and theme enablement handlers.
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
  const { handlers } = await import("./resources.ts");
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

describe("resource handlers", () => {
  it("lists an empty inventory and rejects an unknown kind", async () => {
    const { handleSpopiConfig } = await loadConfigWithTempHome();
    const listed = await handleSpopiConfig(
      "list_resource_inventory",
      { scope: "global" },
      { cwd: tempHomes[0] },
    );
    expect(listed.ok).toBe(true);
    const rejected = await handleSpopiConfig(
      "set_resource_enabled",
      { scope: "global", kind: "nope", id: "x", enabled: true },
      { cwd: tempHomes[0] },
    );
    expect(rejected).toEqual({ ok: false, error: "Invalid resource kind" });
  });
});
