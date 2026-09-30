// ABOUTME: Tests mountSessionTree.
// ABOUTME: Includes "renders flattened nodes and retry".
import { describe, expect, it } from "vitest";
import { mountSessionTree } from "./session-tree-tab.js";

describe("mountSessionTree", () => {
  it("renders flattened nodes and retry", () => {
    const root = document.createElement("div");
    const navigated = [];
    mountSessionTree(root, {
      tree: { id: "root", summary: "start", children: [{ id: "child", summary: "next" }] },
      onNavigate: (payload) => navigated.push(payload),
    });
    expect(root.querySelectorAll(".session-tree-node")).toHaveLength(2);
    root.querySelector(".session-tree-node").click();
    expect(navigated[0].entryId).toBe("root");
    expect(navigated[0].targetId).toBe("root");
  });

  it("renders a get_tree snapshot with the leaf, a label, and edit from here", () => {
    const root = document.createElement("div");
    const edits = [];
    mountSessionTree(root, {
      tree: {
        leafId: "user-2",
        tree: [
          {
            entry: {
              type: "message",
              id: "user-1",
              message: { role: "user", content: "first prompt" },
            },
            label: "start",
            children: [
              {
                entry: {
                  type: "message",
                  id: "user-2",
                  message: { role: "user", content: "second prompt" },
                },
                children: [],
              },
            ],
          },
        ],
      },
      onEdit: (entryId, text) => edits.push({ entryId, text }),
    });
    expect(root.querySelector(".session-tree-leaf")?.textContent).toBe("second prompt");
    expect(root.textContent).toContain("start");
    const edit = root.querySelectorAll(".session-tree-edit");
    expect(edit).toHaveLength(2);
    edit[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(edits).toEqual([{ entryId: "user-2", text: "second prompt" }]);
  });
});
