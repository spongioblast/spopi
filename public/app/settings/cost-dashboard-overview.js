// ABOUTME: Renders the Usage dashboard overview: stat cards, streaks derived from sessions, and the token note.
// ABOUTME: Works from the payload overview and usage totals; charts, tables, and the heatmap live elsewhere.

import { t } from "../i18n/i18n.js";
import { formatCompact, formatInt, formatUsd } from "../ui/formatters.js";
import { escapeHtml } from "../ui/sanitize-markup.js";

/**
 * @typedef {import("./cost-dashboard-render.js").CostOverviewMetrics} CostOverviewMetrics
 * @typedef {import("./cost-dashboard-render.js").CostUsageMetrics} CostUsageMetrics
 * @typedef {import("./cost-dashboard-render.js").CostRenderPayload} CostRenderPayload
 */

/** @type {Readonly<Record<string, string>>} */
const STAT_ICONS = {
  totalCost: `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 1.5v13M11.5 4H6.75a2.25 2.25 0 0 0 0 4.5h2.5a2.25 2.25 0 0 1 0 4.5H4.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  sessions: `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 2.5A1.5 1.5 0 0 1 3.5 1h9A1.5 1.5 0 0 1 14 2.5v6A1.5 1.5 0 0 1 12.5 10H9l-3 3v-3H3.5A1.5 1.5 0 0 1 2 8.5v-6z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/></svg>`,
  messages: `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 3a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5l-4 4V3z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/><circle cx="5.5" cy="6.5" r="1" fill="currentColor"/><circle cx="8" cy="6.5" r="1" fill="currentColor"/><circle cx="10.5" cy="6.5" r="1" fill="currentColor"/></svg>`,
  totalTokens: `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><ellipse cx="8" cy="4" rx="5.5" ry="2" stroke="currentColor" stroke-width="1.25"/><path d="M2.5 4v4c0 1.1 2.46 2 5.5 2s5.5-.9 5.5-2V4" stroke="currentColor" stroke-width="1.25"/><path d="M2.5 8v4c0 1.1 2.46 2 5.5 2s5.5-.9 5.5-2V8" stroke="currentColor" stroke-width="1.25"/></svg>`,
  activeDays: `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="3" width="14" height="12" rx="2" stroke="currentColor" stroke-width="1.25"/><path d="M5 1v3M11 1v3M1 7h14" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/><circle cx="5" cy="10.5" r="1" fill="currentColor"/><circle cx="8" cy="10.5" r="1" fill="currentColor"/><circle cx="11" cy="10.5" r="1" fill="currentColor"/></svg>`,
  currentStreak: `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 1S4 5 4 9a4 4 0 0 0 8 0c0-4-4-8-4-8z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/><path d="M8 11.5c-.83 0-1.5-.67-1.5-1.5S8 7.5 8 7.5s1.5 1 1.5 2.5-.67 1.5-1.5 1.5z" fill="currentColor"/></svg>`,
  longestStreak: `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3.5 2.5h9v5.5a4.5 4.5 0 0 1-9 0V2.5z" stroke="currentColor" stroke-width="1.25"/><path d="M3.5 5.5H2a1.5 1.5 0 0 0 1.5 1.5M12.5 5.5H14a1.5 1.5 0 0 1-1.5 1.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/><path d="M8 12.5v2M5.5 14.5h5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>`,
  input: `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 2v9M4.5 7.5 8 11l3.5-3.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.5 13.5h11" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>`,
  output: `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 14V5M4.5 8.5 8 5l3.5 3.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.5 2.5h11" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>`,
  cacheRead: `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9.5 1.5 5 8.5h4.5L6.5 14.5l6-8.5H8l1.5-4.5z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/></svg>`,
  cacheWrite: `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 4a2 2 0 0 1 2-2h6l4 4v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4z" stroke="currentColor" stroke-width="1.25"/><path d="M5 2v3.5h5V2M5 15v-4h6v4" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>`,
  toolCalls: `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10 1.5a3.5 3.5 0 0 1 .5 5.5L4 13.5a1.5 1.5 0 0 1-2-2L8.5 5A3.5 3.5 0 0 1 10 1.5z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/><circle cx="10.5" cy="3.5" r="1" fill="currentColor"/></svg>`,
};

/**
 * @param {string} id
 * @param {string} label
 * @param {string} value
 * @param {string} tone
 * @param {string} [extraClass]
 */
function buildStatCard(id, label, value, tone, extraClass = "") {
  const icon = STAT_ICONS[id] || "";
  return `
    <article class="cost-dash-stat-card cost-dash-card-tone-${tone} ${extraClass}">
      <div class="cost-dash-stat-title">${icon ? `<span class="cost-dash-stat-icon">${icon}</span>` : ""}${escapeHtml(label)}</div>
      <div class="cost-dash-stat-value">${escapeHtml(value)}</div>
    </article>
  `;
}

/**
 * @param {Element} target
 * @param {CostOverviewMetrics} [overview]
 * @param {CostUsageMetrics} [usage]
 */
export function renderOverview(target, overview = {}, usage = {}) {
  if (!("innerHTML" in target)) return;
  /** @type {Array<[string, string, string, string, string]>} */
  const stats = [
    ["totalCost", t("cost.stats.totalCost"), formatUsd(overview.totalCost), "green", ""],
    ["sessions", t("cost.stats.sessions"), formatInt(overview.sessions), "blue", ""],
    ["messages", t("cost.stats.messages"), formatInt(overview.messages), "violet", ""],
    ["totalTokens", t("cost.stats.totalTokens"), formatCompact(overview.totalTokens), "teal", ""],
    ["activeDays", t("cost.stats.activeDays"), formatInt(overview.activeDays), "amber", ""],
    [
      "currentStreak",
      t("cost.stats.currentStreak"),
      t("cost.daysShort", { count: formatInt(overview.currentStreak) }),
      "blue",
      "",
    ],
    [
      "longestStreak",
      t("cost.stats.longestStreak"),
      t("cost.daysShort", { count: formatInt(overview.longestStreak) }),
      "violet",
      "",
    ],
    ["input", t("cost.stats.input"), formatCompact(usage.inputTokens), "teal", ""],
    ["output", t("cost.stats.output"), formatCompact(usage.outputTokens), "green", ""],
    ["cacheRead", t("cost.stats.cacheRead"), formatCompact(usage.cacheRead), "amber", ""],
    ["cacheWrite", t("cost.stats.cacheWrite"), formatCompact(usage.cacheWrite), "violet", ""],
    ["toolCalls", t("cost.stats.toolCalls"), formatInt(usage.toolCalls), "rose", ""],
  ];
  target.innerHTML = stats
    .map(([id, label, value, tone, extraClass]) =>
      buildStatCard(id, label, value, tone, extraClass),
    )
    .join("");
}

/**
 * @param {CostRenderPayload} payload
 * @param {CostOverviewMetrics} overview
 */
export function deriveOverviewMetrics(payload, overview) {
  const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
  /** @type {Map<string, number>} */
  const dayCounts = new Map();
  /** @type {Map<number, number>} */
  const hourCounts = new Map();
  /** @type {Map<string, number>} */
  const modelCounts = new Map();

  for (const session of sessions) {
    const time = new Date(session.time ?? "");
    if (!Number.isFinite(time.getTime())) continue;
    const dayKey = time.toISOString().slice(0, 10);
    dayCounts.set(dayKey, (dayCounts.get(dayKey) || 0) + 1);
    hourCounts.set(time.getHours(), (hourCounts.get(time.getHours()) || 0) + 1);
    if (session.model) {
      modelCounts.set(session.model, (modelCounts.get(session.model) || 0) + 1);
    }
  }

  const sortedDays = Array.from(dayCounts.keys()).sort();
  let longestStreak = 0;
  let currentStreak = 0;
  let streak = 0;
  /** @type {Date | null} */
  let previousDate = null;

  for (const key of sortedDays) {
    const currentDate = new Date(`${key}T00:00:00`);
    if (previousDate) {
      const prev = previousDate;
      const diffDays = Math.round((currentDate.getTime() - prev.getTime()) / 86400000);
      streak = diffDays === 1 ? streak + 1 : 1;
    } else {
      streak = 1;
    }
    longestStreak = Math.max(longestStreak, streak);
    previousDate = currentDate;
  }

  if (sortedDays.length > 0) {
    const todayKey = new Date().toISOString().slice(0, 10);
    const cursor = new Date(`${todayKey}T00:00:00`);
    while (dayCounts.has(cursor.toISOString().slice(0, 10))) {
      currentStreak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
  }

  return {
    totalCost: overview.totalCost || payload.summary?.totalCost || 0,
    sessions: overview.sessionCount || sessions.length,
    messages: overview.messageCount || 0,
    totalTokens: payload.summary?.totalTokens || 0,
    activeDays: overview.daysActive || sortedDays.length,
    currentStreak,
    longestStreak,
  };
}

/**
 * @param {Element} target
 * @param {unknown} totalTokens
 */
export function renderOverviewNote(target, totalTokens) {
  const warAndPeaceTokens = 587000;
  const ratio = Math.max(1, Math.round(Number(totalTokens || 0) / warAndPeaceTokens));
  target.textContent = t("cost.overviewNote", { ratio });
}
