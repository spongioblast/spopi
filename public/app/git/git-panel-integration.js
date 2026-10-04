// ABOUTME: Connects the Git panel to the native Host runtime transport.
// ABOUTME: Keeps every Git command bound to the current workspace.

import { t } from "../i18n/i18n.js";
import { headerChromeRefs } from "../shell/chrome/chat.js";
import { fileSidebarRefs } from "../shell/chrome/file-sidebar.js";
import { GitClient } from "./git-client.js";
import { GitPanel } from "./git-panel.js";
import { createGitRefreshHooks } from "./git-refresh-hooks.js";

/**
 * @typedef {import("./git-panel.js").GitSnapshot} GitSnapshot
 * @typedef {import("./git-panel.js").GitAiSnapshot} GitAiSnapshot
 * @typedef {import("./git-panel.js").GitEntry} GitEntry
 */

/**
 * @typedef {{
 *   type?: string,
 *   requestId?: string,
 *   command?: Record<string, unknown>,
 *   workspaceGeneration?: number,
 * }} GitClientSendMessage
 */

/**
 * @typedef {{
 *   type?: string,
 *   requestId?: string,
 *   gitUnavailable?: boolean,
 *   snapshot?: GitSnapshot | GitAiSnapshot | null,
 *   diff?: Record<string, unknown>,
 *   truncated?: boolean,
 *   message?: string,
 *   error?: unknown,
 *   confirmationToken?: string,
 *   status?: string,
 *   [key: string]: unknown,
 * }} GitPanelFrame
 */

/**
 * @typedef {{
 *   status?: string,
 *   error?: string,
 *   requestId?: string,
 *   [key: string]: unknown,
 * }} GitCommandResultFrame
 */

/**
 * @typedef {{
 *   data?: { text?: string },
 *   text?: string,
 * }} AiCommitConfigResponse
 */

/**
 * @typedef {{
 *   git: (command: Record<string, unknown>, target?: unknown) => Promise<unknown>,
 *   subscribe: (listener: (frame: GitPanelFrame) => void) => (() => void) | void | undefined,
 * }} GitPanelRuntime
 */

/**
 * @typedef {{
 *   runtime?: GitPanelRuntime | null,
 *   getTarget?: (() => unknown) | null,
 *   container?: Element | null,
 *   fileList?: Element | null,
 *   onError?: ((error: unknown) => void) | null,
 *   onSnapshot?: ((snapshot: unknown) => void) | null,
 *   callConfig?: ((op: string, params: Record<string, unknown>) => unknown) | null,
 *   getProjectPath?: (() => Promise<string>) | null,
 *   onRepositoryFound?: (() => void) | null,
 *   identity?: import("./git-commit-identity.js").GitIdentityService | null,
 * }} MountGitPanelOptions
 */

/**
 * @param {unknown} error
 * @returns {boolean}
 */
export function isGitUnavailableError(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const trimmed = message.trim();
  return trimmed === "git_not_found" || trimmed.toLowerCase() === "program not found";
}

/**
 * git's own stderr for a workspace that is not a repository. A panel state, not a host outage.
 * @param {unknown} error
 * @returns {boolean}
 */
function isNotGitRepoError(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("not a git repository");
}

/**
 * @param {MountGitPanelOptions} [options]
 * @returns {{
 *   panel: GitPanel,
 *   client: GitClient,
 *   setTab: (tab: string) => void,
 *   getTab: () => string,
 *   destroy: () => void,
 * } | null}
 */
export function mountGitPanel({
  runtime,
  getTarget,
  container,
  fileList,
  onError,
  onSnapshot,
  callConfig,
  getProjectPath,
  onRepositoryFound,
  identity,
} = {}) {
  const files = fileSidebarRefs();
  const closeBtn = files.close;
  const path = files.path;
  const up = files.up;
  const filesRefresh = files.refresh;
  const filesToggleHidden = files.toggleHidden;
  const gitRefresh = files.gitRefresh;
  const finder = files.finder;
  const collapse = files.collapse;
  if (!runtime || !container) return null;

  const runtimeRef = runtime;
  const containerRef = container;
  /** @type {() => unknown} */
  const getTargetFn = /** @type {() => unknown} */ (getTarget);

  /** @param {GitClientSendMessage} message */
  const send = (message) => {
    // runtime.git() wraps the payload into { type: "git_command", command }
    // for the backend. Passing the full GitClient message would double-wrap
    // it, so the backend would see /command/type = "git_command" instead of
    // "status" and reject it as "unsupported Git command".
    const payload =
      message.type === "git_ai_commit_message"
        ? { type: "git_ai_commit_message", requestId: message.requestId }
        : { ...message.command, requestId: message.requestId };
    runtimeRef
      .git(payload, getTargetFn())
      .then((/** @type {unknown} */ response) => {
        if (response) {
          handleFrame({
            .../** @type {GitPanelFrame} */ (response),
            requestId: message.requestId,
          });
        }
      })
      .catch((/** @type {unknown} */ error) => {
        if (isGitUnavailableError(error)) {
          panel?.setGitMissing(true);
          onSnapshot?.(null);
          return;
        }
        // Contract: a non-repo workspace is a panel state; it must never
        // reach showError (which flips the header to Disconnected).
        if (isNotGitRepoError(error)) {
          panel?.setNotGitRepo(true);
          onSnapshot?.(null);
          headerChromeRefs().diffSidebarToggle?.classList.add("hidden");
          return;
        }
        onError?.(error);
      });
  };

  // Avoid a fresh-literal excess-property check against GitClient's inferred
  // `{ timeoutMs?: number }` while sibling files are still being typed.
  const clientOptions = { send };
  const client = new GitClient(clientOptions);

  // The native Host backend always uses generation 0 (workspace roots are
  // stable per process — there is no workspace-swap lifecycle). Without this
  // call, generation stays null and every command() returns early, so the
  // panel never sends a status request and renders empty.
  client.setWorkspaceGeneration(0);

  /** @param {GitPanelFrame} frame */
  const handleFrame = (frame) => {
    if (!frame?.type) return;
    const normalized = { ...frame };
    const awaited = client.resolveResponse(normalized);
    if (normalized.type === "git_status") {
      if (normalized.gitUnavailable) {
        panel.setGitMissing(true);
        onSnapshot?.(null);
        return;
      }
      // A folder that just became a repository (Initialize, or git init
      // elsewhere): the header pill and the sidebar's git state are stale.
      const becameRepo = panel.notGitRepo;
      panel.setSnapshot(/** @type {GitSnapshot | null | undefined} */ (normalized.snapshot));
      onSnapshot?.(normalized.snapshot);
      if (becameRepo) onRepositoryFound?.();
    } else if (normalized.type === "git_log") panel.historyPanel?.applyLog(normalized);
    else if (normalized.type === "git_log_detail") panel.historyPanel?.applyLogDetail(normalized);
    else if (normalized.type === "git_commit_diff") {
      const diff =
        /** @type {{ rawPatch?: string, truncated?: boolean, fallbackReason?: string | null } | undefined} */ (
          normalized.diff
        );
      const descriptor = /** @type {Record<string, unknown> | null} */ (latestCommitDiffDescriptor);
      if (diff && descriptor && normalized.requestId === latestCommitDiffRequest) {
        // A commit opens in the same diff tab as Review; the History list stays in the sidebar.
        document.dispatchEvent(
          new CustomEvent("spopi-review-commit-file", {
            detail: {
              commitOid: descriptor.commitOid,
              subject: descriptor.subject,
              path: descriptor.displayPath || descriptor.path,
              status: descriptor.status,
              patch: diff.rawPatch || "",
              binary: diff.fallbackReason === "binary",
              truncated: diff.truncated === true,
            },
          }),
        );
      }
    } else if (normalized.type === "git_ai_commit_message_started") {
      if (normalized.requestId !== panel.pendingAiRequestId) return;
      const snapshot = normalized.snapshot;
      const requestId = normalized.requestId;
      Promise.resolve(
        callConfig?.("commit_message", {
          diff: normalized.diff || "",
          truncated: normalized.truncated === true,
        }),
      )
        .then((/** @type {unknown} */ response) => {
          if (requestId !== panel.pendingAiRequestId) return;
          const typed =
            response && typeof response === "object"
              ? /** @type {AiCommitConfigResponse} */ (response)
              : null;
          const text = typed?.data?.text ?? typed?.text ?? "";
          panel.applyAiResult(/** @type {GitAiSnapshot | null | undefined} */ (snapshot), text);
        })
        .catch((/** @type {unknown} */ error) => {
          if (requestId !== panel.pendingAiRequestId) return;
          panel.applyAiFailure(error instanceof Error ? error.message : String(error));
        });
    } else if (normalized.type === "git_ai_commit_message") {
      if (normalized.requestId !== panel.pendingAiRequestId) return;
      panel.applyAiResult(
        /** @type {GitAiSnapshot | null | undefined} */ (normalized.snapshot),
        normalized.message,
      );
    } else if (normalized.type === "git_ai_commit_message_failed") {
      if (normalized.requestId !== panel.pendingAiRequestId) return;
      panel.applyAiFailure(normalized.error);
    } else if (normalized.type === "git_commit_confirmation_required") {
      if (normalized.requestId !== panel.pendingCommitRequestId) return;
      panel.applyConfirmationToken(normalized.confirmationToken);
    } else if (normalized.type === "git_commit_started") {
      if (normalized.requestId !== panel.pendingCommitRequestId) return;
      panel.setCommitInProgress(true);
    } else if (normalized.type === "git_push_started") panel.setPushInProgress(true);
    else if (normalized.type === "git_push_result") {
      panel.applyPushResult(/** @type {GitCommandResultFrame} */ (normalized));
      // A successful push moves the upstream, so the ahead/behind summary in
      // the toolbar is stale until the next status read.
      if (normalized.status === "succeeded") panel.refresh();
    } else if (normalized.type === "git_commit_result") {
      if (normalized.requestId !== panel.pendingCommitRequestId) return;
      panel.applyCommitResult(/** @type {GitCommandResultFrame} */ (normalized));
      if (normalized.status === "succeeded") panel.refresh();
    } else if (normalized.type === "git_command_ack") {
      panel.remoteInProgress = false;
      panel.refresh();
    } else if (normalized.type === "git_command_failed") {
      client.consumeWriteFailure(normalized);
      panel.historyPanel?.handleFailure(normalized.requestId);
      panel.remoteInProgress = false;
      if (isGitUnavailableError(normalized.error)) {
        panel.setGitMissing(true);
        onSnapshot?.(null);
      } else if (
        // A status probe against a non-repository workspace fails with git's
        // "not a git repository" error and never produces a git_status frame,
        // so the panel would otherwise sit on the generic "no status loaded"
        // message. Surface the real reason instead — but only for the current
        // status probe, never for stale or concurrent non-status failures.
        panel.isStatusFailure(normalized.requestId) &&
        typeof normalized.error === "string" &&
        normalized.error.includes("not a git repository")
      ) {
        panel.setNotGitRepo(true);
        // Runtime parity for the startup probe in project-header: once git
        // itself proves the workspace is not a repository, hide the header
        // pill immediately instead of leaving an entry that cannot work.
        headerChromeRefs().diffSidebarToggle?.classList.add("hidden");
      } else if (normalized.requestId === panel.pendingInitRequestId) {
        panel.applyInitFailure(normalized.error);
      } else if (
        panel.isStatusFailure(normalized.requestId) ||
        normalized.requestId === panel.pendingCommitRequestId
      ) {
        panel.applyCommitFailure(normalized.error);
      } else if (!awaited) {
        panel.applyRemoteError(normalized.error);
      }
    }
  };

  /** @type {string | null} */
  let latestCommitDiffRequest = null;
  /** @type {GitEntry | null} */
  let latestCommitDiffDescriptor = null;
  const panel = new GitPanel({
    container: containerRef,
    fileList,
    client: /** @type {import("./git-panel.js").GitClientLike} */ (/** @type {unknown} */ (client)),
    onReviewFile: (path) => {
      document.dispatchEvent(new CustomEvent("spopi-review-git-file", { detail: { path } }));
    },
    /**
     * @param {string} requestId
     * @param {unknown} [descriptor]
     */
    onHistoryDiffRequest: (requestId, descriptor) => {
      latestCommitDiffRequest = requestId;
      latestCommitDiffDescriptor = /** @type {GitEntry | null} */ (descriptor || null);
    },
    identity,
  });

  /** @type {"files" | "git"} */
  let currentTab = "files";

  const applyChrome = () => {
    const showGit = currentTab === "git";
    if (closeBtn && "dataset" in closeBtn) {
      const btn = /** @type {HTMLElement} */ (closeBtn);
      btn.dataset.i18nAriaLabel = showGit ? "git.closeChanges" : "files.close";
      btn.setAttribute("aria-label", t(btn.dataset.i18nAriaLabel));
    }
  };

  /** @param {string} tab */
  const setTab = (tab) => {
    currentTab = tab === "git" ? "git" : "files";
    const showGit = currentTab === "git";
    containerRef.classList.toggle("hidden", !showGit);
    fileList?.classList.toggle("hidden", showGit);
    path?.classList.toggle("hidden", showGit);
    up?.classList.toggle("hidden", showGit);
    filesRefresh?.classList.toggle("hidden", showGit);
    filesToggleHidden?.classList.toggle("hidden", showGit);
    gitRefresh?.classList.toggle("hidden", !showGit);
    finder?.classList.toggle("hidden", showGit);
    collapse?.classList.toggle("hidden", showGit);
    applyChrome();
    if (showGit) {
      panel.refresh();
      void getProjectPath?.()
        .then((projectPath) => panel.setProjectPath(projectPath))
        .catch(() => {});
      hooks.setGitVisible(true);
    } else {
      hooks.setGitVisible(false);
    }
  };

  const hooks = createGitRefreshHooks({
    refresh: () => panel.refresh(),
    isVisible: () => currentTab === "git",
    /** @param {(frame: GitPanelFrame) => void} listener */
    subscribe: (listener) => runtimeRef.subscribe(listener),
  });

  // The Git status refresh lives in the sidebar header (shared with the Files
  // controls) instead of inside the panel toolbar.
  gitRefresh?.addEventListener("click", () => void panel.refresh());
  setTab("files");

  const unsubscribe = runtimeRef.subscribe((frame) => {
    if (frame?.type?.startsWith("git_")) handleFrame(frame);
  });

  return {
    panel,
    client,
    setTab,
    getTab() {
      return currentTab;
    },
    destroy() {
      hooks.destroy();
      unsubscribe?.();
      panel.historyPanel?.clearSession();
      panel.destroy();
    },
  };
}
