// ABOUTME: Builds one turn from transcript events: work steps, files, and thinking.
// ABOUTME: The reducer owns when a turn opens and closes. This file only edits a turn.

import { toolLineCounts } from "./turn-files.js";

/**
 * @typedef {"read"|"write"|"edit"|"bash"|"other"} TurnStepKind
 * @typedef {{ kind: TurnStepKind, name: string, args: unknown, durationMs: number, startedAt?: number, id?: string }} TurnStep
 * @typedef {{ path: string, add: number, del: number }} TurnFile
 * @typedef {{
 *   id: string,
 *   model: { provider: string, id: string } | null,
 *   startedAt: number,
 *   endedAt: number | null,
 *   tokens: { in: number, out: number, cache: number } | null,
 *   cacheHit: string | null,
 *   thinking: { durationMs: number, text: string, open: boolean },
 *   work: { durationMs: number, steps: TurnStep[], open: boolean },
 *   answerId: string | null,
 *   files: TurnFile[],
 *   notices: { kind: string, text?: string, status?: string, attempt?: number, seconds?: number, source?: string }[]
 * }} Turn
 */

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function asNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * @param {Record<string, unknown>} event
 */
export function eventTime(event) {
  return asNumber(event.timestamp, Date.now());
}

/**
 * @param {string} name
 * @returns {TurnStepKind}
 */
function toolKind(name) {
  if (name === "read" || name === "write" || name === "edit" || name === "bash") return name;
  return "other";
}

/**
 * @param {Record<string, unknown>} event
 */
export function toolArgs(event) {
  if (event.args && typeof event.args === "object") return event.args;
  if (typeof event.arguments === "string") {
    try {
      const parsed = JSON.parse(event.arguments);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * @param {number} index
 * @param {{ provider: string, id: string } | null} model
 * @param {number} startedAt
 * @returns {Turn}
 */
export function createTurn(index, model, startedAt) {
  return {
    id: `turn-${index + 1}`,
    model,
    startedAt,
    endedAt: null,
    tokens: null,
    cacheHit: null,
    thinking: { durationMs: 0, text: "", open: false },
    work: { durationMs: 0, steps: [], open: false },
    answerId: null,
    files: [],
    notices: [],
  };
}

/**
 * @param {Turn} turn
 * @param {number} endedAt
 * @returns {Turn}
 */
export function closeTurn(turn, endedAt) {
  if (turn.endedAt != null) return turn;
  const steps = turn.work.steps.map((step) => {
    const durationMs =
      step.durationMs || Math.max(0, endedAt - asNumber(step.startedAt, turn.startedAt));
    return { kind: step.kind, name: step.name, args: step.args, durationMs };
  });
  const durationMs = steps.reduce((sum, step) => sum + step.durationMs, 0);
  return { ...turn, endedAt, work: { ...turn.work, steps, durationMs } };
}

/**
 * @param {Turn} turn
 * @param {string} id
 * @param {string} name
 * @param {unknown} args
 * @param {number} startedAt
 * @returns {Turn}
 */
export function pushWorkStep(turn, id, name, args, startedAt) {
  const step = { kind: toolKind(name), name, args, durationMs: 0, startedAt, id };
  return { ...turn, work: { ...turn.work, steps: [...turn.work.steps, step] } };
}

/**
 * @param {Turn} turn
 * @param {string} id
 * @param {number} endedAt
 * @returns {Turn}
 */
export function finishWorkStep(turn, id, endedAt) {
  const steps = turn.work.steps.map((step) => {
    if (step.id !== id || step.durationMs > 0) return step;
    const durationMs = Math.max(0, endedAt - asNumber(step.startedAt, endedAt));
    return { kind: step.kind, name: step.name, args: step.args, durationMs };
  });
  return { ...turn, work: { ...turn.work, steps } };
}

/**
 * @param {Turn} turn
 * @param {string} name
 * @param {unknown} args
 * @returns {Turn}
 */
export function pushChangedFile(turn, name, args) {
  const kind = toolKind(name);
  if (kind !== "write" && kind !== "edit") return turn;
  const record =
    args && typeof args === "object" ? /** @type {Record<string, unknown>} */ (args) : {};
  const path = typeof record.path === "string" ? record.path : "";
  if (!path) return turn;
  const { add, del } = toolLineCounts(kind, record);
  return { ...turn, files: [...turn.files, { path, add, del }] };
}

/**
 * @param {Turn} turn
 * @param {{ kind: string, text?: string, status?: string }} notice
 * @returns {Turn}
 */
export function pushTurnNotice(turn, notice) {
  return { ...turn, notices: [...turn.notices, notice] };
}

/**
 * @param {Turn} turn
 * @param {{ id?: string, role?: string, content?: unknown, usage?: unknown }} message
 * @returns {Turn}
 */
export function applyMessageToTurn(turn, message) {
  let next = turn;
  if (message.role === "assistant" && message.id && !next.answerId) {
    next = { ...next, answerId: message.id };
  }
  const text = thinkingText(message.content);
  if (text) next = { ...next, thinking: { ...next.thinking, text } };
  const tokens = tokensFromUsage(message.usage);
  if (tokens) next = { ...next, tokens };
  return next;
}

/**
 * @param {unknown} content
 */
function thinkingText(content) {
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      const entry = /** @type {{ type?: string, thinking?: string, text?: string }} */ (block);
      if (entry.type !== "thinking") return "";
      return entry.thinking || entry.text || "";
    })
    .join("");
}

/**
 * @param {unknown} usage
 * @returns {{ in: number, out: number, cache: number } | null}
 */
function tokensFromUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  const record = /** @type {Record<string, unknown>} */ (usage);
  const input = record.input ?? record.inputTokens;
  const output = record.output ?? record.outputTokens;
  if (typeof input !== "number" && typeof output !== "number") return null;
  const cache = record.cacheRead ?? record.cache ?? 0;
  return {
    in: asNumber(input, 0),
    out: asNumber(output, 0),
    cache: asNumber(cache, 0),
  };
}

/**
 * @param {number} ms
 */
export function formatTurnDuration(ms) {
  const seconds = Math.max(0, Math.round(asNumber(ms, 0) / 1000));
  return `${seconds}s`;
}

/**
 * @param {(key: string, params?: Record<string, unknown>) => string} t
 * @param {string} key
 * @param {Record<string, unknown>} params
 * @param {string} fallback
 */
function turnText(t, key, params, fallback) {
  const value = t(key, params);
  return value && value !== key ? value : fallback;
}

/**
 * One collapsed work row: duration plus read, command, and edit counts.
 * @param {Turn} turn
 * @param {(key: string, params?: Record<string, unknown>) => string} [t]
 */
export function workRowLabel(turn, t = () => "") {
  const steps = turn.work?.steps || [];
  const reads = steps.filter((step) => step.kind === "read").length;
  const commands = steps.filter((step) => step.kind === "bash").length;
  const edits = steps.filter((step) => step.kind === "write" || step.kind === "edit").length;
  const duration = formatTurnDuration(turn.work?.durationMs || 0);
  const parts = [turnText(t, "chat.turn.worked", { duration }, `Worked for ${duration}`)];
  if (reads) {
    const key = reads === 1 ? "chat.turn.readFile" : "chat.turn.readFiles";
    parts.push(turnText(t, key, { count: reads }, `read ${reads} file${reads === 1 ? "" : "s"}`));
  }
  if (commands) {
    const key = commands === 1 ? "chat.turn.ranCommand" : "chat.turn.ranCommands";
    parts.push(
      turnText(t, key, { count: commands }, `ran ${commands} command${commands === 1 ? "" : "s"}`),
    );
  }
  if (edits) {
    const key = edits === 1 ? "chat.turn.editedFile" : "chat.turn.editedFiles";
    parts.push(turnText(t, key, { count: edits }, `edited ${edits} file${edits === 1 ? "" : "s"}`));
  }
  return parts.join(" · ");
}
