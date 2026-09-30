// ABOUTME: One xterm.js terminal instance adapter: input/size events to client
// ABOUTME: calls, snapshot/output application, and idempotent teardown. Never
// ABOUTME: puts terminal bytes or OSC titles into HTML (textContent only, elsewhere).

/**
 * @typedef {{
 *   background?: string,
 *   foreground?: string,
 *   cursor?: string,
 *   cursorAccent?: string,
 *   selection?: string,
 *   [ansi: string]: string | undefined,
 * }} XtermTheme
 */

/**
 * @typedef {{
 *   theme?: unknown,
 *   fontSize?: number,
 *   scrollback?: number,
 *   smoothScrollDuration?: number,
 * }} XtermOptions
 */

/**
 * @typedef {{ dispose: () => void }} XtermDisposable
 */

/**
 * Slice of xterm.js Terminal used by TerminalTab (vendor bundle is untyped).
 * @typedef {{
 *   options?: XtermOptions,
 *   rows?: number,
 *   element?: { querySelector?: (sel: string) => unknown },
 *   loadAddon: (addon: unknown) => void,
 *   open: (parent: unknown) => void,
 *   onData: (cb: (data: string) => void) => XtermDisposable,
 *   onResize: (cb: (size: { cols: number, rows: number }) => void) => XtermDisposable,
 *   write: ((data: string | Uint8Array, callback?: () => void) => void),
 *   reset: () => void,
 *   focus: () => void,
 *   refresh: (start: number, end: number) => void,
 *   dispose: () => void,
 *   buffer?: { active?: {
 *     length: number,
 *     getLine: (y: number) => {
 *       isWrapped?: boolean,
 *       translateToString: (trimRight?: boolean) => string,
 *     } | undefined,
 *   } },
 * }} XtermTerminal
 */

/**
 * @typedef {{ fit: () => void }} XtermFitAddon
 */

/**
 * @typedef {{ serialize: (opts?: { scrollback?: number }) => string }} XtermSerializeAddon
 */

/**
 * @typedef {{ dispose: () => void }} XtermWebglAddon
 */

/**
 * TerminalTab wraps one xterm.js Terminal + Fit/Serialize addons behind an
 * injectable factory so jsdom tests assert SPOPI behavior, not xterm internals.
 * Production passes `globalThis.SpopiXterm` factories.
 */
import { loadTerminalFont } from "./terminal-font.js";

export class TerminalTab {
  /**
   * @param {{
   *   terminalId: string,
   *   generation: number,
   *   container?: unknown,
   *   terminalFactory: () => XtermTerminal,
   *   fitAddonFactory: () => XtermFitAddon,
   *   serializeAddonFactory: () => XtermSerializeAddon,
   *   sendInput?: (terminalId: string, generation: number, dataBase64: string) => void,
   *   sendResize?: (terminalId: string, generation: number, cols: number, rows: number) => void,
   *   fontFamily?: string,
   *   fontSize?: number,
   *   initialTheme?: unknown,
   *   loadFont?: () => Promise<unknown>,
   * }} options
   */
  constructor({
    terminalId,
    generation,
    container,
    terminalFactory,
    fitAddonFactory,
    serializeAddonFactory,
    sendInput,
    sendResize,
    fontFamily,
    fontSize,
    initialTheme,
    loadFont = () => loadTerminalFont({ family: fontFamily, fontSize }),
  }) {
    /** @type {string} */
    this.terminalId = terminalId;
    /** @type {number} */
    this.generation = generation;
    this.sendInput = sendInput;
    this.sendResize = sendResize;
    /** @type {number} */
    this.lastAppliedSequence = 0;
    /** @type {boolean} */
    this.destroyed = false;
    /** @type {ReturnType<typeof setTimeout> | 0} */
    this.resizeTimer = 0;
    /** @type {XtermWebglAddon | null} */
    this.webglAddon = null;
    this._fontReady = Promise.resolve()
      .then(() => loadFont())
      .catch(() => undefined);

    /** @type {XtermTerminal} */
    this.terminal = terminalFactory();
    /** @type {XtermFitAddon} */
    this.fitAddon = fitAddonFactory();
    /** @type {XtermSerializeAddon} */
    this.serializeAddon = serializeAddonFactory();
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.loadAddon(this.serializeAddon);
    if (container) {
      this.terminal.open(container);
    }
    if (this.terminal.options) {
      this.terminal.options.theme = initialTheme || spopiThemeToXterm();
      this._paintViewport(this.terminal.options.theme);
    }

    /** @type {number} */
    this._replaying = 0;
    /** @type {XtermDisposable | null | undefined} */
    this._dataDisposable = this.terminal.onData((data) => {
      // Replaying a checkpoint or journal can make xterm answer a cursor-position
      // query. That reply ends in "R" and must not be typed into the live shell.
      if (this.destroyed || this._replaying > 0) return;
      this.sendInput?.(this.terminalId, this.generation, encodeBase64(toBytes(data)));
    });
    /** @type {XtermDisposable | null | undefined} */
    this._resizeDisposable = this.terminal.onResize(({ cols, rows }) => {
      this._scheduleResize(cols, rows);
    });
    // Never measure xterm cells against the fallback font. Callers can await
    // `ready` when they need to know the first fit has completed.
    this.ready = this._fontReady.then(() => this._fit());
  }

  refit() {
    return this._fontReady.then(() => this._fit());
  }

  _fit() {
    if (this.destroyed) return;
    try {
      this.fitAddon.fit();
    } catch {
      // Container not measurable yet (hidden/collapsed); caller refits on activation.
    }
    this._paintViewport(this.terminal.options?.theme);
  }

  _beginReplay() {
    this._replaying += 1;
  }

  _endReplay() {
    this._replaying = Math.max(0, this._replaying - 1);
  }

  /**
   * @param {string | Uint8Array} bytes
   */
  writeReplay(bytes) {
    this._beginReplay();
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      this._endReplay();
    };
    try {
      this.terminal.write(bytes, end);
    } catch {
      end();
    }
    // Writes that ignore the callback must not leave input suppressed.
    if (this.terminal.write.length < 2) end();
  }

  /**
   * True once any visible character is on screen. Mode switches and titles
   * are not text, so a fresh shell stays blank until it paints its prompt.
   * @returns {boolean}
   */
  hasScreenText() {
    const buffer = this.terminal.buffer?.active;
    if (!buffer) return this.lastAppliedSequence > 0;
    for (let y = 0; y < buffer.length; y += 1) {
      if (buffer.getLine(y)?.translateToString(true).trim()) return true;
    }
    return false;
  }

  /**
   * Scrollback and screen as the user reads them: no escape sequences, wrapped
   * rows joined, blank rows at either end dropped.
   * @param {number} [maxLines]
   * @returns {string}
   */
  plainText(maxLines = 200) {
    const buffer = this.terminal.buffer?.active;
    if (!buffer) return "";
    /** @type {string[]} */
    const lines = [];
    for (let y = 0; y < buffer.length; y += 1) {
      const line = buffer.getLine(y);
      if (!line) continue;
      const text = line.translateToString(true);
      if (line.isWrapped && lines.length) lines[lines.length - 1] += text;
      else lines.push(text);
    }
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    const tail = lines.slice(-maxLines);
    while (tail.length && !tail[0].trim()) tail.shift();
    return tail.join("\n");
  }

  focus() {
    try {
      this.terminal.focus();
    } catch {
      // Ignore focus errors during teardown.
    }
  }

  /**
   * @param {string} snapshotBase64
   */
  writeSnapshot(snapshotBase64) {
    const text = decodeBase64(snapshotBase64);
    try {
      this.terminal.reset();
    } catch {
      // Ignore reset errors during teardown.
    }
    this.writeReplay(text);
    this._paintViewport(this.terminal.options?.theme);
  }

  /**
   * @param {string} dataBase64
   * @param {{ replay?: boolean }} [options]
   */
  writeOutput(dataBase64, { replay } = {}) {
    const bytes = decodeBase64(dataBase64);
    if (replay) {
      this.writeReplay(bytes);
      return;
    }
    try {
      this.terminal.write(bytes);
    } catch {
      // Ignore write errors during teardown.
    }
  }

  /**
   * @param {number} sequence
   */
  ack(sequence) {
    this.lastAppliedSequence = sequence;
  }

  /**
   * Serialize the screen plus up to `scrollback` lines for a checkpoint.
   * @param {number} [scrollback]
   * @returns {string}
   */
  serializeForCheckpoint(scrollback = 2000) {
    return this.serializeAddon.serialize({ scrollback });
  }

  /**
   * @param {number} generation
   */
  setGeneration(generation) {
    this.generation = generation;
  }

  /**
   * @param {unknown} theme
   */
  setTheme(theme) {
    if (!this.destroyed && this.terminal?.options) {
      this.terminal.options.theme = theme;
      this._paintViewport(theme);
      // xterm 6 should redraw on theme change, but force a refresh in case the
      // renderer does not pick up the new background immediately.
      try {
        this.terminal.refresh(0, (this.terminal.rows || 1) - 1);
      } catch {
        // refresh is best-effort across xterm versions
      }
    }
  }

  /**
   * xterm.css hard-codes `.xterm-viewport { background: #000 }` and xterm 6 no
   * longer paints the theme background onto it, so the strip below the last
   * row showed black on every theme. Paint it ourselves.
   * @param {unknown} theme
   */
  _paintViewport(theme) {
    const background =
      theme && typeof theme === "object" && "background" in theme
        ? /** @type {{ background?: unknown }} */ (theme).background
        : undefined;
    const viewport = this.terminal?.element?.querySelector?.(".xterm-viewport");
    if (
      viewport &&
      typeof viewport === "object" &&
      "style" in viewport &&
      typeof background === "string" &&
      background
    ) {
      /** @type {{ style: { backgroundColor: string } }} */ (viewport).style.backgroundColor =
        background;
    }
  }

  /**
   * Apply display-only xterm options without recreating the live terminal.
   * `fontSize` triggers a refit; scrollback and smooth scrolling take effect
   * through xterm's mutable option surface.
   * @param {{
   *   fontSize?: number,
   *   scrollback?: number,
   *   smoothScrollDuration?: number,
   * }} [prefs]
   * @returns {boolean}
   */
  applyPreferences(prefs = {}) {
    if (this.destroyed || !this.terminal?.options) {
      return false;
    }
    let changed = false;
    let refit = false;
    const options = this.terminal.options;
    if (Number.isFinite(prefs.fontSize) && options.fontSize !== prefs.fontSize) {
      options.fontSize = prefs.fontSize;
      changed = true;
      refit = true;
    }
    if (Number.isFinite(prefs.scrollback) && options.scrollback !== prefs.scrollback) {
      options.scrollback = prefs.scrollback;
      changed = true;
    }
    if (
      Number.isFinite(prefs.smoothScrollDuration) &&
      options.smoothScrollDuration !== prefs.smoothScrollDuration
    ) {
      options.smoothScrollDuration = prefs.smoothScrollDuration;
      changed = true;
    }
    if (refit) {
      this._fontReady.then(() => this._fit());
    }
    return changed;
  }

  /**
   * Upgrade a DOM-rendered tab to WebGL at runtime (settings toggle).
   * Returns whether the upgrade succeeded; on failure the DOM renderer stays.
   * @param {unknown} factory
   * @returns {boolean}
   */
  enableWebgl(factory) {
    if (this.destroyed || this.webglAddon || typeof factory !== "function") {
      return false;
    }
    try {
      this.webglAddon = /** @type {() => XtermWebglAddon} */ (factory)();
      this.terminal.loadAddon(this.webglAddon);
    } catch {
      this.webglAddon = null;
    }
    return this.webglAddon !== null;
  }

  /**
   * Drop the WebGL renderer and return to the DOM renderer.
   * @returns {boolean}
   */
  disableWebgl() {
    if (this.destroyed || !this.webglAddon) {
      return false;
    }
    try {
      this.webglAddon.dispose();
    } catch {
      // Already gone.
    }
    this.webglAddon = null;
    return true;
  }

  /** Destroy listeners, addons, and the terminal. Idempotent. */
  destroy() {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = 0;
    }
    this._dataDisposable?.dispose?.();
    this._resizeDisposable?.dispose?.();
    this._dataDisposable = null;
    this._resizeDisposable = null;
    if (this.webglAddon) {
      try {
        this.webglAddon.dispose();
      } catch {
        // Already gone.
      }
      this.webglAddon = null;
    }
    try {
      this.terminal?.dispose?.();
    } catch {
      // Ignore double-dispose.
    }
  }

  /**
   * @param {number} cols
   * @param {number} rows
   */
  _scheduleResize(cols, rows) {
    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer);
    }
    this.resizeTimer = setTimeout(() => {
      this.resizeTimer = 0;
      if (this.destroyed) {
        return;
      }
      this.sendResize?.(this.terminalId, this.generation, cols, rows);
    }, 100);
  }
}

/**
 * @param {string} str
 * @returns {Uint8Array}
 */
function toBytes(str) {
  return new TextEncoder().encode(str);
}

/**
 * @param {ArrayLike<number>} bytes
 * @returns {string}
 */
export function encodeBase64(bytes) {
  let bin = "";
  const len = bytes.length;
  for (let i = 0; i < len; i += 1) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

/**
 * @param {string} b64
 * @returns {Uint8Array}
 */
function decodeBase64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

const ANSI_DARK = {
  black: "#3b3f4a",
  red: "#ff7b72",
  green: "#3fb950",
  yellow: "#d8a93e",
  blue: "#58a6ff",
  magenta: "#bc8cff",
  cyan: "#39c5cf",
  white: "#c9d1d9",
  brightBlack: "#6e7681",
  brightRed: "#ffa198",
  brightGreen: "#56d364",
  brightYellow: "#e8c46a",
  brightBlue: "#79c0ff",
  brightMagenta: "#d2a8ff",
  brightCyan: "#56d4dd",
  brightWhite: "#f0f3f6",
};
// "white" is a mid grey: programs print it as ordinary text on a light ground.
const ANSI_LIGHT = {
  black: "#24292f",
  red: "#cf222e",
  green: "#1a7f37",
  yellow: "#9a6700",
  blue: "#0969da",
  magenta: "#8250df",
  cyan: "#1b7c83",
  white: "#6e7781",
  brightBlack: "#57606a",
  brightRed: "#a40e26",
  brightGreen: "#116329",
  brightYellow: "#7d4e00",
  brightBlue: "#0550ae",
  brightMagenta: "#6639ba",
  brightCyan: "#136061",
  brightWhite: "#8c959f",
};

/**
 * Bridge the active SPOPI theme (CSS variables) into an xterm theme object.
 * @returns {XtermTheme}
 */
export function spopiThemeToXterm() {
  const cs = getComputedStyle(document.documentElement);
  /** @param {string} name @returns {string} */
  const get = (name) => cs.getPropertyValue(name).trim();
  const light = document.documentElement.getAttribute("data-scheme") === "light";
  /** @type {Record<string, string>} */
  const ansi = { ...(light ? ANSI_LIGHT : ANSI_DARK) };
  // A theme may tune the palette with --ansi-green, --ansi-bright-black, …; a bright
  // color it leaves out follows its normal one.
  for (const key of Object.keys(ansi)) {
    const token = key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    const base = key.startsWith("bright") ? key.slice(6).toLowerCase() : null;
    const value = get(`--ansi-${token}`) || (base ? get(`--ansi-${base}`) : "");
    if (value) ansi[key] = value;
  }
  return {
    background: get("--bg-solid") || "#000000",
    foreground: get("--text-primary") || "#e5e5e5",
    cursor: get("--text-primary") || "#e5e5e5",
    cursorAccent: get("--bg-solid") || "#000000",
    selection: get("--bg-glass-active") || "rgba(255,255,255,0.2)",
    ...ansi,
  };
}

// Canonical chrome for forced modes: picked from SPOPI's own dark/light theme
// surfaces (night --bg-solid #1a1a1a, clean --bg-solid #ffffff) so a forced
// terminal stays readable regardless of the active SPOPI theme.
const FORCED_DARK_CHROME = {
  background: "#1a1a1a",
  foreground: "#e6e6e6",
  cursor: "#e6e6e6",
  cursorAccent: "#1a1a1a",
  selection: "rgba(255, 255, 255, 0.2)",
};
const FORCED_LIGHT_CHROME = {
  background: "#ffffff",
  foreground: "rgba(0, 0, 0, 0.88)",
  cursor: "rgba(0, 0, 0, 0.88)",
  cursorAccent: "#ffffff",
  selection: "rgba(0, 0, 0, 0.2)",
};

/**
 * Resolve the xterm theme for a terminal themeMode preference: "system"
 * follows the active SPOPI theme; "light"/"dark" force a canonical palette.
 * Unknown modes fall back to the system behavior.
 * @param {string | null | undefined} mode
 * @returns {XtermTheme}
 */
export function resolveTerminalTheme(mode) {
  if (mode === "dark") {
    return { ...FORCED_DARK_CHROME, ...ANSI_DARK };
  }
  if (mode === "light") {
    return { ...FORCED_LIGHT_CHROME, ...ANSI_LIGHT };
  }
  return spopiThemeToXterm();
}
