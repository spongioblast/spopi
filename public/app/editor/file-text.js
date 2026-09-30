// ABOUTME: Line-ending helpers for the file preview dirty check and save.
// ABOUTME: Editors speak LF; Windows files often stay CRLF on disk.

/**
 * @param {unknown} text
 * @returns {string}
 */
export function normalizeNewlines(text) {
  return String(text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

/**
 * @param {unknown} left
 * @param {unknown} right
 * @returns {boolean}
 */
export function sameFileText(left, right) {
  return normalizeNewlines(left) === normalizeNewlines(right);
}

/**
 * @param {unknown} text
 * @returns {"\r\n" | "\n"}
 */
export function newlineStyle(text) {
  const value = String(text ?? "");
  const crlf = (value.match(/\r\n/g) || []).length;
  const lf = (value.match(/(?<!\r)\n/g) || []).length;
  return crlf > lf ? "\r\n" : "\n";
}

/**
 * @param {unknown} text
 * @param {string} style
 * @returns {string}
 */
export function applyNewlineStyle(text, style) {
  const lf = normalizeNewlines(text);
  return style === "\r\n" ? lf.replace(/\n/g, "\r\n") : lf;
}
