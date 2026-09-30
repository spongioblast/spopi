// ABOUTME: Loads SPOPI's same-origin bundled terminal font before xterm measures cells.
// ABOUTME: Keeps font selection display-only and independent from PTY or terminal identity.

export const TERMINAL_FONT_FAMILY = "SPOPI Mono Nerd";
export const TERMINAL_FONT_STACK =
  '"SPOPI Mono Nerd", ui-monospace, SFMono-Regular, Menlo, Monaco, "Cascadia Mono", Consolas, "Liberation Mono", monospace';
export const DEFAULT_TERMINAL_FONT_SIZE = 14;

/**
 * Resolve both regular and bold faces so xterm's normal and ANSI-bold cells use
 * the same metrics before FitAddon measures the terminal viewport.
 */
export function loadTerminalFont({
  family = TERMINAL_FONT_FAMILY,
  fontSize = DEFAULT_TERMINAL_FONT_SIZE,
} = {}) {
  if (typeof document === "undefined" || !document.fonts?.load) {
    return Promise.resolve();
  }
  return Promise.all([
    document.fonts.load(`${fontSize}px "${family}"`),
    document.fonts.load(`700 ${fontSize}px "${family}"`),
  ]).then(() => undefined);
}
