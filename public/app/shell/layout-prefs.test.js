// ABOUTME: Tests layout clamps.
// ABOUTME: Includes "keeps sidebar, chat, and dock inside the plan ranges".
import { describe, expect, it } from "vitest";
import {
  applyLayoutVars,
  clampChatWidthPct,
  clampDockHeight,
  clampSidebarWidth,
  normalizeLayout,
} from "./layout-prefs.js";

describe("layout clamps", () => {
  it("keeps sidebar, chat, and dock inside the plan ranges", () => {
    expect(clampSidebarWidth(80)).toBe(160);
    expect(clampSidebarWidth(900)).toBe(480);
    expect(clampChatWidthPct(10)).toBe(28);
    expect(clampDockHeight(40)).toBe(120);
  });
});

describe("normalizeLayout", () => {
  it("fills defaults and booleans", () => {
    expect(normalizeLayout({ sidebarHidden: 1 }).sidebarHidden).toBe(true);
    expect(normalizeLayout({}).chatWidthPct).toBe(34);
    expect(normalizeLayout({}).dockHeight).toBe(300);
  });

  it("treats the old 168px default as unset", () => {
    expect(normalizeLayout({ dockHeight: 168 }).dockHeight).toBe(300);
    expect(normalizeLayout({ dockHeight: 240 }).dockHeight).toBe(240);
  });
});

describe("applyLayoutVars", () => {
  it("writes CSS vars on the document root", () => {
    applyLayoutVars({ sidebarWidth: 200, chatWidthPct: 40, dockHeight: 180 });
    expect(document.documentElement.style.getPropertyValue("--sidebar-width")).toBe("200px");
    expect(document.documentElement.style.getPropertyValue("--dock-height")).toBe("180px");
  });
});
