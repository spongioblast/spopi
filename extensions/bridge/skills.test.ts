// ABOUTME: Skill inventory handlers.
// ABOUTME: Each operation is called on its handler with a temporary Pi agent directory.
// @vitest-environment node

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigContext, SpopiConfigResult } from "./paths";
import type { BridgeHandler } from "./types";

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  parseFrontmatter: (await importOriginal<typeof import("@earendil-works/pi-coding-agent")>())
    .parseFrontmatter,
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
  const { handlers } = await import("./skills.ts");
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

describe("spopi config skills operations", () => {
  it("lists and mutates global skills through the config command bridge", async () => {
    const { home, handleSpopiConfig } = await loadConfigWithTempHome();
    const skillDir = join(home, ".pi", "agent", "skills", "demo-skill");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      "---\nname: demo-skill\ndescription: Demo skill\n---\n",
      "utf8",
    );

    const listed = await handleSpopiConfig("list_skill_inventory", { scope: "global" }, {});

    expect(listed.ok).toBe(true);
    if (!listed.ok) throw new Error("Skill inventory lookup failed");
    const skill = (
      listed.data as { roots: Array<{ children: Array<{ id: string; name: string }> }> }
    ).roots[0].children[0];
    expect(skill.name).toBe("demo-skill");

    await expect(
      handleSpopiConfig(
        "set_skill_enabled",
        { scope: "global", target: { kind: "skill", id: skill.id }, enabled: false },
        {},
      ),
    ).resolves.toMatchObject({ ok: true });

    expect(JSON.parse(readFileSync(join(home, ".pi", "agent", "settings.json"), "utf8"))).toEqual({
      skills: ["-skills/demo-skill"],
    });
  });

  it("lists packaged skills for the global scope", async () => {
    const { handleSpopiConfig } = await loadConfigWithTempHome();
    await expect(
      handleSpopiConfig("list_package_skill_inventory", { scope: "global" }, {}),
    ).resolves.toMatchObject({ ok: true });
  });
});
