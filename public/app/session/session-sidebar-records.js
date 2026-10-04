// ABOUTME: Pure helpers over sidebar session records: change signature, merge, live-status flags, labels.
// ABOUTME: No DOM and no storage; the sidebar mixins call these on the records they hold.

import { basenameLocalPath } from "../files/path-utils.js";

/**
 * @typedef {import("./session-sidebar.js").SidebarSession} SidebarSession
 */

/** Sidebar label for a workspace path. Windows `\\?\UNC\...` paths have no `/`.
 * @param {string | null | undefined} path
 * @param {string | null | undefined} [projectName]
 */
export function workspaceFolderName(path, projectName) {
  const fromName = typeof projectName === "string" ? projectName.trim() : "";
  if (fromName && !/[\\/]/.test(fromName)) return fromName;
  return basenameLocalPath(path) || fromName || path || "";
}

/** @param {SidebarSession[] | null | undefined} sessions */
export function sessionListSignature(sessions) {
  return JSON.stringify(
    (sessions ?? []).map((session) => ({
      id: session?.id ?? null,
      name: session?.name ?? null,
      firstMessage: session?.firstMessage ?? null,
      timestamp: session?.timestamp ?? null,
      modifiedAtMs: session?.modifiedAtMs ?? null,
      projectPath: session?.projectPath ?? null,
      projectName: session?.projectName ?? null,
      worktreeOf: session?.worktreeOf ?? null,
      isCurrentWorkspace: session?.isCurrentWorkspace === true,
      kind: session?.kind ?? null,
      status: session?.status ?? null,
      state: session?.state ?? null,
      isWorking: session?.isWorking === true,
      unread: session?.unread === true,
      hasUnread: session?.hasUnread === true,
      target: session?.target ?? null,
      filePath: session?.filePath ?? null,
    })),
  );
}

/** @param {string} value */
export function cssEscape(value) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  // jsdom / older engines: session ids are UUIDs, so a conservative escape is safe.
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

/** @param {SidebarSession | null | undefined} session */
export function isWorkingSession(session) {
  return (
    session?.status === "working" || session?.state === "working" || session?.isWorking === true
  );
}

/** @param {SidebarSession | null | undefined} session */
export function hasLiveStatus(session) {
  return session?.status != null || session?.state != null || session?.isWorking != null;
}

/** @param {SidebarSession | null | undefined} session */
export function isUnreadSession(session) {
  return session?.unread === true || session?.hasUnread === true;
}

/**
 * @param {SidebarSession | null | undefined} existing
 * @param {SidebarSession | null | undefined} incoming
 * @returns {SidebarSession}
 */
export function mergeSessionSummary(existing, incoming) {
  return {
    ...(existing ?? {}),
    ...(incoming ?? {}),
    id: incoming?.id ?? existing?.id ?? "",
    name: incoming?.name ?? existing?.name ?? null,
    firstMessage: existing?.firstMessage ?? incoming?.firstMessage ?? null,
    timestamp: incoming?.timestamp ?? existing?.timestamp ?? new Date().toISOString(),
    modifiedAtMs: incoming?.modifiedAtMs ?? existing?.modifiedAtMs ?? Date.now(),
  };
}

/** @param {string | null | undefined} isoTimestamp */
export function formatSessionTime(isoTimestamp) {
  if (!isoTimestamp) return "";
  try {
    const date = new Date(isoTimestamp);
    if (Number.isNaN(date.getTime())) return "";
    const diffMs = Date.now() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const days = Math.floor(diffMs / 86400000);
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (days === 1) return "Yesterday";
    if (days < 7) return date.toLocaleDateString([], { weekday: "long" });
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}
