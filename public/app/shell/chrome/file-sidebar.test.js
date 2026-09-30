// ABOUTME: File sidebar chrome mounts the browser and the git panel it hosts.
// ABOUTME: The list and git panel keep their ids.

import { describe, expect, test } from "vitest";
import { mountFileSidebarChrome } from "./file-sidebar.js";

describe("file sidebar chrome", () => {
  test("mounts the file browser ids", () => {
    const root = document.createElement("div");
    const { refs } = mountFileSidebarChrome(root);
    expect(refs.sidebar.id).toBe("file-sidebar");
    expect(refs.fileList.id).toBe("file-list");
    expect(refs.gitPanel.id).toBe("git-panel");
    expect(root.querySelector("#file-sidebar-up")).not.toBeNull();
    expect(root.querySelector("#file-sidebar-finder")).not.toBeNull();
    expect(root.querySelector("#file-sidebar-close")).not.toBeNull();
    expect(root.querySelector("#file-sidebar-title")).toBeNull();
  });
});
