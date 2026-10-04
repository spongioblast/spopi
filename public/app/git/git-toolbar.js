// ABOUTME: Renders the git toolbar, including the amend checkbox.
// ABOUTME: Commit and push actions are invoked by the panel.
// ABOUTME: Git panel header: branch control, Add remote / Publish button, fetch/pull/push, AI commit.

import { compactWorkspaceLabel } from "../files/path-utils.js";
import { t } from "../i18n/i18n.js";
import { setButtonIcon } from "../ui/icons.js";

/**
 * @typedef {{
 *   branch?: string | null,
 *   headOid?: string | null,
 *   headState?: string | null,
 *   upstream?: string | null,
 *   remotes?: string[] | null,
 *   ahead?: number | null,
 *   behind?: number | null,
 *   counts?: {
 *     staged?: number,
 *     changes?: number,
 *     untracked?: number,
 *     conflicted?: number,
 *   } | null,
 *   changeStats?: {
 *     additions?: number,
 *     deletions?: number,
 *     untrackedExcludedCount?: number,
 *     binaryFileCount?: number,
 *   } | null,
 * }} GitToolbarSnapshot
 *
 * @typedef {{
 *   pushError?: string | null,
 *   remoteError?: string | null,
 *   pushInProgress?: boolean,
 *   remoteInProgress?: boolean,
 *   amend?: boolean,
 *   projectPath?: string,
 *   openBranchMenu?: (event: MouseEvent) => void,
 *   openRemoteDialog?: () => void,
 *   pull: () => void,
 *   fetch: () => void,
 *   push: () => void,
 *   requestAiCommitMessage: () => void,
 * }} GitToolbarPanel
 */

/**
 * @param {{
 *   className: string,
 *   icon: string,
 *   label: string,
 *   variant: string,
 *   disabled: boolean,
 *   onClick: () => void,
 * }} options
 * @returns {HTMLButtonElement}
 */
function iconButton({ className, icon, label, variant, disabled, onClick }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `ui-icon-button ui-icon-button--sm ${variant} ${className}`;
  button.setAttribute("aria-label", label);
  button.title = label;
  button.disabled = disabled;
  setButtonIcon(button, icon, { size: 14 });
  button.addEventListener("click", onClick);
  return button;
}

/**
 * The project folder this panel belongs to. Read from the workspace path on
 * every render, so a renamed folder shows its new name.
 * @param {string | null | undefined} projectPath
 * @returns {HTMLElement | null}
 */
export function renderProjectLabel(projectPath) {
  const name = compactWorkspaceLabel(projectPath);
  if (!name) return null;
  const label = document.createElement("p");
  label.className = "git-panel-project";
  label.textContent = name;
  label.title = String(projectPath);
  return label;
}

/** @param {GitToolbarSnapshot | null | undefined} snapshot @returns {string} */
function branchLabel(snapshot) {
  if (snapshot?.branch) return snapshot.branch;
  const sha = String(snapshot?.headOid || "").slice(0, 7);
  if (snapshot?.headState === "detached" || sha) return sha ? `HEAD@${sha}` : "HEAD";
  return snapshot?.headState || "";
}

/**
 * @param {GitToolbarPanel} panel
 * @param {GitToolbarSnapshot} snapshot
 * @returns {HTMLElement}
 */
export function renderGitToolbar(panel, snapshot) {
  const toolbar = document.createElement("header");
  toolbar.className = "git-panel-toolbar";
  const details = document.createElement("div");
  details.className = "git-panel-details";
  const project = renderProjectLabel(panel.projectPath);
  if (project) details.append(project);
  const summary = document.createElement("p");
  summary.className = "git-panel-summary";
  const branch = branchLabel(snapshot);
  const upstream = snapshot.upstream || t("git.noUpstream");
  summary.title = t("git.summary", {
    branch,
    upstream,
    ahead: snapshot.ahead || 0,
    behind: snapshot.behind || 0,
  });
  const branchBtn = document.createElement("button");
  branchBtn.type = "button";
  branchBtn.className = "git-branch-name";
  branchBtn.textContent = branch;
  branchBtn.title = t("git.currentBranch");
  branchBtn.addEventListener("click", (event) => panel.openBranchMenu?.(event));
  summary.append(branchBtn);
  if (!snapshot.upstream && snapshot.branch) {
    const hasRemote = (snapshot.remotes?.length || 0) > 0;
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = "git-publish-pill";
    pill.textContent = hasRemote ? `↑ ${t("git.publish")}` : t("git.addRemote");
    pill.title = hasRemote ? t("git.publishTitle") : t("git.addRemoteTitle");
    pill.disabled = Boolean(panel.pushInProgress || panel.remoteInProgress);
    pill.addEventListener("click", () => (hasRemote ? panel.push() : panel.openRemoteDialog?.()));
    summary.append(document.createTextNode(" "), pill);
  }
  details.append(summary);
  const stats = document.createElement("p");
  stats.className = "git-panel-stats";
  stats.textContent = t("git.stats", {
    staged: snapshot.counts?.staged || 0,
    changes: snapshot.counts?.changes || 0,
    untracked: snapshot.counts?.untracked || 0,
    additions: snapshot.changeStats?.additions || 0,
    deletions: snapshot.changeStats?.deletions || 0,
    untrackedExcluded: snapshot.changeStats?.untrackedExcludedCount || 0,
    binary: snapshot.changeStats?.binaryFileCount || 0,
  });
  details.append(stats);
  const errorText = panel.pushError || panel.remoteError;
  if (errorText) {
    const error = document.createElement("p");
    error.className = "git-panel-push-error";
    error.setAttribute("role", "alert");
    error.textContent = errorText;
    details.append(error);
  }
  toolbar.append(details);
  const actions = document.createElement("div");
  actions.className = "git-panel-toolbar-actions";
  const busy = panel.pushInProgress || panel.remoteInProgress;
  const behind = snapshot.behind || 0;
  actions.append(
    iconButton({
      className: "git-panel-fetch",
      icon: "arrow-down",
      label: t("git.behindAhead", { behind, ahead: snapshot.ahead || 0 }),
      variant: "ui-icon-button--ghost",
      disabled: Boolean(busy),
      onClick: () => (behind > 0 ? panel.pull() : panel.fetch()),
    }),
    iconButton({
      className: "git-panel-push",
      icon: "arrow-up",
      label: panel.pushInProgress ? t("git.pushing") : t("git.push"),
      variant: "ui-icon-button--ghost",
      disabled: Boolean(panel.pushInProgress) || !snapshot.branch,
      onClick: () => panel.push(),
    }),
    iconButton({
      className: "git-panel-commit",
      icon: "sparkles",
      label: t("git.aiCommitMessage"),
      variant: "ui-icon-button--primary",
      disabled: snapshot.counts?.staged === 0 || (snapshot.counts?.conflicted ?? 0) > 0,
      onClick: () => panel.requestAiCommitMessage(),
    }),
  );
  toolbar.append(actions);
  return toolbar;
}

/**
 * @param {HTMLElement} dialog
 * @param {GitToolbarPanel} panel
 * @param {GitToolbarSnapshot | null | undefined} snapshot
 */
export function appendAmendCheckbox(dialog, panel, snapshot) {
  const label = document.createElement("label");
  label.className = "git-amend-label";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.className = "git-amend-checkbox";
  const pushed = Boolean(snapshot?.upstream) && (snapshot?.ahead || 0) === 0;
  box.disabled = pushed || !snapshot?.branch;
  box.checked = Boolean(panel.amend) && !box.disabled;
  box.title = pushed ? t("git.amendDisabled") : t("git.amend");
  box.addEventListener("change", () => {
    panel.amend = box.checked;
  });
  panel.amend = box.checked;
  label.append(box, document.createTextNode(` ${t("git.amend")}`));
  label.title = box.title;
  dialog.append(label);
}
