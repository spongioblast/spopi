// ABOUTME: Tests cacheWarming defaults in settings.json.
// ABOUTME: Uses a temporary home so the real agent directory is untouched.
// @vitest-environment node

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const homes: string[] = [];

afterEach(() => {
  vi.resetModules();
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe("cache warming", () => {
  it("writes cacheWarming", async () => {
    const home = mkdtempSync(join(tmpdir(), "spopi-warm-"));
    homes.push(home);
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.PI_CODING_AGENT_DIR = join(home, ".pi", "agent");
    vi.resetModules();
    const { readCacheWarming, writeCacheWarming } = await import("./cache-warming.ts");
    mkdirSync(join(home, ".pi", "agent"), { recursive: true });
    writeFileSync(join(home, ".pi", "agent", "settings.json"), "{}\n");
    expect(await writeCacheWarming("idle")).toMatchObject({ mode: "idle" });
    expect(readCacheWarming().mode).toBe("idle");
    expect(
      JSON.parse(readFileSync(join(home, ".pi", "agent", "settings.json"), "utf8")).cacheWarming,
    ).toBe("idle");
  });

  it("sets the mode through SettingsManager", async () => {
    const { applyCacheWarmingMode } = await import("./cache-warming.ts");
    const manager = { setCacheWarmingMode: vi.fn() };
    applyCacheWarmingMode("off", manager);
    expect(manager.setCacheWarmingMode).toHaveBeenCalledWith("off");
  });
});
