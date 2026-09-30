// ABOUTME: Info right-side panel — fixed workspace actions plus scrollable history.
// ABOUTME: Session rows visualize Pi's native tree and synchronize with chat anchors.

/**
 * Info panel. Two independent sections:
 * 1. **Workspace** (fixed, never scrolls away): workspace path with an icon-only
 *    copy control, and compact Session Info (file basename + session id; copy
 *    and hover still expose the full path / id).
 *    Open-in-app lives only in the header — it is not duplicated here.
 * 2. **Session history** (own vertical scroll): the session tree projected by
 *    `session-tree.js` from the session's entries + leafId (host
 *    `get_tree` snapshot).
 *
 * Interaction contract (design):
 * - Clicking an ACTIVE node scrolls the main chat to the rendered message
 *   (`[data-entry-id]` anchor); it never changes leaf or composer.
 * - Inactive nodes are non-navigable divs (no fake buttons, not focusable).
 * - Inactive branches collapse at their fork point; the summary row is a real
 *   expand/collapse button.
 * - This panel does not switch the active leaf. Tree navigation belongs to the
 *   Session tree tab (`session-tree-host.js`).
 */

/**
 * @typedef {{
 *   id: string,
 *   parentId?: string | null,
 *   type?: string,
 *   message?: object,
 * }} SessionEntry
 *
 * @typedef {{
 *   kind: "node",
 *   entryId: string,
 *   depth: number,
 *   isActive: boolean,
 *   isCurrentLeaf?: boolean,
 *   isFullLeaf?: boolean,
 *   role: string,
 *   previewText?: string,
 *   statusOnly?: boolean,
 *   stopReason?: string | null,
 *   hasImages?: boolean,
 * }} SessionTreeNodeRow
 *
 * @typedef {{
 *   kind: "branch",
 *   entryId: string,
 *   depth: number,
 *   turnCount: number,
 *   rows: SessionTreeRow[],
 * }} SessionTreeBranchRow
 *
 * @typedef {SessionTreeNodeRow | SessionTreeBranchRow} SessionTreeRow
 *
 * @typedef {{ activePathIds: Set<string>, rows: SessionTreeRow[] }} SessionTreeModel
 */

import { displayLocalPath } from "../files/path-utils.js";
import { createIcon } from "../ui/icons.js";
import { describeSessionFile, describeSessionId } from "./session-info.js";
import { buildSessionTree } from "./session-tree.js";

export class InfoPanel {
  /**
   * @param {{
   *   panel: HTMLElement,
   *   actions: { copyWorkspacePath: Function },
   *   t: (key: string, params?: object) => string,
   *   onNavigateLeaf?: (entryId: string) => void,
   *   isStreaming?: () => boolean,
   *   writeText?: (text: string) => Promise<void> | void,
   * }} options
   */
  constructor({ panel, actions, t, onNavigateLeaf, isStreaming, writeText }) {
    /** @type {HTMLElement} */
    this.panel = panel;
    this.actions = actions;
    this.t = t;
    this.onNavigateLeaf = onNavigateLeaf || (() => {});
    this.isStreaming = isStreaming || (() => false);
    this.writeText = writeText || ((text) => navigator.clipboard?.writeText(text));
    this.workspacePath = "";
    this.sessionFilePath = "";
    this.sessionId = "";
    /** @type {Set<string>} */
    this.expandedBranches = new Set();
    /** @type {SessionTreeModel | null} */
    this.tree = null;
    // Session entries + leafId cache. A get_tree snapshot replaces it wholesale.
    /** @type {SessionEntry[] | null} */
    this.entries = null;
    /** @type {string | null} */
    this.leafId = null;
    /** @type {string | null} */
    this.selectedEntryId = null;
    this._pendingSelectedScroll = false;
    /** @type {ReturnType<typeof setTimeout> | null} */
    this._copiedTimer = null;
    /** @type {HTMLElement | undefined} */
    this.workspaceSection = undefined;
    /** @type {HTMLElement | undefined} */
    this.historySection = undefined;
    /** @type {HTMLElement | undefined} */
    this.pathEl = undefined;
    /** @type {HTMLButtonElement | undefined} */
    this.copyBtn = undefined;
    /** @type {HTMLElement | undefined} */
    this.fileValue = undefined;
    /** @type {HTMLElement | undefined} */
    this.idValue = undefined;
    /** @type {HTMLElement | undefined} */
    this.treeScroll = undefined;
    this._buildDom();
  }

  _buildDom() {
    const p = this.panel;
    p.classList.add("info-panel");
    p.setAttribute("aria-label", this.t("infoPanel.title"));
    p.replaceChildren();

    this.workspaceSection = document.createElement("section");
    this.workspaceSection.className = "info-panel-workspace";

    this.historySection = document.createElement("section");
    this.historySection.className = "info-panel-history";
    this.historySection.setAttribute("aria-labelledby", "info-panel-history-heading");

    p.append(this.workspaceSection, this.historySection);
    this._renderWorkspace();
    this._renderHistory();
  }

  // ── Workspace ───────────────────────────────────────────────────────────

  _renderWorkspace() {
    const t = this.t;
    const section = this.workspaceSection;
    if (!section) return;
    section.replaceChildren();

    section.setAttribute("aria-label", t("infoPanel.workspace"));

    const pathRow = document.createElement("div");
    pathRow.className = "info-panel-path-row";

    this.pathEl = document.createElement("div");
    this.pathEl.className = "file-sidebar-path info-panel-path";
    this.pathEl.textContent = displayLocalPath(this.workspacePath) || "—";
    this.pathEl.title = this.workspacePath;

    this.copyBtn = document.createElement("button");
    this.copyBtn.type = "button";
    this.copyBtn.className =
      "ui-icon-button ui-icon-button--xs ui-icon-button--ghost info-panel-copy-path";
    this.copyBtn.title = t("infoPanel.copyPath");
    this.copyBtn.setAttribute("aria-label", t("infoPanel.copyPath"));
    const copyPathIcon = createIcon("clipboard", { size: 14 });
    if (copyPathIcon) this.copyBtn.append(copyPathIcon);
    this.copyBtn.addEventListener("click", () => {
      void this._copyPath();
    });

    pathRow.append(this.pathEl, this.copyBtn);
    section.append(pathRow);
    this._renderSessionInfo(section);
  }

  /** @param {HTMLElement} section */
  _renderSessionInfo(section) {
    const t = this.t;
    const wrap = document.createElement("section");
    wrap.className = "info-panel-session";
    wrap.setAttribute("aria-labelledby", "info-panel-session-heading");

    const heading = document.createElement("h3");
    heading.className = "info-panel-title";
    heading.id = "info-panel-session-heading";
    heading.dataset.i18n = "sessionInfo.heading";
    heading.textContent = t("sessionInfo.heading");

    const list = document.createElement("dl");
    list.className = "session-info-list";

    const fileRow = this._sessionInfoRow({
      labelKey: "sessionInfo.file",
      copyKey: "sessionInfo.copyFile",
      field: "file",
    });
    this.fileValue = fileRow.value;
    const idRow = this._sessionInfoRow({
      labelKey: "sessionInfo.id",
      copyKey: "sessionInfo.copyId",
      field: "id",
    });
    this.idValue = idRow.value;

    list.append(fileRow.row, idRow.row);
    wrap.append(heading, list);
    section.append(wrap);
    this._paintSessionInfo();
  }

  /**
   * @param {{ labelKey: string, copyKey: string, field: string }} options
   */
  _sessionInfoRow({ labelKey, copyKey, field }) {
    const row = document.createElement("div");
    row.className = "session-info-row";

    const dt = document.createElement("dt");
    dt.dataset.i18n = labelKey;
    dt.textContent = this.t(labelKey);

    const dd = document.createElement("dd");
    const value = document.createElement("span");
    value.className = "session-info-value";
    value.dataset.sessionField = field;

    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "ui-icon-button ui-icon-button--xs ui-icon-button--ghost session-info-copy";
    copy.dataset.copySessionField = field;
    copy.title = this.t(copyKey);
    copy.setAttribute("aria-label", this.t(copyKey));
    const copyIcon = createIcon("clipboard", { size: 14 });
    if (copyIcon) copy.append(copyIcon);
    copy.addEventListener("click", () => {
      const raw = field === "file" ? this.sessionFilePath : this.sessionId;
      void this._copySessionField(copy, raw || value.textContent, copyKey);
    });

    dd.append(value, copy);
    row.append(dt, dd);
    return { row, value };
  }

  _paintSessionInfo() {
    if (this.fileValue) {
      const file = describeSessionFile(this.sessionFilePath, this.t("sessionInfo.inMemory"));
      this.fileValue.textContent = file.text;
      if (file.title) this.fileValue.setAttribute("title", file.title);
      else this.fileValue.removeAttribute("title");
    }
    if (this.idValue) {
      const id = describeSessionId(this.sessionId, this.t("sessionInfo.unavailable"));
      this.idValue.textContent = id.text;
      if (id.title) this.idValue.setAttribute("title", id.title);
      else this.idValue.removeAttribute("title");
    }
  }

  /**
   * @param {HTMLButtonElement} button
   * @param {string | null} value
   * @param {string} defaultLabelKey
   */
  async _copySessionField(button, value, defaultLabelKey) {
    const defaultLabel = this.t(defaultLabelKey);
    try {
      const result = this.writeText?.(value ?? "");
      if (!result) throw new Error("Clipboard unavailable");
      await result;
      button.title = this.t("sessionInfo.copied");
      button.setAttribute("aria-label", this.t("sessionInfo.copied"));
    } catch {
      button.title = this.t("sessionInfo.copyFailed");
      button.setAttribute("aria-label", this.t("sessionInfo.copyFailed"));
    }
    setTimeout(() => {
      button.title = defaultLabel;
      button.setAttribute("aria-label", defaultLabel);
    }, 1500);
  }

  async _copyPath() {
    const copyBtn = this.copyBtn;
    if (!copyBtn) return;
    const copied = await this.actions.copyWorkspacePath();
    if (!copied) return;
    const copiedLabel = this.t("infoPanel.copied");
    const defaultLabel = this.t("infoPanel.copyPath");
    copyBtn.title = copiedLabel;
    copyBtn.setAttribute("aria-label", copiedLabel);
    clearTimeout(this._copiedTimer ?? undefined);
    this._copiedTimer = setTimeout(() => {
      copyBtn.title = defaultLabel;
      copyBtn.setAttribute("aria-label", defaultLabel);
    }, 1200);
  }

  /** Update the workspace path.
   * @param {string | null | undefined} path
   */
  updateWorkspace(path) {
    this.workspacePath = path || "";
    if (this.pathEl) {
      this.pathEl.textContent = displayLocalPath(this.workspacePath) || "—";
      this.pathEl.title = this.workspacePath;
    }
  }

  /** Update Session Info (jsonl file path + session id).
   * @param {{ filePath?: string, sessionId?: string }} [options]
   */
  updateSessionInfo({ filePath, sessionId } = {}) {
    this.sessionFilePath = filePath || "";
    this.sessionId = sessionId || "";
    this._paintSessionInfo();
  }

  // ── Session history ─────────────────────────────────────────────────────

  _renderHistory() {
    const t = this.t;
    const section = this.historySection;
    if (!section) return;
    section.replaceChildren();

    const heading = document.createElement("div");
    heading.className = "info-panel-history-heading";
    const h3 = document.createElement("h3");
    h3.className = "info-panel-title";
    h3.id = "info-panel-history-heading";
    h3.dataset.i18n = "infoPanel.sessionHistory";
    h3.textContent = t("infoPanel.sessionHistory");
    const status = document.createElement("span");
    status.className = "info-panel-status";
    status.textContent = `● ${t("infoPanel.activePath")}`;
    heading.append(h3, status);

    this.treeScroll = document.createElement("div");
    this.treeScroll.className = "info-panel-tree-scroll";
    this.treeScroll.setAttribute("role", "tree");
    this.treeScroll.setAttribute("aria-labelledby", "info-panel-history-heading");

    section.append(heading, this.treeScroll);
    this._renderTree();
  }

  /** Replace the tree data (host-authoritative snapshot) and re-render.
   * @param {{ entries?: SessionEntry[] | null, leafId?: string | null }} [options]
   */
  updateTree({ entries, leafId } = {}) {
    this.entries = Array.isArray(entries) ? entries : [];
    this.leafId = leafId ?? null;
    this._rebuildTree();
  }

  _rebuildTree() {
    this.tree = /** @type {SessionTreeModel} */ (
      buildSessionTree({ entries: this.entries ?? undefined, leafId: this.leafId })
    );
    // Prune expand-state for branches that no longer exist.
    const alive = new Set();
    /** @param {SessionTreeRow[]} rows */
    const collect = (rows) => {
      for (const row of rows) {
        if (row.kind === "branch") {
          alive.add(row.entryId);
          collect(row.rows);
        }
      }
    };
    collect(this.tree.rows);
    for (const id of [...this.expandedBranches]) {
      if (!alive.has(id)) this.expandedBranches.delete(id);
    }
    this._renderTree();
    if (this._pendingSelectedScroll && this.selectedEntryId) {
      this._pendingSelectedScroll = false;
      this.scrollToSelectedEntry();
    }
  }

  _renderTree() {
    if (!this.treeScroll) return;
    this.treeScroll.replaceChildren();
    const rows = this.tree?.rows ?? [];
    if (rows.length === 0) {
      const empty = document.createElement("p");
      empty.className = "info-panel-tree-empty";
      empty.textContent = this.t("infoPanel.empty");
      this.treeScroll.append(empty);
      return;
    }
    for (const row of rows) {
      this.treeScroll.append(
        row.kind === "branch" ? this._renderBranch(row) : this._nodeRowEl(row, true),
      );
    }
  }

  /**
   * A node row. `topLevel` marks rows rendered directly in the active-path
   * list (vs rows inside a collapsed branch's expanded group).
   * @param {SessionTreeNodeRow} row
   * @param {boolean} [topLevel]
   */
  _nodeRowEl(row, topLevel = false) {
    const t = this.t;
    const el = document.createElement(row.isActive ? "button" : "div");
    el.className = "info-panel-row";
    if (topLevel) el.classList.add("info-panel-row-top");
    el.dataset.entryId = row.entryId;
    el.style.setProperty("--row-depth", String(row.depth));
    if (row.isActive && el instanceof HTMLButtonElement) {
      el.type = "button";
      el.classList.add("active");
      // Same tree semantics as inactive rows: every row under the role=tree
      // container identifies as a treeitem; the aria-label carries role +
      // preview text.
      el.setAttribute("role", "treeitem");
      el.setAttribute(
        "aria-label",
        `${roleName(t, row)}: ${row.previewText || previewFallback(t, row)}`,
      );
      el.addEventListener("click", () => {
        this._scrollToMessage(row.entryId);
      });
    } else {
      el.classList.add("inactive");
      el.setAttribute("role", "treeitem");
      el.setAttribute("aria-disabled", "true");
    }
    if (this.selectedEntryId === row.entryId) el.classList.add("selected");
    if (row.isCurrentLeaf) {
      el.classList.add("current-leaf");
      // The marker class is visual-only; expose the current leaf to assistive
      // technology as well.
      el.setAttribute("aria-current", "true");
    }

    const role = document.createElement("span");
    role.className = `info-panel-role ${row.role === "user" ? "user" : "assistant"}`;
    role.textContent = row.role === "user" ? "●" : "✦";
    role.setAttribute("aria-hidden", "true");

    const preview = document.createElement("span");
    preview.className = "info-panel-preview";
    preview.textContent = row.previewText || previewFallback(t, row);

    el.append(role, preview);

    // Only full-tree leaves in inactive branches can become the active Pi
    // leaf. The control is injected with the runtime callback so this view
    // remains independent from transport details.
    if (!row.isActive && row.isFullLeaf) {
      const resume = document.createElement("button");
      resume.type = "button";
      resume.className = "info-panel-resume";
      resume.textContent = t("infoPanel.resumeBranch");
      resume.setAttribute(
        "aria-label",
        `${t("infoPanel.resumeBranch")}: ${row.previewText || previewFallback(t, row)}`,
      );
      if (this.isStreaming()) {
        resume.disabled = true;
        resume.title = t("infoPanel.resumeStreamingBlocked");
      }
      resume.addEventListener("click", (event) => {
        event.stopPropagation();
        if (!resume.disabled) this.onNavigateLeaf(row.entryId);
      });
      el.append(resume);
    }
    return el;
  }

  /** Collapsed inactive branch: summary toggle + (expanded) subtree rows.
   * @param {SessionTreeBranchRow} branch
   */
  _renderBranch(branch) {
    const t = this.t;
    const wrap = document.createElement("div");
    wrap.className = "info-panel-branch";
    wrap.dataset.branchId = branch.entryId;

    const expanded = this.expandedBranches.has(branch.entryId);
    const summary = document.createElement("button");
    summary.type = "button";
    summary.className = "info-panel-branch-summary";
    summary.style.setProperty("--row-depth", String(branch.depth));
    summary.setAttribute("aria-expanded", String(expanded));
    summary.setAttribute(
      "aria-label",
      `${t("infoPanel.branch")} · ${t("infoPanel.turns", { count: branch.turnCount })}`,
    );
    const caret = document.createElement("span");
    caret.className = "info-panel-caret";
    caret.textContent = expanded ? "▾" : "▸";
    caret.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.className = "info-panel-preview";
    text.textContent = `${t("infoPanel.branch")} · ${t("infoPanel.turns", { count: branch.turnCount })}`;
    summary.append(caret, text);
    summary.addEventListener("click", () => {
      if (this.expandedBranches.has(branch.entryId)) {
        this.expandedBranches.delete(branch.entryId);
      } else {
        this.expandedBranches.add(branch.entryId);
      }
      this._renderTree();
    });
    wrap.append(summary);

    if (expanded) {
      const group = document.createElement("div");
      group.className = "info-panel-branch-group";
      group.setAttribute("role", "group");
      for (const row of branch.rows) {
        group.append(row.kind === "branch" ? this._renderBranch(row) : this._nodeRowEl(row));
      }
      wrap.append(group);
    }
    return wrap;
  }

  /** @param {string | null | undefined} entryId */
  selectEntry(entryId) {
    this.selectedEntryId = entryId == null ? null : String(entryId);
    const rows = this.treeScroll?.querySelectorAll(".info-panel-row") || [];
    for (const row of rows) {
      if (!(row instanceof HTMLElement)) continue;
      row.classList.toggle("selected", row.dataset.entryId === this.selectedEntryId);
    }
  }

  scrollToSelectedEntry() {
    if (!this.selectedEntryId || this.panel.classList.contains("hidden")) {
      this._pendingSelectedScroll = Boolean(this.selectedEntryId);
      return;
    }
    const row = this.treeScroll?.querySelector(
      `[data-entry-id="${escapeAttribute(this.selectedEntryId)}"]`,
    );
    if (!row) {
      this._pendingSelectedScroll = true;
      return;
    }
    this._pendingSelectedScroll = false;
    row.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  /** @param {string} entryId */
  _scrollToMessage(entryId) {
    this.selectEntry(entryId);
    // Attribute-safe escape (Pi entry ids are generated hex, but stay robust
    // for any id without depending on CSS.escape availability).
    const safeId = escapeAttribute(entryId);
    const target = [...document.querySelectorAll(`[data-entry-id="${safeId}"]`)].find(
      (candidate) => !this.panel.contains(candidate),
    );
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("info-panel-flash");
    target.addEventListener("animationend", () => target.classList.remove("info-panel-flash"), {
      once: true,
    });
  }
}

// Local helpers — kept module-private.

/**
 * @param {(key: string, params?: object) => string} t
 * @param {SessionTreeNodeRow} row
 */
function roleName(t, row) {
  return row.role === "user" ? t("infoPanel.roleUser") : t("infoPanel.roleAssistant");
}

/** @param {unknown} value */
function escapeAttribute(value) {
  return String(value).replace(/["\\]/g, "\\$&");
}

/**
 * @param {(key: string, params?: object) => string} t
 * @param {SessionTreeNodeRow} row
 */
function previewFallback(t, row) {
  if (row.statusOnly) {
    return row.stopReason === "aborted" ? t("infoPanel.statusAborted") : t("infoPanel.statusError");
  }
  if (row.hasImages) return t("infoPanel.imageMessage");
  return "";
}
