// ABOUTME: Tests hideHeaderToggles.
// ABOUTME: Includes "hides SPOPI Files/Git/Info/terminal header controls".
import { describe, expect, it } from "vitest";
import { hideHeaderToggles, mountHeaderChrome } from "./header-chrome.js";

describe("hideHeaderToggles", () => {
  it("hides SPOPI Files/Git/Info/terminal header controls", () => {
    document.body.innerHTML = `
      <div class="header-right">
        <button id="file-sidebar-toggle"></button>
        <button id="diff-sidebar-toggle"></button>
        <button id="info-sidebar-toggle"></button>
        <button class="terminal-toggle"></button>
        <button id="package-update-indicator" data-count="0"></button>
      </div>
    `;
    hideHeaderToggles(document);
    expect(document.getElementById("file-sidebar-toggle")?.hidden).toBe(true);
    expect(document.getElementById("diff-sidebar-toggle")?.hidden).toBe(true);
    expect(document.getElementById("info-sidebar-toggle")?.hidden).toBe(true);
    expect(document.querySelector(".terminal-toggle")?.hidden).toBe(true);
    expect(document.getElementById("package-update-indicator")?.hidden).toBe(true);
  });
});

describe("mountHeaderChrome", () => {
  it("adds dock/chat/TUI controls and hides SPOPI toggles", () => {
    document.body.innerHTML = `
      <div class="header-right">
        <button id="file-sidebar-toggle"></button>
      </div>
    `;
    mountHeaderChrome({
      header: document.querySelector(".header-right"),
      t: (key, fallback) => fallback || key,
    });
    const metrics = document.getElementById("header-metrics");
    expect(metrics?.tagName).toBe("BUTTON");
    expect(metrics?.getAttribute("aria-label")).toBeTruthy();
    expect(metrics?.getAttribute("data-i18n-aria-label")).toBe("header.metrics");
    expect(document.getElementById("toggle-dock")).toBeTruthy();
    expect(document.getElementById("toggle-chat")).toBeTruthy();
    expect(document.getElementById("open-in-terminal-btn")).toBeTruthy();
    expect(document.getElementById("git-branch-toggle")).toBeNull();
    expect(document.getElementById("file-sidebar-toggle")?.hidden).toBe(true);
  });
});
