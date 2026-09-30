// ABOUTME: Tests the session-tree and context tabs on the file preview bar.
// ABOUTME: Covers center-tabs.js: translated labels and closing the last custom tab.

import { afterEach, expect, test, vi } from "vitest";
import { mountCenterTabs } from "./center-tabs.js";

afterEach(() => {
  document.body.replaceChildren();
});

function fixture() {
  const center = document.createElement("div");
  center.id = "pane-center";
  const panel = document.createElement("section");
  panel.id = "file-preview-panel";
  panel.className = "file-preview-panel collapsed";
  const tabs = document.createElement("div");
  tabs.id = "file-preview-tabs";
  center.append(panel, tabs);
  document.body.append(center);
  return { center, panel, tabs };
}

test("openContext uses the translator for the tab name", () => {
  const { tabs, panel } = fixture();
  const api = mountCenterTabs(document.getElementById("pane-center"), {
    t: (key) => (key === "contextInspector.title" ? "Context" : key),
  });
  api.openContext();
  expect(tabs.querySelector(".file-preview-tab-name")?.textContent).toBe("Context");
  expect(panel.classList.contains("collapsed")).toBe(false);
});

test("closing the only custom tab collapses the preview", () => {
  const { tabs, panel } = fixture();
  const api = mountCenterTabs(document.getElementById("pane-center"), {
    t: (key) => key,
  });
  api.openContext();
  tabs.querySelector(".file-preview-tab-close")?.click();
  expect(panel.classList.contains("collapsed")).toBe(true);
  expect(panel.classList.contains("custom-tab-active")).toBe(false);
  expect(document.getElementById("spopi-dock-context")?.hidden).toBe(true);
});

test("closing one custom tab activates the one that remains", () => {
  const { tabs } = fixture();
  const api = mountCenterTabs(document.getElementById("pane-center"), {
    t: (key) => key,
  });
  api.openContext();
  api.openTree();
  const closes = tabs.querySelectorAll(".file-preview-tab-close");
  closes[closes.length - 1]?.click();
  expect(tabs.querySelector(".file-preview-tab.active")?.dataset.customTab).toBe("context");
  expect(document.getElementById("spopi-dock-context")?.hidden).toBe(false);
});

test("closing a custom tab clicks a remaining file tab", () => {
  const { tabs } = fixture();
  const fileTab = document.createElement("div");
  fileTab.className = "file-preview-tab";
  fileTab.dataset.tabId = "readme";
  const click = vi.fn();
  fileTab.addEventListener("click", click);
  tabs.append(fileTab);
  const api = mountCenterTabs(document.getElementById("pane-center"), {
    t: (key) => key,
  });
  api.openContext();
  tabs.querySelector("[data-custom-tab] .file-preview-tab-close")?.click();
  expect(click).toHaveBeenCalled();
});
