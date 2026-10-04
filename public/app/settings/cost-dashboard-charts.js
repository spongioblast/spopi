// ABOUTME: Draws the Usage dashboard charts: stacked model tokens, project cost, and tool cost doughnuts.
// ABOUTME: Colors come from theme tokens; without Chart.js each canvas becomes a text or conic fallback.

import { t } from "../i18n/i18n.js";
import { formatCompact, formatUsd } from "../ui/formatters.js";

/**
 * @typedef {import("./cost-dashboard-render.js").CostRankRow} CostRankRow
 * @typedef {import("./cost-dashboard-render.js").CostToolUsageRow} CostToolUsageRow
 * @typedef {import("./cost-dashboard-tables.js").CostModelSeries} CostModelSeries
 * @typedef {import("./cost-dashboard-tables.js").CostModelSummary} CostModelSummary
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

const CHART_FALLBACK = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#fb7185", "#06b6d4"];

/**
 * Chart.js paints on a canvas, so it needs resolved colors rather than var().
 * @param {string} name
 * @param {string} fallback
 */
function themeColor(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/** @returns {string[]} */
function getChartPalette() {
  return CHART_FALLBACK.map((fallback, index) => themeColor(`--chart-${index + 1}`, fallback));
}

/** @returns {string[]} */
function getModelChartPalette() {
  return getChartPalette().slice(0, 3);
}

/** @returns {string[]} */
function getToolChartPalette() {
  return getChartPalette();
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
export function renderModelsChart(canvas, modelSummary) {
  if (!isChartCanvas(canvas) || !modelSummary) return;
  const chartCanvas = canvas;
  const colors = getModelChartPalette();
  const tickColor = themeColor("--text-secondary", "#8f959e");
  const gridColor = themeColor("--border", "rgba(255,255,255,0.08)");
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
              color: tickColor,
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: 8,
            },
          },
          y: {
            stacked: true,
            grid: {
              color: gridColor,
            },
            border: {
              display: false,
            },
            ticks: {
              color: tickColor,
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

/**
 * @param {Element | null} canvas
 * @param {CostRankRow[]} rows
 */
export function renderProjectsChart(canvas, rows) {
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
export function renderToolCostChart(canvas, tools) {
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
