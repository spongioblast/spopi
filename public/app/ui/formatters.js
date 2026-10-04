// ABOUTME: Shared byte, money, count, duration, and relative-time formatting.
// ABOUTME: Display strings only. Callers keep their own locale and translation functions.

/** @param {unknown} bytes */
export function formatBytes(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
}

/** Per-response and per-session costs pass 4 digits; they are often under a cent.
 * @param {unknown} value
 * @param {number} [digits]
 */
export function formatUsd(value, digits = 2) {
  const amount = Number(value);
  return `$${(Number.isFinite(amount) ? amount : 0).toFixed(digits)}`;
}

/** @param {unknown} value */
export function formatInt(value) {
  return Number(value || 0).toLocaleString();
}

/** Token counts in tight rows: 950, 1.2k, 12k, 1.5M.
 * @param {unknown} value
 */
export function formatShortCount(value) {
  const parsed = Number(value);
  const n = Number.isFinite(parsed) ? parsed : 0;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 10_000) return `${Math.round(n / 1000)}k`;
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

/** @param {unknown} value */
export function formatCompact(value) {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number(value || 0));
}

/** @param {unknown} durationMs */
export function formatDuration(durationMs) {
  if (durationMs == null) return "";
  const ms = Number(durationMs);
  if (!Number.isFinite(ms) || ms < 0) return "";
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

/**
 * @param {unknown} unixSeconds
 * @param {number} [now]
 * @param {(key: string) => string} [translate]
 * @param {string} [locale]
 */
export function relativeTime(unixSeconds, now = Date.now(), translate = (key) => key, locale) {
  const delta = Math.round((Number(unixSeconds) - now / 1000) / 60);
  const absoluteDelta = Math.abs(delta);
  if (absoluteDelta < 1) return translate("git.justNow");
  /** @type {[Intl.RelativeTimeFormatUnit, number, number][]} */
  const units = [
    ["minute", 1, 60],
    ["hour", 60, 1440],
    ["day", 1440, 10080],
    ["week", 10080, 43200],
    ["month", 43200, 525600],
    ["year", 525600, Infinity],
  ];
  const match = units.find(([, , upperBound]) => absoluteDelta < upperBound) ?? units.at(-1);
  if (!match) return translate("git.justNow");
  const [unit, divisor] = match;
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(
    Math.round(delta / divisor),
    unit,
  );
}
