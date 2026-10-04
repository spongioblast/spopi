// ABOUTME: Renders the Settings → Usage dashboard from a payload by filling each section with its panel.
// ABOUTME: Owns the payload shape; overview, heatmap, breakdown tables, and charts render in their own modules.

import { costDashboardSectionRefs } from "./cost-dashboard.js";
import { renderActivityPanel } from "./cost-dashboard-heatmap.js";
import {
  deriveOverviewMetrics,
  renderOverview,
  renderOverviewNote,
} from "./cost-dashboard-overview.js";
import {
  renderEmpty,
  renderModels,
  renderProjects,
  renderSessionsPanel,
  renderToolCost,
} from "./cost-dashboard-tables.js";

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
 */

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
