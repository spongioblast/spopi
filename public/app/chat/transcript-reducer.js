// ABOUTME: The one pure reducer for a window's session: transcript, run state, queue, frame order.
// ABOUTME: No DOM and no IO. Unknown events and actions return the same state.

import { stripAnsi } from "../extension-ui/extension-widgets.js";
import { reduceAssistantMessage } from "../session/assistant-message-stream.js";
import {
  applyMessageToTurn,
  closeTurn,
  createTurn,
  eventTime,
  finishWorkStep,
  pushChangedFile,
  pushTurnNotice,
  pushWorkStep,
  toolArgs,
} from "./transcript-turns.js";

/**
 * @typedef {{ id?: string, role?: string, content?: unknown, usage?: unknown }} TranscriptMessage
 * @typedef {{ kind: string, text?: string, status?: string, id?: string, name?: string, output?: string, isError?: boolean, willRetry?: boolean, attempt?: number, seconds?: number, source?: string }} TranscriptNote
 * @typedef {{
 *   target: { workspaceId: string, sessionId: string, cwd: string },
 *   session: { title: string, model: { provider: string, id: string } | null, thinking: string },
 *   transcript: { messages: TranscriptMessage[], streamingId: string | null, notes: TranscriptNote[], turns: import("./transcript-turns.js").Turn[] },
 *   queue: { steering: unknown[], followUp: unknown[] },
 *   status: {
 *     phase: "idle"|"working"|"waiting"|"retrying",
 *     running: boolean,
 *     compacting: boolean,
 *     retry: Record<string, unknown> | null,
 *     keys: Record<string, string>,
 *   },
 *   sync: { sequence: number, snapshotRequired: boolean },
 *   tree: unknown,
 *   ui: { dockTab: string, railPanel: string }
 * }} TranscriptState
 *
 * @typedef {{ workspaceId?: string, sessionId?: string, instanceId?: string }} FrameTarget
 * @typedef {{ target?: FrameTarget | null, sequence?: number }} RuntimeFrame
 * @typedef {{
 *   type?: string,
 *   event?: { type?: string, [key: string]: unknown },
 *   frame?: RuntimeFrame,
 *   messages?: TranscriptMessage[],
 *   sequence?: number,
 *   streaming?: boolean,
 *   target?: Partial<TranscriptState["target"]>,
 *   tree?: unknown,
 * }} SessionAction
 */

/** @returns {TranscriptState} */
export function emptyTranscriptState() {
  return {
    target: { workspaceId: "", sessionId: "", cwd: "" },
    session: { title: "", model: null, thinking: "" },
    transcript: { messages: [], streamingId: null, notes: [], turns: [] },
    queue: { steering: [], followUp: [] },
    status: { phase: "idle", running: false, compacting: false, retry: null, keys: {} },
    sync: { sequence: 0, snapshotRequired: false },
    tree: null,
    ui: { dockTab: "", railPanel: "" },
  };
}

/**
 * @param {FrameTarget} left
 * @param {FrameTarget | null | undefined} right
 */
function sameTarget(left, right) {
  return (
    left.workspaceId === right?.workspaceId &&
    left.sessionId === right?.sessionId &&
    left.instanceId === right?.instanceId
  );
}

/**
 * Host frames are numbered per runtime. A frame that skips a number means
 * events were lost, so the window needs a fresh snapshot.
 * @param {TranscriptState} state
 * @param {RuntimeFrame} frame
 * @param {FrameTarget} target
 * @returns {TranscriptState}
 */
function acceptFrame(state, frame, target) {
  if (!sameTarget(target, frame.target)) return state;
  const sequence = Number(frame.sequence);
  if (!Number.isFinite(sequence) || sequence <= state.sync.sequence) return state;
  if (sequence !== state.sync.sequence + 1) {
    return state.sync.snapshotRequired
      ? state
      : { ...state, sync: { ...state.sync, snapshotRequired: true } };
  }
  return { ...state, sync: { sequence, snapshotRequired: false } };
}

/**
 * @param {TranscriptState} state
 * @param {SessionAction} action
 * @returns {TranscriptState}
 */
function applySnapshot(state, action) {
  const messages = Array.isArray(action.messages) ? action.messages : state.transcript.messages;
  const next = { ...state, transcript: { ...state.transcript, messages, streamingId: null } };
  if (typeof action.sequence !== "number") return next;
  const running = action.streaming === true;
  return {
    ...next,
    status: { ...next.status, running, phase: running ? "working" : "idle" },
    sync: { sequence: action.sequence, snapshotRequired: false },
  };
}

/**
 * A new target starts with no run, no queue, and frame numbering from zero.
 * @param {TranscriptState} state
 * @returns {TranscriptState}
 */
function resetRun(state) {
  return {
    ...state,
    queue: { steering: [], followUp: [] },
    status: { ...state.status, phase: "idle", running: false, compacting: false, retry: null },
    sync: { sequence: 0, snapshotRequired: false },
  };
}

/**
 * @param {TranscriptState} state
 * @param {SessionAction} action
 * @param {FrameTarget} [target] the window's current runtime target, for frame actions
 * @returns {TranscriptState}
 */
export function reduceSession(state, action, target = {}) {
  switch (action?.type) {
    case "rpc":
      return action.event ? reduceTranscript(state, action.event) : state;
    case "frame":
      return action.frame ? acceptFrame(state, action.frame, target) : state;
    case "snapshot":
      return applySnapshot(state, action);
    case "reset":
      return resetRun(state);
    case "session.created":
      return action.target ? { ...state, target: { ...state.target, ...action.target } } : state;
    case "tree":
      return { ...state, tree: action.tree ?? null };
    default:
      return state;
  }
}

/**
 * @param {TranscriptMessage | null | undefined} message
 * @param {string} fallback
 */
function messageId(message, fallback) {
  const id = message && typeof message === "object" ? message.id : "";
  return typeof id === "string" && id ? id : fallback;
}

/**
 * @param {TranscriptState} state
 * @param {TranscriptMessage[]} messages
 * @param {string | null} streamingId
 * @returns {TranscriptState}
 */
function withMessages(state, messages, streamingId) {
  return {
    ...state,
    transcript: { ...state.transcript, messages, streamingId },
  };
}

/**
 * @param {TranscriptState} state
 * @param {TranscriptNote} note
 * @returns {TranscriptState}
 */
function withNote(state, note) {
  return mapOpenTurn(
    {
      ...state,
      transcript: { ...state.transcript, notes: [...state.transcript.notes, note] },
    },
    (turn) => pushTurnNotice(turn, note),
  );
}

/**
 * @param {TranscriptState} state
 * @returns {import("./transcript-turns.js").Turn | null}
 */
function openTurn(state) {
  for (let index = state.transcript.turns.length - 1; index >= 0; index -= 1) {
    const turn = state.transcript.turns[index];
    if (turn.endedAt == null) return turn;
  }
  return null;
}

/**
 * @param {TranscriptState} state
 * @param {(turn: import("./transcript-turns.js").Turn) => import("./transcript-turns.js").Turn} update
 * @returns {TranscriptState}
 */
function mapOpenTurn(state, update) {
  const turns = state.transcript.turns;
  let index = -1;
  for (let cursor = turns.length - 1; cursor >= 0; cursor -= 1) {
    if (turns[cursor].endedAt == null) {
      index = cursor;
      break;
    }
  }
  if (index < 0) return state;
  const next = turns.slice();
  next[index] = update(turns[index]);
  return { ...state, transcript: { ...state.transcript, turns: next } };
}

/**
 * @param {TranscriptState} state
 * @param {Record<string, unknown>} event
 * @returns {TranscriptState}
 */
function beginTurn(state, event) {
  const closed = closeOpen(state, event);
  const model =
    event.model && typeof event.model === "object"
      ? /** @type {{ provider: string, id: string }} */ (event.model)
      : closed.session.model;
  const turn = createTurn(closed.transcript.turns.length, model, eventTime(event));
  return {
    ...closed,
    transcript: { ...closed.transcript, turns: [...closed.transcript.turns, turn] },
  };
}

/**
 * @param {TranscriptState} state
 * @param {Record<string, unknown>} event
 * @returns {TranscriptState}
 */
function closeOpen(state, event) {
  return mapOpenTurn(state, (turn) => closeTurn(turn, eventTime(event)));
}

/**
 * @param {TranscriptState} state
 * @param {TranscriptState["status"]["phase"]} phase
 * @param {Record<string, unknown> | null} [retry]
 * @returns {TranscriptState}
 */
function withPhase(state, phase, retry = state.status.retry) {
  return { ...state, status: { ...state.status, phase, retry } };
}

/**
 * After a retry or a dialog ends, the agent may still be running.
 * @param {TranscriptState} state
 * @param {Record<string, unknown> | null} [retry]
 */
function resumePhase(state, retry) {
  return withPhase(state, state.status.running ? "working" : "idle", retry);
}

/**
 * @param {TranscriptState} state
 * @param {boolean} compacting
 * @returns {TranscriptState}
 */
function withCompacting(state, compacting) {
  return { ...state, status: { ...state.status, compacting } };
}

const WAITING_UI_METHODS = new Set(["select", "confirm", "input", "editor"]);

/**
 * @param {TranscriptState} state
 * @returns {TranscriptState}
 */
function clearSummarizationRetry(state) {
  const notes = state.transcript.notes.filter((note) => note.kind !== "summarization-retry");
  return mapOpenTurn({ ...state, transcript: { ...state.transcript, notes } }, (turn) => ({
    ...turn,
    notices: turn.notices.filter((note) => note.kind !== "summarization-retry"),
  }));
}

/**
 * A call a tool made (codemode). It is drawn on the parent card, not counted as a work step.
 * @param {{ [key: string]: unknown }} event
 */
function isNestedCall(event) {
  return typeof event?.parentToolCallId === "string" && event.parentToolCallId !== "";
}

/**
 * @param {TranscriptState} state
 * @param {string} id
 * @param {Omit<TranscriptNote, "kind" | "id">} patch
 */
function upsertTool(state, id, patch) {
  const notes = state.transcript.notes.slice();
  const index = notes.findIndex((note) => note.kind === "tool" && note.id === id);
  const next = { ...patch, kind: "tool", id };
  if (index < 0) notes.push(next);
  else notes[index] = { ...notes[index], ...next };
  return { ...state, transcript: { ...state.transcript, notes } };
}

/**
 * @param {TranscriptState} state
 * @param {{ type?: string, [key: string]: unknown }} event
 * @returns {TranscriptState}
 */
export function reduceTranscript(state, event) {
  const type = typeof event?.type === "string" ? event.type : "";
  switch (type) {
    case "agent_start":
      return withPhase({ ...state, status: { ...state.status, running: true } }, "working", null);
    case "turn_start":
      return beginTurn(state, event);
    case "turn_end":
      return closeOpen(state, event);
    case "agent_end":
    case "agent_settled": {
      const closed = closeOpen(state, event);
      return withPhase(
        { ...closed, status: { ...closed.status, running: false } },
        "idle",
        state.status.retry,
      );
    }
    case "message_start": {
      const message = /** @type {TranscriptMessage | undefined} */ (event.message);
      const role = message?.role === "user" ? "user" : "assistant";
      let base = state;
      if (!openTurn(base) && base.status.phase === "working") base = beginTurn(base, event);
      const id = messageId(message, `${role}-${base.transcript.messages.length}`);
      const next = { ...(message ?? {}), id, role };
      const stored = withMessages(
        base,
        [...base.transcript.messages, next],
        role === "assistant" ? id : null,
      );
      return mapOpenTurn(stored, (turn) => applyMessageToTurn(turn, next));
    }
    case "message_update": {
      const messages = state.transcript.messages.slice();
      let index = state.transcript.streamingId
        ? messages.findIndex((message) => message.id === state.transcript.streamingId)
        : -1;
      if (index < 0) {
        const id = `stream-${messages.length}`;
        messages.push({ id, role: "assistant", content: [] });
        index = messages.length - 1;
      }
      const current = messages[index];
      const reduced = reduceAssistantMessage(current, event);
      const next = { ...reduced, id: current.id, role: "assistant" };
      messages[index] = next;
      return mapOpenTurn(withMessages(state, messages, current.id ?? null), (turn) =>
        applyMessageToTurn(turn, next),
      );
    }
    case "message_end": {
      const message = /** @type {TranscriptMessage | undefined} */ (event.message);
      const messages = state.transcript.messages.slice();
      const id = messageId(message, state.transcript.streamingId ?? `end-${messages.length}`);
      const index = messages.findIndex((entry) => entry.id === id);
      const next = { ...(message ?? {}), id, role: message?.role ?? "assistant" };
      if (index < 0) messages.push(next);
      else messages[index] = next;
      return mapOpenTurn(withMessages(state, messages, null), (turn) =>
        applyMessageToTurn(turn, next),
      );
    }
    case "tool_execution_start": {
      const id = String(event.toolCallId ?? "");
      const name = String(event.toolName ?? "");
      // A nested end event has no args, so the file a nested edit changes is noted at its start.
      if (isNestedCall(event)) {
        return mapOpenTurn(state, (turn) => pushChangedFile(turn, name, toolArgs(event)));
      }
      return mapOpenTurn(upsertTool(state, id, { name, status: "pending" }), (turn) =>
        pushWorkStep(turn, id, name, toolArgs(event), eventTime(event)),
      );
    }
    case "tool_execution_update":
      if (isNestedCall(event)) return state;
      return upsertTool(state, String(event.toolCallId ?? ""), {
        name: String(event.toolName ?? ""),
        status: "streaming",
        output: typeof event.partialResult === "string" ? event.partialResult : "",
      });
    case "tool_execution_end": {
      if (isNestedCall(event)) return state;
      const id = String(event.toolCallId ?? "");
      const name = String(event.toolName ?? "");
      const noted = upsertTool(state, id, {
        status: "done",
        isError: Boolean(event.isError),
        output: typeof event.result === "string" ? event.result : "",
      });
      return mapOpenTurn(noted, (turn) => {
        const step = turn.work.steps.find((entry) => entry.id === id);
        const withFile = pushChangedFile(
          turn,
          name || step?.name || "",
          step?.args ?? toolArgs(event),
        );
        return finishWorkStep(withFile, id, eventTime(event));
      });
    }
    case "compaction_start":
      return withCompacting(withNote(state, { kind: "compaction", status: "running" }), true);
    case "compaction_end":
      return withCompacting(
        withNote(state, {
          kind: "compaction",
          status: event.error || event.errorMessage || event.aborted ? "failed" : "completed",
          text: String(event.errorMessage || event.error || ""),
        }),
        false,
      );
    case "queue_update":
      return {
        ...state,
        queue: {
          steering: Array.isArray(event.steering) ? event.steering.slice() : [],
          followUp: Array.isArray(event.followUp) ? event.followUp.slice() : [],
        },
      };
    case "auto_retry_start":
      return withPhase(state, "retrying", { ...event, status: "waiting" });
    case "auto_retry_end":
      return resumePhase(state, null);
    case "extension_error":
      return withNote(state, { kind: "error", text: String(event.error || "") });
    case "summarization_retry_scheduled":
      return withNote(state, {
        kind: "summarization-retry",
        status: "running",
        attempt: Number(event.attempt) || 1,
        seconds: Math.max(0, Math.round((Number(event.delayMs) || 0) / 1000)),
      });
    case "summarization_retry_attempt_start":
      return withNote(state, {
        kind: "summarization-retry",
        status: "running",
        source: String(event.source || "compaction"),
      });
    case "summarization_retry_finished":
      return clearSummarizationRetry(state);
    case "session_info_changed":
      return { ...state, session: { ...state.session, title: String(event.name ?? "") } };
    case "extension_ui_resolved":
      return resumePhase(state);
    case "extension_ui_request": {
      const next = extensionStatus(state, event);
      const method = typeof event.method === "string" ? event.method : "";
      return WAITING_UI_METHODS.has(method) ? withPhase(next, "waiting") : next;
    }
    default:
      if (type.startsWith("auto_retry_")) return withPhase(state, "retrying", { ...event });
      return state;
  }
}

/**
 * @param {TranscriptState} state
 * @param {Record<string, unknown>} event
 * @returns {TranscriptState}
 */
function extensionStatus(state, event) {
  if (event.method !== "setStatus") return state;
  const key = typeof event.statusKey === "string" ? event.statusKey.trim() : "";
  if (!key) return state;
  const text = stripAnsi(event.statusText).trim();
  const keys = { ...state.status.keys };
  if (text) keys[key] = text;
  else delete keys[key];
  return { ...state, status: { ...state.status, keys } };
}
