// ABOUTME: Problems dock lists pi-lens diagnostics grouped by file.
// ABOUTME: A later result replaces the files it covered; the footer keeps pi-lens-lsp.

import { findingsFromToolResult, isLensTool } from "./lens-findings.js";

/**
 * @typedef {import("./lens-findings.js").LensFinding} LensFinding
 * @typedef {{
 *   t?: (key: string, params?: Record<string, unknown>) => string,
 *   onOpenFile?: (path: string, line?: number) => void,
 *   onChange?: () => void,
 * }} MountProblemsDockOptions
 * @typedef {{
 *   noteResult: (name: unknown, result: unknown) => void,
 *   clear: () => void,
 *   setLanguageStatus: (text: string) => void,
 * }} ProblemsDockApi
 */

/**
 * "Inactive" contains the letters of "Active", so the idle wording is matched first.
 * @param {string} text
 * @param {(key: string, params?: Record<string, unknown>) => string} translate
 */
function languageServerLabel(text, translate) {
  const raw = text.trim();
  if (!raw) return "";
  if (raw.includes("Inactive")) return translate("dock.languageServers.none");
  const failed = raw.match(/Failed:?\s*(.*)$/);
  if (failed) return translate("dock.languageServers.failed", { reason: failed[1].trim() });
  if (raw.includes("Active")) {
    const names = raw.replace(/^[\s\S]*Active:?\s*/, "").trim();
    return translate("dock.languageServers.active", { names });
  }
  return raw;
}

/**
 * @param {HTMLElement | Element | null | undefined} root
 * @param {MountProblemsDockOptions} [options]
 * @returns {ProblemsDockApi | null}
 */
export function mountProblemsDock(root, { t = (key) => key, onOpenFile, onChange } = {}) {
  if (!root || !("replaceChildren" in root)) return null;
  const host = /** @type {HTMLElement} */ (root);
  const header = document.createElement("p");
  header.className = "problems-language-status";
  header.hidden = true;
  const list = document.createElement("div");
  list.className = "problems-list";
  host.replaceChildren(header, list);

  /** @type {Map<string, LensFinding[]>} */
  let byFile = new Map();
  let errorText = "";

  const render = () => {
    list.replaceChildren();
    if (errorText) {
      const row = document.createElement("p");
      row.className = "problem-row problem-row-muted";
      row.textContent = errorText;
      list.append(row);
      return;
    }
    for (const [file, findings] of byFile) {
      const group = document.createElement("section");
      group.className = "problem-file";
      const head = document.createElement("div");
      head.className = "problem-file-head";
      const path = document.createElement("span");
      path.className = "problem-path";
      path.textContent = file;
      const count = document.createElement("span");
      count.className = "problem-count";
      count.textContent = String(findings.length);
      head.append(path, count);
      group.append(head);
      for (const finding of findings) group.append(renderRow(finding));
      list.append(group);
    }
  };

  /**
   * @param {LensFinding} finding
   */
  const renderRow = (finding) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "problem-row";
    row.dataset.severity = finding.severity;
    const severity = document.createElement("span");
    severity.className = "problem-severity";
    severity.textContent = t(`dock.problemSeverity.${finding.severity}`);
    const message = document.createElement("span");
    message.className = "problem-message";
    message.textContent = finding.message;
    row.append(severity, message);
    const meta = [finding.source, finding.code].filter(Boolean).join(" ");
    if (meta) {
      const source = document.createElement("span");
      source.className = "problem-meta";
      source.textContent = meta;
      row.append(source);
    }
    if (finding.line > 0) {
      const loc = document.createElement("span");
      loc.className = "problem-loc";
      loc.textContent = `${finding.line}:${finding.column}`;
      row.append(loc);
    }
    row.addEventListener("click", () => {
      onOpenFile?.(finding.file, finding.line > 0 ? finding.line : undefined);
    });
    return row;
  };

  /**
   * @param {string} filePath
   * @param {LensFinding[]} findings
   */
  const replaceCovered = (filePath, findings) => {
    /** @type {Map<string, LensFinding[]>} */
    const next = new Map();
    for (const [file, list] of byFile) {
      if (filePath && (file === filePath || file.startsWith(`${filePath}/`))) continue;
      next.set(file, list);
    }
    /** @type {Map<string, LensFinding[]>} */
    const grouped = new Map();
    for (const finding of findings) {
      const file = finding.file || filePath;
      if (!file) continue;
      const existing = grouped.get(file);
      if (existing) existing.push(finding);
      else grouped.set(file, [finding]);
    }
    for (const [file, list] of grouped) next.set(file, list);
    byFile = next;
  };

  return {
    /**
     * @param {unknown} name
     * @param {unknown} result
     */
    noteResult(name, result) {
      if (!isLensTool(typeof name === "string" ? name : "")) return;
      const record = asRecord(result);
      if (record?.isError === true) {
        errorText = errorTextFrom(record, t);
        render();
        onChange?.();
        return;
      }
      const parsed = findingsFromToolResult(result);
      if (!parsed) return;
      errorText = "";
      replaceCovered(parsed.filePath, parsed.findings);
      render();
      onChange?.();
    },
    clear() {
      byFile = new Map();
      errorText = "";
      render();
      onChange?.();
    },
    /**
     * @param {string} text
     */
    setLanguageStatus(text) {
      const label = languageServerLabel(typeof text === "string" ? text : "", t);
      header.hidden = !label;
      header.textContent = label;
    },
  };
}

/** @param {unknown} value @returns {Record<string, unknown> | null} */
function asRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return /** @type {Record<string, unknown>} */ (value);
}

/**
 * @param {Record<string, unknown>} record
 * @param {(key: string, params?: Record<string, unknown>) => string} translate
 */
function errorTextFrom(record, translate) {
  if (Array.isArray(record.content)) {
    const text = record.content
      .map((block) => {
        const item = asRecord(block);
        return item && typeof item.text === "string" ? item.text.trim() : "";
      })
      .filter(Boolean)
      .join("\n");
    if (text) return text;
  }
  if (typeof record.message === "string" && record.message.trim()) return record.message.trim();
  if (typeof record.error === "string" && record.error.trim()) return record.error.trim();
  return translate("dock.lensError");
}
