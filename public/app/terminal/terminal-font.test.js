// ABOUTME: Tests the bundled terminal font loader and its regular/bold face requests.
// ABOUTME: The loader must remain same-origin and complete before xterm measurement.
import { afterEach, expect, test, vi } from "vitest";
import {
  DEFAULT_TERMINAL_FONT_SIZE,
  loadTerminalFont,
  TERMINAL_FONT_FAMILY,
  TERMINAL_FONT_STACK,
} from "./terminal-font.js";

const originalFonts = document.fonts;

afterEach(() => {
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: originalFonts,
  });
});

test("loads regular and bold bundled faces before resolving", async () => {
  const load = vi.fn().mockResolvedValue([]);
  Object.defineProperty(document, "fonts", { configurable: true, value: { load } });

  await loadTerminalFont({ family: TERMINAL_FONT_FAMILY, fontSize: 16 });

  expect(load).toHaveBeenCalledWith('16px "SPOPI Mono Nerd"');
  expect(load).toHaveBeenCalledWith('700 16px "SPOPI Mono Nerd"');
});

test("exports the bundled family with monospace fallbacks", () => {
  expect(TERMINAL_FONT_STACK).toContain(`"${TERMINAL_FONT_FAMILY}"`);
  expect(TERMINAL_FONT_STACK).toContain("monospace");
  expect(DEFAULT_TERMINAL_FONT_SIZE).toBe(14);
});
