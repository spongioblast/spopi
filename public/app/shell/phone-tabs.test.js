// ABOUTME: Tests the phone tab bar.
// ABOUTME: Covers phone-tabs.js button classes and the selected region.

import { afterEach, expect, test } from "vitest";
import { mountPhoneTabs } from "./phone-tabs.js";

afterEach(() => {
  document.body.replaceChildren();
  delete document.body.dataset.phoneRegion;
});

test("phone tabs are ghost buttons and mark the current region", () => {
  const root = document.createElement("nav");
  document.body.append(root);
  mountPhoneTabs(root);
  const chat = root.querySelector("[data-phone-region='chat']");
  expect(chat?.className).toContain("ui-button");
  expect(chat?.classList.contains("on")).toBe(true);
  expect(chat?.getAttribute("aria-current")).toBe("page");
  root.querySelector("[data-phone-region='changes']")?.click();
  expect(document.body.dataset.phoneRegion).toBe("changes");
  expect(document.body.dataset.centerMode).toBe("review");
});
