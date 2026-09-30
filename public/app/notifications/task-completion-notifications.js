// ABOUTME: Sends an OS notification when a turn finishes and the window is unfocused.
// ABOUTME: The host command is the only path that displays it.

import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { extractRuntimeEventError } from "../session/assistant-error.js";
import { uiStore } from "../storage/ui-store.js";

const SETTINGS_KEY = "ui.settings.task-notifications";

/**
 * @typedef {{ instanceId?: string | null, workspaceId?: string | null, sessionId?: string | null }} TaskTarget
 * @param {unknown} [target]
 * @returns {TaskTarget}
 */
function describeTarget(target = {}) {
  const record = target && typeof target === "object" ? /** @type {TaskTarget} */ (target) : {};
  return {
    instanceId: record.instanceId ?? null,
    workspaceId: record.workspaceId ?? null,
    sessionId: record.sessionId ?? null,
  };
}

/**
 * @param {unknown} [target]
 * @returns {string | null}
 */
function targetKey(target = {}) {
  const record = target && typeof target === "object" ? /** @type {TaskTarget} */ (target) : {};
  return record.instanceId || record.sessionId || null;
}

/**
 * @param {{
 *   invoke?: (command: string, args: Record<string, unknown>) => Promise<unknown>,
 *   logger?: Pick<Console, "warn">,
 * }} [options]
 */
export function createNativeTaskNotificationSender({ invoke, logger = console } = {}) {
  /**
   * @param {{ title?: string, body?: string, target?: TaskTarget | null }} [notice]
   */
  return async ({ title, body, target } = {}) => {
    if (!invoke) {
      logger.warn("[Notifications] native invoke is unavailable");
      return;
    }
    if (!target?.workspaceId || !target?.sessionId) {
      logger.warn(
        "[Notifications] native notification skipped: incomplete target",
        describeTarget(target),
      );
      return;
    }
    await invoke("show_task_completion_notification", {
      title,
      body,
      workspaceId: target.workspaceId,
      sessionId: target.sessionId,
    });
  };
}

/**
 * @typedef {{ name?: string, firstMessage?: string }} TaskSummary
 * @param {{
 *   storage?: { getItem?: (key: string) => string | null },
 *   notificationApi?: {
 *     isPermissionGranted: () => Promise<boolean>,
 *     requestPermission: () => Promise<string>,
 *     sendNotification: (notification: { title: string, body?: string }) => unknown,
 *   },
 *   resolveTask?: (target: unknown) => TaskSummary | null | undefined,
 *   title?: (task: TaskSummary | null | undefined, error: string | null | undefined) => string,
 *   body?: (task: TaskSummary | null | undefined, error: string | null | undefined) => string,
 *   showNotification?: (notification: unknown) => unknown,
 *   onError?: (error: unknown) => void,
 *   logger?: Pick<Console, "warn">,
 * }} [options]
 */
export function createTaskCompletionNotifications({
  storage = uiStore,
  notificationApi = /** @type {{
    isPermissionGranted: () => Promise<boolean>,
    requestPermission: () => Promise<string>,
    sendNotification: (notification: { title: string, body?: string }) => unknown,
  }} */ ({ isPermissionGranted, requestPermission, sendNotification }),
  resolveTask = () => null,
  title = (task, error) =>
    task?.name || task?.firstMessage || (error ? "Task failed" : "Task completed"),
  body = (_task, error) => error || "Your task has finished.",
  showNotification = (notification) =>
    notificationApi.sendNotification(
      /** @type {{ title: string, body?: string }} */ (notification),
    ),
  onError = (error) => console.warn("[Notifications] Failed to show notification:", error),
  logger = console,
} = {}) {
  const runningTargets = new Set();

  const enabled = () => {
    const read = storage?.getItem;
    return typeof read === "function" ? read(SETTINGS_KEY) !== "false" : true;
  };

  /**
   * @param {unknown} target
   * @param {string | null | undefined} [error]
   */
  async function showCompletion(target, error = null) {
    const notificationTarget = describeTarget(target);
    if (!enabled()) {
      return;
    }
    let granted = await notificationApi.isPermissionGranted();
    if (!granted) {
      const permission = await notificationApi.requestPermission();
      granted = permission === "granted";
    }
    if (!granted) {
      logger.warn("[Notifications] completion skipped: permission denied", notificationTarget);
      return;
    }
    const task = resolveTask(target);
    await showNotification({
      title: title(task, error),
      body: body(task, error),
      target,
      task,
      error,
    });
  }

  /** @param {unknown} frame */
  function handleRuntimeFrame(frame) {
    if (!frame || typeof frame !== "object") return;
    const eventFrame =
      /** @type {{ type?: string, target?: TaskTarget, event?: { type?: string } }} */ (frame);
    if (eventFrame.type !== "runtime_event") return;
    const key = targetKey(eventFrame.target);
    if (!key) {
      logger.warn("[Notifications] runtime event skipped: target has no key", {
        eventType: eventFrame.event?.type ?? null,
        ...describeTarget(eventFrame.target),
      });
      return;
    }
    if (eventFrame.event?.type === "agent_start") {
      runningTargets.add(key);
      return;
    }
    if (eventFrame.event?.type !== "agent_settled" && eventFrame.event?.type !== "agent_end")
      return;
    if (!runningTargets.delete(key)) {
      logger.warn("[Notifications] completion skipped: no matching agent start", { key });
      return;
    }
    const error = extractRuntimeEventError(eventFrame.event);
    void showCompletion(eventFrame.target, error).catch(onError);
  }

  return { handleRuntimeFrame };
}
