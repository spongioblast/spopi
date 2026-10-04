// ABOUTME: Tests queue mode defaults in settings.json.
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

describe("queue prefs", () => {
  it("writes steeringMode and keeps follow-up at the default", async () => {
    const home = mkdtempSync(join(tmpdir(), "spopi-queue-"));
    homes.push(home);
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.PI_CODING_AGENT_DIR = join(home, ".pi", "agent");
    vi.resetModules();
    const { readQueueModes, writeQueueMode } = await import("./queue-prefs.ts");
    mkdirSync(join(home, ".pi", "agent"), { recursive: true });
    writeFileSync(join(home, ".pi", "agent", "settings.json"), "{}\n");
    await expect(writeQueueMode("steering", "all")).resolves.toMatchObject({
      kind: "steering",
      mode: "all",
    });
    expect(readQueueModes().steeringMode).toBe("all");
    expect(readQueueModes().followUpMode).toBe("one-at-a-time");
    expect(JSON.parse(readFileSync(join(home, ".pi", "agent", "settings.json"), "utf8"))).toEqual({
      steeringMode: "all",
    });
  });

  it("refuses to write over an unreadable settings.json", async () => {
    const home = mkdtempSync(join(tmpdir(), "spopi-queue-"));
    homes.push(home);
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.PI_CODING_AGENT_DIR = join(home, ".pi", "agent");
    vi.resetModules();
    const { writeQueueMode } = await import("./queue-prefs.ts");
    mkdirSync(join(home, ".pi", "agent"), { recursive: true });
    writeFileSync(join(home, ".pi", "agent", "settings.json"), "{ not json");
    await expect(writeQueueMode("followUp", "all")).rejects.toThrow();
    expect(readFileSync(join(home, ".pi", "agent", "settings.json"), "utf8")).toBe("{ not json");
  });
});
