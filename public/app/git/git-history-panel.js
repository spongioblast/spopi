// ABOUTME: Renders Git first-parent history, commit details, and pagination.
// ABOUTME: Keeps log/detail request channels independent and opens authorized commit diffs.

import { getLocale, t } from "../i18n/i18n.js";
import { copyText } from "../ui/clipboard.js";
import { relativeTime } from "../ui/formatters.js";

/**
 * @typedef {{
 *   oid: string,
 *   subject?: string,
 *   authorName?: string,
 *   authorTime?: number,
 * }} GitHistoryCommitSummary
 *
 * @typedef {{
 *   status?: string,
 *   path: string,
 *   originalPath?: string,
 *   pathBytesBase64?: string,
 * }} GitHistoryCommitFile
 *
 * @typedef {{
 *   oid: string,
 *   fullMessage?: string,
 *   messageTruncated?: boolean,
 *   filesTruncated?: boolean,
 *   files?: GitHistoryCommitFile[],
 * }} GitHistoryCommitDetail
 *
 * @typedef {{
 *   requestId?: string | null,
 *   commits?: GitHistoryCommitSummary[],
 *   hasMore?: boolean,
 * }} GitHistoryLogDetail
 *
 * @typedef {{
 *   requestId?: string | null,
 *   commit?: GitHistoryCommitDetail | null,
 * }} GitHistoryLogDetailResponse
 *
 * @typedef {{
 *   type: "commit_diff",
 *   comparison: "commit",
 *   commitOid: string,
 *   subject?: string,
 *   status?: string,
 *   displayPath: string,
 *   path: string,
 *   originalPath?: string,
 *   pathBytesBase64?: string,
 * }} GitHistoryCommitDiffRequest
 *
 * @typedef {{
 *   log?: (limit?: unknown, before?: unknown) => unknown,
 *   logDetail?: (oid?: unknown) => unknown,
 *   commitDiff?: (commitOid?: unknown, pathBytesBase64?: unknown) => unknown,
 *   [key: string]: unknown,
 * }} GitHistoryClient
 *
 * @typedef {{
 *   container?: HTMLElement | Element | null,
 *   client?: object | null,
 *   onDiffRequest?:
 *     | ((requestId: string, descriptor?: unknown) => void)
 *     | ((requestId: string, descriptor: GitHistoryCommitDiffRequest) => void)
 *     | null,
 * }} GitHistoryPanelOptions
 */

const PAGE_SIZE = 50;

export class GitHistoryPanel {
  /**
   * @param {GitHistoryPanelOptions} [options]
   */
  constructor({ container, client, onDiffRequest } = {}) {
    /** @type {HTMLElement | Element | null | undefined} */
    this.container = container;
    /** @type {GitHistoryClient | null | undefined} */
    this.client = /** @type {GitHistoryClient | null | undefined} */ (client);
    /** @type {((requestId: string, descriptor?: unknown) => void) | ((requestId: string, descriptor: GitHistoryCommitDiffRequest) => void) | null | undefined} */
    this.onDiffRequest = onDiffRequest;
    this._active = false;
    this._unavailable = false;
    /** @type {string | null} */
    this._logRequestId = null;
    /** @type {string | null} */
    this._detailRequestId = null;
    /** @type {GitHistoryCommitSummary[]} */
    this._commits = [];
    this._hasMore = false;
    /** @type {string | null} */
    this._selectedOid = null;
    /** @type {string | null} */
    this._oid = null;
    this._detailExpanded = false;
    this._splitRatio = 0.5;
    /** @type {(() => void) | null} */
    this._resizeCleanup = null;
    /** @type {HTMLElement | undefined} */
    this.listSection = undefined;
    /** @type {HTMLElement | undefined} */
    this.list = undefined;
    /** @type {HTMLElement | undefined} */
    this.detailSection = undefined;
    /** @type {HTMLElement | undefined} */
    this.detail = undefined;
    /** @type {HTMLElement | undefined} */
    this.divider = undefined;
    this._buildDom();
    this._renderList();
    this._renderDetail();
  }
  _buildDom() {
    const container = this.container;
    if (!container || !("replaceChildren" in container)) return;
    container.replaceChildren();
    this.listSection = document.createElement("section");
    this.listSection.className = "git-history-section git-history-list-section";
    this.list = document.createElement("div");
    this.list.className = "git-history-list";
    this.listSection.append(this.list);
    this.detailSection = document.createElement("section");
    this.detailSection.className = "git-history-section git-history-detail-section";
    this.detail = document.createElement("div");
    this.detail.className = "git-history-detail-body";
    this.detailSection.append(this.detail);
    this.divider = document.createElement("div");
    this.divider.className = "git-history-divider";
    this.divider.setAttribute("role", "separator");
    this.divider.setAttribute("aria-orientation", "horizontal");
    this.divider.setAttribute("aria-valuemin", "10");
    this.divider.setAttribute("aria-valuemax", "90");
    this.divider.setAttribute("aria-valuenow", "50");
    this.divider.tabIndex = 0;
    this.divider.addEventListener("pointerdown", (event) => this._beginResize(event));
    container.append(this.listSection, this.divider, this.detailSection);
    this._updateSplitStyles();
  }
  /** @param {unknown} active */
  setActive(active) {
    this._active = Boolean(active);
    const container = this.container;
    if (container && "classList" in container) {
      container.classList.toggle("hidden", !this._active);
    }
    if (!this._active) this._collapseDetail();
  }
  _updateSplitStyles() {
    const listSection = this.listSection;
    const detailSection = this.detailSection;
    const container = this.container;
    if (!listSection || !detailSection || !container) return;
    const listFlex = this._detailExpanded ? this._splitRatio : 1;
    const detailFlex = this._detailExpanded ? 1 - this._splitRatio : 0;
    listSection.style.setProperty("--history-flex", String(listFlex));
    detailSection.style.setProperty("--history-flex", String(detailFlex));
    if ("dataset" in container) {
      container.dataset.detailExpanded = String(this._detailExpanded);
    }
    this.divider?.setAttribute("aria-valuenow", String(Math.round(this._splitRatio * 100)));
  }
  /** @param {unknown} ratio */
  _setSplitRatio(ratio) {
    this._splitRatio = Math.max(0.1, Math.min(0.9, Number(ratio) || 0.5));
    this._updateSplitStyles();
  }
  _expandDetail() {
    this._detailExpanded = true;
    this._updateSplitStyles();
  }
  _collapseDetail() {
    this._detailExpanded = false;
    this._updateSplitStyles();
  }
  /** @param {PointerEvent} event */
  _beginResize(event) {
    event.preventDefault();
    if (!this._detailExpanded) this._expandDetail();
    const container = this.container;
    const divider = this.divider;
    if (!container || !divider || !("getBoundingClientRect" in container)) return;
    /** @param {PointerEvent} moveEvent */
    const update = (moveEvent) => {
      const rect = container.getBoundingClientRect();
      const dividerHeight = divider.getBoundingClientRect().height;
      const available = rect.height - dividerHeight;
      if (available <= 0) return;
      this._setSplitRatio((moveEvent.clientY - rect.top) / available);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", update);
      window.removeEventListener("pointerup", cleanup);
      window.removeEventListener("pointercancel", cleanup);
      this._resizeCleanup = null;
    };
    this._resizeCleanup?.();
    this._resizeCleanup = cleanup;
    window.addEventListener("pointermove", update);
    window.addEventListener("pointerup", cleanup, { once: true });
    window.addEventListener("pointercancel", cleanup, { once: true });
    divider.setPointerCapture?.(event.pointerId);
  }
  /** @param {unknown} [value] */
  setUnavailable(value = true) {
    this._unavailable = Boolean(value);
    if (this._unavailable) this.clearSession();
  }
  clearSession() {
    this._logRequestId = null;
    this._detailRequestId = null;
    this._commits = [];
    this._hasMore = false;
    this._selectedOid = null;
    this._oid = null;
    this._collapseDetail();
    this._renderList();
    this._renderDetail();
  }
  refresh() {
    if (!this._active || this._unavailable) return null;
    this._detailRequestId = null;
    this._selectedOid = null;
    this._oid = null;
    this._collapseDetail();
    const requestId = /** @type {string | null | undefined} */ (
      this.client?.log?.(PAGE_SIZE, null)
    );
    if (!requestId) return null;
    this._logRequestId = requestId;
    this._commits = [];
    this._hasMore = false;
    this._renderList();
    this._renderDetail();
    return requestId;
  }
  loadMore() {
    if (!this._active || this._unavailable || !this._hasMore) return null;
    const before = this._commits.at(-1)?.oid;
    if (!before) return null;
    const requestId = /** @type {string | null | undefined} */ (
      this.client?.log?.(PAGE_SIZE, before)
    );
    if (!requestId) return null;
    this._logRequestId = requestId;
    return requestId;
  }
  /** @param {GitHistoryLogDetail | null | undefined} detail */
  applyLog(detail) {
    if (!detail || detail.requestId !== this._logRequestId || !Array.isArray(detail.commits))
      return;
    const seen = new Set(this._commits.map((commit) => commit.oid));
    for (const commit of detail.commits) {
      if (!commit?.oid || seen.has(commit.oid)) continue;
      seen.add(commit.oid);
      this._commits.push(commit);
    }
    this._hasMore = Boolean(detail.hasMore);
    this._renderList();
  }
  /** @param {string | null | undefined} oid */
  selectCommit(oid) {
    if (!this._active || !oid) return null;
    const requestId = /** @type {string | null | undefined} */ (this.client?.logDetail?.(oid));
    if (!requestId) return null;
    this._detailRequestId = requestId;
    this._selectedOid = oid;
    this._expandDetail();
    this._renderList();
    return requestId;
  }
  /** @param {GitHistoryLogDetailResponse | null | undefined} detail */
  applyLogDetail(detail) {
    if (!detail || detail.requestId !== this._detailRequestId || !detail.commit?.oid) return;
    this._oid = detail.commit.oid;
    this._selectedOid = detail.commit.oid;
    this._renderList();
    this._renderDetail(detail.commit);
  }
  /** @param {unknown} requestId */
  handleFailure(requestId) {
    if (requestId === this._logRequestId) this._logRequestId = null;
    if (requestId === this._detailRequestId) this._detailRequestId = null;
  }
  async copyHash() {
    if (!this._oid) return;
    try {
      await copyText(this._oid);
    } catch {
      // The hash stays selected in the panel when the clipboard is unavailable.
    }
  }
  _renderList() {
    const list = this.list;
    if (!list) return;
    list.replaceChildren();
    if (!this._commits.length) {
      const empty = document.createElement("p");
      empty.className = "git-history-empty";
      empty.textContent = t("git.historyEmpty");
      list.append(empty);
      return;
    }
    for (const commit of this._commits) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = `git-history-row${commit.oid === this._selectedOid ? " selected" : ""}`;
      const subject = document.createElement("span");
      subject.className = "git-history-subject";
      subject.textContent = commit.subject || "";
      const meta = document.createElement("span");
      meta.className = "git-history-meta";
      meta.textContent = `${this._relativeTime(commit.authorTime)} · ${commit.authorName || ""}`;
      row.append(subject, meta);
      row.addEventListener("click", () => this.selectCommit(commit.oid));
      list.append(row);
    }
    if (this._hasMore) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "project-sessions-toggle";
      more.textContent = t("sidebar.showMore");
      more.addEventListener("click", () => this.loadMore());
      list.append(more);
    }
  }
  /** @param {GitHistoryCommitDetail | null} [commit] */
  _renderDetail(commit = null) {
    const detail = this.detail;
    if (!detail) return;
    detail.replaceChildren();
    if (!commit) {
      const hint = document.createElement("p");
      hint.className = "git-history-detail-empty";
      hint.textContent = t("git.historySelectHint");
      detail.append(hint);
      return;
    }
    const header = document.createElement("div");
    header.className = "git-history-detail-header";
    const oid = document.createElement("code");
    oid.className = "git-history-oid-short";
    oid.textContent = commit.oid.slice(0, 7);
    oid.setAttribute("role", "button");
    oid.setAttribute("tabindex", "0");
    oid.setAttribute("aria-label", t("git.copyHash"));
    oid.title = t("git.copyHash");
    oid.addEventListener("click", () => void this.copyHash());
    oid.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        void this.copyHash();
      }
    });
    header.append(oid);
    const message = document.createElement("pre");
    message.className = "git-history-message";
    message.textContent = commit.fullMessage || "";
    const truncation = commit.messageTruncated ? document.createElement("small") : null;
    if (truncation) {
      truncation.className = "git-history-message-truncated";
      truncation.textContent = t("git.messageTruncated");
    }
    const filesTruncation = commit.filesTruncated ? document.createElement("small") : null;
    if (filesTruncation) {
      filesTruncation.className = "git-history-files-truncated";
      filesTruncation.textContent = t("git.filesTruncated");
    }
    const files = document.createElement("ul");
    files.className = "git-history-files";
    for (const file of commit.files || []) {
      const row = document.createElement("li");
      row.className = "git-history-file";
      row.tabIndex = 0;
      const status = document.createElement("span");
      status.className = "git-history-file-status";
      status.textContent = file.status || "";
      const path = document.createElement("span");
      path.textContent = file.originalPath ? `${file.originalPath} → ${file.path}` : file.path;
      row.append(status, path);
      const open = () => {
        const requestId = /** @type {string | null | undefined} */ (
          this.client?.commitDiff?.(commit.oid, file.pathBytesBase64)
        );
        if (requestId) {
          /** @type {GitHistoryCommitDiffRequest} */
          const descriptor = {
            type: "commit_diff",
            comparison: "commit",
            commitOid: commit.oid,
            subject: String(commit.fullMessage || "").split("\n")[0],
            status: file.status,
            displayPath: file.path,
            path: file.path,
            originalPath: file.originalPath,
            pathBytesBase64: file.pathBytesBase64,
          };
          this.onDiffRequest?.(requestId, descriptor);
        }
      };
      row.addEventListener("click", open);
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      });
      files.append(row);
    }
    detail.append(header, message);
    if (truncation) detail.append(truncation);
    if (filesTruncation) detail.append(filesTruncation);
    detail.append(files);
  }
  _rowEls() {
    const list = this.list;
    if (!list) return document.createDocumentFragment().querySelectorAll(".git-history-row");
    return list.querySelectorAll(".git-history-row");
  }
  /** @param {unknown} unixSeconds */
  _relativeTime(unixSeconds) {
    return relativeTime(unixSeconds, Date.now(), t, getLocale());
  }
}
