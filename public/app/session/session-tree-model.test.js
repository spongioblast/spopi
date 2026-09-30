// ABOUTME: Tests flattenTree.
// ABOUTME: Includes "walks children with depth and parent ids".
import { describe, expect, it } from "vitest";
import { flattenTree, navigateTreePayload, retryWithModelCommand } from "./session-tree-model.js";

describe("flattenTree", () => {
  it("walks children with depth and parent ids", () => {
    const rows = flattenTree({
      id: "root",
      summary: "start",
      children: [{ id: "child", summary: "fork", children: [] }],
    });
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ id: "child", parentId: "root", depth: 1 });
  });
});

describe("retryWithModelCommand", () => {
  it("builds a /model command for fork-and-retry", () => {
    expect(retryWithModelCommand("vllm:qwen")).toBe("/model vllm:qwen");
    expect(navigateTreePayload("abc").entryId).toBe("abc");
  });
});
