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
  expect(root.textContent).toContain("settings.customizations.intro");
  expect(root.querySelector(".customizations-folder code").textContent).toBe(
    "%APPDATA%\\spopi\\ui",
  );
  expect(root.querySelectorAll(".settings-section.ui-card")).toHaveLength(2);
});

test("names each override's folder and explains its status", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        entries: [
          { path: "user.css", status: "added" },
          { path: "app/chat/chat.css", status: "stale" },
        ],
        root: "C:\\Users\\me\\AppData\\Roaming\\spopi\\ui",
        safe: false,
        autoSafe: true,
      }),
    })),
  );
  const root = document.createElement("div");
  document.body.append(root);
  mountCustomizationsSettings(root);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(root.querySelector(".customizations-folder code").textContent).toBe(
    "C:\\Users\\me\\AppData\\Roaming\\spopi\\ui",
  );
  const rows = [...root.querySelectorAll(".customizations-row")];
  expect(rows.map((row) => row.querySelector(".settings-label-main").textContent)).toEqual([
    "user.css",
    "app/chat/chat.css",
  ]);
  expect(rows[0].textContent).toContain("settings.customizations.statusAdded");
  expect(rows[0].textContent).not.toContain("settings.customizations.threeWay");
  expect(rows[1].dataset.status).toBe("stale");
  expect(rows[1].textContent).toContain("settings.customizations.threeWay");
  expect(root.textContent).toContain("settings.customizations.autoSafe");
});
