// ABOUTME: Tests save-output: files land in the ignored `.pi/tmp/tool-output/`, Pi temp files are copied, old files pruned.
// ABOUTME: Includes "refuses to copy a fullOutputPath outside the temp directory".

// @vitest-environment node

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  piFullOutputPath,
  pruneOldOutputs,
  readWindows,
  saveOutput,
  WINDOW_BYTES,
} from "./save-output";

const made: string[] = [];

function tempDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(dir);
  return dir;
}

afterEach(() => {
  while (made.length) {
    const dir = made.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("save-output", () => {
  it("writes into the ignored .pi/tmp/tool-output folder", () => {
    const root = tempDir("spopi-tool-output-");
    const saved = saveOutput({
      cwd: root,
      toolName: "mcp:github/search",
      toolCallId: "call_abcdef123456",
      text: "hello\n",
      now: new Date(2026, 8, 27, 18, 45, 12),
    });
    expect(saved.relativePath).toBe(
      ".pi/tmp/tool-output/mcp_github_search-20260927-184512-ef123456.log",
    );
    expect(fs.readFileSync(saved.absolutePath, "utf8")).toBe("hello\n");
    expect(saved.bytes).toBe(6);
    expect(fs.readFileSync(path.join(root, ".pi/tmp/.gitignore"), "utf8")).toBe("*\n!.gitignore\n");
  });

  it("does not overwrite a file saved in the same second", () => {
    const root = tempDir("spopi-tool-output-");
    const now = new Date(2026, 8, 27, 18, 45, 12);
    const first = saveOutput({ cwd: root, toolName: "bash", toolCallId: "c1", text: "a", now });
    const second = saveOutput({ cwd: root, toolName: "bash", toolCallId: "c1", text: "b", now });
    expect(second.relativePath).toBe(first.relativePath.replace(/\.log$/, "-1.log"));
    expect(fs.readFileSync(first.absolutePath, "utf8")).toBe("a");
  });

  it("copies Pi's full output file instead of the truncated text", () => {
    const root = tempDir("spopi-tool-output-");
    const pi = path.join(tempDir("pi-bash-"), "pi-bash-1.log");
    fs.writeFileSync(pi, "full output\n");
    const source = piFullOutputPath({ fullOutputPath: pi });
    expect(source).not.toBeNull();
    const saved = saveOutput({
      cwd: root,
      toolName: "bash",
      toolCallId: "c1",
      text: "tail only",
      sourceFile: source,
    });
    expect(fs.readFileSync(saved.absolutePath, "utf8")).toBe("full output\n");
  });

  it("refuses to copy a fullOutputPath outside the temp directory", () => {
    const outside = path.resolve(os.homedir(), ".ssh", "id_ed25519");
    expect(piFullOutputPath({ fullOutputPath: outside })).toBeNull();
    expect(piFullOutputPath({ fullOutputPath: 42 })).toBeNull();
    expect(piFullOutputPath(undefined)).toBeNull();
  });

  it("reads a large file as two windows", () => {
    const dir = tempDir("spopi-windows-");
    const file = path.join(dir, "big.log");
    fs.writeFileSync(file, `START\n${"x".repeat(WINDOW_BYTES * 3)}\nEND\n`);
    const read = readWindows(file);
    expect("head" in read && read.head.startsWith("START\n")).toBe(true);
    expect("tail" in read && read.tail.endsWith("\nEND\n")).toBe(true);

    const small = path.join(dir, "small.log");
    fs.writeFileSync(small, "a\nb\n");
    expect(readWindows(small)).toEqual({ whole: "a\nb\n" });
  });

  it("prunes saved outputs older than a week and leaves the rest", () => {
    const root = tempDir("spopi-tool-output-");
    const old = saveOutput({ cwd: root, toolName: "bash", toolCallId: "old", text: "old" });
    const fresh = saveOutput({ cwd: root, toolName: "bash", toolCallId: "new", text: "new" });
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    fs.utimesSync(old.absolutePath, eightDaysAgo, eightDaysAgo);
    expect(pruneOldOutputs(root)).toBe(1);
    expect(fs.existsSync(old.absolutePath)).toBe(false);
    expect(fs.existsSync(fresh.absolutePath)).toBe(true);
    expect(pruneOldOutputs(tempDir("spopi-empty-"))).toBe(0);
  });
});
