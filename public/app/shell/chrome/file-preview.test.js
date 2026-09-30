// ABOUTME: File preview chrome mounts the editor column and its resize handle.
// ABOUTME: The panel, toolbar, and content keep their ids.

import { describe, expect, test } from "vitest";
import { mountFilePreviewChrome } from "./file-preview.js";

describe("file preview chrome", () => {
  test("mounts the preview ids", () => {
    const root = document.createElement("div");
    const { refs } = mountFilePreviewChrome(root);
    expect(refs.resizer.id).toBe("file-preview-resizer");
    expect(refs.panel.id).toBe("file-preview-panel");
    expect(refs.content.id).toBe("file-preview-content");
    expect(root.querySelector("#file-preview-tabs")).not.toBeNull();
    expect(root.querySelector("#file-preview-close")).not.toBeNull();
  });
});
