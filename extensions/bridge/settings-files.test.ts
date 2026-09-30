// ABOUTME: Agent settings and prompt markdown handlers.
// ABOUTME: Each operation is called on its handler with a temporary Pi agent directory.
// @vitest-environment node

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
  const { handlers } = await import("./settings-files.ts");
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

describe("spopi config agent text file operations", () => {
  it("reads a missing AGENTS.md as empty content and reports exists=false", async () => {
    const { home, handleSpopiConfig } = await loadConfigWithTempHome();
    const agentsMdPath = join(home, ".pi", "agent", "AGENTS.md");

    await expect(handleSpopiConfig("read_agents_md", {}, {})).resolves.toEqual({
      ok: true,
      data: { content: "", path: agentsMdPath, exists: false },
    });
  });

  it("round-trips AGENTS.md content without JSON validation", async () => {
    const { home, handleSpopiConfig } = await loadConfigWithTempHome();
    const agentsMdPath = join(home, ".pi", "agent", "AGENTS.md");

    await expect(
      handleSpopiConfig("write_agents_md", { content: "Not JSON: just markdown {" }, {}),
    ).resolves.toEqual({ ok: true, data: { path: agentsMdPath } });

    expect(readFileSync(agentsMdPath, "utf8")).toBe("Not JSON: just markdown {");
    await expect(handleSpopiConfig("read_agents_md", {}, {})).resolves.toEqual({
      ok: true,
      data: { content: "Not JSON: just markdown {", path: agentsMdPath, exists: true },
    });
  });

  it("round-trips APPEND_SYSTEM.md content", async () => {
    const { home, handleSpopiConfig } = await loadConfigWithTempHome();
    const appendPath = join(home, ".pi", "agent", "APPEND_SYSTEM.md");

    await expect(
      handleSpopiConfig("write_append_system_md", { content: "Always answer briefly." }, {}),
    ).resolves.toEqual({ ok: true, data: { path: appendPath } });

    expect(readFileSync(appendPath, "utf8")).toBe("Always answer briefly.");
    await expect(handleSpopiConfig("read_append_system_md", {}, {})).resolves.toEqual({
      ok: true,
      data: { content: "Always answer briefly.", path: appendPath, exists: true },
    });
  });

  it("rejects non-string content for agent text files", async () => {
    const { handleSpopiConfig } = await loadConfigWithTempHome();

    // The gateway contract resolves with { ok: false, error } for handler
    // failures — it rejects only on transport/timeout errors.
    await expect(handleSpopiConfig("write_agents_md", { content: 42 }, {})).resolves.toEqual({
      ok: false,
      error: "content must be a string",
    });
    await expect(
      handleSpopiConfig("write_append_system_md", { content: null }, {}),
    ).resolves.toEqual({
      ok: false,
      error: "content must be a string",
    });
  });

  it("reads and writes the agent config", async () => {
    const { home, handleSpopiConfig } = await loadConfigWithTempHome();
    const path = join(home, ".pi", "agent", "settings.json");
    await expect(
      handleSpopiConfig("write_agent_config", { content: '{"unknown":1}' }, {}),
    ).resolves.toEqual({ ok: true, data: { path, reloaded: false } });
    await expect(handleSpopiConfig("read_agent_config", {}, {})).resolves.toMatchObject({
      ok: true,
      data: { content: expect.stringContaining('"unknown"') },
    });
  });
});
