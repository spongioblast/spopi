// ABOUTME: Collects transport errors into one collapsible strip above the composer.
// ABOUTME: Modeled on the queued-messages list: a count header, a dismiss per row, clear all.

import { t } from "../i18n/i18n.js";
import { createIcon, setButtonIcon } from "../ui/icons.js";

const MAX_ENTRIES = 50;

/** @typedef {{ id: number, text: string, detail: string, count: number, at: number }} ErrorEntry */

/** @type {ErrorEntry[]} */
let entries = [];
let collapsed = true;
let nextId = 1;
/** @type {Element | null} */
let container = null;

/** @param {Element | null | undefined} element */
export function mountErrorLog(element) {
  container = element ?? null;
  render();
}

/**
 * Add an error to the strip. Repeats of the newest message bump its count instead of stacking.
 * @param {unknown} error
 * @param {string} [detail] short context to help trace it later (e.g. "while Pi was working")
 */
export function pushErrorLog(error, detail = "") {
  const text = String(error ?? "").trim() || t("errorLog.unknown");
  const note = String(detail ?? "").trim();
  const head = entries[0];
  if (head && head.text === text && head.detail === note) {
    head.count += 1;
    head.at = Date.now();
  } else {
    entries.unshift({ id: nextId++, text, detail: note, count: 1, at: Date.now() });
    if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
  }
  render();
}

export function clearErrorLog() {
  collapsed = true;
  if (!entries.length) return;
  entries = [];
  render();
}

/** @param {number} id */
function dismiss(id) {
  entries = entries.filter((entry) => entry.id !== id);
  render();
}

function render() {
  if (!container) return;
  container.replaceChildren();
  container.classList.toggle("hidden", entries.length === 0);
  if (!entries.length) return;

  const total = entries.reduce((sum, entry) => sum + entry.count, 0);

  const header = document.createElement("button");
  header.type = "button";
  header.className = "error-log-header";
  header.setAttribute("aria-expanded", String(!collapsed));
  const chevron = createIcon("chevron-down", { size: 14 });
  if (chevron) header.append(chevron);
  const warn = createIcon("triangle-alert", { size: 14 });
  if (warn) {
    warn.classList.add("error-log-warn");
    header.append(warn);
  }
  const count = document.createElement("span");
  count.className = "error-log-count";
  count.textContent =
    total === 1 ? t("errorLog.headerOne") : t("errorLog.header", { count: total });
  header.append(count);
  if (collapsed) {
    const latest = document.createElement("span");
    latest.className = "error-log-latest";
    latest.textContent = entries[0].text;
    header.append(latest);
  }
  header.title = t("errorLog.toggle");
  header.addEventListener("click", () => {
    collapsed = !collapsed;
    render();
  });

  const clear = iconButton("error-log-clear", "trash-2", t("errorLog.clear"));
  clear.addEventListener("click", clearErrorLog);

  const top = document.createElement("div");
  top.className = "error-log-top";
  top.append(header, clear);
  container.append(top);

  if (collapsed) return;

  const list = document.createElement("div");
  list.className = "error-log-list";
  list.setAttribute("role", "list");
  for (const entry of entries) {
    list.append(renderRow(entry));
  }
  container.append(list);
}

/** @param {number} at */
function formatTime(at) {
  try {
    return new Date(at).toLocaleTimeString();
  } catch {
    return "";
  }
}

/** @param {ErrorEntry} entry */
function renderRow(entry) {
  const row = document.createElement("div");
  row.className = "error-log-row";
  row.setAttribute("role", "listitem");
  const when = formatTime(entry.at);
  row.title = [entry.text, entry.detail, when].filter(Boolean).join("\n");

  const text = document.createElement("span");
  text.className = "error-log-text";
  text.textContent = entry.text;
  row.append(text);

  if (entry.detail) {
    const detail = document.createElement("span");
    detail.className = "error-log-detail";
    detail.textContent = entry.detail;
    row.append(detail);
  }

  if (entry.count > 1) {
    const badge = document.createElement("span");
    badge.className = "error-log-badge";
    badge.textContent = `×${entry.count}`;
    row.append(badge);
  }

  if (when) {
    const time = document.createElement("span");
    time.className = "error-log-time";
    time.textContent = when;
    row.append(time);
  }

  const close = iconButton("error-log-dismiss", "x", t("errorLog.dismiss"));
  close.addEventListener("click", () => dismiss(entry.id));
  row.append(close);
  return row;
}

/**
 * @param {string} className
 * @param {string} icon
 * @param {string} label
 */
function iconButton(className, icon, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `ui-icon-button ui-icon-button--xs ui-icon-button--ghost ${className}`;
  button.setAttribute("aria-label", label);
  button.title = label;
  setButtonIcon(button, icon, { size: 14 });
  return button;
}
