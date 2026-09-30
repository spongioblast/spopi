// ABOUTME: Verifies workspace-local storage for composer paste offloads.
// ABOUTME: Covers containment, self-ignore creation, deterministic names, and collisions.

// @vitest-environment node

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PASTE_OFFLOAD_MAX_BYTES, writePasteOffloadFile } from "./paste-offload";

const roots: string[] = [];

function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "spopi-paste-offload-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  while (roots.length) {
    const root = roots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("writePasteOffloadFile", () => {
  it("writes into .pi/tmp with self-ignore and restrictive mode", () => {
    const root = makeWorkspace();
    const result = writePasteOffloadFile(root, "hello\nworld", new Date(2026, 7, 21, 14, 32, 5));

    expect(result.relativePath).toBe(".pi/tmp/paste-20260821-143205.txt");
    expect(fs.readFileSync(result.absolutePath, "utf8")).toBe("hello\nworld");
    expect(fs.readFileSync(path.join(root, ".pi/tmp/.gitignore"), "utf8")).toBe("*\n!.gitignore\n");
    const mode = fs.statSync(result.absolutePath).mode & 0o777;
    if (process.platform === "win32") {
      expect([0o600, 0o666]).toContain(mode);
    } else {
      expect(mode).toBe(0o600);
    }
  });

  it("allocates a suffix instead of overwriting same-second files", () => {
    const root = makeWorkspace();
    const now = new Date(2026, 7, 21, 14, 32, 5);
    const first = writePasteOffloadFile(root, "first", now);
    const second = writePasteOffloadFile(root, "second", now);

    expect(first.relativePath).toBe(".pi/tmp/paste-20260821-143205.txt");
    expect(second.relativePath).toBe(".pi/tmp/paste-20260821-143205-1.txt");
    expect(fs.readFileSync(first.absolutePath, "utf8")).toBe("first");
    expect(fs.readFileSync(second.absolutePath, "utf8")).toBe("second");
  });

  it("preserves regular gitignore and rejects symlinked directories", () => {
    const root = makeWorkspace();
    const directory = path.join(root, ".pi/tmp");
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, ".gitignore"), "custom\n", "utf8");
    writePasteOffloadFile(root, "content");
    expect(fs.readFileSync(path.join(directory, ".gitignore"), "utf8")).toBe("custom\n");

    const linkedRoot = makeWorkspace();
    fs.mkdirSync(path.join(linkedRoot, ".pi"), { recursive: true });
    try {
      fs.symlinkSync(root, path.join(linkedRoot, ".pi/tmp"));
    } catch (error) {
      if (process.platform === "win32") return;
      throw error;
    }
    expect(() => writePasteOffloadFile(linkedRoot, "unsafe")).toThrow(/symlink|outside/i);
  });

  it("rejects content over the host limit", () => {
    expect(() =>
      writePasteOffloadFile(makeWorkspace(), "x".repeat(PASTE_OFFLOAD_MAX_BYTES + 1)),
    ).toThrow("Paste content is too large");
  });
});
