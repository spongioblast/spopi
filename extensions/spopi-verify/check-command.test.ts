// ABOUTME: Tests check-command: .pi/verify.json wins, then package scripts, local tsc, cargo, and go.
// ABOUTME: Includes "never proposes npx for a TypeScript project without a local tsc".

// @vitest-environment node

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_MAX_REPAIRS, DEFAULT_TIMEOUT_SECONDS, resolveCheckCommand } from "./check-command";

const dirs: string[] = [];

function project(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spopi-verify-cmd-"));
  dirs.push(dir);
  for (const [name, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), body);
  }
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const scripts = (map: Record<string, string>) => JSON.stringify({ scripts: map });

describe("resolveCheckCommand", () => {
  it("uses the project's .pi/verify.json command and clamps its limits", () => {
    const dir = project({
      ".pi/verify.json": JSON.stringify({ command: "make lint", timeoutSeconds: 5, maxRepairs: 9 }),
      "package.json": scripts({ typecheck: "tsc" }),
    });
    expect(resolveCheckCommand(dir)).toEqual({
      kind: "command",
      check: { command: "make lint", source: ".pi/verify.json", timeoutSeconds: 10, maxRepairs: 5 },
    });
  });

  it("turns the gate off with enabled: false", () => {
    const dir = project({
      ".pi/verify.json": JSON.stringify({ enabled: false }),
      "package.json": scripts({ check: "x" }),
    });
    expect(resolveCheckCommand(dir)).toEqual({ kind: "disabled", source: ".pi/verify.json" });
  });

  it("keeps detection but applies configured limits when verify.json has no command", () => {
    const dir = project({
      ".pi/verify.json": JSON.stringify({ maxRepairs: 1 }),
      "package.json": scripts({ check: "x" }),
      "bun.lock": "",
    });
    expect(resolveCheckCommand(dir)).toMatchObject({
      kind: "command",
      check: { command: "bun run check", source: "package.json", maxRepairs: 1 },
    });
  });

  it("prefers a typecheck script and picks the runner from the lockfile", () => {
    const dir = project({
      "package.json": scripts({ check: "all", typecheck: "tsc -b" }),
      "pnpm-lock.yaml": "",
    });
    expect(resolveCheckCommand(dir)).toEqual({
      kind: "command",
      check: {
        command: "pnpm run typecheck",
        source: "package.json",
        timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
        maxRepairs: DEFAULT_MAX_REPAIRS,
      },
    });
    const npm = project({ "package.json": scripts({ check: "x" }) });
    expect(resolveCheckCommand(npm)).toMatchObject({
      check: { command: "npm run --silent check" },
    });
  });

  it("never proposes npx for a TypeScript project without a local tsc", () => {
    expect(resolveCheckCommand(project({ "tsconfig.json": "{}" }))).toEqual({ kind: "none" });
    const withTsc = project({ "tsconfig.json": "{}", "node_modules/.bin/tsc": "" });
    expect(resolveCheckCommand(withTsc)).toMatchObject({
      check: { command: "npx --no-install tsc --noEmit", source: "tsconfig.json" },
    });
  });

  it("detects cargo and go projects, and nothing in an empty folder", () => {
    expect(resolveCheckCommand(project({ "Cargo.toml": "" }))).toMatchObject({
      check: { command: "cargo check --quiet --message-format=short" },
    });
    expect(resolveCheckCommand(project({ "go.mod": "" }))).toMatchObject({
      check: { command: "go vet ./..." },
    });
    expect(resolveCheckCommand(project({ "README.md": "" }))).toEqual({ kind: "none" });
  });

  it("ignores a malformed verify.json", () => {
    const dir = project({ ".pi/verify.json": "{ nope", "go.mod": "" });
    expect(resolveCheckCommand(dir)).toMatchObject({ check: { source: "go.mod" } });
  });
});
