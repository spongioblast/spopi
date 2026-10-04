// ABOUTME: Opens the branch menu and checks that a new name is safe.
// ABOUTME: Creating or switching a branch goes through the git service.
// ABOUTME: Branch context menu: list locals, checkout, create via prompt, and the project's remotes.

import { t } from "../i18n/i18n.js";
import { showContextMenu } from "../ui/context-menu.js";
import { promptDialog } from "../ui/dialog.js";
import { loadRemotes } from "./git-remote-dialog.js";

/** @typedef {import("./git-remote-dialog.js").GitRemote} GitRemote */

/** @param {unknown} name @returns {boolean} */
export function isSafeBranchName(name) {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    name.length < 128 &&
    !name.startsWith("-") &&
    !name.startsWith("/") &&
    !name.endsWith("/") &&
    !name.includes("..") &&
    !/\s/.test(name) &&
    /^[A-Za-z0-9._/-]+$/.test(name)
  );
}

/**
 * @param {{
 *   event?: { preventDefault?: () => void, clientX?: number, clientY?: number },
 *   client?: unknown,
 *   onError?: (error: unknown) => void,
 *   onEditRemote?: (remote: GitRemote | null) => void,
 * }} [options]
 * @returns {Promise<void>}
 */
export async function openGitBranchMenu({ event, client, onError, onEditRemote } = {}) {
  if (!client || typeof client !== "object") {
    onError?.("branches");
    return;
  }
  const gitClient = /** @type {{
   *   sendAndAwait?: (
   *     payload: Record<string, unknown>,
   *     matcher?: ((message: unknown) => boolean) | null,
   *     timeoutMs?: number,
   *   ) => Promise<unknown>,
   *   checkout: (name: string, options?: { create?: boolean }) => unknown,
   * }} */ (client);
  const [frame, remotes] = await Promise.all([
    gitClient.sendAndAwait?.({ type: "branches" }, (message) => {
      if (!message || typeof message !== "object") return false;
      const type = /** @type {{ type?: unknown }} */ (message).type;
      return type === "git_branches" || type === "git_command_failed";
    }),
    onEditRemote ? loadRemotes(gitClient) : Promise.resolve(null),
  ]);
  if (!frame || typeof frame !== "object") {
    onError?.("branches");
    return;
  }
  const result = /** @type {{ type?: unknown, error?: unknown, branches?: unknown }} */ (frame);
  if (result.type === "git_command_failed") {
    onError?.(result.error || "branches");
    return;
  }
  const branches = Array.isArray(result.branches) ? result.branches : [];
  /** @type {{ separator?: boolean, label?: string, disabled?: boolean, action?: () => void }[]} */
  const items = branches.map((branch) => {
    const entry = /** @type {{ current?: unknown, name?: unknown }} */ (branch);
    const name = typeof entry.name === "string" ? entry.name : String(entry.name ?? "");
    return {
      label: `${entry.current ? "✓ " : ""}${name}`,
      disabled: Boolean(entry.current),
      action: () => {
        gitClient.checkout(name);
      },
    };
  });
  items.push({ separator: true });
  items.push({
    label: t("git.createBranch"),
    action: async () => {
      const name = await promptDialog({
        title: t("git.createBranch"),
        label: t("git.branchPrompt"),
      });
      if (!name) return;
      if (!isSafeBranchName(name)) {
        onError?.(t("git.branchPrompt"));
        return;
      }
      gitClient.checkout(name, { create: true });
    },
  });
  if (onEditRemote && remotes) {
    items.push({ separator: true });
    for (const remote of remotes) {
      items.push({
        label: t("git.remoteMenuItem", { name: remote.name }),
        action: () => onEditRemote(remote),
      });
    }
    if (remotes.length === 0) {
      items.push({ label: t("git.addRemote"), action: () => onEditRemote(null) });
    }
  }
  showContextMenu({ event, items });
}
