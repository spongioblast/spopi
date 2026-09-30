// ABOUTME: Side panel chrome mounts the session-info column.
// ABOUTME: The info panel keeps the ids the header toggle already targets.

import { describe, expect, test } from "vitest";
import { mountSidePanelsChrome } from "./side-panels.js";

describe("side panel chrome", () => {
  test("mounts the info panel ids", () => {
    const root = document.createElement("div");
    const { refs } = mountSidePanelsChrome(root);
    expect(refs.info.id).toBe("info-sidebar");
    expect(refs.infoPanel.id).toBe("info-panel");
    expect(root.querySelector("#diff-sidebar")).toBeNull();
    expect(root.querySelector("#info-sidebar-close")).not.toBeNull();
  });
});
