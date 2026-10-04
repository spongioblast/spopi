// ABOUTME: The "Committing as" line and the name and email form in the commit dialog.
// ABOUTME: The values live in Git's own config; the host reads and writes them with git config.

import { t } from "../i18n/i18n.js";
import { el } from "../ui/dom.js";

/**
 * @typedef {{ name: string, email: string }} GitIdentity
 * @typedef {{
 *   name: string,
 *   email: string,
 *   global: GitIdentity,
 *   repository: GitIdentity | null,
 * }} GitIdentityReport
 * @typedef {"global" | "repository"} GitIdentityScope
 * @typedef {{
 *   load: () => Promise<GitIdentityReport | null>,
 *   save: (identity: { name: string, email: string, scope: GitIdentityScope }) => Promise<GitIdentityReport | null>,
 * }} GitIdentityService
 * @typedef {{ name: string, email: string, scope: GitIdentityScope }} GitIdentityDraft
 * @typedef {{
 *   report: GitIdentityReport | null,
 *   loaded: boolean,
 *   loading: boolean,
 *   editing: boolean,
 *   saving: boolean,
 *   error: string,
 *   draft: GitIdentityDraft,
 *   rerender: (() => void) | null,
 * }} GitIdentityState
 */

const IDENTITY_ERROR =
  /author identity unknown|please tell me who you are|unable to auto-detect email|empty ident name/i;

/** Git's own stderr when it has no name or email to put on a commit. */
/** @param {unknown} error */
export function isIdentityError(error) {
  return typeof error === "string" && IDENTITY_ERROR.test(error);
}

/** @returns {GitIdentityState} */
export function createIdentityState() {
  return {
    report: null,
    loaded: false,
    loading: false,
    editing: false,
    saving: false,
    error: "",
    draft: { name: "", email: "", scope: "global" },
    rerender: null,
  };
}

/** @param {GitIdentityReport | null} report */
function repositoryOverrides(report) {
  return Boolean(report?.repository?.name || report?.repository?.email);
}

/** @param {GitIdentityState} state */
export function beginIdentityEdit(state) {
  const report = state.report;
  state.editing = true;
  state.error = "";
  state.draft = {
    name: report?.name || "",
    email: report?.email || "",
    scope: repositoryOverrides(report) ? "repository" : "global",
  };
}

/** @param {GitIdentityState} state */
function formShown(state) {
  if (state.editing) return true;
  return Boolean(state.report && (!state.report.name || !state.report.email));
}

/**
 * Name and email inputs bound to `draft`.
 * @param {{ name: string, email: string }} draft
 * @param {{ disabled?: boolean }} [options]
 * @returns {{ element: HTMLElement, name: HTMLInputElement, email: HTMLInputElement }}
 */
export function identityFields(draft, { disabled = false } = {}) {
  /** @param {"name" | "email"} key @param {string} label @param {string} placeholder */
  const field = (key, label, placeholder) => {
    const input = /** @type {HTMLInputElement} */ (
      el("input", {
        type: key === "email" ? "email" : "text",
        class: `ui-input git-identity-${key}`,
        value: draft[key],
        placeholder,
        spellcheck: "false",
        autocomplete: key === "email" ? "email" : "name",
      })
    );
    input.value = draft[key];
    input.disabled = disabled;
    input.addEventListener("input", () => {
      draft[key] = input.value;
    });
    const caption = el("span", { class: "dialog-field-label", text: label });
    caption.dataset.i18n = key === "email" ? "git.identityEmail" : "git.identityName";
    const wrap = el("label", { class: "dialog-field git-identity-field" }, [caption, input]);
    return { wrap, input };
  };
  const name = field("name", t("git.identityName"), t("git.identityNamePlaceholder"));
  const email = field("email", t("git.identityEmail"), t("git.identityEmailPlaceholder"));
  return {
    element: /** @type {HTMLElement} */ (
      el("div", { class: "git-identity-fields" }, [name.wrap, email.wrap])
    ),
    name: name.input,
    email: email.input,
  };
}

/**
 * @param {{ name: string, email: string }} draft
 * @returns {string} empty when both values can go to Git
 */
export function identityProblem(draft) {
  const name = draft.name.trim();
  const email = draft.email.trim();
  if (!name || !email) return t("git.identityRequired");
  if (!email.includes("@") || /\s|[<>]/.test(email)) return t("git.identityInvalidEmail");
  return "";
}

/**
 * The identity part of the commit dialog. `state` lives on the panel, so a
 * repaint of the dialog keeps what the user typed.
 * @param {{
 *   state: GitIdentityState,
 *   service?: GitIdentityService | null,
 *   onPaint?: (() => void) | null,
 * }} options
 * @returns {{ element: HTMLElement, save: () => Promise<boolean> }}
 */
export function mountCommitIdentity({ state, service, onPaint }) {
  const element = /** @type {HTMLElement} */ (el("div", { class: "git-commit-identity" }));
  if (!service) {
    element.hidden = true;
    return { element, save: async () => true };
  }
  /** @type {HTMLInputElement | null} */
  let firstInput = null;

  const line = () => {
    const report = /** @type {GitIdentityReport} */ (state.report);
    const change = el("button", {
      type: "button",
      class: "ui-button ui-button--ghost ui-button--xs git-identity-change",
      text: t("git.identityChange"),
    });
    change.addEventListener("click", () => {
      beginIdentityEdit(state);
      render();
      firstInput?.focus();
    });
    return [
      el("span", { class: "git-identity-label", text: t("git.identityCommittingAs") }),
      el("span", { class: "git-identity-who", title: `${report.name} <${report.email}>` }, [
        el("span", { class: "git-identity-who-name", text: report.name }),
        el("span", { class: "git-identity-who-email", text: report.email }),
      ]),
      repositoryOverrides(report)
        ? el("span", { class: "git-identity-scope-note", text: t("git.identityThisRepository") })
        : null,
      change,
    ];
  };

  const form = () => {
    const fields = identityFields(state.draft, { disabled: state.saving });
    firstInput = state.draft.name.trim() ? fields.email : fields.name;
    /** @param {GitIdentityScope} scope @param {string} label */
    const option = (scope, label) => {
      const radio = /** @type {HTMLInputElement} */ (
        el("input", { type: "radio", name: "git-identity-scope", value: scope })
      );
      radio.checked = state.draft.scope === scope;
      radio.disabled = state.saving || (scope === "repository" && !state.report?.repository);
      radio.addEventListener("change", () => {
        if (radio.checked) state.draft.scope = scope;
      });
      return el("label", { class: "git-identity-option" }, [radio, el("span", { text: label })]);
    };
    const canKeep = Boolean(state.report?.name && state.report?.email);
    const keep = canKeep
      ? el("button", {
          type: "button",
          class: "ui-button ui-button--ghost ui-button--xs git-identity-keep",
          text: t("git.identityKeep"),
        })
      : null;
    keep?.addEventListener("click", () => {
      state.editing = false;
      state.error = "";
      render();
    });
    return [
      el("div", { class: "git-identity-head" }, [
        el("span", { class: "git-identity-title", text: t("git.identityTitle") }),
        keep,
      ]),
      el("p", { class: "git-identity-intro", text: t("git.identityIntro") }),
      fields.element,
      el("div", { class: "git-identity-options", role: "radiogroup" }, [
        option("global", t("git.identityScopeGlobal")),
        option("repository", t("git.identityScopeRepository")),
      ]),
      state.error
        ? el("p", { class: "git-identity-error", role: "alert", text: state.error })
        : null,
    ];
  };

  const render = () => {
    const showForm = formShown(state);
    element.hidden = !showForm && !state.report?.name;
    element.classList.toggle("is-form", showForm);
    if (!state.loaded) {
      element.replaceChildren();
      return;
    }
    const nodes = (showForm ? form() : state.report?.name ? line() : []).filter(
      (node) => node != null,
    );
    element.replaceChildren(...nodes);
    onPaint?.();
  };
  state.rerender = render;

  if (!state.loaded && !state.loading) {
    state.loading = true;
    service
      .load()
      .then((report) => {
        state.report = report;
      })
      .catch(() => {
        state.report = null;
      })
      .finally(() => {
        state.loading = false;
        state.loaded = true;
        if (formShown(state) && !state.editing) beginIdentityEdit(state);
        state.rerender?.();
      });
  }
  render();

  return {
    element,
    async save() {
      if (!formShown(state)) return true;
      const problem = identityProblem(state.draft);
      if (problem) {
        state.error = problem;
        state.rerender?.();
        return false;
      }
      state.saving = true;
      state.error = "";
      state.rerender?.();
      try {
        const report = await service.save({
          name: state.draft.name.trim(),
          email: state.draft.email.trim(),
          scope: state.draft.scope,
        });
        if (report) state.report = report;
        state.editing = false;
        return true;
      } catch (error) {
        state.error = error instanceof Error ? error.message : String(error);
        return false;
      } finally {
        state.saving = false;
        state.rerender?.();
      }
    },
  };
}
