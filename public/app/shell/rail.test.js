// ABOUTME: Tests RAIL_ITEMS.
// ABOUTME: Includes "lists the sidebar panels".
import { describe, expect, it } from "vitest";
import { mountRail, nextRailPanel, nextThemeId, RAIL_ITEMS, THEME_ORDER } from "./rail.js";

describe("RAIL_ITEMS", () => {
  it("lists the sidebar panels", () => {
    expect(RAIL_ITEMS).toEqual(["sessions", "files", "review", "git"]);
  });
});

describe("nextRailPanel", () => {
  it("toggles the sidebar when the active item is clicked again", () => {
    expect(nextRailPanel("files", "files", false)).toEqual({
      panel: "files",
      sidebarHidden: true,
    });
    expect(nextRailPanel("sessions", "files", false).sidebarHidden).toBe(false);
  });
});

describe("nextThemeId", () => {
  it("wraps the theme cycle", () => {
    expect(THEME_ORDER.at(-1)).toBe("sage");
    expect(nextThemeId("sage")).toBe("night");
    expect(nextThemeId("night")).toBe("dawn");
  });
});

describe("mountRail", () => {
  it("renders SVG buttons with aria-labels and a theme action", () => {
    const root = document.createElement("nav");
    const seen = [];
    const rail = mountRail(root, { onSelect: (id) => seen.push(id) });
    expect(root.firstElementChild.classList.contains("spopi-rail-logo")).toBe(true);
    expect(root.querySelector(".spopi-rail-logo").nextElementSibling.dataset.nav).toBe("sessions");
    expect(root.querySelectorAll("[data-nav]")).toHaveLength(4);
    expect(root.querySelector('[data-nav="review"] svg')).toBeTruthy();
    expect(root.querySelector('[data-action="theme"]')).toBeTruthy();
    expect(root.querySelector('[data-action="extensions"]')).toBeTruthy();
    expect(root.querySelector('[data-nav="sessions"] svg')).toBeTruthy();
    expect(root.querySelector('[data-nav="sessions"]').getAttribute("aria-label")).toBeTruthy();
    root.querySelector('[data-nav="files"]').click();
    expect(seen).toEqual(["files"]);
    rail.themeBtn.click();
    expect(document.documentElement.getAttribute("data-theme")).toBeTruthy();
  });

  it("opens Settings → Extensions without changing the active rail panel", () => {
    const root = document.createElement("nav");
    const seen = [];
    const opened = [];
    document.body.dataset.railPanel = "files";
    mountRail(root, {
      onSelect: (id) => seen.push(id),
      onOpenExtensions: () => opened.push("extensions"),
    });
    root.querySelector('[data-action="extensions"]').click();
    expect(opened).toEqual(["extensions"]);
    expect(seen).toEqual([]);
    expect(document.body.dataset.railPanel).toBe("files");
    expect(root.querySelector('[data-nav="files"]')?.getAttribute("aria-pressed")).toBe("false");
  });

  it("does not also call onSettings when onOpenExtensions returns nothing", () => {
    const root = document.createElement("nav");
    const opened = [];
    mountRail(root, {
      onOpenExtensions: () => {
        opened.push("extensions");
      },
      onSettings: (page) => opened.push(page || "settings"),
    });
    root.querySelector('[data-action="extensions"]').click();
    expect(opened).toEqual(["extensions"]);
  });
});
