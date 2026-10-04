// ABOUTME: The Cockpit's view model: snapshot shapes it reads, phase states, and log rows as plain specs.
// ABOUTME: Pure text and state decisions; creating elements is metrics-overlay-paint.js's job.

import { formatShortCount, formatUsd } from "../ui/formatters.js";
import { clockTime, fmtMs, fmtPct, fmtTps, translate } from "./metrics-format.js";

/**
 * @typedef {{
 *   id?: string,
 *   thinkingLevel?: string,
 *   provider?: string,
 *   baseUrl?: string,
 *   thinkingBudgetField?: string,
 * }} MetricsModelInfo
 *
 * @typedef {{
 *   meanItlMs?: number,
 *   meanTtftMs?: number,
 *   meanQueueMs?: number,
 *   meanPrefillMs?: number,
 *   tokensPerStep?: number,
 *   genTokens?: number,
 *   specAcceptPct?: number,
 *   kvPeakPct?: number,
 * }} MetricsEngineView
 *
 * @typedef {{
 *   out?: boolean,
 *   in?: boolean,
 *   cached?: boolean,
 *   think?: boolean,
 * }} MetricsPromptEstimated
 *
 * @typedef {{
 *   id?: string,
 *   status?: string,
 *   startedAt?: number,
 *   finishedAt?: number,
 *   durationMs?: number,
 *   toolName?: string,
 *   label?: string,
 *   title?: string,
 * }} MetricsToolView
 *
 * @typedef {{
 *   id?: number,
 *   startedAt?: number,
 *   finishedAt?: number,
 *   active?: boolean,
 *   phase?: string,
 *   durationMs?: number,
 *   genMs?: number,
 *   inputTokens?: number,
 *   cacheReadTokens?: number,
 *   cacheSharePct?: number,
 *   outputTokens?: number,
 *   reasoningTokens?: number,
 *   cost?: number,
 *   estimated?: MetricsPromptEstimated,
 *   textChars?: number,
 *   thinkingChars?: number,
 *   compactions?: number,
 *   retries?: number,
 *   decodeTps?: number,
 *   engine?: MetricsEngineView | null,
 *   callOutputs?: number[],
 *   tools?: MetricsToolView[],
 *   toolCount?: number,
 * }} MetricsPromptView
 *
 * @typedef {{
 *   id?: number,
 *   startedAt?: number,
 *   finishedAt?: number,
 *   status?: string,
 *   reason?: string,
 *   before?: number,
 *   after?: number,
 *   afterAt?: number,
 *   summaryTokens?: number,
 *   error?: string,
 *   turnId?: number,
 *   durationMs?: number,
 *   stale?: boolean,
 *   saved?: number,
 * }} MetricsCompactionView
 *
 * @typedef {{ kind: "prompt", at?: number, prompt: MetricsPromptView }} MetricsLogPrompt
 * @typedef {{ kind: "compaction", at?: number, compaction: MetricsCompactionView }} MetricsLogCompaction
 * @typedef {MetricsLogPrompt | MetricsLogCompaction} MetricsLogItem
 *
 * @typedef {{
 *   elapsedMs?: number,
 *   liveTps?: number,
 * }} MetricsTurnView
 *
 * @typedef {{
 *   meanItlMs?: number,
 *   meanTtftMs?: number,
 *   meanQueueMs?: number,
 *   meanPrefillMs?: number,
 *   tokensPerStep?: number,
 * }} MetricsRatesView
 *
 * @typedef {{
 *   kvCachePct?: number,
 * }} MetricsServerView
 *
 * @typedef {{
 *   ok?: boolean | null,
 *   lastOkAt?: number,
 *   error?: string,
 *   latencyMs?: number,
 * }} MetricsHealthView
 *
 * @typedef {{
 *   tokens?: number, input?: number, cacheRead?: number,
 *   turns?: number,
 * }} MetricsSessionView
 *
 * @typedef {{
 *   active?: boolean,
 *   phase?: string,
 *   prompt?: MetricsPromptView | null,
 *   log?: MetricsLogItem[],
 *   avgDecodeTps?: number,
 *   turn?: MetricsTurnView,
 *   model?: MetricsModelInfo | null,
 *   server?: MetricsServerView | null,
 *   rates?: MetricsRatesView | null,
 *   health?: MetricsHealthView,
 *   session?: MetricsSessionView,
 * }} MetricsSnapshot
 *
 * @typedef {{
 *   kind: string,
 *   state?: string,
 *   at?: number,
 *   glyph: string,
 *   text: string,
 *   right: string,
 *   rightTitle?: string,
 *   title?: string,
 *   copy?: string,
 *   copyTitle?: string,
 * }} LogRowSpec
 */

/* Colours live in metrics-overlay.css (.metrics-phase.<state>), which owns the
   token choice: thinking/tool states reuse the tool-card accents. */
/** @type {Record<string, string>} */
export const PHASE_STATES = {
  idle: "idle",
  working: "accent",
  thinking: "thinking",
  streaming: "accent",
  toolcall: "tool",
  tool: "tool",
  compacting: "warning",
  retrying: "warning",
};

/** @type {Record<string, string>} */
const TOOL_GLYPHS = { running: "◐", ok: "✓", error: "✕" };
/* Compaction gets its own glyph family: it is a session-level event, not a
   tool, and `↺` reads as "the context was rewritten". */
/** @type {Record<string, string>} */
const COMPACTION_GLYPHS = {
  running: "◐",
  ok: "↺",
  retrying: "↻",
  aborted: "⊘",
  error: "✕",
};

/**
 * Coarse fingerprint of the rows (durations rounded); the log is rebuilt only when it changes.
 * @param {MetricsLogItem[]} rows
 */
export function logSignature(rows) {
  return rows
    .map((item) =>
      item.kind === "compaction"
        ? `c${item.compaction.id}:${item.compaction.status}:${Math.round(
            (item.compaction.durationMs || 0) / 500,
          )}:${item.compaction.before}:${item.compaction.after}`
        : `${item.prompt.id}:${item.prompt.active ? 1 : 0}:${Math.round((item.prompt.durationMs || 0) / 500)}:${item.prompt.outputTokens}` +
          `:${item.prompt.toolCount}:${(item.prompt.tools || [])
            .map((tool) => `${tool.status}${Math.round((tool.durationMs || 0) / 250)}`)
            .join(",")}`,
    )
    .join("|");
}

/**
 * @param {MetricsLogItem[]} rows
 * @returns {LogRowSpec[]}
 */
export function logRowSpecs(rows) {
  if (!rows.length) {
    return [
      {
        kind: "empty",
        glyph: "",
        text: translate("metrics.noPrompts", "No prompts captured yet this session"),
        right: "",
      },
    ];
  }
  /** @type {LogRowSpec[]} */
  const specs = [];
  for (const item of rows) {
    if (item.kind === "compaction") specs.push(compactionRowSpec(item.compaction));
    else specs.push(...promptRowSpecs(item.prompt));
  }
  return specs;
}

/**
 * The prompt's own row, then its tool rows (newest last), with a count for the
 * tools the model dropped from the view.
 * @param {MetricsPromptView} prompt
 * @returns {LogRowSpec[]}
 */
function promptRowSpecs(prompt) {
  /** @type {MetricsEngineView} */
  const engine = prompt.engine || {};
  const calls = prompt.callOutputs || [];
  const parts = [
    `out ${formatShortCount(prompt.outputTokens)}`,
    `prompt ${formatShortCount(prompt.inputTokens)}`,
    `${fmtTps(prompt.decodeTps)} t/s`,
  ];
  if (calls.length > 1) parts.push(`${formatShortCount(calls.length)} calls`);
  if (engine.meanItlMs) parts.push(`TPOT ${fmtMs(engine.meanItlMs)}`);
  if (prompt.retries) parts.push(`retry ${prompt.retries}`);
  if (prompt.compactions) parts.push(`compact ${prompt.compactions}`);
  /** @type {LogRowSpec[]} */
  const specs = [
    {
      kind: "prompt",
      state: prompt.active ? PHASE_STATES[prompt.phase || ""] || "working" : "done",
      at: prompt.startedAt,
      glyph: prompt.active ? "◐" : "▪",
      text: `P${prompt.id}  ${parts.join("  ·  ")}`,
      right: fmtMs(prompt.durationMs),
      rightTitle: translate("metrics.turnDuration", "Prompt wall time"),
      copy: [
        `prompt P${prompt.id}`,
        clockTime(prompt.startedAt),
        ...parts,
        engine.meanQueueMs ? `queue ${fmtMs(engine.meanQueueMs)}` : "",
        engine.meanPrefillMs ? `prefill ${fmtMs(engine.meanPrefillMs)}` : "",
        engine.tokensPerStep ? `accept len ${engine.tokensPerStep.toFixed(2)}` : "",
        `turn ${fmtMs(prompt.durationMs)}`,
      ]
        .filter(Boolean)
        .join(" · "),
      title: [
        `prompt ${prompt.id}`,
        calls.length > 1 ? `out per model call: ${calls.map(formatShortCount).join(", ")}` : "",
        `${formatShortCount(prompt.reasoningTokens)} thinking tokens`,
        `cached ${formatShortCount(prompt.cacheReadTokens)}`,
        prompt.cost ? `cost ${formatUsd(prompt.cost, 4)}` : "",
        `${formatShortCount(prompt.textChars)} text chars`,
        `${formatShortCount(prompt.thinkingChars)} thinking chars`,
        prompt.genMs ? `generating ${fmtMs(prompt.genMs)}` : "",
        engine.genTokens ? `engine ${formatShortCount(engine.genTokens)} tokens decoded` : "",
        engine.specAcceptPct ? `spec accept ${fmtPct(engine.specAcceptPct)}` : "",
        engine.kvPeakPct ? `KV peak ${engine.kvPeakPct.toFixed(1)}%` : "",
      ]
        .filter(Boolean)
        .join(" · "),
    },
  ];
  const shownTools = prompt.tools || [];
  const hiddenTools = Math.max(0, (prompt.toolCount || 0) - shownTools.length);
  if (hiddenTools > 0) {
    specs.push({
      kind: "tool",
      state: "",
      at: shownTools[0]?.startedAt,
      glyph: "…",
      text: `${formatShortCount(hiddenTools)} ${translate("metrics.earlierTools", "earlier tool calls")}`,
      right: "",
    });
  }
  for (const tool of shownTools) {
    specs.push({
      kind: "tool",
      state: tool.status,
      at: tool.startedAt,
      glyph: TOOL_GLYPHS[tool.status || ""] || "•",
      text: `${tool.toolName}  ${tool.label || "—"}`,
      title: tool.title || tool.label || "",
      right: fmtMs(tool.durationMs),
      // A tool row copies its argument alone, so it can be pasted into a
      // terminal or opened as a path; the summary line stays in the tooltip.
      copy: tool.title || tool.label || "",
      copyTitle: [
        `tool ${tool.toolName}`,
        tool.status,
        clockTime(tool.startedAt),
        fmtMs(tool.durationMs),
        tool.title || tool.label || "",
      ]
        .filter(Boolean)
        .join(" · "),
    });
  }
  return specs;
}

/**
 * One compaction row: in progress it says so, once finished it carries the
 * before/after context sizes. `after` stays "…" until pi's next request proves
 * the new size, because pi's event only reports `tokensBefore`.
 * @param {MetricsCompactionView} view
 * @returns {LogRowSpec}
 */
function compactionRowSpec(view) {
  // pi mirrors the status into `reason` (`"aborted"`, `"error"`), and "auto" is
  // the default, so only a reason that adds information is worth printing.
  const informative =
    Boolean(view.reason) &&
    view.reason !== "auto" &&
    view.reason !== view.status &&
    !["aborted", "error"].includes(view.reason || "");
  const reason = informative ? ` (${view.reason})` : "";
  /** @type {Record<string, string>} */
  const verbs = {
    running: translate("metrics.compactingRow", "compacting"),
    ok: translate("metrics.compactedRow", "compacted"),
    retrying: translate("metrics.compactionRetrying", "compaction retrying"),
    aborted: translate("metrics.compactionAborted", "compaction aborted"),
    error: translate("metrics.compactionFailed", "compaction failed"),
  };
  const verb = verbs[view.status || ""] || translate("metrics.compactionRow", "compaction");
  const head =
    view.status === "ok"
      ? `${verb}${reason} ${formatShortCount(view.before)} → ${view.after ? formatShortCount(view.after) : "…"}`
      : view.before
        ? `${verb}${reason} ${formatShortCount(view.before)} tokens`
        : `${verb}${reason}`;
  const parts = [];
  if (view.status === "ok" && view.saved) parts.push(`−${formatShortCount(view.saved)}`);
  if (view.summaryTokens) parts.push(`summary ${formatShortCount(view.summaryTokens)}`);
  if (view.error && view.error !== "aborted") parts.push(view.error);
  if (view.stale) parts.push(translate("metrics.compactionStale", "no end event seen"));
  const text = parts.length ? `${head}  ·  ${parts.join("  ·  ")}` : head;
  return {
    kind: "compaction",
    state: view.status,
    at: view.startedAt,
    glyph: COMPACTION_GLYPHS[view.status || ""] || "↺",
    text,
    right: fmtMs(view.durationMs),
    rightTitle: translate("metrics.compactionDuration", "Compaction wall time"),
    copy: [
      informative ? `compaction ${view.reason}` : "compaction",
      view.status,
      clockTime(view.startedAt),
      view.before
        ? `${formatShortCount(view.before)} → ${view.after ? formatShortCount(view.after) : "…"}`
        : "",
      view.saved ? `−${formatShortCount(view.saved)}` : "",
      view.summaryTokens ? `summary ${formatShortCount(view.summaryTokens)}` : "",
      `took ${fmtMs(view.durationMs)}`,
    ]
      .filter(Boolean)
      .join(" · "),
    title: [
      `compaction ${view.id}${view.reason ? ` · ${view.reason}` : ""}`,
      view.before ? `before ${formatShortCount(view.before)} tokens` : "",
      view.status === "ok"
        ? view.after
          ? `after ${formatShortCount(view.after)} tokens`
          : translate("metrics.compactionPendingAfter", "new size waits for the next request")
        : "",
      view.afterAt ? `new size measured ${clockTime(view.afterAt)}` : "",
      view.status === "aborted" || view.status === "error" || view.status === "retrying"
        ? translate("metrics.compactionNoRewrite", "context left untouched")
        : "",
      view.summaryTokens ? `summary ${formatShortCount(view.summaryTokens)} tokens` : "",
      view.turnId ? `inside prompt P${view.turnId}` : "while idle",
      view.error && view.error !== "aborted" ? view.error : "",
    ]
      .filter(Boolean)
      .join(" · "),
  };
}
