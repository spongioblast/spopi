// ABOUTME: Tests sidebar session action controls.
// ABOUTME: Includes "overlays hover actions without reserving title-row space".
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styleCss = ["public/style.css", "public/app/session/session-sidebar.css"]
  .map((path) => readFileSync(resolve(path), "utf8"))
  .join("\n");

function ruleFor(selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = styleCss.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, "s"));
  expect(match, `Missing CSS rule for ${selector}`).toBeTruthy();
  return match[1];
}

describe("sidebar session action controls", () => {
  it("overlays hover actions without reserving title-row space", () => {
    const actionSlotRules = [...styleCss.matchAll(/\.session-action-slot\s*\{([^}]*)\}/gs)].map(
      (match) => match[1],
    );

    expect(actionSlotRules.some((rule) => /position:\s*absolute;/.test(rule))).toBe(true);
    for (const rule of actionSlotRules) {
      expect(rule).not.toMatch(/width:\s*76px;/);
    }

    const groupedButtons = styleCss.match(
      /\.session-pin-btn,\s*\.session-archive-btn,\s*\.session-rename-btn\s*\{([^}]*)\}/s,
    );
    expect(groupedButtons, "Missing grouped session action button rule").toBeTruthy();
    expect(groupedButtons[1]).toMatch(/justify-content:\s*center;/);
    expect(groupedButtons[1]).not.toMatch(/position:\s*absolute;/);
  });

  it("gives the archived delete-all button a fixed centered hit target", () => {
    const deleteAllButtonRule = ruleFor(".archived-delete-all-btn");

    expect(deleteAllButtonRule).toMatch(/display:\s*flex;/);
    expect(deleteAllButtonRule).toMatch(/width:\s*20px;/);
    expect(deleteAllButtonRule).toMatch(/height:\s*20px;/);
    expect(deleteAllButtonRule).toMatch(/padding:\s*0;/);
    expect(deleteAllButtonRule).toMatch(/align-items:\s*center;/);
    expect(deleteAllButtonRule).toMatch(/justify-content:\s*center;/);
  });
});
