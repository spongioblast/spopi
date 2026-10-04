// ABOUTME: Renders the Usage dashboard breakdown panels: model, project, and tool legends plus the sessions table.
// ABOUTME: Each panel puts a canvas next to its legend; cost-dashboard-charts.js draws into that canvas.

import { t } from "../i18n/i18n.js";
import { formatCompact, formatInt, formatUsd } from "../ui/formatters.js";
import { escapeHtml } from "../ui/sanitize-markup.js";
import {
  renderModelsChart,
  renderProjectsChart,
  renderToolCostChart,
} from "./cost-dashboard-charts.js";

/**
 * @typedef {import("./cost-dashboard-render.js").CostRankRow} CostRankRow
 * @typedef {import("./cost-dashboard-render.js").CostUsageMetrics} CostUsageMetrics
 * @typedef {import("./cost-dashboard-render.js").CostSessionView} CostSessionView
 * @typedef {import("./cost-dashboard-render.js").CostRenderPayload} CostRenderPayload
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
 */

/**
 * @param {Element} target
 * @param {string} [message]
 */
export function renderEmpty(target, message = t("cost.noDataInSelectedRange")) {
  if (!("innerHTML" in target)) return;
  target.innerHTML = `<div class="cost-dash-empty-state">${escapeHtml(message)}</div>`;
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

/**
 * @param {Element} target
 * @param {CostRankRow[]} [rows]
 * @param {CostRenderPayload} [payload]
 */
export function renderModels(target, rows = [], payload = {}) {
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
export function renderProjects(target, rows = []) {
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
export function renderToolCost(target, usage = {}, metaTarget = null) {
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
export function renderSessionsPanel(target, sessions = []) {
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
