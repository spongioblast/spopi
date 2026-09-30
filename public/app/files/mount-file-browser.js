// ABOUTME: Wires the Files rail panel to FileTree: refresh, hidden, Finder, collapse.
// ABOUTME: Under .spopi-shell, Ctrl+B stays with the shell; SPOPI's bind is skipped.

import { FileTree } from "./file-tree.js";
import { createFileTreeHooks } from "./file-tree-hooks.js";
import { filesFromGitSnapshot } from "./file-tree-model.js";

/**
 * @typedef {import("./file-tree.js").FileTree} FileTreeInstance
 * @typedef {import("./file-tree.js").FileEntry} FileEntry
 * @typedef {{ insert: (value: string, isDirectory: boolean) => void }} MentionHandle
 * @typedef {{
 *   FileTree?: typeof import("./file-tree.js").FileTree,
 *   fileList?: HTMLElement | null,
 *   pathEl?: HTMLElement | null,
 *   sidebarEl?: HTMLElement | null,
 *   data: import("./file-tree.js").FileTreeGateway & {
 *     workspaceInfo: (id: string | undefined) => Promise<{ path?: string, info?: { path?: string } } | null | undefined>,
 *   },
 *   workspaceId?: string,
 *   openWorkspaceRelativePath: (path: string | undefined) => Promise<unknown>,
 *   filePreviewPanel?: { openFile: (path: string | undefined, meta: { fileName?: string, size?: number, mode?: string }) => void } | null,
 *   atFileMention?: MentionHandle | null,
 *   getAtFileMention?: () => MentionHandle | null | undefined,
 *   input: { focus: () => void },
 *   buildAtMentionValue: (path: string | undefined, isDirectory: boolean) => string,
 *   composerAutoResize: { sync: () => void },
 *   showError: (error: unknown) => void,
 *   openFilesPanel: () => void,
 *   openGitPanel: () => void,
 *   isMacOS: () => boolean,
 *   isFilePanelShortcut: (event: KeyboardEvent) => boolean,
 *   setFileBrowser?: (tree: FileTreeInstance | null) => void,
 *   control?: { revealPath: (path: string, options: { workspaceId?: string }) => Promise<unknown> } | null,
 *   preferences?: {
 *     get?: (key: string) => Promise<unknown>,
 *     set?: (key: string, value: unknown) => Promise<unknown>,
 *   } | null,
 *   getWorkspaceId?: () => string | undefined,
 *   runtime?: { git?: (command: Record<string, unknown>, target: unknown) => Promise<unknown> } | null,
 *   getTarget?: () => unknown,
 *   onRunFile?: (path: string | undefined) => unknown,
 *   upBtn?: HTMLButtonElement | null,
 *   refreshBtn?: HTMLElement | null,
 *   toggleHiddenBtn?: HTMLElement | null,
 *   collapseBtn?: HTMLElement | null,
 *   finderBtn?: HTMLElement | null,
 *   closeBtn?: HTMLElement | null,
 *   fileSidebarToggle?: HTMLElement | null,
 *   diffSidebarToggle?: HTMLElement | null,
 * }} FileBrowserDeps
 */

/** @param {unknown} selectedPath @returns {string} */
export function fileManagerPath(selectedPath) {
  const path = typeof selectedPath === "string" ? selectedPath.trim() : "";
  return path || ".";
}

/** Explorer exits 1 after opening the window. That is not a failed reveal. */
/** @param {unknown} error @returns {boolean} */
export function isHarmlessFileManagerExit(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /File manager exited with status exit code:\s*1\b/.test(message);
}

/** @param {FileBrowserDeps} deps */
export function connectFileTree(deps) {
  /** @type {FileTreeInstance | null} */
  let tree = null;
  const hooks = createFileTreeHooks({
    getTree: () => tree,
    showError: deps.showError,
  });
  return {
    hooks,
    get tree() {
      return tree;
    },
    setup() {
      tree = mountFileBrowser({
        ...deps,
        FileTree,
        workspaceId: deps.getWorkspaceId?.() || deps.workspaceId,
        fileList: deps.fileList,
        pathEl: deps.pathEl,
        sidebarEl: deps.sidebarEl,
        setFileBrowser: (next) => {
          tree = next;
        },
      });
      return tree;
    },
  };
}

/** @param {FileBrowserDeps} options */
function mountFileBrowser({
  FileTree,
  fileList,
  pathEl,
  sidebarEl,
  data,
  workspaceId,
  openWorkspaceRelativePath,
  filePreviewPanel,
  atFileMention,
  getAtFileMention,
  input,
  buildAtMentionValue,
  composerAutoResize,
  showError,
  openFilesPanel,
  openGitPanel,
  isMacOS,
  isFilePanelShortcut,
  setFileBrowser,
  control,
  preferences,
  getWorkspaceId,
  runtime,
  getTarget,
  onRunFile,
  upBtn,
  refreshBtn,
  toggleHiddenBtn,
  collapseBtn,
  finderBtn,
  closeBtn,
  fileSidebarToggle,
  diffSidebarToggle,
}) {
  if (!sidebarEl || !fileList || !pathEl || !FileTree) return null;
  if (upBtn) upBtn.disabled = true;
  const activeWorkspace = () => getWorkspaceId?.() || workspaceId;

  const fileTree = new FileTree(fileList, {
    gateway: data,
    workspaceId,
    pathEl,
    onFileOpen(entry) {
      openWorkspaceRelativePath(entry.relativePath).catch(showError);
    },
    onFileSelect(entry) {
      filePreviewPanel?.openFile(entry.relativePath, {
        fileName: entry.name,
        size: entry.size,
        mode: entry.mode,
      });
    },
    onMention(entry) {
      const mention = getAtFileMention?.() || atFileMention;
      if (!mention) return;
      const isDirectory = Boolean(entry.kind === "directory" || entry.isDirectory);
      const value = buildAtMentionValue(entry.relativePath, isDirectory);
      input.focus();
      mention.insert(value, isDirectory);
      composerAutoResize.sync();
    },
    onReveal(relativePath) {
      return control
        ?.revealPath(relativePath, { workspaceId: activeWorkspace() })
        ?.catch(reportFileManagerError);
    },
    onRun(relativePath) {
      return onRunFile?.(relativePath);
    },
    persistExpanded: async (paths, id) => {
      const stored = await preferences?.get?.("ui.files.expanded");
      const current = /** @type {Record<string, string[]>} */ (
        stored && typeof stored === "object" ? stored : {}
      );
      await preferences?.set?.("ui.files.expanded", { ...current, [id]: paths.slice(0, 200) });
    },
    loadExpanded: async (id) => {
      const stored = await preferences?.get?.("ui.files.expanded");
      const current = /** @type {Record<string, string[]>} */ (
        stored && typeof stored === "object" ? stored : {}
      );
      return current[id] || [];
    },
    workspaceInfo: async () => {
      const info = await data.workspaceInfo(activeWorkspace());
      return { path: info?.path ?? info?.info?.path ?? "" };
    },
    loadGitStatus: async () => {
      const target = getTarget?.();
      if (!runtime?.git || !target) return [];
      return filesFromGitSnapshot(await runtime.git({ type: "status" }, target));
    },
    onShowHiddenChange(showHidden) {
      toggleHiddenBtn?.setAttribute("aria-pressed", String(showHidden));
    },
  });
  setFileBrowser?.(fileTree);

  refreshBtn?.addEventListener("click", () => fileTree.refresh()?.catch(showError));
  collapseBtn?.addEventListener("click", () => fileTree.collapseAll());
  toggleHiddenBtn?.addEventListener("click", () => {
    fileTree.setShowHidden(!fileTree.showHidden)?.catch(showError);
  });
  finderBtn?.addEventListener("click", async () => {
    try {
      await control?.revealPath(fileManagerPath(fileTree.selectedPath), {
        workspaceId: activeWorkspace(),
      });
    } catch (error) {
      reportFileManagerError(error);
    }
  });

  /** @param {unknown} error */
  function reportFileManagerError(error) {
    if (isHarmlessFileManagerExit(error)) return;
    showError(error);
  }
  const toggleBtn = fileSidebarToggle;
  toggleBtn?.addEventListener("click", openFilesPanel);
  if (toggleBtn) {
    const shortcutLabel = isMacOS() ? "⌘B" : "Ctrl+B";
    toggleBtn.title = `${toggleBtn.title || "Files"} (${shortcutLabel})`;
  }
  if (!document.querySelector(".spopi-shell")) {
    document.addEventListener("keydown", (event) => {
      if (!isFilePanelShortcut(event)) return;
      event.preventDefault();
      openFilesPanel();
    });
  }
  closeBtn?.addEventListener("click", () => {
    sidebarEl.classList.add("collapsed");
  });
  diffSidebarToggle?.addEventListener("click", openGitPanel);
  return fileTree;
}

/**
 * @param {{
 *   mountResizablePanel: (
 *     element: HTMLElement | null | undefined,
 *     options: {
 *       storageKey: string,
 *       defaultWidth: number,
 *       minWidth: number,
 *       maxWidth: number,
 *       side: string,
 *     },
 *   ) => void,
 *   sidebarEl?: HTMLElement | null,
 *   toggleBtn?: HTMLElement | null,
 *   overlay?: HTMLElement | null,
 *   fileSidebarEl?: HTMLElement | null,
 * }} options
 */
export function mountSidebarToggle({
  mountResizablePanel,
  sidebarEl,
  toggleBtn,
  overlay,
  fileSidebarEl,
}) {
  if (document.querySelector(".spopi-shell")) return;
  if (!sidebarEl || !toggleBtn) return;
  const isMobile = () => window.innerWidth <= 768;
  /** @param {boolean} collapsed */
  const setCollapsed = (collapsed) => {
    sidebarEl.classList.toggle("collapsed", collapsed);
    overlay?.classList.toggle("visible", !collapsed && isMobile());
  };
  if (isMobile()) setCollapsed(true);
  toggleBtn.addEventListener("click", () => {
    setCollapsed(!sidebarEl.classList.contains("collapsed"));
  });
  overlay?.addEventListener("click", () => setCollapsed(true));
  overlay?.addEventListener("touchend", (e) => {
    e.preventDefault();
    setCollapsed(true);
  });
  mountResizablePanel(sidebarEl, {
    storageKey: "ui.layout.sidebarWidth",
    defaultWidth: 272,
    minWidth: 200,
    maxWidth: 480,
    side: "left",
  });
  mountResizablePanel(fileSidebarEl, {
    storageKey: "ui.layout.fileSidebarWidth",
    defaultWidth: 260,
    minWidth: 200,
    maxWidth: 500,
    side: "right",
  });
}
