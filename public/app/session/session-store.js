// ABOUTME: Holds the session view state and applies pure reductions to it.
// ABOUTME: Subscribers hear every change; the store does not render.

/**
 * @typedef {{ workspaceId?: string, sessionId?: string, instanceId?: string }} SessionTarget
 * @typedef {{
 *   target: SessionTarget,
 *   sequence: number,
 *   snapshotRequired: boolean,
 *   lifecycle: string,
 *   activeLeafId: string | null,
 *   messages: Array<object>,
 *   streaming: object | null,
 *   tools: Array<object>,
 *   queue: { steering: ReadonlyArray<unknown>, followUp: ReadonlyArray<unknown> },
 *   retry: object | null,
 *   compaction: object | null,
 *   dialogs: Array<object>,
 *   model: object | null,
 *   thinkingLevel: string | null,
 *   contextUsage: object | null,
 *   cost: number,
 * }} SessionState
 */

const EMPTY_QUEUE = Object.freeze({ steering: Object.freeze([]), followUp: Object.freeze([]) });

/**
 * @param {SessionTarget} target
 * @returns {SessionState}
 */
export function createSessionStore(target) {
  return {
    target: { ...target },
    sequence: 0,
    snapshotRequired: false,
    lifecycle: "starting",
    activeLeafId: null,
    messages: [],
    streaming: null,
    tools: [],
    queue: EMPTY_QUEUE,
    retry: null,
    compaction: null,
    dialogs: [],
    model: null,
    thinkingLevel: null,
    contextUsage: null,
    cost: 0,
  };
}

/**
 * @param {SessionTarget} left
 * @param {SessionTarget | null | undefined} right
 * @returns {boolean}
 */
function sameTarget(left, right) {
  return (
    left.workspaceId === right?.workspaceId &&
    left.sessionId === right?.sessionId &&
    left.instanceId === right?.instanceId
  );
}

/**
 * @param {SessionState} state
 * @param {{
 *   type?: string,
 *   steering?: Array<unknown>,
 *   followUp?: Array<unknown>,
 *   result?: unknown,
 * } & Record<string, unknown>} event
 * @returns {SessionState}
 */
function applyRuntimeEvent(state, event) {
  switch (event.type) {
    case "agent_start":
      return { ...state, lifecycle: "working" };
    case "agent_settled":
    case "agent_end":
      return { ...state, lifecycle: "idle" };
    case "queue_update":
      return {
        ...state,
        queue: {
          steering: [...(event.steering ?? [])],
          followUp: [...(event.followUp ?? [])],
        },
      };
    case "compaction_start":
      return { ...state, compaction: { status: "running" } };
    case "compaction_end":
      return { ...state, compaction: { status: "completed", result: event.result ?? null } };
    case "auto_retry_start":
      return { ...state, retry: { status: "waiting", ...event } };
    case "auto_retry_end":
      return { ...state, retry: { status: "completed", ...event } };
    case "extension_ui_request":
      return { ...state, dialogs: [...state.dialogs, event] };
    default:
      return state;
  }
}

/**
 * @param {SessionState} state
 * @param {{
 *   type?: string,
 *   target?: SessionTarget | null,
 *   sequence?: number,
 *   state?: Partial<SessionState>,
 *   event?: Parameters<typeof applyRuntimeEvent>[1],
 * }} action
 * @returns {SessionState}
 */
export function reduceSessionState(state, action) {
  if (!sameTarget(state.target, action.target)) return state;
  if (action.type === "runtime_snapshot") {
    return {
      ...state,
      ...structuredClone(action.state),
      target: state.target,
      sequence: /** @type {number} */ (action.sequence),
      snapshotRequired: false,
    };
  }
  if (action.type !== "runtime_event") return state;
  const sequence = /** @type {number} */ (action.sequence);
  if (sequence <= state.sequence) return state;
  if (sequence !== state.sequence + 1) {
    return state.snapshotRequired ? state : { ...state, snapshotRequired: true };
  }
  return {
    ...applyRuntimeEvent(
      state,
      /** @type {Parameters<typeof applyRuntimeEvent>[1]} */ (action.event),
    ),
    sequence,
    snapshotRequired: false,
  };
}
