// ABOUTME: Tests toggleExclusiveSidePanel.
// ABOUTME: Includes "opens one side panel while closing the other".
// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { toggleExclusiveSidePanel, toggleExclusiveSideView } from "./exclusive-side-panel.js";

describe("toggleExclusiveSidePanel", () => {
  it("opens one side panel while closing the other", () => {
    const files = document.createElement("div");
    const diff = document.createElement("div");
    files.className = "collapsed";

    expect(toggleExclusiveSidePanel(files, [diff])).toBe(true);
    expect(files.classList.contains("collapsed")).toBe(false);
    expect(diff.classList.contains("collapsed")).toBe(true);

    expect(toggleExclusiveSidePanel(diff, [files])).toBe(true);
    expect(diff.classList.contains("collapsed")).toBe(false);
    expect(files.classList.contains("collapsed")).toBe(true);
  });

  it("closes the active panel when toggled again", () => {
    const panel = document.createElement("div");
    expect(toggleExclusiveSidePanel(panel)).toBe(false);
    expect(panel.classList.contains("collapsed")).toBe(true);
  });
});

describe("toggleExclusiveSideView", () => {
  it("opens a closed panel onto the requested view", () => {
    const panel = document.createElement("div");
    panel.className = "collapsed";
    expect(toggleExclusiveSideView(panel, { currentView: "files", nextView: "git" })).toEqual({
      open: true,
      view: "git",
    });
    expect(panel.classList.contains("collapsed")).toBe(false);
  });

  it("closes the panel when the same view is requested again", () => {
    const panel = document.createElement("div");
    expect(toggleExclusiveSideView(panel, { currentView: "files", nextView: "files" })).toEqual({
      open: false,
      view: "files",
    });
    expect(panel.classList.contains("collapsed")).toBe(true);
  });

  it("stays open and switches when the other header view is requested", () => {
    const panel = document.createElement("div");
    const other = document.createElement("div");
    expect(
      toggleExclusiveSideView(panel, {
        otherPanels: [other],
        currentView: "files",
        nextView: "git",
      }),
    ).toEqual({
      open: true,
      view: "git",
    });
    expect(panel.classList.contains("collapsed")).toBe(false);
    expect(other.classList.contains("collapsed")).toBe(true);
  });
});
