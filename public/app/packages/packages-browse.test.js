// ABOUTME: Tests package browser installed filter.
// ABOUTME: The case titles in this file name what it checks.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "../i18n/i18n.js";
import { mountPackageBrowse } from "./packages-browse.js";

const enMessages = JSON.parse(readFileSync(join(process.cwd(), "public/locales/en.json"), "utf8"));

function renderPackageBrowseDom() {
  document.body.innerHTML = `
    <input id="pkg-browse-search" />
    <div id="pkg-browse-pills">
      <button class="pkg-browse-pill active" data-pkg-type="all">All</button>
    </div>
    <label><input type="checkbox" id="pkg-browse-installed-only" /></label>
    <select id="pkg-browse-sort"><option value="downloads">Most downloads</option></select>
    <span id="pkg-browse-count"></span>
    <div id="pkg-browse-list"></div>
    <div id="pkg-browse-pagination" hidden></div>
  `;
}

function packageRows() {
  return [...document.querySelectorAll(".pkg-browse-row")].map((row) => row.textContent);
}

describe("package browser installed filter", () => {
  beforeEach(async () => {
    globalThis.fetch = vi.fn(async (input) => {
      if (String(input).includes("/locales/")) {
        return { ok: true, json: async () => enMessages };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    await createI18n();
    renderPackageBrowseDom();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("refreshes installed packages when the installed-only filter is enabled after an initial list failure", async () => {
    const control = {
      browsePiPackages: vi.fn().mockResolvedValue([
        {
          name: "pi-web-access",
          description: "Web access extension",
          types: ["extension"],
          downloads: 10,
        },
        {
          name: "pi-not-installed",
          description: "Not installed",
          types: ["extension"],
          downloads: 5,
        },
      ]),
      listPiPackages: vi
        .fn()
        .mockRejectedValueOnce(new Error("host not ready"))
        .mockResolvedValueOnce(["npm:pi-web-access"]),
      openExternal: vi.fn(),
      installPiPackage: vi.fn(),
      removePiPackage: vi.fn(),
    };

    const browse = mountPackageBrowse(control);
    await browse.load();

    expect(packageRows()).toHaveLength(2);

    const installedOnly = document.getElementById("pkg-browse-installed-only");
    installedOnly.checked = true;
    installedOnly.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => {
      expect(control.listPiPackages).toHaveBeenCalledTimes(2);
      expect(packageRows()).toHaveLength(1);
    });

    expect(packageRows()[0]).toContain("pi-web-access");
    expect(document.getElementById("pkg-browse-list").textContent).not.toContain(
      "No packages match your filters.",
    );
  });
});
