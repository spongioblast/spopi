// ABOUTME: Reads pi-subagents' RPC widgets: the live run snapshot and on-demand inspect replies.
// ABOUTME: Both are one JSON line on a widget key SPOPI must not draw as text; commands go back as slash text.

const RUNS_WIDGET = "subagent-async";
export const INSPECT_WIDGET = "subagent-inspect";
const RUNS_PREFIX = "PI_SUBAGENT_ASYNC_JSON:";
const INSPECT_PREFIX = "PI_SUBAGENT_INSPECT_JSON:";
const RUNS_KIND = "pi-subagents.async-status-snapshot";
const INSPECT_KIND = "pi-subagents.inspect-reply";
const LIVE = new Set(["queued", "running", "paused"]);

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   state: string,
 *   startedAt?: number,
 *   endedAt?: number,
 *   currentTool?: string,
 *   toolCount?: number,
 *   children: SubagentNode[],
 * }} SubagentNode
 *
 * @typedef {{ role: string, kind: string, text: string, name?: string, isError?: boolean }} SubagentMessage
 *
 * @typedef {{
 *   requestId: string,
 *   asyncId?: string,
 *   childId?: string,
 *   status?: string,
 *   label?: string,
 *   task?: string,
 *   messages: SubagentMessage[],
 *   finalOutput?: string,
 *   error?: { code?: string, message?: string },
 * }} SubagentInspectReply
 */

/** @param {{ method?: string, widgetKey?: string } | null | undefined} request */
export function isSubagentWidget(request) {
  return (
    request?.method === "setWidget" &&
    (request.widgetKey === RUNS_WIDGET || request.widgetKey === INSPECT_WIDGET)
  );
}

/**
 * @param {unknown} lines
 * @param {string} prefix
 * @returns {any}
 */
function payload(lines, prefix) {
  if (!Array.isArray(lines)) return null;
  const line = lines.find((item) => typeof item === "string" && item.startsWith(prefix));
  if (!line) return null;
  try {
    return JSON.parse(line.slice(prefix.length));
  } catch {
    return null;
  }
}

/**
 * @param {any} node
 * @returns {SubagentNode | null}
 */
function readNode(node) {
  if (!node || typeof node.id !== "string") return null;
  const activity = node.activity && typeof node.activity === "object" ? node.activity : {};
  return {
    id: node.id,
    label: typeof node.label === "string" && node.label ? node.label : node.id,
    state: typeof node.state === "string" ? node.state : "running",
    startedAt: typeof node.startedAt === "number" ? node.startedAt : undefined,
    endedAt: typeof node.endedAt === "number" ? node.endedAt : undefined,
    currentTool: typeof activity.currentTool === "string" ? activity.currentTool : undefined,
    toolCount: typeof activity.toolCount === "number" ? activity.toolCount : undefined,
    children: (Array.isArray(node.children) ? node.children : []).map(readNode).filter(present),
  };
}

/**
 * @param {SubagentNode | null} node
 * @returns {node is SubagentNode}
 */
function present(node) {
  return node !== null;
}

/**
 * The runs in a `subagent-async` widget. No lines means the extension removed the widget.
 * @param {unknown} lines
 * @returns {SubagentNode[]}
 */
export function parseRuns(lines) {
  const snapshot = payload(lines, RUNS_PREFIX);
  if (!snapshot || snapshot.kind !== RUNS_KIND || !Array.isArray(snapshot.runs)) return [];
  return snapshot.runs.map(readNode).filter(present);
}

/**
 * @param {unknown} lines
 * @returns {SubagentInspectReply | null}
 */
export function parseInspect(lines) {
  const reply = payload(lines, INSPECT_PREFIX);
  if (!reply || reply.kind !== INSPECT_KIND || typeof reply.requestId !== "string") return null;
  return {
    requestId: reply.requestId,
    asyncId: reply.asyncId,
    childId: reply.childId,
    status: reply.status,
    label: reply.label,
    task: typeof reply.task === "string" ? reply.task : undefined,
    messages: (Array.isArray(reply.messages) ? reply.messages : []).filter(
      (/** @type {any} */ message) => message && typeof message.text === "string",
    ),
    finalOutput: typeof reply.finalOutput === "string" ? reply.finalOutput : undefined,
    error: reply.error && typeof reply.error === "object" ? reply.error : undefined,
  };
}

/** @param {string | undefined} state */
export function isLive(state) {
  return LIVE.has(String(state || ""));
}

/**
 * @typedef {{ runId: string, childId?: string, steerChild?: string, node: SubagentNode }} SubagentTarget
 */

/**
 * A single-step run is inspected through its one step and steered as a whole run;
 * a parallel run is inspected and steered per child.
 * @param {SubagentNode} run
 * @returns {SubagentTarget[]}
 */
export function openTargets(run) {
  if (run.children.length > 1) {
    return run.children.map((child) => ({
      runId: run.id,
      childId: child.id,
      steerChild: child.id,
      node: child,
    }));
  }
  return [{ runId: run.id, childId: run.children[0]?.id, node: run }];
}

/**
 * @param {string} runId
 * @param {string} [childId]
 */
export function stopCommand(runId, childId) {
  return ["/subagents-stop", runId, childId].filter(Boolean).join(" ");
}

/**
 * The command splits on whitespace and joins with spaces, so line breaks are folded here.
 * @param {string} runId
 * @param {string | undefined} childId
 * @param {string} message
 */
export function steerCommand(runId, childId, message) {
  const text = String(message || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  return ["/subagents-steer", runId, childId ? `--child ${childId}` : "", text]
    .filter(Boolean)
    .join(" ");
}

/**
 * @param {string} requestId
 * @param {string} runId
 * @param {string} [childId]
 * @param {number} [lines]
 */
export function inspectCommand(requestId, runId, childId, lines = 100) {
  return ["/subagents-inspect-rpc", requestId, runId, childId, "--lines", String(lines)]
    .filter(Boolean)
    .join(" ");
}
