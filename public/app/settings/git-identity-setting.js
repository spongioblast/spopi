// ABOUTME: Settings → General row for the name and email Git records with commits.
// ABOUTME: The values live in Git's own config; this row reads and writes them.

import { identityFields, identityProblem } from "../git/git-commit-identity.js";
import { t } from "../i18n/i18n.js";
import { el } from "../ui/dom.js";
import { row } from "../ui/settings-controls.js";

/**
 * @typedef {import("../git/git-commit-identity.js").GitIdentityReport} GitIdentityReport
 * @typedef {import("../git/git-commit-identity.js").GitIdentityScope} GitIdentityScope
 * @typedef {{
 *   getGitIdentity?: (workspaceId?: string) => Promise<GitIdentityReport | null>,
 *   setGitIdentity?: (identity: {
 *     workspaceId?: string,
 *     name: string,
 *     email: string,
 *     scope: GitIdentityScope,
 *   }) => Promise<GitIdentityReport | null>,
 * }} GitIdentityControl
 */

/**
 * @param {{
 *   control?: GitIdentityControl | null,
 *   getWorkspaceId?: (() => string | null | undefined) | null,
 *   register?: (load: () => Promise<unknown> | undefined) => void,
 * }} [options]
 * @returns {HTMLElement}
 */
export function gitIdentityRow({
  control,
  getWorkspaceId,
  register = (load) => {
    void load()?.catch(() => {});
  },
} = {}) {
  const draft = { name: "", email: "", scope: /** @type {GitIdentityScope} */ ("global") };
  const fields = identityFields(draft);
  /** @type {GitIdentityReport | null} */
  let report = null;
  const global = /** @type {HTMLInputElement} */ (
    el("input", { type: "radio", name: "settings-git-identity-scope", value: "global" })
  );
  const repository = /** @type {HTMLInputElement} */ (
    el("input", { type: "radio", name: "settings-git-identity-scope", value: "repository" })
  );
  global.checked = true;
  const save = /** @type {HTMLButtonElement} */ (
    el("button", {
      type: "button",
      class: "ui-button ui-button--secondary ui-button--sm",
      text: t("settings.gitIdentity.save"),
    })
  );
  save.dataset.i18n = "settings.gitIdentity.save";
  const status = /** @type {HTMLElement} */ (
    el("span", { class: "settings-git-identity-status", role: "status" })
  );
  const error = /** @type {HTMLElement} */ (
    el("span", { class: "settings-git-identity-error", role: "alert" })
  );
  error.hidden = true;

  const workspaceId = () => getWorkspaceId?.() || "";
  const paint = () => {
    const hasRepo = Boolean(report?.repository);
    repository.disabled = !hasRepo;
    if (!hasRepo) {
      draft.scope = "global";
      global.checked = true;
    }
  };
  /** @param {GitIdentityReport | null} next */
  const apply = (next) => {
    report = next;
    if (next) {
      draft.name = next.name || "";
      draft.email = next.email || "";
      draft.scope = next.repository?.name || next.repository?.email ? "repository" : "global";
      fields.name.value = draft.name;
      fields.email.value = draft.email;
      global.checked = draft.scope === "global";
      repository.checked = draft.scope === "repository";
    }
    paint();
  };

  global.addEventListener("change", () => {
    if (global.checked) draft.scope = "global";
  });
  repository.addEventListener("change", () => {
    if (repository.checked) draft.scope = "repository";
  });
  save.addEventListener("click", async () => {
    const problem = identityProblem(draft);
    if (problem) {
      error.textContent = problem;
      error.hidden = false;
      status.textContent = "";
      return;
    }
    error.hidden = true;
    save.disabled = true;
    try {
      const next = await control?.setGitIdentity?.({
        workspaceId: workspaceId(),
        name: draft.name.trim(),
        email: draft.email.trim(),
        scope: draft.scope,
      });
      apply(next ?? report);
      status.textContent = t("settings.gitIdentity.saved");
    } catch (cause) {
      error.textContent = cause instanceof Error ? cause.message : String(cause);
      error.hidden = false;
    } finally {
      save.disabled = false;
    }
  });
  register(() =>
    control?.getGitIdentity?.(workspaceId()).then((next) => {
      apply(next);
    }),
  );

  return /** @type {HTMLElement} */ (
    row({
      id: "setting-git-identity",
      label: "Git name and email",
      labelKey: "settings.gitIdentity.title",
      description: "Git records these on each commit. They live in Git's own config, not in SPOPI.",
      descriptionKey: "settings.gitIdentity.description",
      control: el("div", { class: "settings-git-identity" }, [
        fields.element,
        el("div", { class: "git-identity-options", role: "radiogroup" }, [
          el("label", { class: "git-identity-option" }, [
            global,
            el("span", {
              text: t("git.identityScopeGlobal"),
              dataset: { i18n: "git.identityScopeGlobal" },
            }),
          ]),
          el("label", { class: "git-identity-option" }, [
            repository,
            el("span", {
              text: t("git.identityScopeRepository"),
              dataset: { i18n: "git.identityScopeRepository" },
            }),
          ]),
        ]),
        el("div", { class: "settings-git-identity-actions" }, [save, status]),
        error,
      ]),
    })
  );
}
