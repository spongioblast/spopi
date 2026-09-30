// ABOUTME: File preview panel mount for the center editor column.
// ABOUTME: Opens a workspace-relative path on the desktop through the host.

import { createFileApi } from "../transport/workspace-http.js";
import { FilePreviewPanel } from "./file-preview-panel.js";

/**
 * @param {object} options
 * @param {HTMLElement | null | undefined} options.panel
 * @param {HTMLElement | null | undefined} options.resizer
 * @param {HTMLElement | null | undefined} options.tabBar
 * @param {HTMLElement | null | undefined} options.content
 * @param {import("./file-preview-panel.js").FilePreviewControls | null | undefined} [options.controls]
 * @param {HTMLElement | null | undefined} [options.fileSidebarToggle]
 * @param {HTMLElement | null | undefined} options.mainContainer
 * @param {() => string} options.getWorkspaceId
 * @param {{ workspaceInfo: (id: string) => Promise<{ path?: string } | null | undefined> }} options.data
 * @param {{ openInApp: (path: string) => Promise<unknown> | unknown }} options.control
 * @param {(error: unknown) => void} options.showError
 * @param {((collapsed: boolean) => void) | null | undefined} [options.onToggleChat]
 */
export function mountFilePreview({
  panel,
  resizer,
  tabBar,
  content,
  controls,
  fileSidebarToggle,
  mainContainer,
  getWorkspaceId,
  data,
  control,
  showError,
  onToggleChat,
}) {
  /**
   * @param {string} [relativePath]
   */
  async function openWorkspaceRelativePath(relativePath = "") {
    const info = await data.workspaceInfo(getWorkspaceId());
    const root = info?.path ?? "";
    const normalizedRelative = String(relativePath || "").replace(/^\/+/, "");
    const absolutePath = normalizedRelative ? `${root}/${normalizedRelative}` : root;
    await control.openInApp(absolutePath);
  }

  if (!panel || !resizer || !tabBar || !content || !mainContainer) {
    return { panel: null, openWorkspaceRelativePath };
  }

  const apiOptions = { workspaceId: getWorkspaceId };
  const fileApi = /** @type {import("./file-preview-panel.js").FilePreviewFileApi} */ (
    /** @type {unknown} */ (createFileApi(apiOptions))
  );
  return {
    panel: new FilePreviewPanel({
      panel,
      resizer,
      tabBar,
      content,
      mainContainer,
      fileApi,
      onOpenDesktop: (relativePath) => openWorkspaceRelativePath(relativePath).catch(showError),
      onToggleChat,
      controls,
      fileSidebarToggle,
    }),
    openWorkspaceRelativePath,
  };
}
