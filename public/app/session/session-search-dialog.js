// ABOUTME: Opens the session search dialog from its keyboard shortcut.
// ABOUTME: Choosing a result navigates to that session.

import { t } from "../i18n/i18n.js";
import { bindModal } from "../ui/dialog.js";
import { appKeybindings, installKeybindingListener } from "../ui/keybindings.js";
import { createLoadingPlaceholder } from "../ui/loading-placeholder.js";
import { escapeHtml } from "../ui/sanitize-markup.js";

/**
 * @typedef {{
 *   id?: string,
 *   name?: string,
 *   firstMessage?: string,
 *   projectName?: string,
 *   projectPath?: string,
 *   isCurrentWorkspace?: boolean,
 * }} SessionSearchSession
 *
 * @typedef {{
 *   sessionId?: string,
 *   sessionName?: string,
 *   firstMessage?: string,
 *   matches?: Array<{ snippet?: string }>,
 * }} SessionMessageMatch
 *
 * @typedef {{
 *   sessionId: string,
 *   icon: string,
 *   title: string,
 *   meta?: string,
 *   snippet?: string,
 * }} SessionSearchResultItem
 *
 * @typedef {{
 *   triggerInput?: HTMLInputElement | null,
 *   triggerClear?: HTMLElement | null,
 *   overlay?: HTMLElement | null,
 *   dialog?: HTMLElement | null,
 *   input?: HTMLInputElement | null,
 *   list?: HTMLElement | null,
 *   data?: { searchSessions?: (workspaceId: string, query: string) => Promise<{ results?: SessionMessageMatch[] } | null | undefined> },
 *   getWorkspaceId?: () => string | null | undefined,
 *   getSessions?: () => SessionSearchSession[],
 *   onSelect?: (session: SessionSearchSession, detail: { query: string }) => void,
 *   onQueryChange?: (query: string) => void,
 *   onError?: (...data: unknown[]) => void,
 * }} SessionSearchDialogOptions
 */

const SEARCH_DEBOUNCE_MS = 300;
const MAX_TITLE_RESULTS = 12;
const MAX_RECENT_RESULTS = 12;

function isAppleOs() {
  const platform = globalThis.navigator?.platform ?? "";
  const userAgent = globalThis.navigator?.userAgent ?? "";
  return platform.startsWith("Mac") || /Mac OS|iPhone|iPad/.test(userAgent);
}

function shortcutHintLabel() {
  return isAppleOs() ? "⌘K" : "Ctrl+K";
}

/** @param {KeyboardEvent | { key?: string, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean, shiftKey?: boolean, defaultPrevented?: boolean, isComposing?: boolean, target?: EventTarget | null }} event */
export function isSearchShortcut(event) {
  if (event.defaultPrevented || event.isComposing) return false;
  const key = typeof event.key === "string" ? event.key : "";
  if (event.altKey || event.shiftKey || key.toLowerCase() !== "k") return false;
  if (!(event.metaKey || event.ctrlKey)) return false;
  // The editor owns Ctrl/Cmd+K for inline edit.
  const target = event.target;
  if (
    target &&
    typeof target === "object" &&
    "closest" in target &&
    typeof target.closest === "function" &&
    target.closest(".cm-editor, .cm-content")
  ) {
    return false;
  }
  return true;
}

/** @param {unknown} query */
function normalizeQuery(query) {
  return String(query ?? "")
    .toLowerCase()
    .trim();
}

/** @param {SessionSearchSession | null | undefined} session */
function sessionTitle(session) {
  return session?.name || session?.firstMessage || "Empty session";
}

/** @param {SessionSearchSession | null | undefined} session */
function sessionSearchText(session) {
  return [sessionTitle(session), session?.projectName, session?.projectPath]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** @param {SessionSearchSession | null | undefined} session */
function formatMeta(session) {
  return [session?.projectName, session?.projectPath].filter(Boolean).join(" · ");
}

/**
 * @param {string} text
 * @param {string} query
 */
function highlight(text, query) {
  const escaped = escapeHtml(text);
  if (!query) return escaped;
  const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  return escaped.replace(re, "<mark>$1</mark>");
}

/**
 * @param {SessionSearchDialogOptions} [options]
 */
export function mountSessionSearchDialog({
  triggerInput,
  triggerClear,
  overlay,
  dialog,
  input,
  list,
  data,
  getWorkspaceId,
  getSessions,
  onSelect,
  onQueryChange,
  onError = console.error,
} = {}) {
  if (!triggerInput || !overlay || !dialog || !input || !list) {
    return { open() {}, close() {} };
  }

  // Locals so nested closures keep the early-return narrowing.
  const triggerEl = triggerInput;
  const overlayEl = overlay;
  const dialogEl = dialog;
  const inputEl = input;
  const listEl = list;

  triggerEl.placeholder = `Search... (${shortcutHintLabel()})`;

  let query = "";
  /** @type {SessionMessageMatch[]} */
  let messageMatches = [];
  /** @type {ReturnType<typeof setTimeout> | null} */
  let searchTimer = null;
  let searchSeq = 0;
  let loadingMessages = false;
  let activeIndex = 0;
  let suppressOpenUntil = 0;

  function visibleRows() {
    return [...listEl.querySelectorAll("button.session-search-result")];
  }

  /** @param {number} nextIndex */
  function setActiveIndex(nextIndex) {
    const rows = visibleRows();
    if (rows.length === 0) {
      activeIndex = 0;
      return;
    }
    activeIndex = Math.max(0, Math.min(nextIndex, rows.length - 1));
    rows.forEach((row, index) => {
      row.classList.toggle("active", index === activeIndex);
      row.setAttribute("aria-selected", String(index === activeIndex));
    });
    rows[activeIndex]?.scrollIntoView?.({ block: "nearest" });
  }

  /**
   * @param {{ restoreFocus?: boolean }} [options]
   */
  function close({ restoreFocus = false } = {}) {
    if (searchTimer) clearTimeout(searchTimer);
    searchSeq += 1;
    overlayEl.classList.add("hidden");
    dialogEl.classList.add("hidden");
    loadingMessages = false;
    if (restoreFocus) triggerEl.focus();
  }

  /** @param {string} sessionId */
  function selectSession(sessionId) {
    const session = getSessions?.().find((item) => item.id === sessionId) ?? {
      id: sessionId,
      isCurrentWorkspace: true,
    };
    close({ restoreFocus: false });
    onSelect?.(session, { query });
  }

  /** @param {SessionSearchResultItem} item */
  function resultButton({ sessionId, icon, title, meta, snippet }) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "session-search-result";
    button.dataset.sessionId = sessionId;
    button.setAttribute("role", "option");
    button.innerHTML = `
      <span class="session-search-result-icon">${escapeHtml(icon)}</span>
      <span class="session-search-result-copy">
        <span class="session-search-result-title">${highlight(title, query)}</span>
        ${snippet ? `<span class="session-search-result-snippet">${highlight(snippet, query)}</span>` : ""}
        ${meta ? `<span class="session-search-result-meta">${escapeHtml(meta)}</span>` : ""}
      </span>`;
    button.addEventListener("click", () => selectSession(sessionId));
    return button;
  }

  /**
   * @param {string} title
   * @param {HTMLElement[]} items
   */
  function appendGroup(title, items) {
    if (items.length === 0) return;
    const group = document.createElement("div");
    group.className = "session-search-group";
    const header = document.createElement("div");
    header.className = "session-search-group-header";
    header.textContent = title;
    group.appendChild(header);
    for (const item of items) group.appendChild(item);
    listEl.appendChild(group);
  }

  function render() {
    listEl.innerHTML = "";
    const sessions = getSessions?.() ?? [];
    const normalized = normalizeQuery(query);
    const titleMatches = normalized
      ? sessions
          .filter((session) => sessionSearchText(session).includes(normalized))
          .slice(0, MAX_TITLE_RESULTS)
      : sessions.slice(0, MAX_RECENT_RESULTS);

    appendGroup(
      normalized ? t("sidebar.searchTasks") : t("sidebar.recentTasks"),
      titleMatches.map((session) =>
        resultButton({
          sessionId: session.id || "",
          icon: session.isCurrentWorkspace ? "●" : "○",
          title: sessionTitle(session),
          meta: formatMeta(session),
        }),
      ),
    );

    appendGroup(
      t("sidebar.messageMatches"),
      messageMatches.map((result) =>
        resultButton({
          sessionId: result.sessionId || "",
          icon: "⌕",
          title: result.sessionName || result.firstMessage || t("sidebar.untitled"),
          meta:
            (result.matches?.length ?? 0) > 1
              ? t("sidebar.matchCount", { count: result.matches?.length })
              : t("sidebar.messageMatch"),
          snippet: result.matches?.[0]?.snippet || "",
        }),
      ),
    );

    if (loadingMessages) {
      listEl.appendChild(
        createLoadingPlaceholder({
          className: "session-search-empty",
          label: t("session.search.searchingMessages"),
        }),
      );
    } else if (listEl.children.length === 0) {
      const empty = document.createElement("div");
      empty.className = "session-search-empty";
      empty.textContent = normalized ? t("session.search.noMatches") : t("session.search.noTasks");
      listEl.appendChild(empty);
    }

    setActiveIndex(0);
  }

  /** @param {string} nextQuery */
  function runMessageSearch(nextQuery) {
    if (searchTimer) clearTimeout(searchTimer);
    messageMatches = [];
    if (nextQuery.length < 2) {
      loadingMessages = false;
      render();
      return;
    }
    loadingMessages = true;
    render();
    const seq = ++searchSeq;
    searchTimer = setTimeout(async () => {
      const workspaceId = getWorkspaceId?.();
      if (!workspaceId) return;
      try {
        const response = await data?.searchSessions?.(workspaceId, nextQuery);
        if (seq !== searchSeq) return;
        messageMatches = response?.results ?? [];
      } catch (error) {
        if (seq === searchSeq) onError(error);
      } finally {
        if (seq === searchSeq) {
          loadingMessages = false;
          render();
        }
      }
    }, SEARCH_DEBOUNCE_MS);
  }

  /** @param {string} nextQuery */
  function setQuery(nextQuery) {
    query = nextQuery;
    inputEl.value = nextQuery;
    triggerEl.value = nextQuery;
    triggerClear?.classList.toggle("hidden", nextQuery.length === 0);
    onQueryChange?.(nextQuery);
    render();
    runMessageSearch(normalizeQuery(nextQuery));
  }

  /** @param {string} [initialQuery] */
  function open(initialQuery = triggerEl.value) {
    if (Date.now() < suppressOpenUntil) return;
    overlayEl.classList.remove("hidden");
    dialogEl.classList.remove("hidden");
    setQuery(initialQuery ?? "");
    requestAnimationFrame(() => {
      inputEl.focus();
      inputEl.select();
    });
  }

  triggerEl.addEventListener("focus", () => open());
  triggerEl.addEventListener("click", () => open());
  /** @param {KeyboardEvent} event */
  triggerEl.addEventListener("keydown", (event) => {
    if (event.key === "Escape") return;
    const editingKey =
      event.key.length === 1 || event.key === "Backspace" || event.key === "Delete";
    if (!editingKey) return;
    event.preventDefault();
    open(event.key.length === 1 ? event.key : triggerEl.value);
  });
  /** @param {Event} event */
  function clearWithoutOpening(event) {
    event.preventDefault();
    event.stopPropagation();
    suppressOpenUntil = Date.now() + 250;
    setQuery("");
    close({ restoreFocus: false });
  }

  triggerClear?.addEventListener("pointerdown", clearWithoutOpening);
  triggerClear?.addEventListener("mousedown", clearWithoutOpening);
  triggerClear?.addEventListener("click", clearWithoutOpening);
  overlayEl.addEventListener("click", () => close());
  inputEl.addEventListener("input", () => setQuery(inputEl.value));
  /** @param {KeyboardEvent} event */
  appKeybindings().register({
    id: "session-search",
    keys: "Mod+K",
    labelKey: "keybindings.sessionSearch",
    when: (event) => isSearchShortcut(event),
    run: () => {
      if (!dialogEl.classList.contains("hidden")) {
        inputEl.focus();
        inputEl.select();
      } else open();
    },
  });
  installKeybindingListener();
  bindModal(dialogEl, { onClose: () => close() });
  /** @param {KeyboardEvent} event */
  inputEl.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex(activeIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(activeIndex - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const active = visibleRows()[activeIndex];
      if (active && "click" in active && typeof active.click === "function") active.click();
    }
  });

  return { open, close };
}
