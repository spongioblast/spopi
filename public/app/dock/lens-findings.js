// ABOUTME: Reads pi-lens diagnostics from a finished tool result.
// ABOUTME: Text blocks in result.content are not findings.

import { normalizeLocalPath } from "../files/path-utils.js";

/**
 * @typedef {"error" | "warning" | "info" | "hint"} LensSeverity
 * @typedef {{
 *   file: string,
 *   line: number,
 *   column: number,
 *   severity: LensSeverity,
 *   message: string,
 *   source: string,
 *   code: string,
 * }} LensFinding
 * @typedef {{ filePath: string, findings: LensFinding[] }} LensDiagnostics
 */

/** @param {string} [name] */
export function isLensTool(name = "") {
  return String(name).startsWith("lens_");
}

/**
 * LSP ranges are 0-based. A diagnostic without its own path uses details.filePath
 * (file check). A relative path is joined onto that directory (directory check).
 * @param {unknown} result
 * @returns {LensDiagnostics | null}
 */
export function findingsFromToolResult(result) {
  const details = asRecord(asRecord(result)?.details);
  if (!details || !Array.isArray(details.diagnostics)) return null;
  const filePath = typeof details.filePath === "string" ? normalizeLocalPath(details.filePath) : "";
  /** @type {LensFinding[]} */
  const findings = [];
  for (const entry of details.diagnostics) {
    const item = asRecord(entry);
    if (!item || typeof item.message !== "string") continue;
    const relative = relativeFile(item);
    const file = relative
      ? isAbsolutePath(relative)
        ? normalizeLocalPath(relative)
        : joinUnder(filePath, relative)
      : filePath;
    const position = positionOf(item);
    findings.push({
      file,
      line: position.line,
      column: position.column,
      severity: severityOf(item.severity),
      message: item.message,
      source: typeof item.source === "string" ? item.source : "",
      code: codeOf(item.code),
    });
  }
  return { filePath, findings };
}

/** @param {unknown} value @returns {Record<string, unknown> | null} */
function asRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return /** @type {Record<string, unknown>} */ (value);
}

/** @param {Record<string, unknown>} item */
function relativeFile(item) {
  for (const key of ["file", "path", "relativePath", "uri"]) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/** @param {string} value */
function isAbsolutePath(value) {
  const path = value.replaceAll("\\", "/");
  return path.startsWith("/") || /^[A-Za-z]:\//.test(path);
}

/**
 * @param {string} root
 * @param {string} relative
 */
function joinUnder(root, relative) {
  const rel = relative.replaceAll("\\", "/");
  if (!root) return normalizeLocalPath(rel);
  return normalizeLocalPath(`${root.replace(/\/+$/, "")}/${rel}`);
}

/** @param {Record<string, unknown>} item */
function positionOf(item) {
  const start = asRecord(asRecord(item.range)?.start);
  if (start && typeof start.line === "number") {
    const character = typeof start.character === "number" ? start.character + 1 : 1;
    return { line: start.line + 1, column: character };
  }
  const line = typeof item.line === "number" ? item.line : 0;
  const column =
    typeof item.character === "number"
      ? item.character
      : typeof item.column === "number"
        ? item.column
        : 0;
  return { line, column };
}

/** @param {unknown} value @returns {LensSeverity} */
function severityOf(value) {
  if (value === 1) return "error";
  if (value === 2) return "warning";
  if (value === 3) return "info";
  if (value === 4) return "hint";
  if (typeof value === "string") {
    const name = value.toLowerCase();
    if (name === "error" || name === "warning" || name === "info" || name === "hint") return name;
    const asNumber = Number(name);
    if (asNumber === 1 || asNumber === 2 || asNumber === 3 || asNumber === 4) {
      return severityOf(asNumber);
    }
  }
  return "warning";
}

/** @param {unknown} value */
function codeOf(value) {
  if (typeof value === "string" || typeof value === "number") return String(value);
  const record = asRecord(value);
  if (record && (typeof record.value === "string" || typeof record.value === "number")) {
    return String(record.value);
  }
  return "";
}
