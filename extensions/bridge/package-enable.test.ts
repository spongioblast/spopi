// ABOUTME: Tests turning a configured package on or off through SettingsManager.
// ABOUTME: A disabled package is the empty resource object `pi config` already stores.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { setPackageEnabled } from "./package-enable";

const roots: string[] = [];
const saved = process.env.PI_CODING_AGENT_DIR;

afterEach(() => {
  if (saved === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = saved;
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.length = 0;
});

describe("setPackageEnabled", () => {
  it("disables a string entry and enables an empty resource object", async () => {
    const home = mkdtempSync(join(tmpdir(), "spopi-pkg-enable-"));
    roots.push(home);
    const agent = join(home, "agent");
    process.env.PI_CODING_AGENT_DIR = agent;
    mkdirSync(agent, { recursive: true });
    writeFileSync(
      join(agent, "settings.json"),
      JSON.stringify({
        packages: [
          "npm:foo",
          { source: "npm:bar", extensions: [], skills: [], prompts: [], themes: [] },
        ],
      }),
    );
    await setPackageEnabled({ cwd: home }, "global", "npm:foo", false);
    await setPackageEnabled({ cwd: home }, "global", "npm:bar", true);
    const settings = JSON.parse(readFileSync(join(agent, "settings.json"), "utf8"));
    expect(settings.packages[0]).toEqual({
      source: "npm:foo",
      extensions: [],
      skills: [],
      prompts: [],
      themes: [],
    });
    expect(settings.packages[1]).toBe("npm:bar");
  });

  it("refuses a project change when the project is not trusted", async () => {
    const home = mkdtempSync(join(tmpdir(), "spopi-pkg-trust-"));
    roots.push(home);
    process.env.PI_CODING_AGENT_DIR = join(home, "agent");
    await expect(
      setPackageEnabled({ cwd: home, isProjectTrusted: () => false }, "project", "npm:foo", false),
    ).rejects.toThrow("Project is not trusted");
  });
});
