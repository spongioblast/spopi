// ABOUTME: Offers the verify-recipe and browser-check skills that ship next to spopi-verify.
// ABOUTME: browser-check is listed only when agent-browser is on PATH; before its first command the browser is started detached.

import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ensureScratchDirectory } from "../scratch-dir";

export const BROWSER_CLI = "agent-browser";
const BROWSER_TIMEOUT_MS = 20_000;

export type VerifySkillDeps = {
  onPath: (command: string) => boolean;
  ensureScreens: (cwd: string) => void;
  startBrowser: (cwd: string) => Promise<void>;
  enabled: () => boolean;
};

function runBrowserCli(
  cwd: string,
  args: string[],
  capture: boolean,
): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve) => {
    // With stdout ignored, the browser this may launch holds no pipe of ours open.
    const child = spawn(BROWSER_CLI, args, {
      cwd,
      shell: process.platform === "win32",
      stdio: ["ignore", capture ? "pipe" : "ignore", "ignore"],
      windowsHide: true,
    });
    let stdout = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    const timer = setTimeout(() => child.kill(), BROWSER_TIMEOUT_MS);
    const done = (code: number | null) => {
      clearTimeout(timer);
      resolve({ code, stdout });
    };
    child.on("error", () => done(null));
    child.on("close", done);
  });
}

/**
 * The first agent-browser command launches the browser, and the browser inherits that
 * command's stdout. When the model pipes it (`agent-browser open … | tail`), the reader
 * never sees end of file and the shell call hangs. Starting the session here first, with
 * no pipes attached, leaves the model's piped commands safe.
 */
export async function startBrowserSession(cwd: string): Promise<void> {
  const listed = await runBrowserCli(cwd, ["session", "list"], true);
  if (listed.code !== 0 || !/no active sessions/i.test(listed.stdout)) return;
  await runBrowserCli(cwd, ["stream", "status"], false);
}

export function commandOnPath(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const dirs = (env.PATH ?? env.Path ?? "").split(delimiter).filter(Boolean);
  const suffixes =
    platform === "win32"
      ? ["", ...(env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").map((ext) => ext.toLowerCase())]
      : [""];
  for (const dir of dirs) {
    for (const suffix of suffixes) {
      try {
        if (statSync(join(dir, command + suffix)).isFile()) return true;
      } catch {
        // not in this directory
      }
    }
  }
  return false;
}

export function defaultVerifySkillDeps(): VerifySkillDeps {
  return {
    onPath: (command) => commandOnPath(command),
    ensureScreens: (cwd) => {
      ensureScratchDirectory(cwd, "screens");
    },
    startBrowser: startBrowserSession,
    enabled: () => process.env.SPOPI_AGENT_BROWSER !== "0",
  };
}

/** Skill directories to offer, given the folder that holds `verify-recipe/` and `browser-check/`. */
export function verifySkillPaths(skillsRoot: string, browserAvailable: boolean): string[] {
  const names = browserAvailable ? ["verify-recipe", "browser-check"] : ["verify-recipe"];
  return names.map((name) => join(skillsRoot, name)).filter((dir) => existsSync(dir));
}

function mentionsBrowserCli(command: unknown): command is string {
  return typeof command === "string" && new RegExp(`\\b${BROWSER_CLI}\\b`).test(command);
}

/** A command that attaches to another browser or only closes one needs no session of ours. */
function needsOwnSession(command: string): boolean {
  if (/--cdp\b|--auto-connect\b/.test(command)) return false;
  return !new RegExp(`^\\s*${BROWSER_CLI}\\s+close\\b`).test(command);
}

export function registerVerifySkills(
  pi: ExtensionAPI,
  skillsRoot: string,
  deps: VerifySkillDeps = defaultVerifySkillDeps(),
) {
  pi.on("resources_discover", () => {
    const skillPaths = verifySkillPaths(skillsRoot, deps.enabled() && deps.onPath(BROWSER_CLI));
    return skillPaths.length > 0 ? { skillPaths } : undefined;
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!deps.enabled()) return;
    if (event.toolName !== "bash") return;
    const command = (event.input as { command?: unknown }).command;
    if (!mentionsBrowserCli(command)) return;
    // The skill saves screenshots under `.pi/tmp/screens/`. Creating it here first
    // writes the `.gitignore` that keeps them out of commits.
    try {
      deps.ensureScreens(ctx.cwd);
    } catch {
      // A read-only or symlinked project keeps working; screenshots then go where the model says.
    }
    if (needsOwnSession(command)) await deps.startBrowser(ctx.cwd);
  });
}
