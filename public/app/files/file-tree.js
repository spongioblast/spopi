// ABOUTME: Lazy Files tree: expand one directory per host list_files call.
// ABOUTME: Keyboard, context menu, persisted expanded set, best-effort git badges.

import { createFileTypeIcon } from "../editor/file-type-icons.js";
import { t } from "../i18n/i18n.js";
import { runCommandForFile } from "../terminal/run-file.js";
import { copyText } from "../ui/clipboard.js";
import { registerContextMenuHost, showContextMenu } from "../ui/context-menu.js";
import {
  ancestorPaths,
  applyDir,
  applyGitOverlay,
  collapseAll,
  createFileTreeState,
  nextGeneration,
  pathsToReload,
  persistExpandedPaths,
  restoreExpanded,
  toggleExpanded,
  visibleRows,
} from "./file-tree-model.js";
import { parentPath } from "./path-utils.js";

/**
 * @typedef {import("./file-tree-model.js").FileTreeEntry} FileEntry
 * @typedef {import("./file-tree-model.js").FileTreeRow} FileTreeRow
 * @typedef {import("./file-tree-model.js").GitStatusFile} GitStatusFile
 * @typedef {(key: string, params?: Record<string, unknown>) => string} TranslateFn
 * @typedef {{
 *   listFiles: (
 *     workspaceId: string,
 *     path: string,
 *     showHidden: boolean,
 *   ) => Promise<{ entries?: FileEntry[] } | null | undefined>,
 * }} FileTreeGateway
 * @typedef {{
 *   gateway: FileTreeGateway,
 *   workspaceId?: string,
 *   pathEl?: HTMLElement | null,
 *   onFileSelect?: (entry: FileEntry) => void,
 *   onFileOpen?: (entry: FileEntry) => void,
 *   onMention?: (entry: FileEntry) => void,
 *   onReveal?: (path: string) => unknown,
 *   onRun?: (path: string) => unknown,
 *   onCopy?: (text: string) => unknown,
 *   onShowHiddenChange?: (value: boolean) => void,
 *   persistExpanded?: (paths: string[], workspaceId: string) => unknown,
 *   loadExpanded?: (workspaceId: string) => Promise<unknown>,
 *   workspaceInfo?: () => Promise<{ path?: string, info?: { path?: string } } | null | undefined>,
 *   loadGitStatus?: () => Promise<GitStatusFile[]>,
 *   t?: TranslateFn,
 * }} FileTreeOptions
 */

export class FileTree {
  #container;
  /** @type {HTMLElement | null} */
  #pathEl;
  #gateway;
  #onFileSelect;
  #onFileOpen;
  #onMention;
  #onReveal;
  #onRun;
  #onCopy;
  #onShowHiddenChange;
  #persistExpanded;
  #loadExpanded;
  #workspaceInfo;
  #loadGitStatus;
  #translate;
  #state;
  #workspaceRoot = "";
  loaded = false;
  showHidden = false;

  /**
   * @param {HTMLElement} container
   * @param {FileTreeOptions} [options]
   */
  constructor(
    container,
    {
      gateway,
      workspaceId,
      pathEl = null,
      onFileSelect,
      onFileOpen,
      onMention,
      onReveal,
      onRun,
      onCopy,
      onShowHiddenChange,
      persistExpanded,
      loadExpanded,
      workspaceInfo,
      loadGitStatus,
      t: translate = t,
    } = /** @type {FileTreeOptions} */ ({}),
  ) {
    this.#container = container;
    this.#pathEl = pathEl;
    this.#gateway = gateway;
    this.#onFileSelect = onFileSelect;
    this.#onFileOpen = onFileOpen;
    this.#onMention = onMention;
    this.#onReveal = onReveal;
    this.#onRun = onRun;
    this.#onCopy = onCopy || copyText;
    this.#onShowHiddenChange = onShowHiddenChange;
    this.#persistExpanded = persistExpanded;
    this.#loadExpanded = loadExpanded;
    this.#workspaceInfo = workspaceInfo;
    this.#loadGitStatus = loadGitStatus;
    this.#translate = translate;
    this.#state = createFileTreeState({ workspaceId: workspaceId || "" });
    this.#container.classList.add("file-tree");
    this.#container.setAttribute("role", "tree");
    this.#container.tabIndex = 0;
    this.#container.addEventListener("click", (event) => this.#onClick(event));
    this.#container.addEventListener("dblclick", (event) => this.#onDblClick(event));
    this.#container.addEventListener("contextmenu", (event) => this.#onContext(event));
    registerContextMenuHost(this.#container);
    this.#container.addEventListener("keydown", (event) => this.#onKey(event));
  }

  get workspaceId() {
    return this.#state.workspaceId;
  }

  get selectedPath() {
    return this.#state.selectedPath;
  }

  async load() {
    if (this.#loadExpanded) {
      try {
        restoreExpanded(this.#state, await this.#loadExpanded(this.#state.workspaceId));
      } catch {
        restoreExpanded(this.#state, []);
      }
    }
    return this.#reload({ keepSelected: false });
  }

  refresh() {
    return this.#reload({ keepSelected: true });
  }

  /** @param {string} id */
  async setWorkspaceId(id) {
    if (id === this.#state.workspaceId) return;
    this.#state = createFileTreeState({ workspaceId: id || "", showHidden: this.showHidden });
    this.loaded = false;
    await this.load();
  }

  /** @param {boolean} value */
  setShowHidden(value) {
    const next = Boolean(value);
    if (next === this.showHidden) return undefined;
    this.showHidden = next;
    this.#state.showHidden = next;
    this.#onShowHiddenChange?.(next);
    return this.refresh();
  }

  collapseAll() {
    collapseAll(this.#state);
    void this.#persist();
    this.#render();
  }

  /** @param {string} relativePath */
  async revealAndSelect(relativePath) {
    for (const ancestor of ancestorPaths(relativePath)) {
      this.#state.expanded.add(ancestor);
      if (!this.#state.childrenByPath.has(ancestor)) {
        const gen = this.#state.generation;
        await this.#listInto(ancestor, gen);
      }
    }
    this.#state.selectedPath = relativePath;
    this.#render();
  }

  /** @param {{ keepSelected?: boolean }} options */
  async #reload({ keepSelected }) {
    const scrollTop = this.#container.scrollTop;
    const selected = keepSelected ? this.#state.selectedPath : null;
    const gen = nextGeneration(this.#state);
    try {
      const listed = await this.#listInto("", gen);
      if (!listed) return;
      this.loaded = true;
      await this.#rehydrate(gen);
      await this.#overlayGit();
      await this.#refreshLabel();
      if (keepSelected) this.#state.selectedPath = selected;
      this.#render();
      this.#container.scrollTop = scrollTop;
    } catch (error) {
      if (gen !== this.#state.generation) return;
      this.#renderError(error);
    }
  }

  /**
   * @param {string} path
   * @param {number} generation
   */
  async #listInto(path, generation) {
    const response = await this.#gateway.listFiles(this.#state.workspaceId, path, this.showHidden);
    return applyDir(this.#state, path, response?.entries || [], generation);
  }

  /** @param {number} generation */
  async #rehydrate(generation) {
    for (const path of pathsToReload(this.#state)) {
      if (path === "" || generation !== this.#state.generation) continue;
      try {
        const ok = await this.#listInto(path, generation);
        if (!ok) return;
      } catch {
        this.#state.expanded.delete(path);
      }
    }
  }

  async #overlayGit() {
    try {
      const files = this.#loadGitStatus ? await this.#loadGitStatus() : [];
      applyGitOverlay(this.#state, files);
    } catch {
      applyGitOverlay(this.#state, []);
    }
  }

  async #refreshLabel() {
    if (!this.#pathEl) return;
    try {
      const info = (await this.#workspaceInfo?.()) || {};
      this.#workspaceRoot = info.path || info.info?.path || "";
      const name = this.#workspaceRoot.split(/[\\/]/).filter(Boolean).pop() || "/";
      this.#pathEl.textContent = name;
      this.#pathEl.title = this.#workspaceRoot || name;
      this.#pathEl.classList.add("is-workspace-name");
    } catch {
      this.#pathEl.textContent = "/";
    }
  }

  async #persist() {
    try {
      await this.#persistExpanded?.(persistExpandedPaths(this.#state), this.#state.workspaceId);
    } catch {
      // Persistence is best-effort.
    }
  }

  /** @param {string} path */
  async #expandPath(path) {
    const { expanded, needsLoad } = toggleExpanded(this.#state, path);
    if (expanded && needsLoad) {
      const gen = nextGeneration(this.#state);
      try {
        await this.#listInto(path, gen);
      } catch {
        this.#state.expanded.delete(path);
      }
    }
    await this.#persist();
    this.#render();
  }

  #render() {
    const rows = visibleRows(this.#state);
    this.#container.replaceChildren();
    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "file-tree-empty";
      empty.textContent = this.#translate("files.empty") || "Empty folder";
      this.#container.append(empty);
      return;
    }
    for (const row of rows) this.#container.append(this.#rowEl(row));
  }

  /** @param {unknown} error */
  #renderError(error) {
    const wrap = document.createElement("div");
    wrap.className = "file-tree-error";
    const message = document.createElement("span");
    const detail =
      error && typeof error === "object" && "message" in error ? String(error.message) : "";
    message.textContent = detail || this.#translate("files.failedLoad") || "Failed to load";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "ui-button ui-button--sm";
    retry.textContent = this.#translate("files.retry") || "Retry";
    retry.addEventListener("click", () => this.refresh());
    wrap.append(message, retry);
    this.#container.replaceChildren(wrap);
  }

  /** @param {FileTreeRow} row */
  #rowEl(row) {
    const el = document.createElement("div");
    el.className = "file-tree-row";
    el.setAttribute("role", "treeitem");
    el.setAttribute("aria-label", row.name || "");
    el.setAttribute("aria-level", String(row.depth + 1));
    el.setAttribute("aria-selected", String(row.path === this.#state.selectedPath));
    if (row.kind === "directory") el.setAttribute("aria-expanded", String(row.expanded));
    el.dataset.path = row.path;
    el.dataset.kind = row.kind;
    el.dataset.depth = String(row.depth);
    el.style.paddingLeft = `${6 + row.depth * 12}px`;

    const chevron = document.createElement("span");
    chevron.className = "file-tree-chevron";
    chevron.textContent = row.kind === "directory" ? (row.expanded ? "▼" : "▶") : "";
    const icon = document.createElement("span");
    icon.className = "file-tree-icon";
    icon.append(
      createFileTypeIcon(
        { name: row.name, isDirectory: row.kind === "directory", expanded: row.expanded },
        { size: 14 },
      ),
    );
    const name = document.createElement("span");
    name.className = "file-name";
    name.textContent = row.name || "";
    el.append(chevron, icon, name);
    if (row.kind === "directory" && row.gitStatus) {
      el.dataset.git = row.gitStatus;
      const dot = document.createElement("span");
      dot.className = "file-git-dot";
      dot.title = this.#translate("files.git.inside");
      el.append(dot);
    }
    if (row.kind === "file" && row.gitCode) {
      if (row.gitStatus) el.dataset.git = row.gitStatus;
      const badge = document.createElement("span");
      badge.className = "file-git-badge";
      badge.dataset.gitStatus = row.gitCode;
      badge.textContent = row.gitCode;
      const label = row.gitStatus ? this.#translate(`files.git.${row.gitStatus}`) : "";
      if (label) badge.title = label;
      el.append(badge);
    }
    if (this.#onMention) {
      const onMention = this.#onMention;
      const mention = document.createElement("button");
      mention.type = "button";
      mention.className = "file-tree-mention";
      const glyph = document.createElement("span");
      glyph.setAttribute("aria-hidden", "true");
      glyph.textContent = "@";
      mention.append(glyph);
      mention.title = this.#translate("files.mentionInChat") || "Mention in chat";
      mention.setAttribute("aria-label", this.#translate("files.mentionInChat"));
      mention.addEventListener("click", (event) => {
        event.stopPropagation();
        onMention({ name: row.name, relativePath: row.path, kind: row.kind });
      });
      el.append(mention);
    }
    return el;
  }

  /**
   * @param {Event} event
   * @returns {HTMLElement | null}
   */
  #rowFromEvent(event) {
    const target = event.target;
    if (
      !target ||
      typeof target !== "object" ||
      !("closest" in target) ||
      typeof target.closest !== "function"
    ) {
      return null;
    }
    const row = target.closest(".file-tree-row");
    if (!row || !("dataset" in row)) return null;
    return /** @type {HTMLElement} */ (row);
  }

  /** @param {string} path */
  #select(path) {
    this.#state.selectedPath = path;
    this.#render();
  }

  /** @param {string} path */
  #entry(path) {
    const parent = parentPath(path) ?? "";
    return (this.#state.childrenByPath.get(parent) || []).find(
      (item) => item.relativePath === path,
    );
  }

  /** @param {MouseEvent} event */
  #onClick(event) {
    const row = this.#rowFromEvent(event);
    if (!row) return;
    const path = row.dataset.path;
    if (!path) return;
    const kind = row.dataset.kind;
    this.#select(path);
    if (kind === "directory") {
      event.stopPropagation();
      void this.#expandPath(path);
      return;
    }
    const entry = this.#entry(path);
    if (entry) this.#onFileSelect?.(entry);
  }

  /** @param {MouseEvent} event */
  #onDblClick(event) {
    const row = this.#rowFromEvent(event);
    if (row?.dataset.kind !== "file") return;
    const path = row.dataset.path;
    if (!path) return;
    const entry = this.#entry(path);
    if (entry) this.#onFileOpen?.(entry);
  }

  /** @param {MouseEvent} event */
  #onContext(event) {
    event.preventDefault();
    const row = this.#rowFromEvent(event);
    if (!row) {
      showContextMenu({ event, items: this.#blankItems() });
      return;
    }
    const path = row.dataset.path;
    if (!path) return;
    this.#select(path);
    showContextMenu({ event, items: this.#rowItems(path, row.dataset.kind) });
  }

  #blankItems() {
    return [
      { label: this.#translate("files.refresh") || "Refresh", action: () => void this.refresh() },
      {
        label: this.#translate("files.collapseAll") || "Collapse all",
        action: () => this.collapseAll(),
      },
    ];
  }

  /**
   * @param {string} path
   * @param {string | undefined} kind
   */
  #rowItems(path, kind) {
    const entry = this.#entry(path) || { name: path.split("/").pop(), relativePath: path, kind };
    const absolute = [this.#workspaceRoot.replace(/[\\/]+$/, ""), path].filter(Boolean).join("/");
    return [
      {
        label: this.#translate("files.open") || "Open",
        action: () => {
          if (kind === "directory") void this.#expandPath(path);
          else this.#onFileOpen?.(entry);
        },
      },
      {
        label: this.#translate("files.revealInExplorer") || "Reveal in Explorer",
        action: () => this.#onReveal?.(path),
      },
      ...(kind === "file" && this.#onRun && runCommandForFile(path)
        ? [
            {
              label: this.#translate("files.runInTerminal") || "Run in terminal",
              action: () => {
                const onRun = this.#onRun;
                if (onRun) onRun(path);
              },
            },
          ]
        : []),
      { separator: true },
      {
        label: this.#translate("files.copyPath") || "Copy path",
        action: () => this.#onCopy?.(absolute),
      },
      {
        label: this.#translate("files.copyRelativePath") || "Copy relative path",
        action: () => this.#onCopy?.(path),
      },
      {
        label: this.#translate("files.mentionInChat") || "Mention in chat",
        action: () => this.#onMention?.(entry),
      },
      { separator: true },
      ...this.#blankItems(),
    ];
  }

  /** @param {KeyboardEvent} event */
  #onKey(event) {
    const rows = visibleRows(this.#state);
    if (!rows.length) return;
    const index = Math.max(
      0,
      rows.findIndex((row) => row.path === this.#state.selectedPath),
    );
    const current = rows[index];
    const keys = new Set([
      "ArrowDown",
      "ArrowUp",
      "Home",
      "End",
      "ArrowRight",
      "ArrowLeft",
      "Enter",
    ]);
    if (!keys.has(event.key)) return;
    event.preventDefault();
    if (event.key === "ArrowDown") this.#select(rows[Math.min(rows.length - 1, index + 1)].path);
    if (event.key === "ArrowUp") this.#select(rows[Math.max(0, index - 1)].path);
    if (event.key === "Home") this.#select(rows[0].path);
    if (event.key === "End") this.#select(rows[rows.length - 1].path);
    if (event.key === "Enter") {
      if (current.kind === "directory") void this.#expandPath(current.path);
      else {
        const opened = this.#entry(current.path);
        if (opened) this.#onFileOpen?.(opened);
      }
    }
    if (event.key === "ArrowRight" && current.kind === "directory") {
      if (!current.expanded) void this.#expandPath(current.path);
      else {
        const child = rows[index + 1];
        if (child && child.depth > current.depth) this.#select(child.path);
      }
    }
    if (event.key === "ArrowLeft") {
      if (current.kind === "directory" && current.expanded) void this.#expandPath(current.path);
      else {
        const parent = parentPath(current.path);
        if (parent != null) this.#select(parent || rows[0].path);
      }
    }
  }
}
