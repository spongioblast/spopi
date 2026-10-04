// ABOUTME: Creates the Cockpit's elements: the card skeleton, headline stat chips, and log rows.
// ABOUTME: Takes snapshots and row specs as given; scraping, timers, and open state stay in the overlay.

import { copyText } from "../ui/clipboard.js";
import { formatShortCount, formatUsd } from "../ui/formatters.js";
import { cacheWarmingControl, cacheWarmingSegments } from "./cache-warming-control.js";
import { clockTime, fmtMs, fmtTps, translate } from "./metrics-format.js";
import { cacheSharePct } from "./metrics-model.js";

/**
 * @typedef {import("./metrics-overlay-view.js").MetricsSnapshot} MetricsSnapshot
 * @typedef {import("./metrics-overlay-view.js").MetricsPromptView} MetricsPromptView
 * @typedef {import("./metrics-overlay-view.js").MetricsEngineView} MetricsEngineView
 * @typedef {import("./metrics-overlay-view.js").MetricsRatesView} MetricsRatesView
 * @typedef {import("./metrics-overlay-view.js").MetricsPromptEstimated} MetricsPromptEstimated
 * @typedef {import("./metrics-overlay-view.js").LogRowSpec} LogRowSpec
 *
 * @typedef {{
 *   foot: HTMLElement,
 *   kvRow: HTMLElement,
 *   kvFill: HTMLElement,
 *   kvText: HTMLElement,
 *   list: HTMLElement,
 *   modelLabel: HTMLElement,
 *   phase: HTMLElement,
 *   thinking: HTMLButtonElement,
 *   stats: HTMLElement,
 *   turnTime: HTMLElement,
 * }} MetricsOverlayEls
 */

const COPY_GLYPH = "⎘";

/** @param {string} text */
function sectionTitle(text) {
  const label = document.createElement("div");
  label.className = "metrics-section-title";
  label.textContent = text;
  return label;
}

/**
 * Builds the card and appends it to `container`. The docked layout is the
 * Cockpit panel; the floating one is the older pill-triggered card.
 * @param {ParentNode | null | undefined} container
 * @param {{ docked: boolean, onThinkingClick: () => void }} options
 * @returns {{ root: HTMLElement, els: MetricsOverlayEls }}
 */
export function buildMetricsOverlay(container, { docked, onThinkingClick }) {
  const root = document.createElement("div");
  root.className = "metrics-overlay hidden";
  root.id = "metrics-overlay";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", translate("metrics.title", "Metrics"));

  const head = document.createElement("div");
  head.className = "metrics-head";
  const title = document.createElement("span");
  title.className = "metrics-title";
  title.textContent = translate("metrics.title", "Metrics");
  const modelLabel = document.createElement("span");
  modelLabel.className = "metrics-model";
  head.append(title, modelLabel);

  const body = document.createElement("div");
  body.className = "metrics-body";

  const now = document.createElement("section");
  now.className = "metrics-section metrics-now";
  const phase = document.createElement("span");
  phase.className = "metrics-phase";
  const turnTime = document.createElement("span");
  turnTime.className = "metrics-turn-time";
  const nowHead = document.createElement("div");
  nowHead.className = "metrics-now-head";
  nowHead.append(phase, turnTime);
  const stats = document.createElement("div");
  stats.className = "metrics-chip-row";

  const kvRow = document.createElement("div");
  kvRow.className = "metrics-kv";
  const kvBar = document.createElement("div");
  kvBar.className = "metrics-bar";
  const kvFill = document.createElement("i");
  kvBar.append(kvFill);
  const kvText = document.createElement("span");
  kvText.className = "metrics-bar-label";
  kvRow.append(kvBar, kvText);

  const log = document.createElement("section");
  log.className = "metrics-section metrics-log-section";
  log.append(sectionTitle(translate("metrics.log", "Prompts & tools")));
  const list = document.createElement("ul");
  list.className = "metrics-log";
  log.append(list);

  const foot = document.createElement("div");
  foot.className = "metrics-foot";

  const thinking = document.createElement("button");
  thinking.type = "button";
  thinking.className = "ui-button ui-button--sm ui-button--ghost metrics-thinking";
  thinking.addEventListener("click", onThinkingClick);
  if (docked) {
    nowHead.append(modelLabel);
    now.append(nowHead, kvRow);
    const controls = document.createElement("div");
    controls.className = "metrics-controls";
    controls.append(cacheWarmingSegments(), thinking);
    const footRow = document.createElement("div");
    footRow.className = "metrics-foot-row";
    footRow.append(foot);
    body.append(now, stats, log, controls, footRow);
    root.append(body);
  } else {
    now.append(nowHead, stats, kvRow);
    body.append(now, log, foot, thinking);
    root.append(head, body);
  }
  if (docked) {
    root.classList.add("docked");
    root.classList.remove("hidden");
  }
  container?.append(root);

  return {
    root,
    els: {
      foot,
      kvRow,
      kvFill,
      kvText,
      list,
      modelLabel,
      phase,
      thinking,
      stats,
      turnTime,
    },
  };
}

/**
 * @param {string} label
 * @param {string} value
 * @param {string} [tone]
 */
function chip(label, value, tone = "") {
  const element = document.createElement("span");
  element.className = `pill metrics-chip${tone ? ` ${tone}` : ""}`;
  const name = document.createElement("b");
  name.textContent = label;
  const body = document.createElement("span");
  body.textContent = value;
  element.append(name, body);
  return element;
}

/**
 * The headline chip row. Latency chips appear only while the model server's
 * own counters answer (`serverLive`).
 * @param {MetricsSnapshot} snapshot
 * @param {{ docked: boolean, serverLive: boolean }} options
 * @returns {HTMLElement[]}
 */
export function statChips(snapshot, { docked, serverLive }) {
  const turn = snapshot.turn || {};
  /** @type {MetricsPromptView} */
  const prompt = snapshot.prompt || {};
  /** @type {MetricsEngineView} */
  const engine = prompt.engine || {};
  /** @type {MetricsRatesView} */
  const rates = snapshot.rates || {};
  // Cumulative-since-turn-start rates: they tick continuously while the model
  // works and settle on the final number the moment the prompt finishes.
  const decodeTps = prompt.decodeTps || (snapshot.active ? turn.liveTps : 0);
  // `≈` marks values that come from the engine's counters rather than pi's
  // usage report, which only arrives when the prompt ends.
  /** @type {MetricsPromptEstimated} */
  const est = prompt.estimated || {};
  /**
   * @param {unknown} value
   * @param {boolean | undefined} flag
   */
  const count = (value, flag) => (flag ? `≈${formatShortCount(value)}` : formatShortCount(value));
  // Labels follow the usual serving-stack vocabulary: throughput in tok/s, and
  // every waiting cost in its own milliseconds, so the two never blur.
  const chipOut = chip("out", count(prompt.outputTokens, est.out));
  chipOut.title = `${translate(
    "metrics.outTitle",
    "output tokens this prompt · {thinking} thinking · {chars} text chars",
    {
      thinking: formatShortCount(prompt.reasoningTokens),
      chars: formatShortCount(prompt.textChars),
    },
  )}${prompt.cost ? ` · ${formatUsd(prompt.cost, 4)}` : ""}`;
  const chipPrompt = chip("prompt", count(prompt.inputTokens, est.in));
  chipPrompt.title = translate("metrics.promptTitle", "prompt tokens");
  // Same honesty rule as the counts: without engine counters the rate is the
  // client-side estimate (out / generation window), so it is marked as one.
  const tpsEstimated = !prompt.engine && (decodeTps || 0) > 0;
  const chipTps = chip("tok/s", `${tpsEstimated ? "≈" : ""}${fmtTps(decodeTps)}`, "accent");
  chipTps.title = translate(
    "metrics.tpsTitle",
    "per-request output throughput · excludes queue, prefill and TTFT",
  );
  if (tpsEstimated)
    chipTps.title = `${chipTps.title} · ${translate("metrics.tpsEstimated", "estimated from output ÷ generation window")}`;
  const chipTpot = chip("TPOT", fmtMs(engine.meanItlMs || rates.meanItlMs));
  chipTpot.title = translate(
    "metrics.tpotTitle",
    "time per output token · vLLM: inter_token_latency_seconds",
  );
  const chipTtft = chip("TTFT", fmtMs(engine.meanTtftMs || rates.meanTtftMs));
  chipTtft.title = translate(
    "metrics.ttftTitle",
    "time to first token · queue + prefill + scheduling",
  );
  const chipQueue = chip("queue", fmtMs(engine.meanQueueMs || rates.meanQueueMs));
  chipQueue.title = translate("metrics.queueTitle", "waiting for KV blocks or the scheduler");
  const chipPrefill = chip("prefill", fmtMs(engine.meanPrefillMs || rates.meanPrefillMs));
  chipPrefill.title = translate("metrics.prefillTitle", "prompt processing time");
  const acceptLen = engine.tokensPerStep || rates.tokensPerStep || 0;
  const chipAccept = chip(
    "accept len",
    acceptLen >= 1 ? acceptLen.toFixed(2) : "—",
    acceptLen > 1 ? "success" : "",
  );
  chipAccept.title = translate(
    "metrics.acceptTitle",
    "accepted tokens per step, including the guaranteed token (MTP speculation)",
  );
  const session = snapshot.session || {};
  const chipCache = chip(
    translate("metrics.cacheHit", "Cache hit"),
    `${Math.round(prompt.cacheSharePct || 0)}% · ${Math.round(cacheSharePct(session.input, session.cacheRead))}%`,
  );
  const chipSession = chip("session", formatShortCount(session.tokens || 0));
  chipSession.title = translate("metrics.sessionTitle", "output tokens generated this session");
  const chipTurn = chip("turn", fmtMs(prompt.durationMs));
  chipTurn.title = translate("metrics.turnDuration", "prompt wall time");
  const chips = [
    chipOut,
    chipPrompt,
    chipTps,
    ...(serverLive ? [chipTpot, chipTtft, chipQueue, chipPrefill, chipAccept] : []),
    chipCache,
    chipSession,
    chipTurn,
  ];
  if (!docked) chips.splice(2, 0, cacheWarmingControl());
  return chips;
}

/**
 * @param {LogRowSpec} spec
 * @param {(button: HTMLButtonElement, text: string) => void} onCopy
 */
export function createLogRow(
  {
    kind,
    state = "",
    at,
    glyph,
    text,
    right,
    rightTitle = "",
    title = "",
    copy = "",
    copyTitle = "",
  },
  onCopy,
) {
  const row = document.createElement("li");
  row.className = `metrics-log-row metrics-log-${kind}${state ? ` ${state}` : ""}`;
  const time = document.createElement("span");
  time.className = "metrics-log-time";
  time.textContent = at ? clockTime(at) : "";
  const mark = document.createElement("span");
  mark.className = "metrics-log-glyph";
  mark.textContent = glyph;
  const body = document.createElement("span");
  body.className = "metrics-log-text";
  body.textContent = text;
  if (title) body.title = title;
  const tail = document.createElement("span");
  tail.className = "metrics-log-right";
  tail.textContent = right;
  if (rightTitle) tail.title = rightTitle;
  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "ui-icon-button ui-icon-button--ghost ui-icon-button--xs metrics-copy";
  copyButton.textContent = COPY_GLYPH;
  // Say what it copies: the argument for a tool row, the stats line for a prompt.
  const copyLabel =
    kind === "tool"
      ? translate("metrics.copyCommand", "Copy command / path")
      : kind === "compaction"
        ? translate("metrics.copyCompaction", "Copy compaction line")
        : translate("metrics.copyStats", "Copy prompt stats");
  copyButton.title = copyLabel;
  copyButton.setAttribute("aria-label", copyLabel);
  copyButton.addEventListener("click", (event) => {
    event.stopPropagation();
    onCopy(copyButton, copy || row.textContent || "");
  });
  copyButton.addEventListener("mouseenter", () => {
    copyButton.title = copyTitle || translate("metrics.copy", "Copy this line");
  });
  row.append(time, mark, body, tail, copyButton);
  return row;
}

/** Clipboard with a same-page fallback; the glyph answers so it is obvious.
 * @param {HTMLButtonElement} button
 * @param {string} text
 */
export async function copyLogLine(button, text) {
  const feedback = () => {
    button.textContent = "✓";
    button.classList.add("copied");
    setTimeout(() => {
      button.textContent = COPY_GLYPH;
      button.classList.remove("copied");
    }, 1200);
  };
  try {
    await copyText(text);
    feedback();
  } catch {
    /* clipboard permission denied */
  }
}
