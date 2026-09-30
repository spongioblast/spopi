// ABOUTME: Populates the chat header with workspace path and git branch info.
// ABOUTME: Safe to call repeatedly — each call re-probes and stale probes lose.

import { compactWorkspaceLabel } from "../files/path-utils.js";
import { onLocaleChange, t } from "../i18n/i18n.js";
import { headerChromeRefs } from "./chrome/chat.js";

/**
 * project-header — populates the chat header with workspace path and git
 * branch info fetched from the host data plane.
 *
 * Responsibilities:
 *  - Show the workspace folder name in the #workspace-indicator label inside
 *    #file-sidebar-toggle. Title and aria-label keep the full path.
 *  - Show the current git branch in the #git-branch-indicator label inside
 *    #diff-sidebar-toggle.
 *  - Both labels are hidden when data is unavailable.
 *  - Re-probe on every workspace switch: the caller (app.js adoptTarget)
 *    invokes this again whenever the workspaceId changes, so pill visibility
 *    follows the current workspace even when the git panel is never opened.
 *  - Late/stale probes never win: only the most recently started probe may
 *    touch the DOM.
 *  - Click handling stays on the toggle buttons in app.js: the path label is
 *    display-only, matching the git-branch label.
 */

/**
 * @typedef {{
 *   path?: string,
 *   gitBranch?: string,
 * }} ProjectHeaderInfo
 */

// Sequence of the most recently started probe. A probe that resolves after a
// newer one started is stale and must not touch the DOM.
let latestProbeSequence = 0;

// Info from the latest probe that got applied. The single locale listener
// reads this instead of capturing a per-call closure, so a re-probe cannot
// leave a stale workspace's label-retranslation behind.
/** @type {ProjectHeaderInfo | null} */
let currentHeaderInfo = null;
let localeListenerRegistered = false;

/**
 * Apply the files-toggle title/aria-label for the given workspace path.
 *
 * @param {Element} filesToggleEl
 * @param {ProjectHeaderInfo} info
 */
function applyFilesToggleLabels(filesToggleEl, info) {
  if ("title" in filesToggleEl && typeof info.path === "string") {
    /** @type {{ title: string }} */ (filesToggleEl).title = info.path;
  }
  filesToggleEl.setAttribute("aria-label", t("shell.openFilesPanelLabel", { path: info.path }));
}

/**
 * @param {{
 *   data?: import('../transport/data-gateway.js').HostDataGateway,
 *   workspaceId?: string,
 * }} [options]
 */
export async function mountProjectHeader({ data, workspaceId } = {}) {
  const sequence = ++latestProbeSequence;
  const header = headerChromeRefs();
  const workspaceEl = header.workspaceIndicator;
  const filesToggleEl = header.fileSidebarToggle;
  // The branch label sits inside the diff toggle. The toggle stays hidden
  // until git info is available.
  const branchLabelEl = header.gitBranch;
  const diffToggleEl = header.diffSidebarToggle;
  if (!workspaceEl && !branchLabelEl) return;
  if (!data) return;

  /** @type {ProjectHeaderInfo | null | undefined} */
  let info;
  try {
    const response = await data.workspaceInfo(/** @type {string} */ (workspaceId));
    const payload = /** @type {{ info?: ProjectHeaderInfo }} */ (/** @type {unknown} */ (response));
    info = payload.info;
  } catch {
    // Network or host error — leave the header on its previous state.
    return;
  }
  // A newer probe started while this one was in flight — drop this result so
  // a slow old-workspace answer can never overwrite the new workspace's DOM.
  if (sequence !== latestProbeSequence) return;
  if (!info) return;
  currentHeaderInfo = info;

  if (workspaceEl) {
    if (info.path) {
      workspaceEl.textContent = compactWorkspaceLabel(info.path);
      workspaceEl.classList.remove("hidden");
      if (filesToggleEl) {
        applyFilesToggleLabels(filesToggleEl, info);
        // One listener for the module's lifetime reads currentHeaderInfo, so
        // repeated calls never accumulate listeners nor resurrect stale paths.
        if (!localeListenerRegistered) {
          localeListenerRegistered = true;
          onLocaleChange(() => {
            const currentInfo = currentHeaderInfo;
            if (!currentInfo?.path) return;
            const filesToggle = headerChromeRefs().fileSidebarToggle;
            if (filesToggle) applyFilesToggleLabels(filesToggle, currentInfo);
          });
        }
      }
    } else {
      // No path for this workspace — clear the previous workspace's label
      // instead of leaving it visible.
      workspaceEl.textContent = "";
      workspaceEl.classList.add("hidden");
      if (filesToggleEl) {
        if ("title" in filesToggleEl) {
          /** @type {{ title: string }} */ (filesToggleEl).title = t("shell.filesTitle");
        }
        filesToggleEl.setAttribute("aria-label", t("shell.toggleFileBrowserLabel"));
      }
    }
  }

  if (diffToggleEl) {
    if (info.gitBranch) {
      if (branchLabelEl) branchLabelEl.textContent = info.gitBranch;
      if ("title" in diffToggleEl) {
        /** @type {{ title: string }} */ (diffToggleEl).title = t("git.changesWithBranch", {
          branch: info.gitBranch,
        });
      }
      diffToggleEl.classList.remove("hidden");
    } else {
      diffToggleEl.classList.add("hidden");
    }
  }
}
