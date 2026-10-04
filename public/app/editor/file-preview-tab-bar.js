// ABOUTME: Renders the file preview tab strip: lead tabs, file tabs, dirty and conflict marks, close marks.
// ABOUTME: Selecting and closing go back through the panel; tab data stays in FileTabState.

import { t } from "../i18n/i18n.js";
import { createIcon } from "../ui/icons.js";
import { leadTabActive, leadTabs, leaveLeadTab } from "./lead-tab.js";

/** @typedef {import("./file-preview-panel.js").FilePreviewPanel} FilePreviewPanel */

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * A close mark inside a tab. Not a button: a button inside a tab is a nested control,
 * so keyboard users close the focused tab with Delete or Backspace.
 * @param {() => void} onClose
 */
function tabCloseMark(onClose) {
  const close = document.createElement("span");
  close.className = "file-preview-tab-close";
  close.title = t("files.preview.close");
  close.setAttribute("aria-hidden", "true");
  appendCloseIcon(close);
  close.addEventListener("click", (event) => {
    event.stopPropagation();
    onClose();
  });
  return close;
}

/**
 * @param {KeyboardEvent} event
 */
function isCloseKey(event) {
  return event.key === "Delete" || event.key === "Backspace";
}

/** @param {HTMLElement} target */
function appendCloseIcon(target) {
  const svg = document.createElementNS(SVG_NS, "svg");
  for (const [name, value] of Object.entries({
    "aria-hidden": "true",
    width: "10",
    height: "10",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2.5",
    "stroke-linecap": "round",
  })) {
    svg.setAttribute(name, value);
  }
  const firstLine = document.createElementNS(SVG_NS, "line");
  firstLine.setAttribute("x1", "18");
  firstLine.setAttribute("y1", "6");
  firstLine.setAttribute("x2", "6");
  firstLine.setAttribute("y2", "18");
  const secondLine = document.createElementNS(SVG_NS, "line");
  secondLine.setAttribute("x1", "6");
  secondLine.setAttribute("y1", "6");
  secondLine.setAttribute("x2", "18");
  secondLine.setAttribute("y2", "18");
  svg.append(firstLine, secondLine);
  target.appendChild(svg);
}

/** @param {FilePreviewPanel} panel */
export function renderFilePreviewTabBar(panel) {
  const tabBar = panel.tabBar;
  if (!tabBar) return;
  tabBar.replaceChildren();
  tabBar.setAttribute("role", "tablist");
  const leading = leadTabActive();
  for (const [id, lead] of leadTabs()) renderLeadTab(panel, tabBar, id, lead);

  for (const tab of panel.state.getTabs()) {
    const tabEl = document.createElement("div");
    const isActive = !leading && tab.id === panel.state.activeTabId;
    tabEl.className = `file-preview-tab${isActive ? " active" : ""}`;
    tabEl.dataset.tabId = tab.id;
    tabEl.setAttribute("role", "tab");
    tabEl.setAttribute("tabindex", isActive ? "0" : "-1");
    tabEl.setAttribute("aria-selected", String(isActive));

    const icon = document.createElement("span");
    icon.className = "file-preview-tab-icon";
    const glyph = createIcon("files", { size: 12 });
    if (glyph) icon.appendChild(glyph);
    icon.setAttribute("aria-hidden", "true");
    tabEl.appendChild(icon);

    const name = document.createElement("span");
    name.className = "file-preview-tab-name";
    name.textContent = tab.fileName;
    name.title = tab.filePath;
    tabEl.appendChild(name);

    if (tab.dirty) {
      const dot = document.createElement("span");
      dot.className = "file-preview-tab-dirty";
      dot.textContent = "●";
      dot.title = t("files.unsaved.title");
      dot.setAttribute("aria-label", t("files.unsaved.title"));
      tabEl.appendChild(dot);
    }
    if (tab.conflict) {
      const warning = document.createElement("span");
      warning.className = "file-preview-tab-conflict";
      warning.textContent = "⚠";
      warning.title = t("files.preview.conflict");
      warning.setAttribute("aria-label", t("files.preview.conflict"));
      tabEl.appendChild(warning);
    }

    const closeTab = () => {
      if (!panel._interactionLocked) void panel._closeTab(tab.id);
    };
    tabEl.appendChild(tabCloseMark(closeTab));

    const showTab = () => {
      leaveLeadTab();
      void panel._selectTab(tab.id).then(() => panel._renderTabBar());
    };
    tabEl.addEventListener("click", () => {
      if (!panel._interactionLocked) showTab();
    });
    tabEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        showTab();
        return;
      }
      if (isCloseKey(event)) {
        event.preventDefault();
        closeTab();
        return;
      }
      onTabKeydown(panel, event);
    });
    tabBar.appendChild(tabEl);
  }

  ensureRovingTabindex(tabBar);
  revealActiveTab(tabBar);
}

/**
 * Scroll the strip so a newly active tab is visible. The strip hides its
 * scrollbar, so a tab opened past the edge would otherwise be invisible.
 * Repaints for the same tab (typing marks it dirty) leave the scroll alone.
 * @param {HTMLElement} tabBar
 */
function revealActiveTab(tabBar) {
  const active = tabBar.querySelector(".file-preview-tab.active");
  const key =
    active instanceof HTMLElement ? active.dataset.tabId || active.dataset.leadTab || "" : "";
  if (tabBar.dataset.revealedTab === key) return;
  tabBar.dataset.revealedTab = key;
  if (!(active instanceof HTMLElement)) return;
  const bar = tabBar.getBoundingClientRect();
  const tab = active.getBoundingClientRect();
  if (tab.left < bar.left) tabBar.scrollLeft -= bar.left - tab.left;
  else if (tab.right > bar.right) tabBar.scrollLeft += tab.right - bar.right;
}

/**
 * @param {FilePreviewPanel} panel
 * @param {HTMLElement} tabBar
 * @param {string} id
 * @param {import("./lead-tab.js").LeadTab} lead
 */
function renderLeadTab(panel, tabBar, id, lead) {
  const tabEl = document.createElement("div");
  tabEl.className = `file-preview-tab lead-tab${lead.active ? " active" : ""}`;
  tabEl.dataset.leadTab = id;
  tabEl.setAttribute("role", "tab");
  tabEl.setAttribute("tabindex", lead.active ? "0" : "-1");
  tabEl.setAttribute("aria-selected", String(lead.active));

  const icon = document.createElement("span");
  icon.className = "file-preview-tab-icon";
  icon.setAttribute("aria-hidden", "true");
  const svg = createIcon(lead.icon || "review", { size: 12 });
  if (svg) icon.appendChild(svg);
  tabEl.appendChild(icon);

  const name = document.createElement("span");
  name.className = "file-preview-tab-name";
  name.textContent = lead.label;
  tabEl.appendChild(name);

  tabEl.appendChild(tabCloseMark(() => lead.onClose()));

  const select = () => {
    if (!panel._interactionLocked && !lead.active) lead.onSelect();
  };
  tabEl.addEventListener("click", select);
  tabEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select();
      return;
    }
    if (isCloseKey(event)) {
      event.preventDefault();
      lead.onClose();
      return;
    }
    onTabKeydown(panel, event);
  });
  tabBar.appendChild(tabEl);
}

/**
 * @param {FilePreviewPanel} panel
 * @param {KeyboardEvent} event
 */
function onTabKeydown(panel, event) {
  if (panel._interactionLocked || !panel.tabBar) return;
  const tabs = Array.from(panel.tabBar.querySelectorAll(".file-preview-tab"));
  const currentTarget = event.currentTarget;
  const current =
    currentTarget && typeof currentTarget === "object"
      ? tabs.indexOf(/** @type {Element} */ (currentTarget))
      : -1;
  if (current < 0) return;
  let target = current;
  if (event.key === "ArrowRight") target = (current + 1) % tabs.length;
  else if (event.key === "ArrowLeft") target = (current - 1 + tabs.length) % tabs.length;
  else if (event.key === "Home") target = 0;
  else if (event.key === "End") target = tabs.length - 1;
  else return;
  event.preventDefault();
  const next = tabs[target];
  if (next && "focus" in next && typeof next.focus === "function") {
    next.focus();
  }
  if (next && "click" in next && typeof next.click === "function") {
    next.click();
  }
  // Keep the focused tab visible when the tab strip overflows.
  if (next && "scrollIntoView" in next && typeof next.scrollIntoView === "function") {
    next.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
}

// Roving tabindex: exactly one tab is in the tab order. If none is active,
// make the first tab focusable so keyboard users can enter the strip.
/** @param {HTMLElement} tabBar */
function ensureRovingTabindex(tabBar) {
  const tabs = Array.from(tabBar.querySelectorAll(".file-preview-tab"));
  if (tabs.length === 0) return;
  if (tabs.some((tab) => tab.getAttribute("tabindex") === "0")) return;
  tabs[0].setAttribute("tabindex", "0");
}
