// ABOUTME: Empty Git panel for a folder that is not a repository yet.
// ABOUTME: The button asks the host to run git init in that workspace root.

import { t } from "../i18n/i18n.js";

/**
 * @param {ParentNode} container
 * @param {{
 *   busy?: boolean,
 *   error?: string,
 *   onInit?: (() => void) | null | undefined,
 * }} [options]
 */
export function renderNotGitRepo(container, { busy = false, error = "", onInit } = {}) {
  const empty = document.createElement("div");
  empty.className = "git-empty";
  const message = document.createElement("p");
  message.textContent = t("git.notGitRepo");
  const hint = document.createElement("p");
  hint.className = "git-empty-hint";
  hint.textContent = t("git.initHint");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ui-button ui-button--secondary";
  button.textContent = busy ? t("git.initWorking") : t("git.initRepo");
  button.disabled = busy;
  button.addEventListener("click", () => onInit?.());
  empty.append(message, hint, button);
  if (error) {
    const failure = document.createElement("p");
    failure.className = "git-panel-push-error";
    failure.textContent = error;
    empty.append(failure);
  }
  container.append(empty);
}
