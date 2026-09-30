// ABOUTME: Tests the customizations settings page.
// ABOUTME: Covers the empty override note. Bundled switches live on Packages.

import { afterEach, expect, test, vi } from "vitest";
import { mountCustomizationsSettings } from "./customizations-settings.js";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

test("shows the empty override note without bundled extension switches", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ entries: [], disabled: ["spopi-verify"], safe: false, autoSafe: false }),
    })),
  );
  const root = document.createElement("div");
  document.body.append(root);
  mountCustomizationsSettings(root);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(root.textContent).toContain("settings.customizations.overridesEmpty");
  expect(document.getElementById("use-own-spopi-verify")).toBeNull();
  expect(document.getElementById("load-spopi-spopi-verify")).toBeNull();
  expect(root.textContent).not.toContain("extensions.bundled.load");
});
