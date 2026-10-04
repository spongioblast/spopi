// ABOUTME: Session renames in the sidebar: inline title editing, generated titles, and pushed names.
// ABOUTME: The open session renames through Pi's RPC; older sessions through the config gateway.

import { t } from "../i18n/i18n.js";
import { randomId } from "../utils/random-id.js";
import { cssEscape } from "./session-sidebar-records.js";

/**
 * @typedef {import("./session-sidebar.js").SessionSidebar} SessionSidebar
 * @typedef {import("./session-sidebar.js").SidebarSession} SidebarSession
 * @typedef {import("./session-sidebar.js").SidebarTarget} SidebarTarget
 */

/**
 * @param {SessionSidebar} sidebar
 * @param {SidebarSession} session
 * @param {SidebarTarget | null | undefined} [target]
 */
export async function generateTitle(sidebar, session, target = sidebar.getTarget()) {
  if (!sidebar.config) return false;
  const item = sidebar.container.querySelector(
    `.session-item[data-session-id="${cssEscape(session.id ?? "")}"]`,
  );
  const titleElRaw = item?.querySelector(".session-title");
  const titleEl = titleElRaw instanceof HTMLElement ? titleElRaw : null;
  const previousTitle = titleEl?.textContent || session.name || "";
  if (titleEl) titleEl.textContent = t("sidebar.generatingTitle");

  try {
    const result = await sidebar.config.call(
      "generate_session_title",
      {},
      { timeoutMs: 100_000, target },
    );
    const title = result?.data?.title?.trim();
    if (!result?.ok || !title) throw new Error(result?.error || t("sidebar.generateTitleError"));
    await sidebar.runtime.request({ type: "set_session_name", name: title }, target, {
      idempotencyKey: randomId(),
    });
    session.name = title;
    if (titleEl) {
      titleEl.textContent = title;
      titleEl.title = title;
    }
    return true;
  } catch (error) {
    if (titleEl) titleEl.textContent = previousTitle;
    console.error("[Sidebar] Generate title failed:", error);
    return false;
  }
}

/**
 * @param {SessionSidebar} sidebar
 * @param {SidebarSession} session
 */
export function startRename(sidebar, session) {
  const item = sidebar.container.querySelector(
    `.session-item[data-session-id="${cssEscape(session.id ?? "")}"]`,
  );
  const titleEl = item?.querySelector(".session-title");
  if (!(titleEl instanceof HTMLElement)) return;
  const current = titleEl.textContent;
  const input = document.createElement("input");
  input.className = "session-rename-input";
  input.value = current ?? "";
  titleEl.replaceWith(input);
  input.focus();
  input.select();

  const commit = async () => {
    const name = input.value.trim();
    if (name && name !== current) {
      try {
        if (session.id === sidebar.activeSessionId) {
          await sidebar.runtime.request({ type: "set_session_name", name }, sidebar.getTarget(), {
            idempotencyKey: randomId(),
          });
        } else {
          const result = await sidebar.config?.call("rename_historical_session", {
            filePath: session.filePath,
            name,
          });
          if (!result?.ok) throw new Error(result?.error || "Session rename failed");
        }
        for (const candidate of sidebar.sessions) {
          if (candidate.filePath === session.filePath) candidate.name = name;
        }
        session.name = name;
        void sidebar.load({ quiet: true });
      } catch (error) {
        console.error("[Sidebar] Rename failed:", error);
      }
    }
    const el = document.createElement("div");
    el.className = "session-title";
    el.title = name || current || "";
    el.textContent = name || current || "";
    input.replaceWith(el);
  };

  input.addEventListener("blur", commit);
  /** @param {KeyboardEvent} event */
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      input.blur();
    } else if (event.key === "Escape") {
      input.value = current ?? "";
      input.blur();
    }
  });
}

/** Methods SessionSidebar delegates to; `this` is the sidebar. */
export const sidebarRename = /** @satisfies {ThisType<SessionSidebar>} */ ({
  /**
   * @param {string} sessionId
   * @param {string} name
   */
  setSessionName(sessionId, name) {
    const session = this.sessions.find((candidate) => candidate.id === sessionId);
    if (!session) return;
    session.name = name || "";
    const title = session.name || session.firstMessage || t("sidebar.emptySession");
    const titleEl = this.container.querySelector(
      `.session-item[data-session-id="${cssEscape(sessionId)}"] .session-title`,
    );
    if (!(titleEl instanceof HTMLElement)) return;
    titleEl.textContent = title;
    titleEl.title = title;
  },
});
