// ABOUTME: Reusable sidebar region and workspace-group DOM builders for PINNED and PROJECTS.
// ABOUTME: Safe textContent-only rendering with disclosure semantics and inert hostile labels.

import { t } from "../i18n/i18n.js";
import { registerContextMenuHost } from "../ui/context-menu.js";
import { createIcon } from "../ui/icons.js";

const FOLDER_CLOSED_ICON =
  '<svg class="folder-closed-icon" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>';

const FOLDER_OPEN_ICON =
  '<svg class="folder-open-icon" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 14l1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/></svg>';

// Static disclosure arrow for the four section headers (RECENT, PINNED,
// PROJECTS, ARCHIVED). Points right when collapsed; CSS rotates it 90deg to
// point down when expanded.

function createFolderIcon() {
  const icon = document.createElement("span");
  icon.className = "chevron folder-icon";
  icon.setAttribute("aria-hidden", "true");
  const doc = new DOMParser().parseFromString(
    `${FOLDER_CLOSED_ICON}${FOLDER_OPEN_ICON}`,
    "text/html",
  );
  icon.append(...doc.body.childNodes);
  return icon;
}

/**
 * Builds the disclosure arrow shared by all four sidebar section headers.
 * Exported so inline section builders (recent / archived in index.js) render
 * the exact same icon contract as buildSidebarSection.
 */
function createSectionChevron() {
  const chevron = document.createElement("span");
  chevron.className = "chevron section-chevron";
  chevron.setAttribute("aria-hidden", "true");
  const icon = createIcon("chevron-right", { size: 16 });
  if (icon) chevron.appendChild(icon);
  return chevron;
}

let disclosureSeq = 0;

/**
 * The row stays a plain div. Chevron, title, and count move into one button.
 * Buttons already in the row (new chat, actions) stay siblings of that button.
 *
 * @param {HTMLElement} header
 * @param {HTMLElement} body
 * @param {boolean} expanded
 * @param {((expanded: boolean) => void) | null | undefined} onToggle
 * @returns {HTMLButtonElement}
 */
export function mountDisclosure(header, body, expanded, onToggle) {
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "project-group-toggle";
  for (const child of [...header.childNodes]) {
    if (child instanceof HTMLButtonElement) continue;
    toggle.append(child);
  }
  header.prepend(toggle);

  if (!body.id) {
    disclosureSeq += 1;
    body.id = `sidebar-disclosure-${disclosureSeq}`;
  }
  toggle.setAttribute("aria-controls", body.id);

  /**
   * @param {boolean} open
   */
  const apply = (open) => {
    toggle.setAttribute("aria-expanded", String(open));
    header.classList.toggle("collapsed", !open);
    body.classList.toggle("collapsed", !open);
  };
  apply(expanded);
  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    const open = toggle.getAttribute("aria-expanded") !== "true";
    apply(open);
    onToggle?.(open);
  });
  return toggle;
}

/**
 * Builds a collapsible sidebar region section (RECENT, PINNED, PROJECTS,
 * ARCHIVED).
 *
 * @param {object}  options
 * @param {string}  options.region          Region slug used for CSS classes.
 * @param {string}  options.titleKey        i18n key for the section title.
 * @param {object}  [options.titleParams]   Interpolation params for titleKey.
 * @param {number | null}  [options.count]         Optional count badge value.
 * @param {boolean} [options.expanded=true] Initial expanded state.
 * @param {((expanded: boolean) => void) | null} [options.onToggle]     Called with the new expanded boolean.
 * @param {((container: HTMLElement) => void) | null} [options.renderSessions] Receives the sessions container element.
 * @param {((header: HTMLElement) => void) | null} [options.renderHeaderActions] Receives the header; append action buttons here.
 * @param {((footer: HTMLElement) => void) | null} [options.renderFooter]  Receives a footer element (shown only when provided).
 * @returns {{ section: HTMLElement, header: HTMLElement, sessionsContainer: HTMLElement }}
 */
export function buildSidebarSection({
  region,
  titleKey,
  titleParams,
  count = null,
  expanded = true,
  onToggle = null,
  renderSessions = null,
  renderHeaderActions = null,
  renderFooter = null,
}) {
  const section = document.createElement("div");
  section.className = `sidebar-section sidebar-section-${region}`;

  const header = document.createElement("div");
  header.className = `project-header sidebar-section-header sidebar-section-header-${region}`;

  header.appendChild(createSectionChevron());

  const title = document.createElement("span");
  title.className = "sidebar-section-title";
  title.textContent = t(titleKey, titleParams || {});
  header.appendChild(title);

  if (typeof count === "number") {
    const countEl = document.createElement("span");
    countEl.className = "project-count sidebar-section-count";
    countEl.textContent = String(count);
    header.appendChild(countEl);
  }

  if (renderHeaderActions) {
    renderHeaderActions(header);
  }

  section.appendChild(header);

  const sessionsContainer = document.createElement("div");
  sessionsContainer.className = "project-sessions sidebar-section-sessions";

  if (renderSessions) {
    renderSessions(sessionsContainer);
  }

  mountDisclosure(header, sessionsContainer, expanded, onToggle);

  section.appendChild(sessionsContainer);

  if (renderFooter) {
    const footer = document.createElement("div");
    footer.className = "sidebar-section-footer";
    renderFooter(footer);
    section.appendChild(footer);
  }

  return { section, header, sessionsContainer };
}

/**
 * Builds a single workspace group with a disclosure header, folder name,
 * session count, and an optional new-chat button. Used inside both PINNED
 * and PROJECTS regions.
 *
 * All dynamic values (folder name, path, count, labels) are assigned via
 * textContent or DOM properties — never innerHTML — so HTML-like content
 * is rendered as inert text.
 *
 * @param {object}  options
 * @param {string}  options.workspaceId         Stable ID for data-workspace-id.
 * @param {string}  options.folderName          Folder name to display (inert text).
 * @param {string}  [options.workspacePath]     Full path for the tooltip (inert).
 * @param {number}  [options.sessionCount=0]    Non-archived session count.
 * @param {boolean} [options.expanded=false]    Initial expanded state.
 * @param {((expanded: boolean) => void) | null} [options.onToggle]         Called with the new expanded boolean.
 * @param {((event: MouseEvent) => void) | null} [options.onNewChat]        New-chat callback (button shown only when provided).
 * @param {((event: MouseEvent) => void) | null} [options.onContextMenu]    Workspace context-menu callback.
 * @param {((event: MouseEvent) => void) | null} [options.onMoreActions]    Workspace actions-button callback.
 * @param {string}  [options.newChatTitleKey]   i18n key for the new-chat aria-label.
 * @param {string}  [options.moreActionsTitleKey] i18n key for the actions-button aria-label.
 * @param {((container: HTMLElement) => void) | null} [options.renderSessions]   Receives the sessions container element.
 * @param {((footer: HTMLElement) => void) | null} [options.renderFooter]     Receives a footer element (shown only when provided).
 * @returns {{ group: HTMLElement, header: HTMLElement, sessionsContainer: HTMLElement }}
 */
export function buildSidebarWorkspaceGroup({
  workspaceId,
  folderName,
  workspacePath,
  sessionCount = 0,
  expanded = false,
  onToggle = null,
  onNewChat = null,
  onContextMenu = null,
  onMoreActions = null,
  newChatTitleKey = "sidebar.newChat",
  moreActionsTitleKey = "sidebar.workspaceActions",
  renderSessions = null,
  renderFooter = null,
}) {
  const group = document.createElement("div");
  group.className = "project-group workspace-group";
  if (workspaceId) {
    group.dataset.workspaceId = workspaceId;
  }

  const header = document.createElement("div");
  header.className = "project-header workspace-header";

  header.appendChild(createFolderIcon());

  const nameEl = document.createElement("span");
  nameEl.className = "project-name workspace-name";
  nameEl.textContent = folderName;
  if (workspacePath) {
    nameEl.title = workspacePath;
  }
  header.appendChild(nameEl);

  const countEl = document.createElement("span");
  countEl.className = "project-count workspace-count";
  countEl.textContent = String(sessionCount);
  header.appendChild(countEl);

  if (onContextMenu) {
    header.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      onContextMenu(event);
    });
    registerContextMenuHost(header);
  }

  if (onMoreActions) {
    const label = t(moreActionsTitleKey, { path: folderName });
    const moreActionsBtn = document.createElement("button");
    moreActionsBtn.type = "button";
    moreActionsBtn.className = "workspace-more-actions-btn";
    moreActionsBtn.title = label;
    moreActionsBtn.setAttribute("aria-label", label);
    const moreIcon = createIcon("ellipsis", { size: 14 });
    if (moreIcon) moreActionsBtn.replaceChildren(moreIcon);
    else moreActionsBtn.replaceChildren();
    moreActionsBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      onMoreActions(event);
    });
    header.appendChild(moreActionsBtn);
  }

  if (onNewChat) {
    const label = t(newChatTitleKey, { path: folderName });
    const newChatBtn = document.createElement("button");
    newChatBtn.type = "button";
    newChatBtn.className = "project-new-chat-btn workspace-new-chat-btn";
    newChatBtn.title = label;
    newChatBtn.setAttribute("aria-label", label);
    const newChatIcon = createIcon("plus", { size: 12 });
    if (newChatIcon) newChatBtn.replaceChildren(newChatIcon);
    newChatBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      onNewChat(event);
    });
    header.appendChild(newChatBtn);
  }

  group.appendChild(header);

  const sessionsContainer = document.createElement("div");
  sessionsContainer.className = "project-sessions workspace-sessions";

  if (renderSessions) {
    renderSessions(sessionsContainer);
  }

  mountDisclosure(header, sessionsContainer, expanded, onToggle);

  group.appendChild(sessionsContainer);

  if (renderFooter) {
    const footer = document.createElement("div");
    footer.className = "workspace-group-footer";
    renderFooter(footer);
    group.appendChild(footer);
  }

  return { group, header, sessionsContainer };
}
