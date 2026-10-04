// ABOUTME: Owns the Git tab, status groups, and safe user-visible Git actions.
// ABOUTME: Renders untrusted repository paths with DOM text nodes and delegates writes to GitClient.

import { createFileTypeIcon } from "../editor/file-type-icons.js";
import { t } from "../i18n/i18n.js";
import { createIcon } from "../ui/icons.js";
import { createIdentityState } from "./git-commit-identity.js";
import { GitHistoryPanel } from "./git-history-panel.js";
import { renderNotGitRepo } from "./git-init-prompt.js";
import { gitPanelActions } from "./git-panel-actions.js";
import { mountGitEntryRow, openWorkingTreeFile } from "./git-row-actions.js";
import { renderGitToolbar } from "./git-toolbar.js";

/**
 * @typedef {"staged" | "changes" | "untracked" | "conflicted"} GitGroupName
 * @typedef {"stage" | "unstage" | "discard"} GitWriteOperation
 * @typedef {{
 *   entryKind?: string,
 *   xy?: string,
 *   displayPath?: string,
 *   pathBytesBase64?: string,
 *   originalPathBytesBase64?: string,
 *   comparison?: string,
 *   [key: string]: unknown,
 * }} GitEntry
 * @typedef {{
 *   snapshotId?: string,
 *   headState?: string,
 *   headOid?: string,
 *   indexTreeOid?: string,
 *   branch?: string | null,
 *   upstream?: string | null,
 *   remotes?: string[] | null,
 *   ahead?: number,
 *   behind?: number,
 *   entries?: GitEntry[],
 *   counts?: {
 *     staged?: number,
 *     changes?: number,
 *     untracked?: number,
 *     conflicted?: number,
 *   },
 *   changeStats?: {
 *     additions?: number,
 *     deletions?: number,
 *     untrackedExcludedCount?: number,
 *     binaryFileCount?: number,
 *   },
 *   totalEntryCount?: number,
 *   returnedEntryCount?: number,
 *   [key: string]: unknown,
 * }} GitSnapshot
 * @typedef {{
 *   snapshotId?: string,
 *   headState?: string,
 *   headOid?: string,
 *   indexTreeOid?: string,
 * }} GitAiSnapshot
 * @typedef {{
 *   dirs: Map<string, GitTreeNode>,
 *   files: GitEntry[],
 *   prefix?: string,
 * }} GitTreeNode
 * @typedef {{
 *   command: (payload?: Record<string, unknown>, frameType?: string) => string | null | undefined,
 *   aiCommitMessage: () => string | null | undefined,
 *   commit: (
 *     snapshotId: string,
 *     message: string,
 *     confirmationToken?: string | null,
 *     amend?: boolean,
 *   ) => string | null | undefined,
 *   push: () => string | null | undefined,
 *   fetch: () => string | null | undefined,
 *   pull: () => string | null | undefined,
 *   init: () => string | null | undefined,
 *   diff: (
 *     snapshotId: string,
 *     group: string,
 *     pathBytesBase64: string,
 *     comparison: string,
 *   ) => string | null | undefined,
 *   write: (
 *     operation: string,
 *     snapshotId: string,
 *     entries: Array<{
 *       group?: string,
 *       pathBytesBase64?: string,
 *       originalPathBytesBase64?: string,
 *     }>,
 *   ) => string | null | undefined,
 *   log?: (limit: number, before: string | null) => string | null | undefined,
 *   logDetail?: (oid: string) => string | null | undefined,
 *   commitDiff?: (commitOid: string, pathBytesBase64?: string) => string | null | undefined,
 *   sendAndAwait?: (
 *     payload: Record<string, unknown>,
 *     matcher?: ((message: unknown) => boolean) | null,
 *     timeoutMs?: number,
 *   ) => Promise<unknown>,
 *   checkout: (name: string, options?: { create?: boolean }) => unknown,
 * }} GitClientLike
 * @typedef {{
 *   container?: Element | null,
 *   client?: GitClientLike | null,
 *   onReviewFile?: ((path: string) => void) | null,
 *   onHistoryDiffRequest?: ((requestId: string, descriptor?: unknown) => void) | null,
 *   onStatus?: ((snapshot: GitSnapshot | null | undefined) => void) | null,
 *   fileList?: Element | null,
 *   identity?: import("./git-commit-identity.js").GitIdentityService | null,
 * }} GitPanelOptions
 * @typedef {{
 *   overlay: HTMLElement,
 *   textarea: HTMLTextAreaElement,
 *   submit: HTMLButtonElement,
 *   identity: { save: () => Promise<boolean> },
 *   unbindEscape?: (() => void) | null,
 * }} GitCommitDialog
 */

function createSectionChevron() {
  const chevron = document.createElement("span");
  chevron.className = "section-chevron";
  chevron.setAttribute("aria-hidden", "true");
  const icon = createIcon("chevron-right", { size: 16 });
  if (icon) chevron.append(icon);
  return chevron;
}

// Object-icon rendering for Git entries uses the shared Material file-type
// vocabulary from `file-type-icons.js`, so the Git tree stays visually
// consistent with the File Browser and File Preview tabs.
/** @type {GitGroupName[]} */
const GROUPS = ["staged", "changes", "untracked", "conflicted"];

export class GitPanel {
  /**
   * @param {GitPanelOptions} [options]
   */
  constructor({
    container,
    client,
    onReviewFile,
    onHistoryDiffRequest,
    onStatus,
    fileList,
    identity,
  } = {}) {
    /** @type {Element} */
    this.outerContainer = /** @type {Element} */ (container);
    /** @type {GitClientLike | null | undefined} */
    this.client = client;
    /** @type {"changes" | "history"} */
    this._subTab = "changes";
    this.subTabBar = document.createElement("div");
    this.subTabBar.className = "git-subtab-bar";
    this.subTabBar.setAttribute("role", "tablist");
    this.container = document.createElement("div");
    this.container.className = "git-subtab-pane git-changes-pane";
    this.historyContainer = document.createElement("div");
    this.historyContainer.className = "git-subtab-pane git-history-pane hidden";
    this.historyPanel = new GitHistoryPanel({
      container: this.historyContainer,
      client,
      onDiffRequest: onHistoryDiffRequest,
    });
    this.outerContainer.replaceChildren(this.subTabBar, this.container, this.historyContainer);
    this._renderSubTabBar();
    this.onReviewFile = onReviewFile;
    /** @type {((snapshot: GitSnapshot | null | undefined) => void) | null | undefined} */
    this.onStatus = onStatus;
    /** @type {Element | null | undefined} */
    this.fileList = fileList;
    /** @type {GitSnapshot | null} */
    this.snapshot = null;
    this.projectPath = "";
    this.notGitRepo = false;
    this.initInProgress = false;
    this.initError = "";
    /** @type {string | null} */
    this.pendingInitRequestId = null;
    /** @type {string | null} */
    this.pendingStatusRequestId = null;
    /** @type {Set<string>} */
    this.folded = new Set();
    /** @type {Set<string>} */
    this.selected = new Set();
    /** @type {GitAiSnapshot | null} */
    this.aiSnapshot = null;
    this.commitMessage = "";
    /** @type {string | null} */
    this.pendingConfirmationToken = null;
    /** @type {GitCommitDialog | null} */
    this.commitDialog = null;
    /** @type {string | null} */
    this.aiError = null;
    this.commitInProgress = false;
    /** @type {string | null} */
    this.pendingCommitRequestId = null;
    /** @type {string | null} */
    this.pendingAiRequestId = null;
    this.pushInProgress = false;
    /** @type {string | null} */
    this.pushError = null;
    this.gitMissing = false;
    this.amend = false;
    this.remoteInProgress = false;
    /** @type {string | null} */
    this.remoteError = null;
    /** @type {string | null} */
    this.pendingPushRequestId = null;
    /** @type {import("./git-commit-identity.js").GitIdentityService | null} */
    this.identity = identity || null;
    this.identityState = createIdentityState();
  }
  /** @param {GitSnapshot | null | undefined} snapshot */
  setSnapshot(snapshot) {
    this.snapshot = snapshot ?? null;
    this.notGitRepo = false;
    this.initInProgress = false;
    this.initError = "";
    this.pendingInitRequestId = null;
    this.gitMissing = false;
    this.pendingStatusRequestId = null;
    this.historyPanel?.setUnavailable(false);
    const snapshotId = snapshot?.snapshotId;
    const valid = new Set(
      (snapshot?.entries || []).flatMap((entry) =>
        this.groupsFor(entry).map((group) => `${snapshotId}:${group}:${entry.pathBytesBase64}`),
      ),
    );
    this.selected = new Set(
      [...this.selected].filter(
        (identity) =>
          snapshot &&
          identity.split(":").slice(0, 2).join(":") === snapshot.snapshotId &&
          valid.has(identity),
      ),
    );
    this.render();
    this.onStatus?.(snapshot);
  }
  /** @param {string | null | undefined} path */
  setProjectPath(path) {
    const next = path || "";
    if (next === this.projectPath) return;
    this.projectPath = next;
    this.render();
  }
  /** @param {boolean} [value] */
  setNotGitRepo(value = true) {
    this.notGitRepo = value;
    this.gitMissing = false;
    this.pendingStatusRequestId = null;
    this.historyPanel?.setUnavailable(value);
    this.render();
  }
  /** @param {boolean} [value] */
  setGitMissing(value = true) {
    this.gitMissing = Boolean(value);
    this.notGitRepo = false;
    this.snapshot = null;
    this.pendingStatusRequestId = null;
    this.render();
  }
  _renderSubTabBar() {
    for (const name of /** @type {const} */ (["changes", "history"])) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "git-subtab";
      button.dataset.subtab = name;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(name === this._subTab));
      button.textContent = name === "changes" ? t("git.comparison.changes") : t("git.history");
      button.addEventListener("click", () => this.setSubTab(name));
      this.subTabBar.append(button);
    }
  }
  /** @param {string} name */
  setSubTab(name) {
    if (name !== "changes" && name !== "history") return;
    const wasHistory = this._subTab === "history";
    this._subTab = name;
    const isHistory = name === "history";
    this.container.classList.toggle("hidden", isHistory);
    this.historyContainer.classList.toggle("hidden", !isHistory);
    for (const button of this.subTabBar.querySelectorAll(".git-subtab")) {
      if (!("dataset" in button)) continue;
      const dataset = /** @type {DOMStringMap} */ (button.dataset);
      button.setAttribute("aria-selected", String(dataset.subtab === name));
    }
    this.historyPanel.setActive(isHistory);
    if (isHistory && !wasHistory) this.historyPanel.refresh();
  }
  /** True only for the failure of the most recent status probe, so stale or
   *  concurrent non-status failures (diff/write/commit) cannot flip the panel
   *  into the not-a-repository state.
   * @param {string | null | undefined} requestId
   * @returns {boolean}
   */
  isStatusFailure(requestId) {
    return requestId != null && requestId === this.pendingStatusRequestId;
  }
  async refresh() {
    const id = this.client?.command({ type: "status" });
    if (!id) return null;
    this.pendingStatusRequestId = id;
    return id;
  }
  destroy() {
    this.container?.replaceChildren();
  }
  render() {
    if (!this.container) return;
    const scrollTop = this.container.scrollTop;
    this.container.replaceChildren();
    const snapshot = this.snapshot;
    if (this.gitMissing) {
      const empty = document.createElement("p");
      empty.className = "git-missing";
      empty.textContent = t("git.missing");
      this.container.append(empty);
      return;
    }
    if (this.notGitRepo) {
      renderNotGitRepo(this.container, {
        busy: this.initInProgress,
        error: this.initError,
        projectPath: this.projectPath,
        onInit: () => this.initializeRepository(),
      });
      return;
    }
    if (!snapshot) {
      const empty = document.createElement("p");
      empty.textContent = t("git.noStatus");
      this.container.append(empty);
      return;
    }
    /** @param {GitGroupName} group */
    const selectedEntriesFor = (group) =>
      (snapshot.entries || [])
        .filter((entry) => this.groupsFor(entry).includes(group))
        .filter((entry) =>
          this.selected.has(`${snapshot.snapshotId}:${group}:${entry.pathBytesBase64}`),
        );
    for (const group of GROUPS) {
      const entries = (snapshot.entries || []).filter((entry) =>
        this.groupsFor(entry).includes(group),
      );
      const section = document.createElement("section");
      section.className = `git-group git-group-${group}`;
      const heading = document.createElement("div");
      heading.className = `git-group-heading sidebar-section-header${
        this.folded.has(group) ? " collapsed" : ""
      }`;
      const headingId = `git-group-heading-${group}`;
      heading.id = headingId;
      heading.setAttribute("role", "button");
      heading.tabIndex = 0;
      heading.setAttribute("aria-expanded", String(!this.folded.has(group)));
      heading.setAttribute("aria-controls", `git-group-body-${group}`);
      section.setAttribute("role", "region");
      section.setAttribute("aria-labelledby", headingId);
      heading.appendChild(this._createChevron());
      const label = document.createElement("span");
      label.className = "sidebar-section-title";
      label.textContent = t(`git.${group}`);
      const count = document.createElement("span");
      count.className = "sidebar-section-count";
      count.textContent = String(entries.length);
      heading.append(label, count);
      heading.addEventListener("click", () => {
        this.folded.has(group) ? this.folded.delete(group) : this.folded.add(group);
        this.render();
      });
      heading.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        heading.click();
      });
      section.append(heading);
      if (this.folded.has(group)) {
        this.container.append(section);
        continue;
      }
      const body = document.createElement("div");
      body.className = "git-group-body";
      body.id = `git-group-body-${group}`;
      const tree = this.buildTree(entries);
      this.renderTree(tree, body, snapshot, group, "");
      section.append(body);
      if (
        /** @type {number} */ (snapshot.totalEntryCount) >
        /** @type {number} */ (snapshot.returnedEntryCount)
      ) {
        const hidden =
          /** @type {number} */ (snapshot.totalEntryCount) -
          /** @type {number} */ (snapshot.returnedEntryCount);
        const notice = document.createElement("p");
        notice.className = "git-truncation-notice";
        notice.textContent = t("git.truncated", { count: hidden });
        section.append(notice);
      }
      if (entries.length > 0) {
        const selected = selectedEntriesFor(group);
        const actions = document.createElement("div");
        actions.className = "git-group-actions";
        const operations =
          group === "staged"
            ? ["unstage"]
            : group === "changes"
              ? ["stage", "discard"]
              : group === "conflicted"
                ? ["stage"]
                : ["stage"];
        for (const operation of operations) {
          const action = document.createElement("button");
          action.type = "button";
          const targetCount = selected.length > 0 ? selected.length : entries.length;
          action.textContent = `${t(`git.${operation}`)} (${targetCount})`;
          action.addEventListener("click", () => {
            const targets = selected.length > 0 ? selected : entries;
            if (operation === "discard") this.discard(targets, group);
            else this.write(operation, targets, group);
          });
          actions.append(action);
        }
        section.append(actions);
      }
      this.container.append(section);
    }
    this.container.prepend(renderGitToolbar(this, snapshot));
    this.container.scrollTop = scrollTop;
  }
  /**
   * @param {GitEntry[]} entries
   * @returns {GitTreeNode}
   */
  buildTree(entries) {
    /** @type {GitTreeNode} */
    const root = { dirs: new Map(), files: [] };
    for (const entry of entries) {
      const path = entry.displayPath || "";
      const parts = path.split(/[/\\]/).filter(Boolean);
      if (parts.length <= 1) {
        root.files.push(entry);
        continue;
      }
      let node = root;
      for (let i = 0; i < parts.length - 1; i += 1) {
        const segment = parts[i];
        let child = node.dirs.get(segment);
        if (!child) {
          child = {
            dirs: new Map(),
            files: [],
            prefix: parts.slice(0, i + 1).join("/"),
          };
          node.dirs.set(segment, child);
        }
        node = child;
      }
      node.files.push(entry);
    }
    return root;
  }
  /**
   * @param {GitTreeNode} node
   * @param {ParentNode} container
   * @param {GitSnapshot} snapshot
   * @param {GitGroupName} group
   * @param {string} prefix
   */
  renderTree(node, container, snapshot, group, prefix) {
    for (const [segment, child] of node.dirs) {
      const dirKey = `dir:${group}:${child.prefix}`;
      const dirSection = document.createElement("div");
      dirSection.className = "git-directory";
      const dirHeading = document.createElement("button");
      dirHeading.type = "button";
      dirHeading.className = "git-directory-heading git-tree-row";
      if (this.folded.has(dirKey)) dirHeading.classList.add("collapsed");
      const fileCount = this.countFiles(child);
      const icon = document.createElement("span");
      icon.className = "git-tree-folder-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.append(
        createFileTypeIcon({
          name: segment,
          isDirectory: true,
          expanded: !this.folded.has(dirKey),
        }),
      );
      const label = document.createElement("span");
      label.className = "git-tree-label";
      label.textContent = `${prefix ? `${prefix}/` : ""}${segment}`;
      const count = document.createElement("span");
      count.className = "git-tree-count";
      count.textContent = String(fileCount);
      dirHeading.append(icon, label, count);
      dirHeading.setAttribute("aria-expanded", String(!this.folded.has(dirKey)));
      dirHeading.addEventListener("click", () => {
        this.folded.has(dirKey) ? this.folded.delete(dirKey) : this.folded.add(dirKey);
        this.render();
      });
      dirSection.append(dirHeading);
      if (!this.folded.has(dirKey)) {
        const dirBody = document.createElement("div");
        dirBody.className = "git-directory-body";
        this.renderTree(child, dirBody, snapshot, group, `${prefix ? `${prefix}/` : ""}${segment}`);
        dirSection.append(dirBody);
      }
      container.append(dirSection);
    }
    for (const entry of node.files) {
      const row = document.createElement("div");
      row.className = "git-entry git-tree-row";
      row.setAttribute("role", "button");
      row.tabIndex = 0;
      const displayPath = /** @type {string} */ (entry.displayPath);
      const fileName = displayPath.split(/[/\\]/).pop() || displayPath;
      const icon = document.createElement("span");
      icon.className = "git-tree-file-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.append(createFileTypeIcon({ name: fileName }));
      const label = document.createElement("span");
      label.className = "git-tree-label";
      label.textContent = fileName;
      row.append(icon, label);
      row.setAttribute("aria-label", displayPath);
      row.title = displayPath;
      const identity = `${snapshot.snapshotId}:${group}:${entry.pathBytesBase64}`;
      // The diff opens in the shared diff tab; conflicted rows open the file instead.
      const openDiff = () => this.onReviewFile?.(displayPath);
      const rowMount = {
        row,
        group,
        entry,
        identity,
        selected: this.selected.has(identity),
        onToggleSelect: () => {
          this.selected.has(identity)
            ? this.selected.delete(identity)
            : this.selected.add(identity);
          this.render();
        },
        onOpenDiff: openDiff,
        onStage: () => this.write("stage", [entry], group),
        onUnstage: () => this.write("unstage", [entry], group),
        onDiscard: () => this.discard([entry], group),
        onDelete: () => this.discard([entry], "untracked"),
        onOpenFile: () => openWorkingTreeFile(entry),
      };
      mountGitEntryRow(rowMount);
      container.append(row);
    }
  }
  /**
   * @param {GitTreeNode} node
   * @returns {number}
   */
  countFiles(node) {
    let count = node.files.length;
    for (const child of node.dirs.values()) count += this.countFiles(child);
    return count;
  }
  _createChevron() {
    return createSectionChevron();
  }
  /**
   * @param {GitEntry} entry
   * @returns {GitGroupName[]}
   */
  groupsFor(entry) {
    if (entry.entryKind === "unmerged") return ["conflicted"];
    if (entry.entryKind === "untracked") return ["untracked"];
    /** @type {GitGroupName[]} */
    const groups = [];
    if (entry.xy?.[0] && entry.xy[0] !== ".") groups.push("staged");
    if (entry.xy?.[1] && entry.xy[1] !== ".") groups.push("changes");
    return groups.length > 0 ? groups : ["changes"];
  }
  /**
   * @param {GitEntry} entry
   * @returns {GitGroupName}
   */
  groupFor(entry) {
    return this.groupsFor(entry)[0];
  }

  /** @param {...any} args @returns {any} */
  discard(...args) {
    return gitPanelActions.discard.apply(this, args);
  }
  /** @param {...any} args @returns {any} */
  requestAiCommitMessage(...args) {
    return gitPanelActions.requestAiCommitMessage.apply(this, args);
  }
  /** @param {...any} args @returns {any} */
  applyAiResult(...args) {
    return gitPanelActions.applyAiResult.apply(this, args);
  }
  /** @param {...any} args @returns {any} */
  applyAiFailure(...args) {
    return gitPanelActions.applyAiFailure.apply(this, args);
  }
  /** @param {...any} args @returns {any} */
  applyConfirmationToken(...args) {
    return gitPanelActions.applyConfirmationToken.apply(this, args);
  }
  /** @param {...any} args @returns {any} */
  openCommitDialog(...args) {
    return gitPanelActions.openCommitDialog.apply(this, args);
  }
  /** @param {...any} args @returns {any} */
  closeCommitDialog(...args) {
    return gitPanelActions.closeCommitDialog.apply(this, args);
  }
  /** @param {...any} args @returns {any} */
  updateCommitDialogState(...args) {
    return gitPanelActions.updateCommitDialogState.apply(this, args);
  }
  /** @param {...any} args @returns {any} */
  setCommitInProgress(...args) {
    return gitPanelActions.setCommitInProgress.apply(this, args);
  }
  /** @param {...any} args @returns {any} */
  applyCommitResult(...args) {
    return gitPanelActions.applyCommitResult.apply(this, args);
  }
  /** @param {...any} args @returns {any} */
  applyCommitFailure(...args) {
    return gitPanelActions.applyCommitFailure.apply(this, args);
  }
  /** @param {...any} args @returns {any} */
  submitCommit(...args) {
    return gitPanelActions.submitCommit.apply(this, args);
  }
  /** @param {...any} args @returns {any} */
  commit(...args) {
    return gitPanelActions.commit.apply(this, args);
  }
  /** @param {...any} args @returns {any} */
  push(...args) {
    return gitPanelActions.push.apply(this, args);
  }
  /** @param {...any} args @returns {any} */
  setPushInProgress(...args) {
    return gitPanelActions.setPushInProgress.apply(this, args);
  }
  /** @param {...any} args @returns {any} */
  applyPushResult(...args) {
    return gitPanelActions.applyPushResult.apply(this, args);
  }
  /** @param {...any} args @returns {any} */
  pushErrorText(...args) {
    return gitPanelActions.pushErrorText.apply(this, args);
  }
  /** @param {...any} args @returns {any} */
  fetch(...args) {
    return gitPanelActions.fetch.apply(this, args);
  }
  /** @param {...any} args @returns {any} */
  pull(...args) {
    return gitPanelActions.pull.apply(this, args);
  }
  /** @param {...any} args @returns {any} */
  initializeRepository(...args) {
    return gitPanelActions.initializeRepository.apply(this, args);
  }
  /** @param {...any} args @returns {any} */
  applyInitFailure(...args) {
    return gitPanelActions.applyInitFailure.apply(this, args);
  }
  /** @param {...any} args @returns {any} */
  applyRemoteError(...args) {
    return gitPanelActions.applyRemoteError.apply(this, args);
  }
  /** @param {...any} args @returns {any} */
  openBranchMenu(...args) {
    return gitPanelActions.openBranchMenu.apply(this, args);
  }
  /** @param {...any} args @returns {any} */
  openRemoteDialog(...args) {
    return gitPanelActions.openRemoteDialog.apply(this, args);
  }
  /** @param {...any} args @returns {any} */
  write(...args) {
    return gitPanelActions.write.apply(this, args);
  }
}

Object.assign(GitPanel.prototype, gitPanelActions);
