// ABOUTME: Tests verify-skills: which bundled skills are offered, PATH lookup, and the screenshot folder.
// ABOUTME: Uses the real skill folders shipped next to spopi-verify and a temporary PATH directory.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { commandOnPath, registerVerifySkills, verifySkillPaths } from "./verify-skills";

const SKILLS_ROOT = path.join(__dirname, "skills");
const temps: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spopi-verify-skills-"));
  temps.push(dir);
  return dir;
}

function register(onPath: boolean, enabled = true) {
  const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
  const screens: string[] = [];
  const started: string[] = [];
  const pi = {
    on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) =>
      handlers.set(event, handler),
  };
  registerVerifySkills(pi as never, SKILLS_ROOT, {
    onPath: () => onPath,
    ensureScreens: (cwd) => screens.push(cwd),
    startBrowser: async (cwd) => {
      started.push(cwd);
    },
    enabled: () => enabled,
  });
  return { handlers, screens, started };
}

afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("verify skills", () => {
  it("ships both skills with a valid frontmatter name", () => {
    for (const name of ["verify-recipe", "browser-check"]) {
      const text = fs.readFileSync(path.join(SKILLS_ROOT, name, "SKILL.md"), "utf8");
      expect(text.startsWith(`---\nname: ${name}\n`)).toBe(true);
    }
  });

  it("keeps the recipe generator out of the model's skill list", () => {
    const text = fs.readFileSync(path.join(SKILLS_ROOT, "verify-recipe", "SKILL.md"), "utf8");
    expect(text).toMatch(/^disable-model-invocation: true$/m);
  });

  it("hides browser-check when agent-browser is switched off, even if it is on PATH", async () => {
    const { handlers, started } = register(true, false);
    expect(handlers.get("resources_discover")?.({}, {})).toEqual({
      skillPaths: [path.join(SKILLS_ROOT, "verify-recipe")],
    });
    await handlers.get("tool_call")?.(
      { toolName: "bash", input: { command: "agent-browser open http://127.0.0.1:1" } },
      { cwd: "/p" },
    );
    expect(started).toEqual([]);
  });

  it("offers browser-check only when agent-browser is on PATH", () => {
    expect(verifySkillPaths(SKILLS_ROOT, false)).toEqual([path.join(SKILLS_ROOT, "verify-recipe")]);
    expect(register(true).handlers.get("resources_discover")?.({}, {})).toEqual({
      skillPaths: [
        path.join(SKILLS_ROOT, "verify-recipe"),
        path.join(SKILLS_ROOT, "browser-check"),
      ],
    });
  });

  it("returns nothing when the skills folder is missing", () => {
    expect(verifySkillPaths(path.join(tempDir(), "none"), true)).toEqual([]);
  });

  it("prepares the screenshot folder and the browser before an agent-browser command only", async () => {
    const { handlers, screens, started } = register(true);
    const toolCall = handlers.get("tool_call");
    await toolCall?.({ toolName: "bash", input: { command: "npm test" } }, { cwd: "/p" });
    await toolCall?.({ toolName: "read", input: { path: "agent-browser" } }, { cwd: "/p" });
    await toolCall?.(
      {
        toolName: "bash",
        input: { command: "agent-browser open http://127.0.0.1:5173 | tail -1" },
      },
      { cwd: "/p" },
    );
    expect(screens).toEqual(["/p"]);
    expect(started).toEqual(["/p"]);
  });

  it("starts no browser of its own for close or an attached browser", async () => {
    const { handlers, started } = register(true);
    const toolCall = handlers.get("tool_call");
    for (const command of [
      "agent-browser close",
      "agent-browser --cdp 9222 snapshot -i",
      "agent-browser --auto-connect snapshot",
    ]) {
      await toolCall?.({ toolName: "bash", input: { command } }, { cwd: "/p" });
    }
    expect(started).toEqual([]);
  });

  it("finds a command on PATH, with PATHEXT on Windows", () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "agent-browser.cmd"), "");
    const env = { PATH: dir, PATHEXT: ".EXE;.CMD" };
    expect(commandOnPath("agent-browser", env, "win32")).toBe(true);
    expect(commandOnPath("agent-browser", env, "linux")).toBe(false);
    expect(commandOnPath("missing-cli", env, "win32")).toBe(false);
  });
});
