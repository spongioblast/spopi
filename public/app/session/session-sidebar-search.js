// ABOUTME: Session sidebar search: title filtering of the drawn rows plus host full-text message matches.
// ABOUTME: Full-text hits render as their own group at the top; the regular list is not rebuilt.

import { t } from "../i18n/i18n.js";
import { formatSessionTime } from "./session-sidebar-records.js";
import { decorateSessionItem } from "./session-sidebar-render.js";

/**
 * @typedef {import("./session-sidebar.js").SessionSidebar} SessionSidebar
 */

/**
 * @param {SessionSidebar} sidebar
 * @param {string} query
 */
async function fullTextSearch(sidebar, query) {
  if (query !== sidebar.searchQuery) return;
  const workspaceId = sidebar.getTarget()?.workspaceId;
  if (!workspaceId) return;
  try {
    const response = await sidebar.data.searchSessions(workspaceId, query);
    if (query !== sidebar.searchQuery) return;
    sidebar._searchResults = response.results ?? [];
    renderSearchResults(sidebar);
  } catch (error) {
    console.error("[Sidebar] Search failed:", error);
  }
}

/** @param {SessionSidebar} sidebar */
function renderSearchResults(sidebar) {
  if (!sidebar._searchResults || sidebar._searchResults.length === 0) return;
  sidebar.container.querySelector(".search-results-group")?.remove();

  const group = document.createElement("div");
  group.className = "search-results-group";
  const header = document.createElement("div");
  header.className = "project-header search-results-header";
  header.setAttribute("role", "presentation");
  const searchIcon = document.createElement("span");
  searchIcon.textContent = "\u{1F50D}";
  const matchesLabel = document.createElement("span");
  matchesLabel.textContent = t("sidebar.messageMatches");
  const countBadge = document.createElement("span");
  countBadge.className = "project-count";
  countBadge.textContent = String(sidebar._searchResults.length);
  header.append(searchIcon, matchesLabel, countBadge);
  group.appendChild(header);

  const sessionsDiv = document.createElement("div");
  sessionsDiv.className = "project-sessions";
  for (const result of sidebar._searchResults) {
    const typed =
      /** @type {{ sessionId?: string, sessionName?: string, firstMessage?: string, matches?: { snippet?: string }[], sessionTimestamp?: string }} */ (
        result
      );
    const item = document.createElement("div");
    item.className = "session-item search-result-item";
    item.dataset.sessionId = typed.sessionId ?? "";
    if (typed.sessionId === sidebar.activeSessionId) item.classList.add("active");
    decorateSessionItem(sidebar, item, {
      selected: typed.sessionId === sidebar.activeSessionId,
      onActivate: () => sidebar.onSelect({ id: typed.sessionId ?? "", isCurrentWorkspace: true }),
    });
    const title = typed.sessionName || typed.firstMessage || t("sidebar.untitled");
    const snippet = typed.matches?.[0]?.snippet || "";
    const matchCount = typed.matches?.length ?? 0;
    const time = formatSessionTime(typed.sessionTimestamp);
    const titleRow = document.createElement("div");
    titleRow.className = "session-title-row";
    const titleElement = document.createElement("div");
    titleElement.className = "session-title";
    titleElement.title = title;
    titleElement.textContent = title;
    titleRow.appendChild(titleElement);
    item.appendChild(titleRow);

    const snippetEl = document.createElement("div");
    snippetEl.className = "search-snippet";
    snippetEl.textContent = snippet;
    item.appendChild(snippetEl);

    const metaEl = document.createElement("div");
    metaEl.className = "session-meta";
    metaEl.textContent =
      matchCount > 1 ? `${time} · ${t("sidebar.matchCount", { count: matchCount })}` : time;
    item.appendChild(metaEl);

    sessionsDiv.appendChild(item);
  }
  group.appendChild(sessionsDiv);
  sidebar.container.insertBefore(group, sidebar.container.firstChild);
}

/** Methods SessionSidebar delegates to; `this` is the sidebar. */
export const sidebarSearch = /** @satisfies {ThisType<SessionSidebar>} */ ({
  /** @param {string | null | undefined} query */
  setSearchQuery(query) {
    this.searchQuery = (query || "").toLowerCase().trim();
    if (this._searchTimer) clearTimeout(this._searchTimer);
    if (!this.searchQuery) {
      this._searchResults = null;
      this.applySearch();
      return;
    }
    this.applySearch();
    if (this.searchQuery.length >= 2) {
      this._searchTimer = setTimeout(() => fullTextSearch(this, this.searchQuery), 300);
    }
  },

  applySearch() {
    if (!this.searchQuery) {
      this.container.querySelectorAll(".session-item").forEach((el) => {
        el.classList.remove("hidden");
      });
      this.container
        .querySelectorAll(".favourites-group, .project-group, .archived-group")
        .forEach((el) => {
          if (!(el instanceof HTMLElement)) return;
          el.style.display = "";
        });
      this.container.querySelector(".search-results-group")?.remove();
      return;
    }
    this.container
      .querySelectorAll(".favourites-group, .project-group, .archived-group")
      .forEach((group) => {
        if (!(group instanceof HTMLElement)) return;
        let hasVisible = false;
        group.querySelectorAll(".session-item").forEach((item) => {
          const title = (item.querySelector(".session-title")?.textContent || "").toLowerCase();
          const matches = title.includes(this.searchQuery);
          item.classList.toggle("hidden", !matches);
          if (matches) hasVisible = true;
        });
        group.style.display = hasVisible ? "" : "none";
      });
  },
});
