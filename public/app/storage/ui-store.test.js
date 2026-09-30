// ABOUTME: Tests the in-memory ui.* preference cache.
// ABOUTME: Covers ui-store.js hydration from a host list.

import { afterEach, expect, test } from "vitest";
import { hydrateUiStore, resetUiStore, uiStore } from "./ui-store.js";

afterEach(() => {
  resetUiStore();
});

test("hydrateUiStore keeps strings and stringifies other JSON", async () => {
  await hydrateUiStore({
    list: async () => ({ "ui.a": true, "ui.b": "x", "ui.c": [1] }),
  });
  expect(uiStore.getItem("ui.a")).toBe("true");
  expect(uiStore.getItem("ui.b")).toBe("x");
  expect(uiStore.getItem("ui.c")).toBe("[1]");
});
