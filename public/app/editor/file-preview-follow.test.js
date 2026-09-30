// ABOUTME: Tests isWriteTool.
// ABOUTME: Includes "matches write/edit family names case-insensitively".
import { describe, expect, test } from "vitest";
import {
  createFilePreviewFollow,
  isWriteTool,
  pathFromToolArgs,
  shouldFollowWrite,
  toPreviewPath,
} from "./file-preview-follow.js";

describe("isWriteTool", () => {
  test("matches write/edit family names case-insensitively", () => {
    expect(isWriteTool("write")).toBe(true);
    expect(isWriteTool("Edit")).toBe(true);
    expect(isWriteTool("apply_patch")).toBe(true);
    expect(isWriteTool("read")).toBe(false);
    expect(isWriteTool("bash")).toBe(false);
  });
});

describe("pathFromToolArgs", () => {
  test("reads path, file_path, or filePath", () => {
    expect(pathFromToolArgs({ path: "src/a.js" })).toBe("src/a.js");
    expect(pathFromToolArgs({ file_path: "src/b.js" })).toBe("src/b.js");
    expect(pathFromToolArgs({ filePath: "src/c.js" })).toBe("src/c.js");
    expect(pathFromToolArgs({ command: "ls" })).toBe("");
  });
});

describe("toPreviewPath", () => {
  test("strips the workspace root from an absolute path", () => {
    expect(toPreviewPath("/Users/me/proj/index.html", "/Users/me/proj")).toBe("index.html");
    expect(toPreviewPath("/Users/me/proj/src/app.js", "/Users/me/proj")).toBe("src/app.js");
  });

  test("keeps workspace-relative paths", () => {
    expect(toPreviewPath("src/app.js", "/Users/me/proj")).toBe("src/app.js");
    expect(toPreviewPath("src/app.js", "")).toBe("src/app.js");
  });

  test("rejects absolute paths outside the workspace", () => {
    expect(toPreviewPath("/etc/passwd", "/Users/me/proj")).toBe("");
    expect(toPreviewPath("/Users/me/other/a.js", "/Users/me/proj")).toBe("");
    expect(toPreviewPath("/Users/me/proj/index.html", "")).toBe("");
  });
});

describe("shouldFollowWrite", () => {
  test("follows a successful write with a path", () => {
    expect(
      shouldFollowWrite({
        toolName: "write",
        isError: false,
        args: { path: "a.html" },
      }),
    ).toBe(true);
  });

  test("skips errors, reads, and tools without a path", () => {
    expect(shouldFollowWrite({ toolName: "write", isError: true, args: { path: "a.js" } })).toBe(
      false,
    );
    expect(shouldFollowWrite({ toolName: "read", args: { path: "a.js" } })).toBe(false);
    expect(shouldFollowWrite({ toolName: "write", args: { content: "x" } })).toBe(false);
  });

  test("follows when the start event already recorded the path", () => {
    expect(shouldFollowWrite({ toolCallId: "1", isError: false }, "src/a.js")).toBe(true);
  });
});

describe("createFilePreviewFollow", () => {
  test("opens a relative write path after the tool ends", async () => {
    const revealWrite = async (path) => ({ path });
    const follow = createFilePreviewFollow({
      panel: { revealWrite, workspaceRoot: "/ws" },
      getWorkspacePath: async () => "/ws",
    });
    follow.onToolStart({
      toolCallId: "t1",
      toolName: "write",
      args: { path: "/ws/docs/index.html" },
    });
    const result = await follow.onToolEnd({ toolCallId: "t1", isError: false });
    expect(result).toEqual({ path: "docs/index.html" });
  });

  test("does not follow a failed write", async () => {
    const revealWrite = async () => {
      throw new Error("should not run");
    };
    const follow = createFilePreviewFollow({ panel: { revealWrite } });
    follow.onToolStart({
      toolCallId: "t1",
      toolName: "write",
      args: { path: "a.js" },
    });
    expect(await follow.onToolEnd({ toolCallId: "t1", isError: true })).toBeNull();
  });

  test("openPath focuses the preview without requiring a write tool", async () => {
    const opened = [];
    const follow = createFilePreviewFollow({
      panel: { openFile: async (path) => opened.push(path) },
      getWorkspacePath: async () => "/ws",
    });
    await follow.openPath("/ws/readme.md");
    expect(opened).toEqual(["readme.md"]);
  });

  test("notifies onWriteApplied with the raw and preview paths", async () => {
    const applied = [];
    const follow = createFilePreviewFollow({
      panel: { revealWrite: async (path) => ({ filePath: path }) },
      getWorkspacePath: async () => "/ws",
      onWriteApplied: (raw, previewPath) => applied.push([raw, previewPath]),
    });
    follow.onToolStart({ toolCallId: "t1", toolName: "write", args: { path: "/ws/new.js" } });
    await follow.onToolEnd({ toolCallId: "t1", isError: false });
    expect(applied).toEqual([["/ws/new.js", "new.js"]]);
  });

  test("notifies onWriteApplied even without a panel", async () => {
    const applied = [];
    const follow = createFilePreviewFollow({
      getWorkspacePath: async () => "/ws",
      onWriteApplied: (raw, previewPath) => applied.push([raw, previewPath]),
    });
    follow.onToolStart({ toolCallId: "t1", toolName: "edit", args: { file_path: "src/a.ts" } });
    await follow.onToolEnd({ toolCallId: "t1", isError: false });
    expect(applied).toEqual([["src/a.ts", "src/a.ts"]]);
  });

  test("does not notify for failed or non-write tools", async () => {
    const applied = [];
    const follow = createFilePreviewFollow({
      panel: { revealWrite: async (path) => ({ filePath: path }) },
      getWorkspacePath: async () => "/ws",
      onWriteApplied: (raw, previewPath) => applied.push([raw, previewPath]),
    });
    follow.onToolStart({ toolCallId: "t1", toolName: "write", args: { path: "/ws/a.js" } });
    await follow.onToolEnd({ toolCallId: "t1", isError: true });
    follow.onToolStart({ toolCallId: "t2", toolName: "read", args: { path: "/ws/b.js" } });
    await follow.onToolEnd({ toolCallId: "t2", isError: false });
    expect(applied).toEqual([]);
  });
});
