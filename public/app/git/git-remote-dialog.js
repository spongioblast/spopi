// ABOUTME: Add, change, or remove a Git remote, and publish the branch to a new one.
// ABOUTME: The host runs git remote; sign-in stays with Git's credential manager or SSH key.

import { t } from "../i18n/i18n.js";
import { confirmDialog, openDialog } from "../ui/dialog.js";
import { el } from "../ui/dom.js";

/**
 * @typedef {{ name: string, url: string }} GitRemote
 * @typedef {{
 *   sendAndAwait?: (
 *     payload: Record<string, unknown>,
 *     matcher?: ((message: unknown) => boolean) | null,
 *     timeoutMs?: number,
 *   ) => Promise<unknown>,
 * }} GitRemoteClient
 */

/** Same rules as `is_safe_remote_name` in src-tauri/src/git/remote.rs. */
/** @param {unknown} name */
export function isSafeRemoteName(name) {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    name.length < 64 &&
    !/^[-.]/.test(name) &&
    !name.endsWith(".lock") &&
    !name.includes("..") &&
    /^[A-Za-z0-9._-]+$/.test(name)
  );
}

/** Same rules as `is_safe_remote_url` in src-tauri/src/git/remote.rs. */
/** @param {unknown} url */
export function isSafeRemoteUrl(url) {
  if (typeof url !== "string" || !url || url.length > 2048) return false;
  if (url.startsWith("-") || url.includes("::") || /[\s\p{Cc}]/u.test(url)) return false;
  if (/^(https?|ssh|git|file):\/\/./i.test(url)) return true;
  return /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:(?!\/\/).+$/.test(url);
}

/**
 * @param {GitRemoteClient | null | undefined} client
 * @param {Record<string, unknown>} payload
 * @returns {Promise<{ ok: true, frame: Record<string, unknown> } | { ok: false, error: string }>}
 */
async function send(client, payload) {
  const frame = /** @type {Record<string, unknown> | null} */ (
    await client?.sendAndAwait?.(payload)
  );
  if (!frame) return { ok: false, error: t("git.remoteFailed") };
  if (frame.type === "git_command_failed") {
    return { ok: false, error: String(frame.error || t("git.remoteFailed")) };
  }
  return { ok: true, frame };
}

/**
 * @param {GitRemoteClient | null | undefined} client
 * @returns {Promise<GitRemote[] | null>}
 */
export async function loadRemotes(client) {
  const result = await send(client, { type: "remotes" });
  if (!result.ok) return null;
  const list = Array.isArray(result.frame.remotes) ? result.frame.remotes : [];
  return list
    .map((entry) => /** @type {{ name?: unknown, url?: unknown }} */ (entry))
    .filter((entry) => typeof entry.name === "string")
    .map((entry) => ({ name: String(entry.name), url: String(entry.url ?? "") }));
}

/**
 * Add a remote (no `remote` given) or change or remove an existing one.
 * Resolves once the dialog closes; `onPublish` runs after a remote is added
 * with "Push this branch now" ticked.
 * @param {{
 *   client: GitRemoteClient | null | undefined,
 *   remote?: GitRemote | null,
 *   canPublish?: boolean,
 *   onPublish?: () => void,
 *   onChanged?: () => void,
 * }} options
 * @returns {Promise<void>}
 */
export function openRemoteDialog({
  client,
  remote = null,
  canPublish = false,
  onPublish,
  onChanged,
}) {
  const editing = Boolean(remote);
  return new Promise((resolve) => {
    const nameInput = /** @type {HTMLInputElement} */ (
      el("input", { type: "text", class: "ui-input git-remote-name", spellcheck: "false" })
    );
    nameInput.value = remote?.name || "origin";
    nameInput.disabled = editing;
    const urlInput = /** @type {HTMLInputElement} */ (
      el("input", {
        type: "text",
        class: "ui-input git-remote-url",
        spellcheck: "false",
        placeholder: t("git.remoteUrlPlaceholder"),
      })
    );
    urlInput.value = remote?.url || "";
    const publish = /** @type {HTMLInputElement} */ (
      el("input", { type: "checkbox", class: "git-remote-publish" })
    );
    publish.checked = canPublish;
    const error = /** @type {HTMLElement} */ (
      el("p", { class: "git-remote-error", role: "alert" })
    );
    error.hidden = true;
    /** @param {string} label @param {HTMLElement} input */
    const field = (label, input) =>
      el("label", { class: "dialog-field" }, [
        el("span", { class: "dialog-field-label", text: label }),
        input,
      ]);
    const body = el("div", { class: "git-remote-body" }, [
      el("p", { class: "dialog-message git-remote-hint", text: t("git.remoteHint") }),
      field(t("git.remoteName"), nameInput),
      field(t("git.remoteUrl"), urlInput),
      !editing && canPublish
        ? el("label", { class: "git-identity-option git-remote-publish-label" }, [
            publish,
            el("span", { text: t("git.remotePublishNow") }),
          ])
        : null,
      error,
    ]);

    let busy = false;
    /** @param {string} text */
    const fail = (text) => {
      error.textContent = text;
      error.hidden = false;
    };
    const setBusy = (/** @type {boolean} */ value) => {
      busy = value;
      for (const button of handle.element.querySelectorAll("button")) button.disabled = value;
      urlInput.disabled = value;
    };

    const save = async () => {
      if (busy) return;
      const name = nameInput.value.trim();
      const url = urlInput.value.trim();
      if (!isSafeRemoteName(name)) return fail(t("git.remoteInvalidName"));
      if (!isSafeRemoteUrl(url)) return fail(t("git.remoteInvalidUrl"));
      if (editing && url === remote?.url) return handle.close();
      setBusy(true);
      const result = await send(client, {
        type: editing ? "remote_set_url" : "remote_add",
        name,
        url,
      });
      setBusy(false);
      if (!result.ok) return fail(result.error);
      const publishNow = !editing && canPublish && publish.checked;
      handle.close();
      onChanged?.();
      if (publishNow) onPublish?.();
    };

    const remove = async () => {
      if (busy || !remote) return;
      const confirmed = await confirmDialog({
        title: t("git.remoteRemove"),
        message: t("git.remoteRemoveConfirm", { name: remote.name }),
        confirmLabel: t("git.remoteRemove"),
        danger: true,
      });
      if (!confirmed) return;
      setBusy(true);
      const result = await send(client, { type: "remote_remove", name: remote.name });
      setBusy(false);
      if (!result.ok) return fail(result.error);
      handle.close();
      onChanged?.();
    };

    urlInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.isComposing) return;
      event.preventDefault();
      void save();
    });

    /** @type {{ label: string, className?: string, onClick?: () => void, primary?: boolean }[]} */
    const actions = [];
    if (editing) {
      actions.push({
        label: t("git.remoteRemove"),
        className: "ui-button ui-button--danger git-remote-remove",
        onClick: () => void remove(),
      });
    }
    actions.push(
      {
        label: t("git.cancel"),
        className: "ui-button ui-button--secondary",
        onClick: () => handle.close(),
      },
      {
        label: editing ? t("git.remoteSave") : t("git.remoteAddAction"),
        className: "ui-button ui-button--primary git-remote-save",
        primary: true,
        onClick: () => void save(),
      },
    );
    const handle = openDialog({
      title: editing
        ? t("git.remoteTitleEdit", { name: remote?.name || "" })
        : t("git.remoteTitleAdd"),
      body,
      className: "git-remote-dialog",
      initialFocus: urlInput,
      closeOnBackdrop: false,
      actions,
      onClose: () => resolve(),
    });
  });
}
