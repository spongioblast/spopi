// ABOUTME: Info sidebar mount — session tree, workspace path, and resume.
// ABOUTME: A sequence guard drops a tree response that arrives after a session switch.

import { toggleExclusiveSidePanel } from "../shell/exclusive-side-panel.js";
import { copyText } from "../ui/clipboard.js";
import { InfoPanel } from "./info-panel.js";
import {
  consumeSummarizeNavigate,
  sessionTreeModel,
  startSessionTreeModel,
} from "./session-tree-host.js";

/**
 * @param {object} options
 * @param {HTMLElement | null | undefined} options.infoSidebar
 * @param {HTMLElement | null | undefined} options.panel
 * @param {ParentNode | null} options.messages the chat list a tree row scrolls to
 * @param {HTMLElement | null | undefined} options.infoClose
 * @param {HTMLElement | null | undefined} options.infoRefresh
 * @param {HTMLElement | null | undefined} options.infoSidebarToggle
 * @param {HTMLElement | null | undefined} options.fileSidebar
 * @param {(key: string, params?: object) => string} options.t
 * @param {{
 *   workspaceInfo: (workspaceId: string) => Promise<{ info?: { path?: string } }>,
 * }} options.data
 * @param {{ request: (payload: object, target: object) => Promise<{ response?: { data?: { entries?: Array<object>, leafId?: string | null } } }> }} options.runtime
 * @param {() => { workspaceId: string, sessionId: string }} options.getTarget
 * @param {() => boolean} options.isWorking
 * @param {{ call: (method: string, params: object, opts?: { timeoutMs?: number }) => Promise<{ ok?: boolean, error?: string }> }} options.config
 * @param {() => Promise<void>} options.hydrateSnapshot
 * @param {() => void} options.syncSessionInfo
 */
export function mountInfoSidebar({
  infoSidebar,
  panel,
  messages,
  infoClose,
  infoRefresh,
  infoSidebarToggle,
  fileSidebar,
  t,
  data,
  runtime,
  getTarget,
  isWorking,
  config,
  hydrateSnapshot,
  syncSessionInfo,
}) {
  let infoTreeSeq = 0;
  let treeSubscribed = false;
  async function copyWorkspacePath() {
    const path = infoPanel?.workspacePath || "";
    if (!path) return "";
    try {
      await copyText(path);
      return path;
    } catch (err) {
      console.error("[InfoPanel] Failed to copy workspace path:", err);
      return "";
    }
  }
  const infoPanel = infoSidebar
    ? new InfoPanel({
        panel: /** @type {HTMLElement} */ (panel),
        messages,
        actions: { copyWorkspacePath },
        t,
        onNavigateLeaf: (entryId) => navigateActiveTree(entryId),
        isStreaming: isWorking,
      })
    : null;

  /**
   * @param {object} [refreshOptions]
   * @param {boolean} [refreshOptions.refreshWorkspace]
   */
  async function refreshInfoPanel({ refreshWorkspace = false } = {}) {
    if (!infoPanel || !infoSidebar || infoSidebar.classList.contains("collapsed")) return;
    // Sequence guard: a session switch while a fetch is in flight must not let
    // the stale response repaint the new session's tree.
    const seq = ++infoTreeSeq;
    const target = getTarget();
    if (refreshWorkspace) {
      try {
        const response = await data.workspaceInfo(target.workspaceId);
        infoPanel.updateWorkspace(response?.info?.path ?? "");
      } catch {
        // Workspace path stays at the last known value; the tree still loads.
      }
    }
    syncSessionInfo();
    const treeModel =
      sessionTreeModel() ||
      startSessionTreeModel({
        request: (cmd, next) => runtime.request(cmd, /** @type {object} */ (next || target)),
        getTarget,
      });
    if (!treeSubscribed) {
      treeSubscribed = true;
      treeModel.subscribe((snapshot) => {
        if (!infoPanel) return;
        infoPanel.updateTree({
          entries: /** @type {import("./info-panel.js").SessionEntry[]} */ (snapshot.entries),
          leafId: snapshot.leafId,
        });
      });
    }
    try {
      await treeModel.load();
      if (seq !== infoTreeSeq) return;
    } catch (error) {
      console.warn("[InfoPanel] tree refresh failed:", error);
    }
  }

  /**
   * @param {string} entryId
   */
  async function navigateActiveTree(entryId) {
    if (!entryId || isWorking()) return;
    // pi-workspace-history asks (conversation only / with files) before the
    // tree moves; the request has to outlive that dialog.
    const result = await config.call(
      "navigate_tree",
      {
        targetId: entryId,
        summarize: consumeSummarizeNavigate(),
        label: t("infoPanel.resumeBranch"),
      },
      { timeoutMs: 10 * 60_000 },
    );
    if (!result?.ok) throw new Error(result?.error || "Session tree navigation failed");
    await hydrateSnapshot();
    if (infoSidebar && !infoSidebar.classList.contains("collapsed")) {
      await refreshInfoPanel();
    }
  }

  function openInfoPanel() {
    const opened = toggleExclusiveSidePanel(infoSidebar, [fileSidebar]);
    if (opened) void refreshInfoPanel({ refreshWorkspace: true });
  }

  function closeInfoPanel() {
    infoSidebar?.classList.add("collapsed");
  }

  function onRefreshClick() {
    void refreshInfoPanel({ refreshWorkspace: true });
  }

  infoSidebarToggle?.addEventListener("click", openInfoPanel);
  infoClose?.addEventListener("click", closeInfoPanel);
  infoRefresh?.addEventListener("click", onRefreshClick);

  return {
    infoSidebar,
    infoPanel,
    refreshInfoPanel,
    navigateActiveTree,
    get infoTreeSeq() {
      return infoTreeSeq;
    },
    set infoTreeSeq(value) {
      infoTreeSeq = value;
    },
    destroy() {
      infoSidebarToggle?.removeEventListener("click", openInfoPanel);
      infoClose?.removeEventListener("click", closeInfoPanel);
      infoRefresh?.removeEventListener("click", onRefreshClick);
    },
  };
}
