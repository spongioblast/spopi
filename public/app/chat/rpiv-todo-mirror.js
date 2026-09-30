// ABOUTME: Mirrors an extension todo widget into a panel beside the chat.
// ABOUTME: It rebuilds the list from messages and from todo command notifications.

import { t } from "../i18n/i18n.js";

/**
 * @typedef {"pending" | "in_progress" | "completed" | "deleted"} RpivTodoStatus
 * @typedef {{
 *   id: number,
 *   subject: string,
 *   status: RpivTodoStatus,
 *   activeForm?: string,
 *   blockedBy?: number[],
 * }} RpivTodoTask
 * @typedef {{ tasks: RpivTodoTask[], nextId: number }} RpivTodoState
 * @typedef {{ role?: string, toolName?: string, details?: unknown }} RpivTodoSourceMessage
 */

const TODO_TOOL_NAME = "todo";
const TODO_WIDGET_KEY = "rpiv-todos";
const EMPTY_STATE = /** @type {RpivTodoState} */ (
  Object.freeze({
    tasks: Object.freeze(/** @type {RpivTodoTask[]} */ ([])),
    nextId: 1,
  })
);
/** @type {Record<RpivTodoStatus, string>} */
const STATUS_LABELS = {
  pending: "pending",
  in_progress: "in progress",
  completed: "completed",
  deleted: "deleted",
};
/** @type {Record<RpivTodoStatus, string>} */
const STATUS_GLYPHS = {
  pending: "○",
  in_progress: "◐",
  completed: "✓",
  deleted: "✗",
};

/** @param {{ method?: string, widgetKey?: string } | null | undefined} request */
export function isRpivTodoWidgetRequest(request) {
  return request?.method === "setWidget" && request.widgetKey === TODO_WIDGET_KEY;
}

/** @param {unknown} message */
export function isRpivTodoCommandNotify(message) {
  const text = String(message ?? "");
  return (
    text === "No todos yet. Ask the agent to add some!" ||
    /^\d+\/\d+ completed/m.test(text) ||
    text.includes("── Pending ──") ||
    text.includes("── In Progress ──") ||
    text.includes("── Completed ──")
  );
}

/**
 * @param {unknown} value
 * @returns {value is RpivTodoState}
 */
export function isRpivTodoDetails(value) {
  if (!value || typeof value !== "object") return false;
  const details = /** @type {Record<string, unknown>} */ (value);
  if (!Array.isArray(details.tasks)) return false;
  if (typeof details.nextId !== "number") return false;
  return details.tasks.every(isRpivTodoTask);
}

/**
 * @param {unknown} value
 * @returns {value is RpivTodoTask}
 */
function isRpivTodoTask(value) {
  if (!value || typeof value !== "object") return false;
  const task = /** @type {Record<string, unknown>} */ (value);
  return (
    typeof task.id === "number" &&
    typeof task.subject === "string" &&
    typeof task.status === "string" &&
    ["pending", "in_progress", "completed", "deleted"].includes(task.status)
  );
}

/** @param {RpivTodoSourceMessage[]} [messages] */
export function replayRpivTodoFromMessages(messages = []) {
  let state = EMPTY_STATE;
  for (const message of messages) {
    if (message?.role !== "toolResult") continue;
    if (message.toolName !== TODO_TOOL_NAME) continue;
    if (!isRpivTodoDetails(message.details)) continue;
    state = cloneTodoState(message.details);
  }
  return state;
}

/**
 * @param {RpivTodoState} details
 * @returns {RpivTodoState}
 */
function cloneTodoState(details) {
  return {
    tasks: details.tasks.map((task) => ({ ...task })),
    nextId: details.nextId,
  };
}

export class RpivTodoMirrorPanel {
  #element;
  /** @type {RpivTodoState} */
  #state = EMPTY_STATE;

  /** @param {{ container?: Element | null }} options */
  constructor({ container }) {
    this.#element = document.createElement("section");
    this.#element.className = "rpiv-todo-panel hidden is-collapsed";
    this.#element.setAttribute("aria-label", t("features.todos.label"));
    container?.insertBefore(this.#element, container.querySelector("form"));
  }

  /** @param {RpivTodoSourceMessage[]} messages */
  hydrateFromMessages(messages) {
    this.setState(replayRpivTodoFromMessages(messages));
  }

  /** @param {{ details?: unknown } | null | undefined} result */
  applyToolResult(result) {
    if (!isRpivTodoDetails(result?.details)) return false;
    this.setState(cloneTodoState(result.details));
    return true;
  }

  /** @param {RpivTodoState | null | undefined} state */
  setState(state) {
    this.#state = state ?? EMPTY_STATE;
    this.#render();
  }

  clear() {
    this.setState(EMPTY_STATE);
  }

  /** True when the panel actually renders something the user can look at. */
  get hasVisibleTasks() {
    return this.#state.tasks.some((task) => task.status !== "deleted");
  }

  expand() {
    this.#element.classList.add("is-hover-expanded");
  }

  #render() {
    const visibleTasks = this.#state.tasks.filter((task) => task.status !== "deleted");
    if (visibleTasks.length === 0) {
      this.#element.classList.add("hidden");
      this.#element.replaceChildren();
      return;
    }

    const completed = visibleTasks.filter((task) => task.status === "completed").length;
    const total = visibleTasks.length;
    const hasActive = visibleTasks.some(
      (task) => task.status === "pending" || task.status === "in_progress",
    );

    const header = document.createElement("div");
    header.className = "rpiv-todo-panel__header";
    const titleGroup = document.createElement("div");
    titleGroup.className = "rpiv-todo-panel__titleGroup";
    const dot = document.createElement("span");
    dot.className = `rpiv-todo-panel__dot ${hasActive ? "is-active" : ""}`;
    dot.textContent = hasActive ? "●" : "○";
    const title = document.createElement("span");
    title.className = "rpiv-todo-panel__title";
    title.textContent = t("features.todos.label");
    titleGroup.append(dot, title);
    const summary = document.createElement("span");
    summary.className = "rpiv-todo-panel__summary";
    summary.textContent = `${completed}/${total}`;
    summary.dataset.expandedText = `${completed}/${total} complete`;
    header.append(titleGroup, summary);

    const displayTasks = selectDisplayTasks(visibleTasks);
    const list = document.createElement("ol");
    list.className = "rpiv-todo-panel__list";
    for (const task of displayTasks) {
      list.append(renderTask(task, shouldShowIds(visibleTasks)));
    }
    const children = [header, list];
    if (visibleTasks.length > displayTasks.length) {
      const more = document.createElement("div");
      more.className = "rpiv-todo-panel__more";
      more.textContent = `+${visibleTasks.length - displayTasks.length} more`;
      children.push(more);
    }

    this.#element.classList.toggle("is-complete", !hasActive);
    this.#element.replaceChildren(...children);
    this.#element.classList.remove("hidden");
  }
}

/** @param {RpivTodoTask[]} tasks */
function shouldShowIds(tasks) {
  return tasks.some((task) => Array.isArray(task.blockedBy) && task.blockedBy.length > 0);
}

/**
 * @param {RpivTodoTask[]} tasks
 * @returns {RpivTodoTask[]}
 */
function selectDisplayTasks(tasks) {
  const maxRows = 5;
  const active = tasks.filter((task) => task.status !== "completed");
  const completed = tasks.filter((task) => task.status === "completed");
  return [...active, ...completed].slice(0, maxRows);
}

/**
 * @param {RpivTodoTask} task
 * @param {boolean} showId
 */
function renderTask(task, showId) {
  const item = document.createElement("li");
  item.className = `rpiv-todo-panel__task is-${task.status.replace("_", "-")}`;

  const glyph = document.createElement("span");
  glyph.className = "rpiv-todo-panel__glyph";
  glyph.textContent = STATUS_GLYPHS[task.status] ?? "•";

  const text = document.createElement("span");
  text.className = "rpiv-todo-panel__text";
  text.textContent = `${showId ? `#${task.id} ` : ""}${task.subject}`;

  item.append(glyph, text);

  if (task.status === "in_progress" && task.activeForm) {
    const active = document.createElement("span");
    active.className = "rpiv-todo-panel__meta";
    active.textContent = `(${task.activeForm})`;
    item.append(active);
  }

  if (Array.isArray(task.blockedBy) && task.blockedBy.length > 0) {
    const blocked = document.createElement("span");
    blocked.className = "rpiv-todo-panel__meta";
    blocked.textContent = `⛓ ${task.blockedBy.map((id) => `#${id}`).join(",")}`;
    item.append(blocked);
  }

  item.title = STATUS_LABELS[task.status] ?? task.status;
  return item;
}
