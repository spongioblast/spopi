// ABOUTME: Shared workspace action source feeding the Info panel's app rows.
// ABOUTME: Mirrors header-open-app: same gateway calls, one controller per consumer.

import { copyText } from "../ui/clipboard.js";

/**
 * Workspace app actions — the controller behind the Info panel's
 * "open workspace in app" rows.
 *
 * One action source, two render locations: the header keeps its own
 * split-button (header-open-app.js); this module is the Info panel's
 * controller. Both go through the SAME transport surface
 * (control.listInstalledApps / control.openInApp) and the brand marks in
 * header-open-app.js, so launch behavior and iconography cannot drift.
 */

/**
 * @typedef {{ appName?: string | null, command?: string | null }} WorkspaceApp
 */

/**
 * Create the Info panel's workspace-action controller.
 *
 * @param {object} [options]
 * @param {{ listInstalledApps?: Function, openInApp?: Function } | null} [options.control]
 * @param {() => string} [options.getWorkspacePath]
 * @param {(apps: Array<WorkspaceApp>) => void} [options.onAppsLoaded]
 */
export function createWorkspaceAppActions({ control, getWorkspacePath, onAppsLoaded } = {}) {
  /** @type {{ apps: Array<WorkspaceApp>, appsLoaded: boolean }} */
  const state = { apps: [], appsLoaded: false };

  /**
   * @param {object} [loadOptions]
   * @param {boolean} [loadOptions.force]
   */
  async function loadApps({ force = false } = {}) {
    // listInstalledApps spawns a host probe; once loaded for this workspace,
    // reuse the cached list unless the workspace changed (force).
    if (!force && state.appsLoaded) return;
    if (!control?.listInstalledApps) return;
    try {
      const apps = await control.listInstalledApps();
      state.apps = Array.isArray(apps) ? apps : [];
      state.appsLoaded = true;
      onAppsLoaded?.(state.apps);
    } catch (err) {
      console.error("[WorkspaceAppActions] Failed to load installed apps:", err);
    }
  }

  /**
   * Open the workspace in `app`.
   * @param {WorkspaceApp | null | undefined} app
   */
  async function openWorkspaceInApp(app) {
    const path = /** @type {() => string} */ (getWorkspacePath)();
    if (!control?.openInApp || !app || !path) return;
    try {
      await control.openInApp(path, {
        appName: app.appName ?? null,
        command: app.command ?? null,
      });
    } catch (err) {
      console.error("[WorkspaceAppActions] Failed to open workspace in app:", err);
    }
  }

  /** Copy the workspace path. Returns the copied text, or "" when unavailable. */
  async function copyWorkspacePath() {
    const path = /** @type {() => string} */ (getWorkspacePath)();
    if (!path) return "";
    try {
      await copyText(path);
      return path;
    } catch (err) {
      console.error("[WorkspaceAppActions] Failed to copy workspace path:", err);
      return "";
    }
  }

  return {
    get apps() {
      return state.apps;
    },
    loadApps,
    openWorkspaceInApp,
    copyWorkspacePath,
  };
}
