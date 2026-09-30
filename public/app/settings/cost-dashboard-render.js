// ABOUTME: Renders Usage overview, model, project, and tool sections from a payload.
// ABOUTME: When Chart.js is missing, those charts become text fallbacks.

// Render logic for the Settings → Usage tab cost dashboard.
import { t } from "../i18n/i18n.js";
import { formatCompact, formatInt, formatUsd } from "../ui/formatters.js";
import { escapeHtml } from "../ui/sanitize-markup.js";
import { costDashboardSectionRefs } from "./cost-dashboard.js";

/**
 * @typedef {{
 *   totalCost?: number,
 *   sessions?: number,
 *   messages?: number,
 *   totalTokens?: number,
 *   activeDays?: number,
 *   currentStreak?: number,
 *   longestStreak?: number,
 *   sessionCount?: number,
 *   messageCount?: number,
 *   daysActive?: number,
 * }} CostOverviewMetrics
 *
 * @typedef {{
 *   name?: string,
 *   cost?: number,
 *   count?: number,
 *   fraction?: number,
 *   sessions?: number,
 *   inputTokens?: number,
 *   outputTokens?: number,
 * }} CostRankRow
 *
 * @typedef {{
 *   name?: string,
 *   cost?: number,
 *   count?: number,
 *   fraction?: number,
 * }} CostToolUsageRow
 *
 * @typedef {{
 *   totalTokens?: number,
 *   inputTokens?: number,
 *   outputTokens?: number,
 *   cacheRead?: number,
 *   cacheWrite?: number,
 *   toolCalls?: number,
 *   tools?: CostToolUsageRow[],
 * }} CostUsageMetrics
 *
 * @typedef {{
 *   time?: string,
 *   model?: string,
 *   title?: string,
 *   workspace?: string,
 *   totalTokens?: number,
 *   inputTokens?: number,
 *   outputTokens?: number,
 *   toolCalls?: number,
 *   totalCost?: number,
 * }} CostSessionView
 *
 * @typedef {{
 *   totalCost?: number,
 *   totalTokens?: number,
 * }} CostPayloadSummary
 *
 * @typedef {{
 *   overview?: CostOverviewMetrics,
 *   usage?: CostUsageMetrics,
 *   models?: CostRankRow[],
 *   projects?: CostRankRow[],
 * }} CostInfobar
 *
 * @typedef {{
 *   infobar?: CostInfobar,
 *   overview?: CostOverviewMetrics,
 *   usage?: CostUsageMetrics,
 *   models?: CostRankRow[],
 *   projects?: CostRankRow[],
 *   sessions?: CostSessionView[],
 *   topSessions?: CostSessionView[],
 *   summary?: CostPayloadSummary,
 *   range?: unknown,
 * }} CostRenderPayload
 *
 * @typedef {{
 *   name: string,
 *   fraction: number,
 *   inputTokens: number,
 *   outputTokens: number,
 * }} CostModelSummaryEntry
 *
 * @typedef {{
 *   name: string,
 *   data: number[],
 * }} CostModelSeries
 *
 * @typedef {{
 *   labels: string[],
 *   models: CostModelSummaryEntry[],
 *   series: CostModelSeries[],
 * }} CostModelSummary
 *
 * @typedef {{ key: string, value: number }} CostActivityDay
 *
 * @typedef {{ column: number, name: string }} CostActivityMonthLabel
 *
 * @typedef {{
 *   topLeft: number,
 *   topRight: number,
 *   bottomLeft: number,
 *   bottomRight: number,
 * }} CostChartCornerRadius
 *
 * @typedef {{ destroy: () => void }} CostChartInstance
 *
 * @typedef {{ dataIndex?: number }} CostChartBorderRadiusContext
 *
 * @typedef {{
 *   raw?: unknown,
 *   label?: string,
 *   dataset: { label?: string },
 * }} CostChartTooltipContext
 *
 * @typedef {{
 *   new (canvas: HTMLCanvasElement, config: unknown): CostChartInstance
 * }} CostChartConstructor
 *
 * @typedef {HTMLCanvasElement & {
 *   _modelsChart?: CostChartInstance,
 *   _projectsChart?: CostChartInstance,
 *   _toolCostChart?: CostChartInstance,
 * }} CostChartCanvas
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
 * @returns {CostChartConstructor | null}
 */
function getChartConstructor() {
  const chart = /** @type {{ Chart?: unknown }} */ (window).Chart;
  return typeof chart === "function" ? /** @type {CostChartConstructor} */ (chart) : null;
}

/**
 * @param {Element | null | undefined} node
 * @returns {node is CostChartCanvas}
 */
function isChartCanvas(node) {
  return Boolean(node && "getContext" in node && "tagName" in node && node.tagName === "CANVAS");
}

/**
 * @param {Element} target
 * @param {string} [message]
 */
function renderEmpty(target, message = t("cost.noDataInSelectedRange")) {
  if (!("innerHTML" in target)) return;
  target.innerHTML = `<div class="cost-dash-empty-state">${escapeHtml(message)}</div>`;
}

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
function renderOverview(target, overview = {}, usage = {}) {
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
 * @param {Element} target
 * @param {CostRankRow[]} [rows]
 * @param {CostRenderPayload} [payload]
 */
function renderModels(target, rows = [], payload = {}) {
  if (!("innerHTML" in target)) return;
  if (!Array.isArray(rows) || rows.length === 0) {
    renderEmpty(target);
    return;
  }
  const modelSummary = buildModelSummary(rows, payload);
  target.innerHTML = `
    <div class="cost-dash-models-card">
      <div class="cost-dash-models-chart-wrap">
        <canvas class="cost-dash-models-chart" width="960" height="320"></canvas>
      </div>
      <div class="cost-dash-models-legend">
        ${modelSummary.models
          .map((model, index) => {
            const percent = Math.round((model.fraction || 0) * 1000) / 10;
            return `
              <div class="cost-dash-model-legend-row">
                <div class="cost-dash-model-legend-main">
                  <span class="cost-dash-tool-legend-dot cost-dash-model-color-${index + 1}"></span>
                  <span class="cost-dash-model-legend-name">${escapeHtml(model.name)}</span>
                </div>
                <div class="cost-dash-model-legend-meta">
                  <span>${escapeHtml(t("cost.modelTokens", { input: formatCompact(model.inputTokens), output: formatCompact(model.outputTokens) }))}</span>
                  <span>${percent}%</span>
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
    </div>
  `;
  renderModelsChart(target.querySelector(".cost-dash-models-chart"), modelSummary);
}

/**
 * @param {Element} target
 * @param {CostRankRow[]} [rows]
 */
function renderProjects(target, rows = []) {
  if (!("innerHTML" in target)) return;
  if (!Array.isArray(rows) || rows.length === 0) {
    renderEmpty(target);
    return;
  }
  const top = rows.slice(0, 6);
  const totalCost = top.reduce((sum, r) => sum + Number(r.cost || 0), 0);
  target.innerHTML = `
    <div class="cost-dash-projects-card">
      <div class="cost-dash-tool-chart-layout">
        <div class="cost-dash-tool-chart-wrap">
          <canvas class="cost-dash-projects-chart" width="240" height="240"></canvas>
        </div>
        <div class="cost-dash-tool-legend">
          ${top
            .map((row, index) => {
              const percent =
                totalCost > 0 ? Math.round((Number(row.cost || 0) / totalCost) * 100) : 0;
              return `
                <div class="cost-dash-tool-legend-row">
                  <div class="cost-dash-tool-legend-main">
                    <span class="cost-dash-tool-legend-dot" data-tool-color="${index}"></span>
                    <div>
                      <div class="cost-dash-tool-legend-title">${escapeHtml(row.name || t("cost.unknown"))}</div>
                      <div class="cost-dash-tool-legend-subtitle">${escapeHtml(t("cost.projectSessions", { count: formatInt(row.sessions || 0) }))}</div>
                    </div>
                  </div>
                  <div class="cost-dash-tool-legend-values">
                    <span>${formatUsd(row.cost)}</span>
                    <span>${percent}%</span>
                  </div>
                </div>
              `;
            })
            .join("")}
        </div>
      </div>
    </div>
  `;
  renderProjectsChart(target.querySelector(".cost-dash-projects-chart"), top);
}

/**
 * @param {Element} target
 * @param {CostUsageMetrics} [usage]
 * @param {Element | null} [metaTarget]
 */
function renderToolCost(target, usage = {}, metaTarget = null) {
  if (!("innerHTML" in target)) return;
  const tools = Array.isArray(usage.tools) ? usage.tools : [];
  if (metaTarget) {
    metaTarget.textContent = t("cost.trackedTools", { count: formatInt(tools.length) });
  }
  target.innerHTML = `
    <div class="cost-dash-tool-cost-card">
      ${
        tools.length > 0
          ? `
        <div class="cost-dash-tool-chart-layout">
          <div class="cost-dash-tool-chart-wrap">
            <canvas class="cost-dash-tool-chart" width="240" height="240"></canvas>
          </div>
          <div class="cost-dash-tool-legend">
            ${tools
              .slice(0, 6)
              .map((row, index) => {
                const percent = Math.round((row.fraction || 0) * 100);
                return `
                  <div class="cost-dash-tool-legend-row">
                    <div class="cost-dash-tool-legend-main">
                      <span class="cost-dash-tool-legend-dot" data-tool-color="${index}"></span>
                      <div>
                        <div class="cost-dash-tool-legend-title">${escapeHtml(row.name || t("cost.unknown"))}</div>
                        <div class="cost-dash-tool-legend-subtitle">${escapeHtml(t("cost.toolSessions", { count: formatInt(row.count) }))}</div>
                      </div>
                    </div>
                    <div class="cost-dash-tool-legend-values">
                      <span>${formatUsd(row.cost)}</span>
                      <span>${percent}%</span>
                    </div>
                  </div>
                `;
              })
              .join("")}
          </div>
        </div>
      `
          : `<div class="cost-dash-empty-state">${escapeHtml(t(Number(usage.toolCalls) > 0 ? "cost.toolCostLocal" : "cost.noToolUsage"))}</div>`
      }
    </div>
  `;

  if (tools.length > 0) {
    renderToolCostChart(target.querySelector(".cost-dash-tool-chart"), tools.slice(0, 6));
  }
}

/**
 * @param {string | null | undefined} timeStr
 */
function formatSessionDate(timeStr) {
  if (!timeStr) return "";
  const d = new Date(timeStr);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * @param {Element} target
 * @param {CostSessionView[]} [sessions]
 */
function renderSessionsPanel(target, sessions = []) {
  if (!("innerHTML" in target)) return;
  if (!Array.isArray(sessions) || sessions.length === 0) {
    renderEmpty(target, t("cost.noRecentSessions"));
    return;
  }
  target.innerHTML = `
    <div class="cost-dash-sessions-table-wrap">
      <table class="cost-dash-sessions-table">
        <thead>
          <tr>
            <th>${escapeHtml(t("cost.table.session"))}</th>
            <th>${escapeHtml(t("cost.table.model"))}</th>
            <th class="cost-dash-num">${escapeHtml(t("cost.table.tokens"))}</th>
            <th class="cost-dash-num">${escapeHtml(t("cost.table.tools"))}</th>
            <th class="cost-dash-num">${escapeHtml(t("cost.table.cost"))}</th>
            <th>${escapeHtml(t("cost.table.date"))}</th>
          </tr>
        </thead>
        <tbody>
          ${sessions
            .map(
              (session) => `
            <tr>
              <td class="cost-dash-sessions-td-title">
                <div class="cost-dash-sessions-title">${escapeHtml(session.title || t("cost.untitled"))}</div>
                ${session.workspace ? `<div class="cost-dash-sessions-workspace">${escapeHtml(session.workspace)}</div>` : ""}
              </td>
              <td class="cost-dash-sessions-td-model">${escapeHtml(session.model || "—")}</td>
              <td class="cost-dash-num">${formatCompact(session.totalTokens)}</td>
              <td class="cost-dash-num">${formatInt(session.toolCalls)}</td>
              <td class="cost-dash-num cost-dash-sessions-cost">${formatUsd(session.totalCost)}</td>
              <td class="cost-dash-sessions-td-date">${formatSessionDate(session.time)}</td>
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

/**
 * @param {CostRenderPayload} payload
 * @param {CostOverviewMetrics} overview
 */
function deriveOverviewMetrics(payload, overview) {
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
 * @param {CostRenderPayload} payload
 */
function renderActivityPanel(target, payload) {
  if (!("innerHTML" in target)) return;
  const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
  /** @type {Map<string, number>} */
  const intensityByDay = new Map();
  for (const session of sessions) {
    const time = new Date(session.time ?? "");
    if (!Number.isFinite(time.getTime())) continue;
    const key = time.toISOString().slice(0, 10);
    intensityByDay.set(key, (intensityByDay.get(key) || 0) + Number(session.totalTokens || 0));
  }

  const TOTAL_DAYS = 365;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  /** @type {CostActivityDay[]} */
  const days = [];
  for (let i = TOTAL_DAYS - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    days.push({ key, value: intensityByDay.get(key) || 0 });
  }

  const max = Math.max(...days.map((day) => day.value), 0);
  const leadingEmptyDays = new Date(`${days[0]?.key}T00:00:00`).getDay();
  const totalCells = leadingEmptyDays + days.length;
  const weekColumns = Math.ceil(totalCells / 7);
  const monthLabels = buildActivityMonthLabels(days, leadingEmptyDays);
  const emptyCells = Array.from(
    { length: leadingEmptyDays },
    () => '<div class="cost-dash-activity-cell is-empty" aria-hidden="true"></div>',
  ).join("");
  const weekdayMonday = escapeHtml(t("cost.activity.monday"));
  const weekdayWednesday = escapeHtml(t("cost.activity.wednesday"));
  const weekdayFriday = escapeHtml(t("cost.activity.friday"));
  const activityLess = escapeHtml(t("cost.activity.less"));
  const activityMore = escapeHtml(t("cost.activity.more"));

  target.innerHTML = `
    <div class="cost-dash-activity-calendar" style="--activity-columns:${weekColumns}">
      <div class="cost-dash-activity-months" aria-hidden="true">
        ${monthLabels
          .map(
            (label) =>
              `<span class="cost-dash-activity-month" style="grid-column:${label.column}">${escapeHtml(label.name)}</span>`,
          )
          .join("")}
      </div>
      <div class="cost-dash-activity-body">
        <div class="cost-dash-activity-weekdays" aria-hidden="true">
          <span></span>
          <span>${weekdayMonday}</span>
          <span></span>
          <span>${weekdayWednesday}</span>
          <span></span>
          <span>${weekdayFriday}</span>
          <span></span>
        </div>
        <div class="cost-dash-activity-grid">
          ${emptyCells}${days
            .map((day) => {
              let level = 0;
              if (max > 0) {
                const ratio = day.value / max;
                if (ratio >= 0.75) level = 4;
                else if (ratio >= 0.5) level = 3;
                else if (ratio >= 0.25) level = 2;
                else if (ratio > 0) level = 1;
              }
              return `<div class="cost-dash-activity-cell level-${level}" title="${escapeHtml(t("cost.activityCellTitle", { date: day.key, tokens: formatCompact(day.value) }))}"></div>`;
            })
            .join("")}
        </div>
      </div>
      <div class="cost-dash-activity-footer">
        <span>${activityLess}</span>
        <span class="cost-dash-activity-cell level-0" aria-hidden="true"></span>
        <span class="cost-dash-activity-cell level-1" aria-hidden="true"></span>
        <span class="cost-dash-activity-cell level-2" aria-hidden="true"></span>
        <span class="cost-dash-activity-cell level-3" aria-hidden="true"></span>
        <span class="cost-dash-activity-cell level-4" aria-hidden="true"></span>
        <span>${activityMore}</span>
      </div>
    </div>
  `;
}

/**
 * @param {CostActivityDay[]} days
 * @param {number} leadingEmptyDays
 * @returns {CostActivityMonthLabel[]}
 */
function buildActivityMonthLabels(days, leadingEmptyDays) {
  /** @type {CostActivityMonthLabel[]} */
  const labels = [];
  const seen = new Set();
  let lastColumn = -99;
  for (let index = 0; index < days.length; index += 1) {
    const date = new Date(`${days[index].key}T00:00:00`);
    if (!Number.isFinite(date.getTime())) continue;
    const monthKey = `${date.getFullYear()}-${date.getMonth()}`;
    if (seen.has(monthKey)) continue;
    const column = Math.floor((leadingEmptyDays + index) / 7) + 1;
    if (column - lastColumn < 3) continue;
    seen.add(monthKey);
    lastColumn = column;
    labels.push({
      column,
      name: date.toLocaleDateString(undefined, { month: "short" }),
    });
  }
  return labels;
}

/**
 * @param {Element} target
 * @param {unknown} totalTokens
 */
function renderOverviewNote(target, totalTokens) {
  const warAndPeaceTokens = 587000;
  const ratio = Math.max(1, Math.round(Number(totalTokens || 0) / warAndPeaceTokens));
  target.textContent = t("cost.overviewNote", { ratio });
}

/**
 * @param {CostRankRow[]} rows
 * @param {CostRenderPayload} payload
 * @returns {CostModelSummary}
 */
function buildModelSummary(rows, payload) {
  const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
  const topModels = rows.slice(0, 3).map((row) => ({
    name: row.name || t("cost.unknown"),
    fraction: Number(row.fraction || 0),
    inputTokens: 0,
    outputTokens: 0,
  }));
  const modelNames = new Set(topModels.map((model) => model.name));
  /** @type {Map<string, Record<string, number>>} */
  const byDay = new Map();

  for (const session of sessions) {
    const modelName = session.model || t("cost.unknown");
    if (!modelNames.has(modelName)) continue;
    const time = new Date(session.time ?? "");
    if (!Number.isFinite(time.getTime())) continue;
    const dayKey = time.toISOString().slice(0, 10);
    let day = byDay.get(dayKey);
    if (!day) {
      day = /** @type {Record<string, number>} */ (Object.create(null));
      byDay.set(dayKey, day);
    }
    day[modelName] = (day[modelName] || 0) + Number(session.totalTokens || 0);
    const summary = topModels.find((model) => model.name === modelName);
    if (summary) {
      summary.inputTokens += Number(session.inputTokens || 0);
      summary.outputTokens += Number(session.outputTokens || 0);
    }
  }

  const labels = Array.from(byDay.keys()).sort();
  return {
    labels,
    models: topModels,
    series: topModels.map((model) => ({
      name: model.name,
      data: labels.map((label) => Number(byDay.get(label)?.[model.name] || 0)),
    })),
  };
}

/** @returns {string[]} */
function getModelChartPalette() {
  return ["#3b82f6", "#10b981", "#f59e0b"];
}

/**
 * @param {CostModelSeries[]} seriesList
 * @param {number} datasetIndex
 * @param {number | undefined} dataIndex
 * @returns {number | CostChartCornerRadius}
 */
function getStackSegmentRadius(seriesList, datasetIndex, dataIndex) {
  const activeIndices = seriesList
    .map((series, index) => ({
      index,
      value: Number(series.data?.[/** @type {number} */ (dataIndex)] || 0),
    }))
    .filter((entry) => entry.value > 0)
    .map((entry) => entry.index);

  if (activeIndices.length === 0 || !activeIndices.includes(datasetIndex)) {
    return 0;
  }

  const first = activeIndices[0];
  const last = activeIndices[activeIndices.length - 1];

  if (first === last) {
    return { topLeft: 6, topRight: 6, bottomLeft: 6, bottomRight: 6 };
  }

  if (datasetIndex === first) {
    return { topLeft: 0, topRight: 0, bottomLeft: 6, bottomRight: 6 };
  }

  if (datasetIndex === last) {
    return { topLeft: 6, topRight: 6, bottomLeft: 0, bottomRight: 0 };
  }

  return 0;
}

/**
 * @param {Element | null} canvas
 * @param {CostModelSummary | null | undefined} modelSummary
 */
function renderModelsChart(canvas, modelSummary) {
  if (!isChartCanvas(canvas) || !modelSummary) return;
  const chartCanvas = canvas;
  const colors = getModelChartPalette();
  const ChartCtor = getChartConstructor();
  if (ChartCtor) {
    const previous = chartCanvas._modelsChart;
    if (previous && typeof previous.destroy === "function") {
      previous.destroy();
    }
    chartCanvas._modelsChart = new ChartCtor(chartCanvas, {
      type: "bar",
      data: {
        labels: modelSummary.labels,
        datasets: modelSummary.series.map((series, index) => ({
          label: series.name,
          data: series.data,
          backgroundColor: colors[index] || colors[colors.length - 1],
          /**
           * @param {CostChartBorderRadiusContext} context
           */
          borderRadius(context) {
            return getStackSegmentRadius(modelSummary.series, index, context.dataIndex);
          },
          borderSkipped: false,
          maxBarThickness: 30,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            callbacks: {
              /**
               * @param {CostChartTooltipContext} context
               */
              label(context) {
                return t("cost.chartTooltipTokens", {
                  label: context.dataset.label,
                  tokens: formatCompact(context.raw),
                });
              },
            },
          },
        },
        scales: {
          x: {
            stacked: true,
            grid: {
              display: false,
            },
            border: {
              display: false,
            },
            ticks: {
              color: "#8f959e",
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: 8,
            },
          },
          y: {
            stacked: true,
            grid: {
              color: "rgba(255,255,255,0.08)",
            },
            border: {
              display: false,
            },
            ticks: {
              color: "#8f959e",
              /**
               * @param {unknown} value
               */
              callback(value) {
                return formatCompact(value);
              },
            },
          },
        },
      },
    });
    return;
  }

  canvas.replaceWith(
    Object.assign(document.createElement("div"), {
      className: "cost-dash-empty-state",
      textContent: t("cost.chartUnavailable"),
    }),
  );
}

/** @returns {string[]} */
function getToolChartPalette() {
  return ["#4f8ff7", "#67c587", "#f3a64f", "#8c7cf7", "#ef6b73", "#4fc3d9"];
}

/**
 * @param {Element | null} canvas
 * @param {CostRankRow[]} rows
 */
function renderProjectsChart(canvas, rows) {
  if (!isChartCanvas(canvas) || !Array.isArray(rows) || rows.length === 0) return;
  const chartCanvas = canvas;
  const labels = rows.map((row) => row.name || t("cost.unknown"));
  const data = rows.map((row) => Number(row.cost || 0));
  const colors = getToolChartPalette().slice(0, rows.length);

  const ChartCtor = getChartConstructor();
  if (ChartCtor) {
    const previous = chartCanvas._projectsChart;
    if (previous && typeof previous.destroy === "function") {
      previous.destroy();
    }
    chartCanvas._projectsChart = new ChartCtor(chartCanvas, {
      type: "doughnut",
      data: {
        labels,
        datasets: [
          {
            data,
            backgroundColor: colors,
            borderWidth: 0,
            hoverOffset: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "62%",
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            callbacks: {
              /**
               * @param {CostChartTooltipContext} context
               */
              label(context) {
                return t("cost.chartTooltipCost", {
                  label: context.label,
                  cost: formatUsd(context.raw),
                });
              },
            },
          },
        },
      },
    });
    return;
  }

  canvas.replaceWith(
    Object.assign(document.createElement("div"), {
      className: "cost-dash-empty-state",
      textContent: t("cost.chartUnavailable"),
    }),
  );
}

/**
 * @param {Element | null} canvas
 * @param {CostToolUsageRow[]} tools
 */
function renderToolCostChart(canvas, tools) {
  if (!isChartCanvas(canvas) || !Array.isArray(tools) || tools.length === 0) return;
  const chartCanvas = canvas;
  const labels = tools.map((tool) => tool.name || t("cost.unknown"));
  const data = tools.map((tool) => Number(tool.cost || 0));
  const colors = getToolChartPalette().slice(0, tools.length);

  const ChartCtor = getChartConstructor();
  if (ChartCtor) {
    const previous = chartCanvas._toolCostChart;
    if (previous && typeof previous.destroy === "function") {
      previous.destroy();
    }
    chartCanvas._toolCostChart = new ChartCtor(chartCanvas, {
      type: "doughnut",
      data: {
        labels,
        datasets: [
          {
            data,
            backgroundColor: colors,
            borderWidth: 0,
            hoverOffset: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "62%",
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            callbacks: {
              /**
               * @param {CostChartTooltipContext} context
               */
              label(context) {
                return t("cost.chartTooltipCost", {
                  label: context.label,
                  cost: formatUsd(context.raw),
                });
              },
            },
          },
        },
      },
    });
    return;
  }

  const total = data.reduce((sum, value) => sum + value, 0);
  /** @type {{ values: string[], offset: number }} */
  const conicStops = data.reduce(
    (parts, value, index) => {
      const start = parts.offset;
      const end = total > 0 ? start + (value / total) * 360 : start;
      parts.values.push(`${colors[index]} ${start}deg ${end}deg`);
      parts.offset = end;
      return parts;
    },
    { values: /** @type {string[]} */ ([]), offset: 0 },
  );

  canvas.replaceWith(
    Object.assign(document.createElement("div"), {
      className: "cost-dash-tool-chart-fallback",
      style: `background: conic-gradient(${conicStops.values.join(", ")});`,
    }),
  );
}

/**
 * Renders the full Usage dashboard into `section`, given the same
 * `{ infobar, sessions, summary, range }` payload shape used by
 * `adaptDashboardToInfobarPayload` in `cost-dashboard.js`.
 *
 * @param {Element | null | undefined} section
 * @param {CostRenderPayload} [payload]
 */
export function renderCostDashboard(section, payload = {}) {
  if (!section) return;
  const {
    overview: overviewEl,
    activity: activityEl,
    overviewNote: overviewNoteEl,
    models: modelsEl,
    toolCost: toolCostEl,
    projects: projectsEl,
    sessions: sessionsEl,
  } = costDashboardSectionRefs(section);

  if (
    !overviewEl ||
    !activityEl ||
    !overviewNoteEl ||
    !modelsEl ||
    !toolCostEl ||
    !projectsEl ||
    !sessionsEl
  ) {
    return;
  }

  const infobar = payload.infobar || payload || {};
  const overview = infobar.overview || {};
  const hasData = Number(overview.sessionCount || 0) > 0;
  if (!hasData) {
    renderEmpty(overviewEl);
    renderEmpty(activityEl);
    overviewNoteEl.textContent = "";
    renderEmpty(modelsEl);
    renderEmpty(toolCostEl);
    renderEmpty(projectsEl);
    renderEmpty(sessionsEl);
    return;
  }

  const overviewMetrics = deriveOverviewMetrics(payload, overview);
  renderOverview(overviewEl, overviewMetrics, infobar.usage || {});
  renderActivityPanel(activityEl, payload);
  renderOverviewNote(overviewNoteEl, overviewMetrics.totalTokens);
  renderModels(modelsEl, infobar.models || [], payload);
  renderToolCost(toolCostEl, infobar.usage || {});
  renderProjects(projectsEl, infobar.projects || []);
  renderSessionsPanel(sessionsEl, payload.sessions || payload.topSessions || []);
}
