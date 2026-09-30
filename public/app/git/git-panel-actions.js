// ABOUTME: Commit, push, pull, and discard actions for the Git panel.
// ABOUTME: The panel view stays in git-panel.js and paints the status tree.

import { t } from "../i18n/i18n.js";
import { bindModal } from "../ui/dialog.js";
import { openGitBranchMenu } from "./git-branch-menu.js";
import { confirmGitAction } from "./git-confirm-dialog.js";
import { appendAmendCheckbox } from "./git-toolbar.js";

/**
 * @typedef {any} GitEntry
 * @typedef {any} GitAiSnapshot
 * @typedef {any} GitWriteOperation
 */

/** @type {any} */
export const gitPanelActions = {
  /**
   * @param {GitEntry[]} [entries]
   * @param {string | null} [contextGroup]
   */
  async discard(entries = [], contextGroup = null) {
    if (!entries.length) return null;
    const untracked = contextGroup === "untracked";
    const confirmed = await confirmGitAction({
      message: untracked
        ? t("git.deleteUntrackedConfirm", { count: entries.length })
        : t("git.discardConfirm", { count: entries.length }),
      confirmLabel: untracked ? t("git.deleteUntracked") : t("git.discard"),
    });
    if (!confirmed) return null;
    return this.write("discard", entries, contextGroup);
  },
  requestAiCommitMessage() {
    if (
      !this.snapshot ||
      this.snapshot.counts?.staged === 0 ||
      /** @type {number} */ (this.snapshot.counts?.conflicted) > 0
    )
      return null;
    this.aiError = null;
    const requestId = this.client?.aiCommitMessage();
    this.pendingAiRequestId = requestId || null;
    return requestId;
  },
  /**
   * @param {GitAiSnapshot | null | undefined} snapshot
   * @param {string | null | undefined} message
   */
  applyAiResult(snapshot, message) {
    this.pendingAiRequestId = null;
    this.aiSnapshot = snapshot || null;
    this.commitMessage = message || "";
    this.aiError = null;
    this.openCommitDialog();
  },
  /** @param {unknown} error */
  applyAiFailure(error) {
    this.pendingAiRequestId = null;
    // Spec: AI failure/timeout must still open the commit dialog with an empty
    // message so the user can write one by hand. If no AI snapshot exists yet,
    // fall back to the current status snapshot so the commit can still bind to
    // a snapshotId, HEAD and index tree.
    if (!this.aiSnapshot?.snapshotId && this.snapshot?.snapshotId) {
      this.aiSnapshot = {
        snapshotId: this.snapshot.snapshotId,
        headState: this.snapshot.headState,
        headOid: this.snapshot.headOid,
        indexTreeOid: this.snapshot.indexTreeOid,
      };
    }
    this.commitMessage = this.commitMessage || "";
    this.aiError = /** @type {string} */ (error || t("git.aiFailed"));
    this.openCommitDialog();
  },
  /** @param {string | null | undefined} token */
  applyConfirmationToken(token) {
    this.pendingConfirmationToken = token || null;
    // A confirmation-required response means the first commit attempt was
    // accepted-but-pending, not failed. End the in-progress state so the
    // dialog becomes editable and the submit button is re-enabled for the
    // user to explicitly confirm.
    this.commitInProgress = false;
    if (this.commitDialog) {
      // Re-render the dialog so the confirmation notice appears.
      this.openCommitDialog();
    }
  },
  openCommitDialog() {
    if (!this.aiSnapshot?.snapshotId) return;
    this.closeCommitDialog();
    const overlay = document.createElement("div");
    overlay.className = "git-commit-dialog-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-labelledby", "git-commit-dialog-title");
    const dialog = document.createElement("div");
    dialog.className = "git-commit-dialog";
    const title = document.createElement("h3");
    title.id = "git-commit-dialog-title";
    title.textContent = t("git.commit");
    dialog.append(title);
    if (this.aiError) {
      const error = document.createElement("p");
      error.className = "git-commit-error";
      error.textContent = this.aiError;
      dialog.append(error);
    }
    if (this.pendingConfirmationToken) {
      const notice = document.createElement("p");
      notice.className = "git-commit-confirmation";
      notice.textContent = t("git.confirmationRequired");
      dialog.append(notice);
    }
    const textarea = document.createElement("textarea");
    textarea.className = "git-commit-textarea";
    textarea.value = this.commitMessage || "";
    textarea.setAttribute("aria-label", t("git.commitMessageLabel"));
    textarea.rows = 6;
    textarea.addEventListener("input", () => {
      this.commitMessage = textarea.value;
    });
    dialog.append(textarea);
    const actions = document.createElement("div");
    actions.className = "git-commit-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = t("git.cancel");
    cancel.addEventListener("click", () => this.closeCommitDialog());
    const submit = document.createElement("button");
    submit.type = "button";
    submit.textContent = t("git.commit");
    submit.className = "git-commit-submit";
    submit.addEventListener("click", () => {
      this.commitMessage = textarea.value;
      this.commit();
    });
    actions.append(cancel, submit);
    appendAmendCheckbox(dialog, this, this.snapshot);
    dialog.append(actions);
    overlay.append(dialog);
    overlay.addEventListener("click", () => {
      // Commit dialog is modal: do not close on overlay click. The user
      // must explicitly cancel or submit.
    });
    document.body.append(overlay);
    this.commitDialog = {
      overlay,
      textarea,
      submit,
      unbindEscape: bindModal(overlay, { onClose: () => this.closeCommitDialog() }),
    };
    textarea.focus();
    this.updateCommitDialogState();
  },
  closeCommitDialog() {
    if (!this.commitDialog) return;
    this.commitDialog.unbindEscape?.();
    this.commitDialog.overlay.remove();
    this.commitDialog = null;
  },
  updateCommitDialogState() {
    if (!this.commitDialog) return;
    this.commitDialog.textarea.disabled = this.commitInProgress;
    this.commitDialog.submit.disabled =
      this.commitInProgress || !this.commitDialog.textarea.value.trim();
    this.commitDialog.submit.textContent = this.commitInProgress
      ? t("git.committing")
      : t("git.commit");
  },
  /** @param {unknown} inProgress */
  setCommitInProgress(inProgress) {
    this.commitInProgress = Boolean(inProgress);
    if (inProgress) this.updateCommitDialogState();
    else this.closeCommitDialog();
  },
  /**
   * @param {{
   *   status?: string,
   *   error?: string,
   *   requestId?: string,
   *   [key: string]: unknown,
   * } | null | undefined} result
   */
  applyCommitResult(result) {
    const status = result?.status;
    if (status === "succeeded") {
      this.setCommitInProgress(false);
      this.aiSnapshot = null;
      this.commitMessage = "";
      this.pendingConfirmationToken = null;
      this.pendingCommitRequestId = null;
      return;
    }
    // failed / outcomeUnknown: end the spinner but keep the user's message so
    // they can read the error and retry. Do not clear aiSnapshot — the commit
    // may be retried against the same snapshot once the user fixes the cause.
    this.commitInProgress = false;
    this.pendingCommitRequestId = null;
    if (status === "outcomeUnknown") {
      this.aiError = t("git.outcomeUnknown");
    } else {
      this.aiError = result?.error || t("git.aiFailed");
    }
    if (this.commitDialog) this.openCommitDialog();
  },
  /** @param {unknown} error */
  applyCommitFailure(error) {
    // A commit failure (stale snapshot, hook rejection, token error) must not
    // leave the dialog permanently disabled. End the in-progress state,
    // surface the error, and keep the user's message so they can retry.
    this.commitInProgress = false;
    this.aiError = /** @type {string} */ (error || t("git.aiFailed"));
    if (this.commitDialog) this.openCommitDialog();
  },
  /**
   * @param {string} [message]
   * @param {string | null} [confirmationToken]
   * @this {any}
   */
  commit(message = this.commitMessage, confirmationToken = this.pendingConfirmationToken) {
    if (!this.aiSnapshot?.snapshotId || !message.trim()) return null;
    this.setCommitInProgress(true);
    const requestId = this.client?.commit(
      this.aiSnapshot.snapshotId,
      message,
      confirmationToken,
      this.amend,
    );
    this.pendingCommitRequestId = requestId || null;
    return requestId;
  },
  push() {
    if (this.pushInProgress) return null;
    // Clear the previous outcome first so a retry never renders a stale error
    // next to an in-flight push.
    this.pushError = null;
    this.pushInProgress = true;
    const requestId = this.client?.push();
    this.pendingPushRequestId = requestId || null;
    if (!requestId) this.pushInProgress = false;
    this.render();
    return requestId;
  },
  /** @param {unknown} inProgress */
  setPushInProgress(inProgress) {
    this.pushInProgress = Boolean(inProgress);
    this.render();
  },
  /**
   * @param {{
   *   status?: string,
   *   error?: string,
   *   [key: string]: unknown,
   * } | null | undefined} result
   */
  applyPushResult(result) {
    this.pushInProgress = false;
    this.pendingPushRequestId = null;
    this.pushError = result?.status === "succeeded" ? null : this.pushErrorText(result?.error);
    this.render();
  },
  /** Map the backend's stable failure codes onto localized copy, and pass
   *  git's own stderr through unchanged when there is no code for it.
   * @param {unknown} error
   * @returns {string}
   */
  pushErrorText(error) {
    if (error === "push_detached_head") return t("git.pushDetachedHead");
    if (error === "push_no_remote") return t("git.pushNoRemote");
    if (error === "busy") return t("git.pushBusy");
    const text = typeof error === "string" ? error.trim() : "";
    return text || t("git.pushFailed");
  },
  fetch() {
    this.remoteError = null;
    this.remoteInProgress = true;
    const requestId = this.client?.fetch();
    if (!requestId) this.remoteInProgress = false;
    this.render();
    return requestId;
  },
  pull() {
    this.remoteError = null;
    this.remoteInProgress = true;
    const requestId = this.client?.pull();
    if (!requestId) this.remoteInProgress = false;
    this.render();
    return requestId;
  },
  initializeRepository() {
    if (this.initInProgress) return null;
    this.initError = "";
    this.initInProgress = true;
    const requestId = this.client?.init();
    this.pendingInitRequestId = requestId || null;
    if (!requestId) this.initInProgress = false;
    this.render();
    return requestId;
  },
  /** @param {unknown} error */
  applyInitFailure(error) {
    this.initInProgress = false;
    this.pendingInitRequestId = null;
    this.initError = typeof error === "string" && error.trim() ? error.trim() : t("git.initFailed");
    this.render();
  },
  /** @param {unknown} error */
  applyRemoteError(error) {
    this.remoteInProgress = false;
    this.remoteError = this.pushErrorText(error);
    this.render();
  },
  /** @param {Event} event */
  openBranchMenu(event) {
    return openGitBranchMenu({
      event,
      client: this.client,
      onError: (error) => this.applyRemoteError(error),
    });
  },
  /**
   * @param {string} operation
   * @param {GitEntry[]} [entries]
   * @param {string | null} [contextGroup]
   */
  write(operation, entries = [], contextGroup = null) {
    const snapshotId = this.snapshot?.snapshotId;
    // The caller supplies the group context (the group the user clicked in).
    // Do NOT expand a partial-stage entry into all its groups: staging from
    // the Changes group must send group="changes", not also "staged".
    const selected = entries
      .map((entry) => ({
        group: contextGroup || this.groupsFor(entry)[0],
        pathBytesBase64: entry.pathBytesBase64,
        originalPathBytesBase64: entry.originalPathBytesBase64,
      }))
      .filter((entry) => entry.pathBytesBase64);
    /** @type {Record<GitWriteOperation, Set<string>>} */
    const allowedGroups = {
      stage: new Set(["changes", "untracked", "conflicted"]),
      unstage: new Set(["staged"]),
      discard: new Set(["changes", "untracked"]),
    };
    if (operation !== "stage" && operation !== "unstage" && operation !== "discard") return null;
    if (
      !snapshotId ||
      selected.length === 0 ||
      !allowedGroups[operation] ||
      selected.some((entry) => !allowedGroups[operation].has(entry.group || ""))
    )
      return null;
    return this.client?.write(operation, snapshotId, selected);
  },
};
