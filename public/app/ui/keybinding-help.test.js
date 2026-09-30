// ABOUTME: Tests the shortcut sheet.
// ABOUTME: Unbound rows stay hidden, duplicate labels collapse, Escape is titled.
import { describe, expect, it } from "vitest";
import { showKeybindingHelp } from "./keybinding-help.js";
import { appKeybindings, formatChord } from "./keybindings.js";

describe("keybinding help", () => {
  it("hides unbound bindings, dedupes labels, titles Escape, and closes", () => {
    document.body.innerHTML = `<div id="dialog-container" class="hidden"></div>`;
    const keys = appKeybindings();
    keys.register({ id: "help", keys: "Escape", labelKey: "keybindings.hotkeys", run() {} });
    keys.register({ id: "hotkeys", keys: "", labelKey: "keybindings.hotkeys", run() {} });
    keys.register({ id: "guard", keys: "", labelKey: "keybindings.guard", run() {} });
    expect(formatChord("Escape")).toBe("Escape");
    expect(showKeybindingHelp()).toBe(true);
    const rows = document.querySelectorAll(".keybinding-help-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.querySelector("kbd")?.textContent).toBe("Escape");
    const close = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "keybindings.close",
    );
    expect(close).toBeTruthy();
    close?.click();
    expect(document.querySelector(".dialog")).toBeNull();
  });
});
