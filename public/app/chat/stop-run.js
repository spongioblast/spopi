// ABOUTME: Stop = clear_queue, abort, abort_bash, in that order; returns cleared text.
// ABOUTME: Cancelling one queued row clears the queue and re-sends the rest.

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
  for (const message of steering) {
    await runtime.request({ type: "steer", message }, target, { idempotencyKey: randomId() });
  }
  for (const message of followUp) {
    await runtime.request({ type: "follow_up", message }, target, { idempotencyKey: randomId() });
  }
}
