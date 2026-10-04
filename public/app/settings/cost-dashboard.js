// ABOUTME: Loads workspace usage and paints the Usage settings page.
// ABOUTME: It loads Chart.js the first time the page renders.

import { t } from "../i18n/i18n.js";
import { uiStore } from "../storage/ui-store.js";
import { createLoadingPlaceholder } from "../ui/loading-placeholder.js";
import { escapeHtml } from "../ui/sanitize-markup.js";
import { loadScriptOnce } from "../utils/load-vendor.js";
import { renderCostDashboard } from "./cost-dashboard-render.js";

const FILTER_STORAGE_KEY = "ui.usage.costFilters";
/** @type {"7d" | "30d" | "90d"} */
const DEFAULT_RANGE = "30d";

/** @typedef {"7d" | "30d" | "90d"} CostRangeKey */

/** @type {Readonly<Record<CostRangeKey, number>>} */
const RANGE_DAYS = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

/**
 * @typedef {{
 *   time?: string,
 *   model?: string,
 *   totalCost?: number,
 *   totalTokens?: number,
 *   inputTokens?: number,
 *   outputTokens?: number,
 *   cacheRead?: number,
 *   cacheWrite?: number,
 *   toolCalls?: number,
 *   userMessages?: number,
 *   projectName?: string,
 *   workspace?: string,
 *   projectPath?: string,
 *   toolCostByName?: Record<string, unknown>,
 *   title?: string,
 * }} CostSessionRow
 *
 * @typedef {{
 *   sessions?: CostSessionRow[],
 *   topSessions?: CostSessionRow[],
 * }} CostDashboardRaw
 *
 * @typedef {{
 *   costDashboard: (workspaceId: string) => Promise<{ dashboard?: CostDashboardRaw } | null | undefined>,
 * }} CostDashboardDataApi
 *
 * @typedef {{ from: Date, to: Date }} CostRangeBounds
 *
 * @typedef {{
 *   name: string,
 *   cost: number,
 *   sessions: number,
 *   totalTokens: number,
 *   inputTokens?: number,
 *   outputTokens?: number,
 *   fraction?: number,
 * }} CostAggregateEntry
 *
 * @typedef {{
 *   name: string,
 *   cost: number,
 *   count: number,
 *   fraction: number,
 * }} CostToolRow
 *
 * @typedef {{
 *   totalCost: number,
 *   totalTokens: number,
 *   inputTokens: number,
 *   outputTokens: number,
 *   cacheRead: number,
 *   cacheWrite: number,
 *   toolCalls: number,
 *   userMessageCount: number,
 *   sessionCount?: number,
 *   avgCostPerSession?: number,
 *   avgCostPerUserMessage?: number,
 * }} CostSummaryTotals
 *
 * @typedef {{
 *   overview?: Element | null,
 *   activity?: Element | null,
 *   overviewNote?: Element | null,
 *   models?: Element | null,
 *   toolCost?: Element | null,
 *   projects?: Element | null,
 *   sessions?: Element | null,
 * }} CostDashboardSectionRefs
 */

/**
 * @param {Element} container
 */
function renderShell(container) {
  if (!("innerHTML" in container)) return;
  container.innerHTML = `
    <div class="cost-dash-page">
      <section id="cost-dash-section">
        <div class="cost-dash-topbar">
          <div class="cost-dash-topbar-actions">
            <div class="cost-dash-quick-range" role="group" aria-label="${escapeHtml(t("costDashboard.quickRange"))}">
              <button type="button" class="cost-dash-range-chip" data-range-chip="7d">7d</button>
              <button type="button" class="cost-dash-range-chip" data-range-chip="30d">30d</button>
              <button type="button" class="cost-dash-range-chip" data-range-chip="90d">90d</button>
            </div>
          </div>
        </div>

        <div class="cost-dash-panels">
          <div class="cost-dash-panel is-active" id="usage-overview">
            <div class="cost-dash-cost-block">
              <div class="cost-dash-subsection-head">
                <h3>Overview</h3>
              </div>
              <div class="cost-dash-overview-grid" id="cost-dash-overview-grid"></div>
              <div class="cost-dash-activity-wrap">
                <div id="cost-dash-activity-panel"></div>
              </div>
              <p class="cost-dash-overview-note" id="cost-dash-overview-note"></p>
            </div>
          </div>

          <div class="cost-dash-section-row">
            <div class="cost-dash-panel is-active" id="usage-models">
              <div class="cost-dash-cost-block">
                <div class="cost-dash-subsection-head">
                  <h3>Models</h3>
                </div>
                <div class="cost-dash-rank-list" id="cost-dash-models-list"></div>
              </div>
            </div>

            <div class="cost-dash-right-col">
              <div class="cost-dash-panel is-active" id="usage-tool-cost">
                <div class="cost-dash-cost-block">
                  <div class="cost-dash-subsection-head">
                    <h3>Tool Cost</h3>
                  </div>
                  <div id="cost-dash-tool-cost-panel"></div>
                </div>
              </div>

              <div class="cost-dash-panel is-active" id="usage-projects">
                <div class="cost-dash-cost-block">
                  <div class="cost-dash-subsection-head">
                    <h3>Projects</h3>
                  </div>
                  <div class="cost-dash-rank-list" id="cost-dash-projects-list"></div>
                </div>
              </div>
            </div>
          </div>

          <div class="cost-dash-panel is-active" id="usage-sessions">
            <div class="cost-dash-cost-block">
              <div class="cost-dash-subsection-head">
                <h3>Sessions</h3>
                <span>Recent sessions in range</span>
              </div>
              <div id="cost-dash-sessions-panel"></div>
            </div>
          </div>
        </div>
      </section>
    </div>
  `;
}

/** @returns {CostRangeKey} */
function loadSavedRange() {
  try {
    const raw = uiStore.getItem(FILTER_STORAGE_KEY);
    if (!raw) return DEFAULT_RANGE;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== "object") return DEFAULT_RANGE;
    const range = /** @type {{ range?: unknown }} */ (saved).range;
    if (typeof range === "string" && range in RANGE_DAYS) {
      return /** @type {CostRangeKey} */ (range);
    }
    return DEFAULT_RANGE;
  } catch {
    return DEFAULT_RANGE;
  }
}

/**
 * @param {CostRangeKey} range
 */
function saveRange(range) {
  try {
    uiStore.setItem(FILTER_STORAGE_KEY, JSON.stringify({ range, scope: "all" }));
  } catch {}
}

/**
 * @param {ParentNode} container
 * @param {CostRangeKey} range
 */
function syncRangeChips(container, range) {
  for (const chip of container.querySelectorAll("[data-range-chip]")) {
    if (!("dataset" in chip) || !("classList" in chip) || !("setAttribute" in chip)) continue;
    const dataset = /** @type {{ rangeChip?: string }} */ (chip.dataset);
    const active = dataset.rangeChip === range;
    chip.classList.toggle("is-active", active);
    chip.setAttribute("aria-pressed", active ? "true" : "false");
  }
}

/**
 * @param {Element} container
 * @param {unknown} error
 */
function renderLoadError(container, error) {
  if (!("innerHTML" in container)) return;
  const message =
    error && typeof error === "object" && "message" in error && typeof error.message === "string"
      ? error.message
      : String(error || "Failed to load usage data");
  container.innerHTML = `<p class="cost-dash-empty-state cost-dash-error">${escapeHtml(
    message,
  )}</p>`;
}

/**
 * @param {CostRangeKey | string} range
 * @param {Date} [now]
 * @returns {CostRangeBounds}
 */
function rangeBounds(range, now = new Date()) {
  const key = range in RANGE_DAYS ? /** @type {CostRangeKey} */ (range) : DEFAULT_RANGE;
  const days = RANGE_DAYS[key];
  const to = new Date(now);
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - (days - 1));
  return { from, to };
}

/**
 * @param {CostSessionRow | null | undefined} session
 * @param {CostRangeBounds} bounds
 */
function isInRange(session, bounds) {
  const time = new Date(session?.time ?? "");
  return Number.isFinite(time.getTime()) && time >= bounds.from && time <= bounds.to;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function number(value) {
  return Number(value) || 0;
}

/**
 * @template T
 * @param {T[]} rows
 * @param {(row: T) => string | null | undefined} getName
 * @param {(entry: CostAggregateEntry, row: T) => void} update
 * @returns {CostAggregateEntry[]}
 */
function aggregateRows(rows, getName, update) {
  /** @type {Map<string, CostAggregateEntry>} */
  const byName = new Map();
  for (const row of rows) {
    const name = getName(row) || "unknown";
    const existing = byName.get(name) || { name, cost: 0, sessions: 0, totalTokens: 0 };
    update(existing, row);
    byName.set(name, existing);
  }
  return Array.from(byName.values()).sort((left, right) => right.cost - left.cost);
}

/**
 * @param {CostDashboardRaw | null | undefined} dashboard
 * @param {CostRangeKey} range
 */
function adaptDashboardToInfobarPayload(dashboard, range) {
  const allSessions = Array.isArray(dashboard?.sessions)
    ? dashboard.sessions
    : Array.isArray(dashboard?.topSessions)
      ? dashboard.topSessions
      : [];
  const bounds = rangeBounds(range);
  const sessions = allSessions.filter((session) => isInRange(session, bounds));

  const summary = sessions.reduce(
    /**
     * @param {CostSummaryTotals} totals
     * @param {CostSessionRow} session
     */
    (totals, session) => {
      totals.totalCost += number(session.totalCost);
      totals.totalTokens += number(session.totalTokens);
      totals.inputTokens += number(session.inputTokens);
      totals.outputTokens += number(session.outputTokens);
      totals.cacheRead += number(session.cacheRead);
      totals.cacheWrite += number(session.cacheWrite);
      totals.toolCalls += number(session.toolCalls);
      totals.userMessageCount += number(session.userMessages);
      return totals;
    },
    /** @type {CostSummaryTotals} */ ({
      totalCost: 0,
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheRead: 0,
      cacheWrite: 0,
      toolCalls: 0,
      userMessageCount: 0,
    }),
  );
  summary.sessionCount = sessions.length;
  summary.avgCostPerSession = sessions.length > 0 ? summary.totalCost / sessions.length : 0;
  summary.avgCostPerUserMessage =
    summary.userMessageCount > 0 ? summary.totalCost / summary.userMessageCount : 0;

  const models = aggregateRows(
    sessions,
    (session) => session.model,
    (entry, session) => {
      entry.cost += number(session.totalCost);
      entry.sessions += 1;
      entry.totalTokens += number(session.totalTokens);
      entry.inputTokens = number(entry.inputTokens) + number(session.inputTokens);
      entry.outputTokens = number(entry.outputTokens) + number(session.outputTokens);
    },
  ).map((entry) => ({
    ...entry,
    fraction: summary.totalTokens > 0 ? entry.totalTokens / summary.totalTokens : 0,
  }));

  const toolRows = aggregateToolRows(sessions);
  const projects = aggregateRows(
    sessions,
    (session) => session.projectName || session.workspace || session.projectPath,
    (entry, session) => {
      entry.cost += number(session.totalCost);
      entry.sessions += 1;
      entry.totalTokens += number(session.totalTokens);
    },
  );

  return {
    range: {
      range,
      from: bounds.from.toISOString(),
      to: bounds.to.toISOString(),
    },
    summary,
    infobar: {
      overview: {
        totalCost: summary.totalCost,
        sessionCount: summary.sessionCount,
        messageCount: summary.userMessageCount,
      },
      usage: {
        totalTokens: summary.totalTokens,
        inputTokens: summary.inputTokens || summary.totalTokens,
        outputTokens: summary.outputTokens,
        cacheRead: summary.cacheRead,
        cacheWrite: summary.cacheWrite,
        toolCalls: summary.toolCalls,
        tools: toolRows,
      },
      models,
      projects,
    },
    sessions: sessions
      .slice()
      .sort(
        (left, right) => new Date(right.time ?? "").getTime() - new Date(left.time ?? "").getTime(),
      ),
  };
}

/**
 * @param {CostSessionRow[]} sessions
 * @returns {CostToolRow[]}
 */
function aggregateToolRows(sessions) {
  /** @type {Map<string, { name: string, cost: number, count: number }>} */
  const byName = new Map();
  for (const session of sessions) {
    const costs = session.toolCostByName || {};
    for (const [name, costValue] of Object.entries(costs)) {
      const entry = byName.get(name) || { name, cost: 0, count: 0 };
      entry.cost += number(costValue);
      entry.count += 1;
      byName.set(name, entry);
    }
  }
  const total = Array.from(byName.values()).reduce((sum, row) => sum + row.cost, 0);
  return Array.from(byName.values())
    .map((row) => ({ ...row, fraction: total > 0 ? row.cost / total : 0 }))
    .sort((left, right) => right.cost - left.cost);
}

/**
 * Loads and renders the Usage dashboard into `container`. The UI shell and CSS
 * classes intentionally match the standalone Usage page so the Settings tab
 * keeps the same visual design while using the native host data plane.
 *
 * @param {ParentNode | null | undefined} container
 * @param {object} options
 * @param {CostDashboardDataApi} options.data
 * @param {() => string | null | undefined} options.getWorkspaceId
 * @returns {Promise<void>}
 */
export async function loadCostDashboard(container, { data, getWorkspaceId }) {
  if (!container || !("replaceChildren" in container)) return;
  let currentRange = loadSavedRange();

  // Show a loading placeholder first — don't render section titles until data arrives.
  const page = document.createElement("div");
  page.className = "cost-dash-page";
  page.append(
    createLoadingPlaceholder({
      className: "cost-dash-empty-state",
      label: t("status.loading"),
    }),
  );
  container.replaceChildren(page);

  try {
    const workspaceId = getWorkspaceId();
    if (!workspaceId) throw new Error("No active workspace");
    const response = await data.costDashboard(workspaceId);
    const dashboard = response?.dashboard ?? {};
    try {
      await loadScriptOnce("vendor/chart.js");
    } catch {
      // The renderer draws a text fallback when Chart is absent.
    }

    // Data is ready — now render the full shell with all section headings.
    if (!("innerHTML" in container)) return;
    renderShell(/** @type {Element} */ (container));
    syncRangeChips(container, currentRange);
    const section = container.querySelector("#cost-dash-section");

    const renderRange = () => {
      saveRange(currentRange);
      syncRangeChips(container, currentRange);
      renderCostDashboard(section, adaptDashboardToInfobarPayload(dashboard, currentRange));
    };

    for (const chip of container.querySelectorAll("[data-range-chip]")) {
      chip.addEventListener("click", () => {
        if (!("dataset" in chip)) return;
        const dataset = /** @type {{ rangeChip?: string }} */ (chip.dataset);
        const nextRange = dataset.rangeChip;
        if (!nextRange || !(nextRange in RANGE_DAYS)) return;
        currentRange = /** @type {CostRangeKey} */ (nextRange);
        renderRange();
      });
    }

    renderRange();
  } catch (error) {
    if ("innerHTML" in container) {
      renderLoadError(/** @type {Element} */ (container), error);
    }
  }
}

/**
 * Section nodes this page's shell creates. The renderer asks here.
 * @param {ParentNode | null | undefined} section
 * @returns {CostDashboardSectionRefs}
 */
export function costDashboardSectionRefs(section) {
  if (!section || !("querySelector" in section)) return {};
  return {
    overview: section.querySelector("#cost-dash-overview-grid"),
    activity: section.querySelector("#cost-dash-activity-panel"),
    overviewNote: section.querySelector("#cost-dash-overview-note"),
    models: section.querySelector("#cost-dash-models-list"),
    toolCost: section.querySelector("#cost-dash-tool-cost-panel"),
    projects: section.querySelector("#cost-dash-projects-list"),
    sessions: section.querySelector("#cost-dash-sessions-panel"),
  };
}
