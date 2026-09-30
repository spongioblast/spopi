// ABOUTME: Steering and follow-up delivery selects for General settings.
// ABOUTME: A change writes settings.json and the live session.

import { t } from "../i18n/i18n.js";
import { row, select } from "../ui/settings-controls.js";
import { randomId } from "../utils/random-id.js";

const OPTION_KEYS = { "one-at-a-time": "settings.queueOne", all: "settings.queueAll" };

function queueOptions() {
  return Object.entries(OPTION_KEYS).map(([value, key]) => ({ value, label: t(key) }));
}

/** @param {HTMLSelectElement} node */
function tagOptionKeys(node) {
  for (const option of node.options) {
    const key = OPTION_KEYS[/** @type {keyof typeof OPTION_KEYS} */ (option.value)];
    if (key) option.dataset.i18n = key;
  }
  return node;
}

/**
 * @param {{
 *   configGateway?: { call: (op: string, params?: Record<string, unknown>) => Promise<{ ok?: boolean, data?: { steeringMode?: string, followUpMode?: string } }> } | null,
 *   runtime?: { request: (message: Record<string, unknown>, target: unknown, options?: Record<string, unknown>) => Promise<unknown> } | null,
 *   getTarget?: (() => unknown) | null,
 * } | null | undefined} deps
 */
export function queueModeControls(deps) {
  const options = queueOptions();
  const steering = select({
    id: "queue-steering-mode",
    label: "While Pi is working, new messages",
    options,
    value: "one-at-a-time",
    onChange: (mode) => void applyQueueMode(deps, "steering", mode),
  });
  const followUp = select({
    id: "queue-follow-up-mode",
    label: "Follow-up messages",
    options,
    value: "one-at-a-time",
    onChange: (mode) => void applyQueueMode(deps, "followUp", mode),
  });
  tagOptionKeys(steering);
  tagOptionKeys(followUp);
  void loadQueueModes(deps, steering, followUp);
  return [
    row({
      id: "setting-steering-mode",
      label: "While Pi is working, new messages",
      labelKey: "settings.steeringMode",
      control: steering,
    }),
    row({
      id: "setting-follow-up-mode",
      label: "Follow-up messages",
      labelKey: "settings.followUpMode",
      control: followUp,
    }),
  ];
}

/**
 * @param {Parameters<typeof queueModeControls>[0]} deps
 * @param {HTMLSelectElement} steering
 * @param {HTMLSelectElement} followUp
 */
async function loadQueueModes(deps, steering, followUp) {
  if (!deps?.configGateway) return;
  const response = await deps.configGateway.call("get_queue_modes", {});
  if (!response?.ok || !response.data) return;
  if (response.data.steeringMode) steering.value = response.data.steeringMode;
  if (response.data.followUpMode) followUp.value = response.data.followUpMode;
}

/**
 * @param {Parameters<typeof queueModeControls>[0]} deps
 * @param {"steering" | "followUp"} kind
 * @param {string} mode
 */
async function applyQueueMode(deps, kind, mode) {
  await deps?.configGateway?.call("set_queue_mode", { kind, mode });
  const type = kind === "followUp" ? "set_follow_up_mode" : "set_steering_mode";
  await deps?.runtime?.request?.({ type, mode }, deps.getTarget?.() ?? null, {
    idempotencyKey: randomId(),
  });
}
