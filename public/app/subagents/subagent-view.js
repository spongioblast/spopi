// ABOUTME: One subagent's conversation as a center tab, read through pi-subagents' inspect command.
// ABOUTME: It refreshes while the child runs; steer and stop go back to pi-subagents as slash commands.

import { centerSubagentOpen, setCenterSubagent } from "../editor/center-mode.js";
import { leaveLeadTab, setLeadTab } from "../editor/lead-tab.js";
import { el } from "../ui/dom.js";
import { formatDuration } from "../ui/formatters.js";
import { inspectCommand, isLive, steerCommand, stopCommand } from "./subagent-feed.js";

/**
 * @typedef {import("./subagent-feed.js").SubagentTarget} SubagentTarget
 * @typedef {import("./subagent-feed.js").SubagentNode} SubagentNode
 * @typedef {import("./subagent-feed.js").SubagentInspectReply} SubagentInspectReply
 */

const REFRESH_MS = 2500;
const PANE_ID = "spopi-subagent";

/** @type {(command: string) => unknown} */
let runCommand = () => {};
/** @type {(key: string, params?: Record<string, unknown>) => string} */
let t = (key) => key;

/** @type {SubagentTarget | null} */
let target = null;
/** @type {SubagentInspectReply | null} */
let reply = null;
let pendingId = "";
let requestCount = 0;
/** @type {ReturnType<typeof setInterval> | 0} */
let timer = 0;
/** @type {SubagentInspectReply | null} */
let paintedReply = null;

/**
 * @param {{ run: (command: string) => unknown, t: (key: string, params?: Record<string, unknown>) => string }} options
 */
export function configureSubagentView(options) {
  runCommand = options.run;
  t = options.t;
}

export function subagentPaneElement() {
  return document.getElementById(PANE_ID);
}

/**
 * The transcript pane sits beside Review in the center column.
 * @param {ParentNode | null | undefined} center
 */
export function ensureSubagentHost(center) {
  if (subagentPaneElement() || !center || !("append" in center)) return;
  center.append(el("section", { class: "spopi-subagent", id: PANE_ID }));
}

/** @param {SubagentTarget} next */
export function openSubagent(next) {
  const same = target && target.runId === next.runId && target.childId === next.childId;
  target = next;
  if (!same) reply = null;
  showSubagent();
  refresh();
}

function showSubagent() {
  if (!target) return;
  leaveLeadTab("subagent");
  setCenterSubagent(true);
  document.body.classList.add("subagent-open");
  syncTab();
  schedule();
  document.dispatchEvent(new CustomEvent("spopi-center-repaint"));
}

function stepAside() {
  if (!centerSubagentOpen()) return;
  setCenterSubagent(false);
  document.body.classList.remove("subagent-open");
  subagentPaneElement()?.classList.remove("is-visible");
  schedule();
  syncTab();
  document.dispatchEvent(new CustomEvent("spopi-center-repaint"));
}

/** A session switch closes the tab: the child belongs to the session that started it. */
export function resetSubagentView() {
  if (target) closeSubagent();
}

function closeSubagent() {
  target = null;
  reply = null;
  setCenterSubagent(false);
  document.body.classList.remove("subagent-open");
  const pane = subagentPaneElement();
  pane?.classList.remove("is-visible");
  if (pane) pane.dataset.child = "";
  schedule();
  setLeadTab("subagent", null);
  document.dispatchEvent(new CustomEvent("spopi-center-repaint"));
}

function syncTab() {
  if (!target) return;
  setLeadTab("subagent", {
    label: target.node.label,
    icon: "bot",
    active: centerSubagentOpen(),
    onSelect: showSubagent,
    onClose: closeSubagent,
    onLeave: stepAside,
  });
}

/** Refresh while the child runs and its tab is in front; one last read happens when it ends. */
function schedule() {
  const want = Boolean(target && centerSubagentOpen() && isLive(target.node.state));
  if (want && !timer) timer = setInterval(refresh, REFRESH_MS);
  if (!want && timer) {
    clearInterval(timer);
    timer = 0;
  }
}

function refresh() {
  if (!target) return;
  requestCount += 1;
  pendingId = `spopi${requestCount}`;
  void runCommand(inspectCommand(pendingId, target.runId, target.childId));
}

/**
 * The strip's latest snapshot keeps the tab's state and time current.
 * @param {SubagentNode[]} runs
 */
export function noteSubagentRuns(runs) {
  if (!target) return;
  const run = runs.find((item) => item.id === target?.runId);
  const node = !run
    ? null
    : target.childId && run.children.length > 1
      ? run.children.find((child) => child.id === target?.childId)
      : run;
  if (!node) return;
  const ended = isLive(target.node.state) && !isLive(node.state);
  target = { ...target, node };
  schedule();
  syncTab();
  if (ended) refresh();
  const pane = visiblePane();
  if (pane) paintChrome(pane);
}

/** @param {SubagentInspectReply} next */
export function applySubagentInspect(next) {
  if (next.requestId !== pendingId) return;
  reply = next;
  const pane = visiblePane();
  if (pane) paintBody(pane);
}

function visiblePane() {
  const pane = subagentPaneElement();
  if (!(pane instanceof HTMLElement) || !target || !centerSubagentOpen()) return null;
  return pane;
}

/** The header and steer box are built once per child, so typing survives each refresh. */
export function paintSubagent() {
  const pane = visiblePane();
  if (!pane || !target) return;
  pane.classList.add("is-visible");
  const key = `${target.runId}:${target.childId || ""}`;
  if (pane.dataset.child !== key) {
    pane.dataset.child = key;
    paintedReply = null;
    pane.replaceChildren(
      el("header", { class: "subagent-view-head" }),
      el("div", { class: "subagent-view-body" }),
      steerForm(),
    );
  }
  paintChrome(pane);
  paintBody(pane);
}

/** @param {HTMLElement} pane */
function paintChrome(pane) {
  pane.querySelector(".subagent-view-head")?.replaceWith(head());
  const form = pane.querySelector(".subagent-steer");
  if (form instanceof HTMLElement) form.hidden = !isLive(target?.node.state);
}

/**
 * Only a new reply repaints the transcript; tool results the reader opened stay open.
 * @param {HTMLElement} pane
 */
function paintBody(pane) {
  const body = pane.querySelector(".subagent-view-body");
  if (!(body instanceof HTMLElement)) return;
  if (body.childElementCount > 0 && paintedReply === reply) return;
  paintedReply = reply;
  const pinned = body.scrollHeight - body.scrollTop - body.clientHeight < 24;
  const open = new Set(
    [...body.querySelectorAll("details")].flatMap((node, index) =>
      node instanceof HTMLDetailsElement && node.open ? [index] : [],
    ),
  );
  body.replaceChildren(...bodyParts());
  [...body.querySelectorAll("details")].forEach((node, index) => {
    if (node instanceof HTMLDetailsElement && open.has(index)) node.open = true;
  });
  if (pinned) body.scrollTop = body.scrollHeight;
}

function head() {
  const node = /** @type {SubagentTarget} */ (target).node;
  const live = isLive(node.state);
  const time = node.startedAt
    ? formatDuration(Math.max(0, (node.endedAt || Date.now()) - node.startedAt))
    : "";
  return el("header", { class: "subagent-view-head" }, [
    el("h2", { class: "subagent-view-title", text: node.label }),
    el("span", {
      class: "subagent-view-state",
      dataset: { state: node.state },
      text: [t(`subagents.state.${node.state}`), time].filter(Boolean).join(" · "),
    }),
    el("span", { class: "review-spacer" }),
    live
      ? el("button", {
          type: "button",
          class: "ui-button ui-button--sm ui-button--ghost subagent-view-stop",
          text: t("subagents.stop"),
          onClick: () => {
            const current = /** @type {SubagentTarget} */ (target);
            void runCommand(stopCommand(current.runId, current.steerChild));
          },
        })
      : null,
  ]);
}

function bodyParts() {
  if (!reply) return [el("p", { class: "settings-help", text: t("subagents.loading") })];
  if (reply.error) {
    return [
      el("p", {
        class: "review-file-notice",
        role: "status",
        text: t("subagents.unavailable", { message: reply.error.message || "" }),
      }),
    ];
  }
  const parts = [];
  const task = reply.task?.trim() || "";
  if (task) parts.push(section("subagent-task", t("subagents.task"), task));
  // The task is also the child's first user message; the Task box already shows it.
  // pi-subagents cuts messages shorter than the task, so the start is what matches.
  let taskShown = Boolean(task);
  for (const message of reply.messages) {
    const opening = message.text
      .trim()
      .replace(/(?:…|\.\.\.)$/, "")
      .slice(0, 200);
    if (taskShown && message.role === "user" && opening && task.startsWith(opening)) {
      taskShown = false;
      continue;
    }
    parts.push(messageRow(message));
  }
  if (reply.finalOutput) {
    parts.push(section("subagent-final", t("subagents.result"), reply.finalOutput));
  }
  return parts;
}

/**
 * @param {string} className
 * @param {string} label
 * @param {string} text
 */
function section(className, label, text) {
  return el("div", { class: className }, [
    el("div", { class: "subagent-section-label", text: label }),
    el("div", { class: "subagent-text", text }),
  ]);
}

/** @param {import("./subagent-feed.js").SubagentMessage} message */
function messageRow(message) {
  if (message.kind === "toolCall") {
    return el("div", { class: "subagent-msg is-tool", text: message.name || message.text });
  }
  if (message.role === "toolResult") {
    const first = message.text.trim().split("\n")[0] || "";
    return el("details", { class: `subagent-msg is-result${message.isError ? " is-error" : ""}` }, [
      el("summary", { text: first }),
      el("pre", { class: "subagent-text", text: message.text }),
    ]);
  }
  const role = message.role === "user" ? "is-user" : "is-text";
  return el("div", { class: `subagent-msg ${role} subagent-text`, text: message.text.trim() });
}

function steerForm() {
  const current = /** @type {SubagentTarget} */ (target);
  const input = /** @type {HTMLInputElement} */ (
    el("input", {
      type: "text",
      class: "ui-input ui-input--sm subagent-steer-input",
      placeholder: t("subagents.steerPlaceholder", { name: current.node.label }),
      "aria-label": t("subagents.steerPlaceholder", { name: current.node.label }),
    })
  );
  const form = el("form", { class: "subagent-steer" }, [
    input,
    el("button", {
      type: "submit",
      class: "ui-button ui-button--sm ui-button--secondary",
      text: t("subagents.send"),
    }),
  ]);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const command = steerCommand(current.runId, current.steerChild, input.value);
    if (!command) return;
    input.value = "";
    void runCommand(command);
    setTimeout(refresh, 600);
  });
  return form;
}
