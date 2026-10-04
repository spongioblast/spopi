// ABOUTME: The session sidebar's ui.* preference keys, list limits, and best-effort storage access.
// ABOUTME: Values live in uiStore; the sidebar decides when to read and write them.

import { uiStore } from "../storage/ui-store.js";

export const STORAGE = {
  favourites: "ui.sessions.favourites",
  archived: "ui.sessions.archived",
  archivedOpen: "ui.sessions.archivedOpen",
  projectsCollapsed: "ui.sessions.projectsCollapsed",
  unread: "ui.sessions.unread",
  recent: "ui.sessions.recent",
  recentCollapsed: "ui.sessions.recentCollapsed",
};
export const INITIAL_LIMIT = 8;
export const STEP = 10;

// Bounded so the Recent section never crowds out the project groups below it.
export const MAX_RECENT_SESSIONS = 5;

/** @param {string} key @returns {Record<string, unknown>} */
export function readObject(key) {
  try {
    const value = JSON.parse(uiStore.getItem(key) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

/** @param {string} key @returns {string[]} */
export function readArray(key) {
  try {
    const value = JSON.parse(uiStore.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

/** @param {string} key @param {string} value */
export function writeStorage(key, value) {
  try {
    uiStore.setItem(key, value);
  } catch {
    // Sidebar preferences are best-effort; storage quota/private-mode errors
    // must not prevent the live UI interaction from completing.
  }
}

/** @param {string} key @param {unknown} value */
export function saveJson(key, value) {
  writeStorage(key, JSON.stringify(value));
}
