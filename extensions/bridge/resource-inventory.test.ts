// ABOUTME: Tests resourceEnabledByFilter.
// ABOUTME: Includes "treats a missing key as enabled and an empty array as disabled".
// ABOUTME: Resource inventory lists folder and package resources and writes Pi's filter entries.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildResourceInventory,
  resourceEnabledByFilter,
  setResourceEnabled,
} from "./resource-inventory.ts";

let tmp = "";

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = "";
});

function layout() {
  tmp = mkdtempSync(join(tmpdir(), "spopi-resources-"));
  const agentDir = join(tmp, "agent");
  const cwd = join(tmp, "project");
  mkdirSync(join(agentDir, "prompts"), { recursive: true });
  mkdirSync(join(agentDir, "extensions"), { recursive: true });
  writeFileSync(join(agentDir, "prompts", "review.md"), "# Review the diff\n");
  writeFileSync(join(agentDir, "extensions", "stats.ts"), "export default function () {}\n");
  const pkg = join(agentDir, "npm", "node_modules", "pi-lens");
  mkdirSync(join(pkg, "skills", "grep"), { recursive: true });
  mkdirSync(join(pkg, "prompts"), { recursive: true });
  writeFileSync(
    join(pkg, "skills", "grep", "SKILL.md"),
    "---\nname: Pi Lens Grep\ndescription: Search with pi-lens\n---\n# Pi Lens Grep\n",
  );
  writeFileSync(join(pkg, "prompts", "scan.md"), "# Scan\n");
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "pi-lens", version: "1.0.0" }));
  writeFileSync(
    join(agentDir, "settings.json"),
    JSON.stringify({ packages: ["npm:pi-lens"] }, null, 2),
  );
  return { agentDir, cwd, pkg };
}

function opts(agentDir: string, cwd: string) {
  return {
    scope: "global" as const,
    cwd,
    agentDir,
    homeDir: join(tmp, "home"),
    projectTrusted: true,
  };
}

describe("resourceEnabledByFilter", () => {
  it("treats a missing key as enabled and an empty array as disabled", () => {
    expect(resourceEnabledByFilter(undefined, "skills/grep", "grep")).toBe(true);
    expect(resourceEnabledByFilter([], "skills/grep", "grep")).toBe(false);
    expect(resourceEnabledByFilter(["-skills/grep"], "skills/grep", "grep")).toBe(false);
  });
});

describe("buildResourceInventory", () => {
  it("lists folder prompts and package skills", () => {
    const { agentDir, cwd } = layout();
    const inventory = buildResourceInventory(opts(agentDir, cwd));
    const names = inventory.items.map((item) => `${item.kind}:${item.name}`);
    expect(names).toContain("prompt:review");
    expect(names).toContain("extension:stats");
    expect(names).toContain("skill:Pi Lens Grep");
    expect(inventory.items.find((item) => item.name === "Pi Lens Grep")?.enabled).toBe(true);
    expect(inventory.items.find((item) => item.name === "Pi Lens Grep")?.origin.type).toBe(
      "package",
    );
  });
});

describe("setResourceEnabled", () => {
  it("writes a package -path filter and a folder -path entry", async () => {
    const { agentDir, cwd } = layout();
    const base = opts(agentDir, cwd);
    const before = buildResourceInventory(base);
    const skill = before.items.find((item) => item.name === "Pi Lens Grep");
    const prompt = before.items.find((item) => item.name === "review");
    if (!skill || !prompt) throw new Error("expected resources");
    await setResourceEnabled({ ...base, kind: "skill", id: skill.id, enabled: false });
    await setResourceEnabled({ ...base, kind: "prompt", id: prompt.id, enabled: false });
    const settings = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"));
    const pkg = settings.packages.find(
      (entry: { source?: string }) =>
        entry && typeof entry === "object" && entry.source === "npm:pi-lens",
    );
    expect(pkg.skills).toEqual(["-skills/grep"]);
    expect(settings.prompts).toEqual(["-prompts/review.md"]);
    const after = buildResourceInventory(base);
    expect(after.items.find((item) => item.name === "Pi Lens Grep")?.enabled).toBe(false);
    expect(after.items.find((item) => item.name === "review")?.enabled).toBe(false);
  });
});
