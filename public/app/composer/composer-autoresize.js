// ABOUTME: Grows the composer textarea with its text up to a maximum height.
// ABOUTME: The surrounding layout is left to the composer stylesheet.

const DEFAULT_MAX_ROWS = 5;
const DEFAULT_MIN_ROWS = 2;
const FALLBACK_FONT_SIZE = 16;
const FALLBACK_LINE_HEIGHT_RATIO = 1.45;

/** @param {string} value */
function parsePixelValue(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** @param {CSSStyleDeclaration} style */
function resolveLineHeight(style) {
  const lineHeight = parsePixelValue(style.lineHeight);
  if (lineHeight > 0) return lineHeight;

  const fontSize = parsePixelValue(style.fontSize) || FALLBACK_FONT_SIZE;
  return fontSize * FALLBACK_LINE_HEIGHT_RATIO;
}

/**
 * @param {HTMLElement} input
 * @param {number} rows
 */
function resolveBoxHeightForRows(input, rows) {
  const style = getComputedStyle(input);
  const lineHeight = resolveLineHeight(style);
  const verticalPadding = parsePixelValue(style.paddingTop) + parsePixelValue(style.paddingBottom);
  const verticalBorder =
    parsePixelValue(style.borderTopWidth) + parsePixelValue(style.borderBottomWidth);

  return Math.ceil(lineHeight * rows + verticalPadding + verticalBorder);
}

/**
 * @param {object} [options]
 * @param {HTMLTextAreaElement | null | undefined} [options.input]
 * @param {number} [options.minRows]
 * @param {number} [options.maxRows]
 */
export function mountComposerAutoResize({
  input,
  minRows = DEFAULT_MIN_ROWS,
  maxRows = DEFAULT_MAX_ROWS,
} = {}) {
  if (!input) return { dispose() {}, sync() {} };
  const el = input;

  const minHeight = () => resolveBoxHeightForRows(el, minRows);
  const maxHeight = () => resolveBoxHeightForRows(el, maxRows);

  const sync = () => {
    el.style.height = "auto";
    const nextHeight = Math.max(minHeight(), Math.min(el.scrollHeight, maxHeight()));
    el.style.height = `${nextHeight}px`;
    el.style.overflowY = el.scrollHeight > maxHeight() ? "auto" : "hidden";
  };

  el.addEventListener("input", sync);
  sync();

  return {
    dispose() {
      el.removeEventListener("input", sync);
    },
    sync,
  };
}
