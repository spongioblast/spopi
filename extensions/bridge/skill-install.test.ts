// ABOUTME: Tests scanning a skill folder and appending it through SettingsManager.
// ABOUTME: Entries are relative under the settings base, overrides stay, and an untrusted project is refused.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addSkillFolder, scanSkillFolder } from "./skill-install";

const roots: string[] = [];
let savedDir: string | undefined;

function skill(dir: string, name: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${name} skill\n---\nbody\n`,
  );
}

beforeEach(() => {
  savedDir = process.env.PI_CODING_AGENT_DIR;
});

afterEach(() => {
  if (savedDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = savedDir;
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.length = 0;
});

describe("scanSkillFolder", () => {
  it("builds a tree whose ids are paths relative to the picked folder", () => {
    const root = mkdtempSync(join(tmpdir(), "spopi-skill-scan-"));
    roots.push(root);
    skill(join(root, "alpha"), "alpha");
    skill(join(root, "group", "beta"), "beta");
    const scan = scanSkillFolder(root);
    expect(scan.tree.map((node) => node.id).sort()).toEqual(["alpha", "group"]);
    const group = scan.tree.find((node) => node.id === "group");
    expect(group?.children?.map((node) => node.id)).toEqual(["group/beta"]);
    expect(scan.defaultSelection.map((item) => item.id).sort()).toEqual(["alpha", "group/beta"]);
  });

  it("reads a SKILL.md saved with a byte order mark, as Pi does", () => {
    const root = mkdtempSync(join(tmpdir(), "spopi-skill-bom-"));
    roots.push(root);
    mkdirSync(join(root, "hello"), { recursive: true });
    writeFileSync(
      join(root, "hello", "SKILL.md"),
      "\uFEFF---\r\nname: hello\r\ndescription: Says hello\r\n---\r\nbody\r\n",
    );
    const scan = scanSkillFolder(root);
    expect(scan.diagnostics).toEqual([]);
    expect(scan.tree).toEqual([
      expect.objectContaining({ id: "hello", description: "Says hello" }),
    ]);
  });
});

describe("addSkillFolder", () => {
  it("encodes a folder under the agent dir as relative and keeps override entries", async () => {
    const home = mkdtempSync(join(tmpdir(), "spopi-skill-add-"));
    roots.push(home);
    const agent = join(home, "agent");
    process.env.PI_CODING_AGENT_DIR = agent;
    const folder = join(agent, "incoming");
    skill(join(folder, "alpha"), "alpha");
    skill(join(folder, "nested", "beta"), "beta");
    skill(join(folder, "nested", "gamma"), "gamma");
    mkdirSync(agent, { recursive: true });
    writeFileSync(
      join(agent, "settings.json"),
      JSON.stringify({ skills: ["!./kept", "./incoming/alpha"] }),
    );
    const scan = scanSkillFolder(folder);
    const added = await addSkillFolder(
      { cwd: home, isProjectTrusted: () => true },
      folder,
      "global",
      [
        { kind: "skill", id: "alpha" },
        { kind: "group", id: "nested" },
      ],
    );
    expect(added.skippedEntries).toHaveLength(1);
    expect(added.addedEntries).toEqual([expect.stringMatching(/^\.\/incoming\/nested$/)]);
    const settings = JSON.parse(readFileSync(join(agent, "settings.json"), "utf8"));
    expect(settings.skills[0]).toBe("!./kept");
    expect(settings.skills).toContain("./incoming/alpha");
    expect(settings.skills).toContain("./incoming/nested");
    expect(scan.defaultSelection.map((item) => item.id).sort()).toEqual([
      "alpha",
      "nested/beta",
      "nested/gamma",
    ]);
  });

  it("stores an absolute path when the folder is outside the settings base", async () => {
    const home = mkdtempSync(join(tmpdir(), "spopi-skill-abs-"));
    roots.push(home);
    const agent = join(home, "agent");
    const folder = join(home, "outside");
    process.env.PI_CODING_AGENT_DIR = agent;
    mkdirSync(agent, { recursive: true });
    skill(join(folder, "gamma"), "gamma");
    const added = await addSkillFolder({ cwd: home }, folder, "global", [
      { kind: "skill", id: "gamma" },
    ]);
    expect(added.addedEntries).toHaveLength(1);
    expect(added.addedEntries[0].startsWith("./")).toBe(false);
    const settings = JSON.parse(readFileSync(join(agent, "settings.json"), "utf8"));
    expect(settings.skills).toContain(added.addedEntries[0]);
  });

  it("refuses a project install when the project is not trusted", async () => {
    const home = mkdtempSync(join(tmpdir(), "spopi-skill-trust-"));
    roots.push(home);
    process.env.PI_CODING_AGENT_DIR = join(home, "agent");
    const folder = join(home, "skills");
    skill(join(folder, "alpha"), "alpha");
    await expect(
      addSkillFolder({ cwd: home, isProjectTrusted: () => false }, folder, "project", [
        { kind: "skill", id: "alpha" },
      ]),
    ).rejects.toThrow("Project is not trusted");
  });

  it("honors PI_CODING_AGENT_DIR instead of the real agent folder", async () => {
    const home = mkdtempSync(join(tmpdir(), "spopi-skill-env-"));
    roots.push(home);
    const agent = join(home, "scratch-agent");
    process.env.PI_CODING_AGENT_DIR = agent;
    const folder = join(home, "pack");
    skill(join(folder, "delta"), "delta");
    await addSkillFolder({ cwd: home }, folder, "global", [{ kind: "skill", id: "delta" }]);
    expect(readFileSync(join(agent, "settings.json"), "utf8")).toContain("delta");
  });
});
