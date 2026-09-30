// ABOUTME: Tests the shared shortcut registry.
// ABOUTME: A matching chord runs, and the slash column reads the same list.
import { describe, expect, it, vi } from "vitest";
import { commandShortcut } from "../composer/slash-sources.js";
import { appKeybindings, createKeybindings, formatChord } from "./keybindings.js";

describe("createKeybindings", () => {
  it("runs the matching chord and lists it for the slash menu", () => {
    const keys = createKeybindings();
    const run = vi.fn();
    keys.register({ id: "dock", keys: "Mod+J", labelKey: "keybindings.dock", run });
    const event = new KeyboardEvent("keydown", { key: "j", ctrlKey: true, cancelable: true });
    expect(keys.handle(event)).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    expect(keys.list().map((binding) => binding.id)).toEqual(["dock"]);
    expect(formatChord("Mod+J")).toBe("Ctrl+J");
  });

  it("skips a chord whose when() is false", () => {
    const keys = createKeybindings();
    const run = vi.fn();
    keys.register({
      id: "editor.inline",
      keys: "Mod+K",
      labelKey: "keybindings.inlineEdit",
      when: () => false,
      run,
    });
    const event = new KeyboardEvent("keydown", { key: "k", metaKey: true, cancelable: true });
    expect(keys.handle(event)).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("feeds the slash shortcut column from the shared list", () => {
    appKeybindings().register({
      id: "sidebar",
      keys: "Mod+B",
      labelKey: "keybindings.sidebar",
      run: () => {},
    });
    expect(commandShortcut({ name: "sidebar" })).toBe("Ctrl+B");
  });
});
