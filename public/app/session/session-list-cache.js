// ABOUTME: Memory-only cache of the last session list per workspace, for an instant first paint.
// ABOUTME: The host list stays the source of truth; the sidebar overwrites the cache after every load.

/**
 * @typedef {import("./session-sidebar.js").SidebarSession} SidebarSession
 */

const sessionCache = new Map();

/** @param {string | null | undefined} workspaceId */
function sessionCacheKey(workspaceId) {
  return workspaceId || "latest";
}

/**
 * @param {string | null | undefined} workspaceId
 * @param {string | null | undefined} activeSessionId
 * @returns {SidebarSession[]}
 */
export function readSessionCache(workspaceId, activeSessionId) {
  const workspaceValue = sessionCache.get(sessionCacheKey(workspaceId));
  if (Array.isArray(workspaceValue) && workspaceValue.length > 0) return workspaceValue;
  const latestValue = sessionCache.get("latest");
  return Array.isArray(latestValue) ? rebaseCachedSessions(latestValue, activeSessionId) : [];
}

/**
 * @param {string | null | undefined} workspaceId
 * @param {SidebarSession[]} sessions
 */
export function writeSessionCache(workspaceId, sessions) {
  sessionCache.set(sessionCacheKey(workspaceId), sessions);
  sessionCache.set("latest", sessions);
}

export function clearSessionListCache() {
  sessionCache.clear();
}

/**
 * @param {string | null | undefined} workspaceId
 * @param {SidebarSession[]} sessions
 */
export function seedSessionListCache(workspaceId, sessions) {
  writeSessionCache(workspaceId, sessions);
}

/**
 * @param {SidebarSession[]} sessions
 * @param {string | null | undefined} activeSessionId
 * @returns {SidebarSession[]}
 */
function rebaseCachedSessions(sessions, activeSessionId) {
  const active = sessions.find((session) => session?.id === activeSessionId);
  const activeProjectPath = active?.projectPath;
  if (!activeProjectPath) return sessions;
  return sessions.map((session) => ({
    ...session,
    isCurrentWorkspace: session?.projectPath === activeProjectPath,
  }));
}
