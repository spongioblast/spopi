// ABOUTME: Formats Cockpit numbers, durations, and Pi phase names.
// ABOUTME: The overlay paints these strings. It does not decide them.

import { t } from "../i18n/i18n.js";

/**
 * @param {string} key
 * @param {string} fallback
 * @param {Record<string, string | number>} [params]
 */
export function translate(key, fallback, params) {
  const filled = params
    ? fallback.replace(/\{(\w+)\}/g, (match, name) => String(params[name] ?? match))
    : fallback;
  try {
    const value = t(key, params);
    return value && value !== key ? value : filled;
  } catch {
    return filled;
  }
}

/** The user's metrics URL, or "" to read `/metrics` at the current model's server.
 * @param {unknown} stored
 * @param {unknown} fallbackUrl
 */
export function resolveMetricsUrl(stored, fallbackUrl) {
  const candidate = String(stored || fallbackUrl || "").trim();
  if (!/^https?:\/\//i.test(candidate)) return "";
  return candidate.endsWith("/metrics") ? candidate : `${candidate.replace(/\/+$/, "")}/metrics`;
}

/** @param {unknown} value */
export function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** @param {unknown} value */
export function fmtTps(value) {
  const n = num(value);
  if (n <= 0) return "—";
  return n >= 100 ? `${Math.round(n)}` : n.toFixed(1);
}

/** @param {unknown} value */
export function fmtMs(value) {
  const n = num(value);
  if (n <= 0) return "—";
  if (n < 1000) return `${Math.round(n)} ms`;
  if (n < 60_000) return `${(n / 1000).toFixed(1)} s`;
  const minutes = Math.floor(n / 60_000);
  const seconds = Math.round((n % 60_000) / 1000);
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

/**
 * @param {unknown} value
 * @param {number} [digits]
 */
export function fmtPct(value, digits = 0) {
  const n = num(value);
  if (n <= 0) return "—";
  return `${n.toFixed(digits)}%`;
}

/** Local HH:MM:SS for log rows — a full timestamp would eat the row's width.
 * @param {unknown} value
 */
export function clockTime(value) {
  const date = new Date(num(value));
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour12: false });
}

/** Display names are Pi's own words (content types and runtime events).
 * @type {Record<string, string>}
 */
const PHASE_LABELS = {
  idle: "idle",
  working: "working",
  thinking: "thinking",
  streaming: "text",
  toolcall: "toolcall",
  tool: "tool",
  compacting: "compacting",
  retrying: "retrying",
};

/** @param {string} phase */
export function phaseLabel(phase) {
  return PHASE_LABELS[phase] || PHASE_LABELS.working;
}
