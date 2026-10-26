// ABOUTME: Reads the project check's findings that spopi-verify sends as one JSON widget line.
// ABOUTME: The Problems dock listens here; the widget never reaches the generic widget renderer.

import { normalizeLocalPath } from "../files/path-utils.js";

/**
 * @typedef {import("./lens-findings.js").LensFinding} LensFinding
 * @typedef {{ command: string, status: "passed" | "failed" | "could-not-run", findings: LensFinding[] }} CheckReport
 */

const VERIFY_FINDINGS_WIDGET = "spopi-verify-findings";
const STATUSES = new Set(["passed", "failed", "could-not-run"]);
const SEVERITIES = new Set(["error", "warning", "info", "hint"]);

/** @type {Set<(report: CheckReport) => void>} */
const listeners = new Set();

/** @param {{ method?: string, widgetKey?: string } | null | undefined} request */
export function isVerifyFindingsWidget(request) {
  return request?.method === "setWidget" && request.widgetKey === VERIFY_FINDINGS_WIDGET;
}

/**
 * @param {unknown} lines
 * @returns {CheckReport | null}
 */
export function parseVerifyFindings(lines) {
  if (!Array.isArray(lines) || typeof lines[0] !== "string") return null;
  /** @type {unknown} */
  let raw;
  try {
    raw = JSON.parse(lines[0]);
  } catch {
    return null;
  }
  const report = /** @type {{ command?: unknown, status?: unknown, findings?: unknown }} */ (raw);
  if (!report || typeof report.command !== "string" || !STATUSES.has(String(report.status))) {
    return null;
  }
  /** @type {LensFinding[]} */
  const findings = [];
  for (const entry of Array.isArray(report.findings) ? report.findings : []) {
    const item = /** @type {Record<string, unknown>} */ (entry);
    if (!item || typeof item.file !== "string" || typeof item.message !== "string") continue;
    const severity = String(item.severity);
    findings.push({
      file: normalizeLocalPath(item.file),
      line: Number(item.line) || 0,
      column: Number(item.column) || 0,
      severity: /** @type {LensFinding["severity"]} */ (
        SEVERITIES.has(severity) ? severity : "error"
      ),
      message: item.message,
      source: "check",
      code: typeof item.code === "string" ? item.code : "",
    });
  }
  return {
    command: report.command,
    status: /** @type {CheckReport["status"]} */ (report.status),
    findings,
  };
}

/** @param {CheckReport} report */
export function emitVerifyFindings(report) {
  for (const listener of listeners) listener(report);
}

/**
 * @param {(report: CheckReport) => void} listener
 * @returns {() => void}
 */
export function onVerifyFindings(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
