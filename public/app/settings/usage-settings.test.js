// ABOUTME: Tests the Usage settings page mount.
// ABOUTME: The page owns a title and the embedded cost dashboard.

import { expect, test } from "vitest";
import { mountUsageSettings } from "./usage-settings.js";

test("usage page renders a title and the cost dashboard, then destroy clears it", () => {
  const root = document.createElement("div");
  const page = mountUsageSettings(root);
  expect(root.querySelector(".settings-header h3")?.textContent).toBe("Usage");
  expect(root.querySelector("#settings-cost-dashboard")).not.toBeNull();
  page.refresh();
  expect(root.querySelector("#settings-cost-dashboard")).not.toBeNull();
  page.destroy();
  expect(root.childElementCount).toBe(0);
});
