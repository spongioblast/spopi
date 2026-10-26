// ABOUTME: Stop = clear_queue, abort, abort_bash, in that order; returns cleared text.
// ABOUTME: Queue edits (cancel, reorder, interrupt) clear Pi's queue and re-send it in order.

/**
 * @param {{
 *   response?: { data?: { steering?: unknown[], followUp?: unknown[] } },
 *   data?: { steering?: unknown[], followUp?: unknown[] },
 * } | null | undefined} frame
 */
function queueLists(frame) {
  /** @type {{ steering?: unknown[], followUp?: unknown[] }} */
  const body = frame?.response?.data ?? frame?.data ?? {};
  return {
    steering: [...(body.steering || [])],
    followUp: [...(body.followUp || [])],
  };
}

/**
 * @param {{
 *   runtime: {
 *     request: (msg: unknown, target?: unknown, opts?: unknown) => Promise<unknown>,
 *   },
 *   target?: unknown,
 *   onQueueCleared?: (text: string) => void,
 * }} options
 */
export async function stopRun({ runtime, target, onQueueCleared }) {
  const cleared = await runtime.request({ type: "clear_queue" }, target).catch(() => null);
  const { steering, followUp } = queueLists(
    /** @type {{ response?: { data?: { steering?: unknown[], followUp?: unknown[] } }, data?: { steering?: unknown[], followUp?: unknown[] } } | null} */ (
      cleared
    ),
  );
  const texts = [...steering, ...followUp];
  if (texts.length) onQueueCleared?.(texts.join("\n\n"));
  await runtime.request({ type: "abort" }, target).catch(() => null);
  await runtime.request({ type: "abort_bash" }, target).catch(() => null);
  return texts;
}

/**
 * @param {unknown[]} messages
 * @param {{ index?: number, message?: unknown } | null | undefined} item
 */
function withoutItem(messages, item) {
  const next = [...messages];
  if (!item) return next;
  const at = item.index;
  const index =
    typeof at === "number" && Number.isInteger(at) && next[at] === item.message
      ? at
      : next.indexOf(item.message);
  if (index >= 0) next.splice(index, 1);
  return next;
}

/**
 * @param {{
 *   runtime: {
 *     request: (msg: unknown, target?: unknown, opts?: unknown) => Promise<unknown>,
 *   },
 *   target?: unknown,
 *   item?: { kind?: string, index?: number, message?: unknown },
 *   randomId: () => string,
 * }} options
 */
export async function cancelQueuedMessage({ runtime, target, item, randomId }) {
  const cleared = await runtime.request({ type: "clear_queue" }, target);
  const lists = queueLists(
    /** @type {{ response?: { data?: { steering?: unknown[], followUp?: unknown[] } }, data?: { steering?: unknown[], followUp?: unknown[] } } | null} */ (
      cleared
    ),
  );
  const steering = item?.kind === "steer" ? withoutItem(lists.steering, item) : lists.steering;
  const followUp = item?.kind === "follow_up" ? withoutItem(lists.followUp, item) : lists.followUp;
  await requeue(runtime, target, steering, followUp, randomId);
}

/**
 * @param {{ request: (msg: unknown, target?: unknown, opts?: unknown) => Promise<unknown> }} runtime
 * @param {unknown} target
 * @param {unknown[]} steering
 * @param {unknown[]} followUp
 * @param {() => string} randomId
 */
async function requeue(runtime, target, steering, followUp, randomId) {
  for (const message of steering) {
    await runtime.request({ type: "steer", message }, target, { idempotencyKey: randomId() });
  }
  for (const message of followUp) {
    await runtime.request({ type: "follow_up", message }, target, { idempotencyKey: randomId() });
  }
}

/**
 * Moves one queued message within its kind. Pi has no reorder command, so the queue is
 * taken and sent back in the new order.
 * @param {{
 *   runtime: { request: (msg: unknown, target?: unknown, opts?: unknown) => Promise<unknown> },
 *   target?: unknown,
 *   item: { kind?: string, index?: number, message?: unknown },
 *   to: number,
 *   randomId: () => string,
 * }} options
 */
export async function reorderQueue({ runtime, target, item, to, randomId }) {
  const lists = queueLists(
    /** @type {Parameters<typeof queueLists>[0]} */ (
      await runtime.request({ type: "clear_queue" }, target)
    ),
  );
  const list = item.kind === "steer" ? lists.steering : lists.followUp;
  const from =
    typeof item.index === "number" && list[item.index] === item.message
      ? item.index
      : list.indexOf(item.message);
  if (from >= 0 && to >= 0 && to < list.length && from !== to) {
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);
  }
  await requeue(runtime, target, lists.steering, lists.followUp, randomId);
}

/**
 * Send now: stop the running reply and send this message at once. Pi drops the
 * unfinished reply from context (stopReason "aborted"); finished steps stay.
 * @param {{
 *   runtime: { request: (msg: unknown, target?: unknown, opts?: unknown) => Promise<unknown> },
 *   target?: unknown,
 *   item: { kind?: string, index?: number, message?: unknown },
 *   randomId: () => string,
 *   waitSettled: () => Promise<void>,
 *   onFailed?: (text: string) => void,
 * }} options
 */
export async function interruptWithQueued({
  runtime,
  target,
  item,
  randomId,
  waitSettled,
  onFailed,
}) {
  const message = String(item.message ?? "").trim();
  if (!message) return;
  const lists = queueLists(
    /** @type {Parameters<typeof queueLists>[0]} */ (
      await runtime.request({ type: "clear_queue" }, target)
    ),
  );
  const steering = item.kind === "steer" ? withoutItem(lists.steering, item) : lists.steering;
  const followUp = item.kind === "follow_up" ? withoutItem(lists.followUp, item) : lists.followUp;
  // Pi already delivered it between the render and the click: do not send it twice.
  if (steering.length + followUp.length === lists.steering.length + lists.followUp.length) {
    await requeue(runtime, target, steering, followUp, randomId);
    return;
  }
  await runtime.request({ type: "abort" }, target).catch(() => null);
  if (await isStreaming(runtime, target)) await waitSettled();
  try {
    await runtime.request({ type: "prompt", message }, target, { idempotencyKey: randomId() });
  } catch (error) {
    const unsent = await requeue(runtime, target, steering, followUp, randomId).then(
      () => [],
      () => [...steering, ...followUp],
    );
    onFailed?.([message, ...unsent].map(String).join("\n\n"));
    throw error;
  }
  await requeue(runtime, target, steering, followUp, randomId);
}

/**
 * @param {{ request: (msg: unknown, target?: unknown) => Promise<unknown> }} runtime
 * @param {unknown} target
 */
async function isStreaming(runtime, target) {
  const frame =
    /** @type {{ response?: { data?: { isStreaming?: boolean } }, data?: { isStreaming?: boolean } } | null} */ (
      await runtime.request({ type: "get_state" }, target).catch(() => null)
    );
  return Boolean((frame?.response?.data ?? frame?.data)?.isStreaming);
}
