// ABOUTME: Renders the Usage dashboard activity heatmap: a year of daily token intensity by week column.
// ABOUTME: Reads session times and token totals from the payload; other dashboard panels live elsewhere.

import { t } from "../i18n/i18n.js";
import { formatCompact } from "../ui/formatters.js";
import { escapeHtml } from "../ui/sanitize-markup.js";

/**
 * @typedef {import("./cost-dashboard-render.js").CostRenderPayload} CostRenderPayload
 *
 * @typedef {{ key: string, value: number }} CostActivityDay
 *
 * @typedef {{ column: number, name: string }} CostActivityMonthLabel
 */

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
 * @param {CostRenderPayload} payload
 */
export function renderActivityPanel(target, payload) {
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
