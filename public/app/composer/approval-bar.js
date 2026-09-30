// ABOUTME: Docked approval card that replaces the composer while Pi waits.
// ABOUTME: The first answer wins. Digit keys pick the option with that number.

import { closeWhenResolved, showNativeDialog } from "../extension-ui/dialog.js";
import { t } from "../i18n/i18n.js";
import { composerChromeRefs } from "../shell/chrome/composer.js";
import { bindFocusTrap } from "../ui/dialog.js";
import { el } from "../ui/dom.js";
import { choiceRole, parsePermissionPrompt, sessionLabel } from "./approval-prompt.js";

/**
 * @typedef {import("../extension-ui/dialog.js").DialogResult} DialogResult
 * @typedef {{ label: string, result: DialogResult }} ApprovalChoice
 */

/**
 * @param {unknown} request
 * @returns {ApprovalChoice[]}
 */
export function approvalChoices(request) {
  if (requestKind(request) === "phone_claim") {
    return [
      { label: label("pair.allow", "Allow"), result: { confirmed: true, value: "control" } },
      { label: label("composer.deny", "Deny"), result: { cancelled: true } },
    ];
  }
  const method =
    request && typeof request === "object" && "method" in request ? String(request.method) : "";
  const options =
    request && typeof request === "object" && "options" in request && Array.isArray(request.options)
      ? request.options
      : [];
  if (options.length > 0) {
    return options.map((value, index) => ({
      label: optionLabel(value, index),
      result: method === "confirm" ? { confirmed: index === 0, value } : { value },
    }));
  }
  if (method === "confirm") {
    return [
      { label: label("composer.allowOnce", "Allow once"), result: { confirmed: true } },
      { label: label("composer.always", "Always"), result: { confirmed: true, value: "always" } },
      { label: label("composer.deny", "Deny"), result: { cancelled: true } },
    ];
  }
  return [];
}

/**
 * @param {unknown} request
 */
function requestKind(request) {
  return request && typeof request === "object" && "kind" in request ? String(request.kind) : "";
}

/**
 * @param {string} key
 * @param {string} fallback
 */
function label(key, fallback) {
  const value = t(key);
  return value === key ? fallback : value;
}

const HEADLINES = {
  run: "Pi wants to run a command",
  read: "Pi wants to read outside the project",
  write: "Pi wants to write outside the project",
  file: "Pi wants to access a file",
  skill: "Pi wants to use a skill",
  use: "Pi wants to use {tool}",
};

/**
 * Headline, tool tag, subject block, and folded facts for a permission prompt; a plain title and
 * message for any other select or confirm.
 * @param {string} text
 * @returns {Array<HTMLElement | SVGElement>}
 */
function approvalHead(text) {
  const prompt = parsePermissionPrompt(text);
  if (!prompt) {
    const [first = "", ...rest] = text.split(/\r?\n/);
    const nodes = [el("header", { class: "approval-bar-head" }, [approvalTitle(first)])];
    const message = rest.join("\n").trim();
    if (message) nodes.push(el("p", { class: "approval-bar-message", text: message }));
    return nodes;
  }
  const key = `composer.approval.${prompt.kind}`;
  const translated = t(key, { tool: prompt.tool });
  const headline =
    translated === key ? HEADLINES[prompt.kind].replace("{tool}", prompt.tool) : translated;
  const head = el("header", { class: "approval-bar-head" }, [approvalTitle(headline)]);
  if (prompt.tool) head.append(el("span", { class: "approval-bar-tool", text: prompt.tool }));
  const nodes = [head];
  if (prompt.subject)
    nodes.push(el("pre", { class: "approval-bar-subject", text: prompt.subject }));
  if (prompt.facts.length) {
    nodes.push(
      el("details", { class: "approval-bar-facts" }, [
        el("summary", { text: label("composer.approval.details", "Details") }),
        el(
          "dl",
          {},
          prompt.facts.flatMap((fact) => [
            el("dt", { text: fact.label }),
            el("dd", { text: fact.text }),
          ]),
        ),
      ]),
    );
  }
  return nodes;
}

/** @param {string} text */
function approvalTitle(text) {
  return el("strong", { class: "approval-bar-title", text });
}

const ROLE_CLASS = {
  once: "ui-button--primary",
  session: "ui-button--secondary",
  deny: "ui-button--danger",
  reason: "ui-button--ghost",
  other: "ui-button--secondary",
};

/**
 * @param {string} labelText
 * @param {number} index
 */
function choiceButton(labelText, index) {
  const role = choiceRole(labelText);
  const shown =
    role === "once"
      ? label("composer.allowOnce", "Allow once")
      : role === "session"
        ? sessionLabel(labelText)
        : role === "deny"
          ? label("composer.deny", "Deny")
          : role === "reason"
            ? label("composer.approval.denyReason", "Deny with reason")
            : labelText;
  const variant = role === "other" && index === 0 ? "ui-button--primary" : ROLE_CLASS[role];
  return el(
    "button",
    { type: "button", class: `ui-button ${variant} approval-choice`, dataset: { role } },
    [
      el("span", { class: "approval-choice-label", text: shown }),
      el("kbd", { text: `${index + 1}` }),
    ],
  );
}

/**
 * @param {unknown} value
 * @param {number} index
 */
function optionLabel(value, index) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "label" in value) return String(value.label);
  return String(index + 1);
}

/**
 * @param {ParentNode} root
 * @param {unknown} request
 * @param {{ onAnswer?: (result: DialogResult) => void }} [options]
 */
export function mountApprovalBar(root, request, { onAnswer } = {}) {
  const choices = approvalChoices(request);
  const title =
    request && typeof request === "object" && "title" in request && request.title
      ? String(request.title)
      : request && typeof request === "object" && "message" in request
        ? String(request.message || "")
        : "";
  root.replaceChildren();
  const bar = document.createElement("div");
  bar.className = "approval-bar";
  bar.setAttribute("role", "alertdialog");
  bar.setAttribute("aria-label", title.split("\n")[0] || label("composer.allowOnce", "Allow once"));
  if (title) bar.append(...approvalHead(title));
  /** @type {HTMLSelectElement | null} */
  let tier = null;
  if (requestKind(request) === "phone_claim") {
    tier = document.createElement("select");
    tier.className = "approval-tier";
    tier.setAttribute("aria-label", label("settings.phone.tier", "Tier"));
    for (const name of ["observe", "control", "full"]) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      if (name === "control") option.selected = true;
      tier.append(option);
    }
    bar.append(tier);
  }
  const actions = document.createElement("div");
  actions.className = "approval-bar-actions";
  let settled = false;
  /** @type {ReturnType<typeof setInterval> | null} */
  let countdown = null;
  let unbindTrap = () => {};
  /**
   * @param {DialogResult} result
   */
  const withTier = (result) => {
    if (tier && result.confirmed) return { ...result, value: tier.value };
    return result;
  };
  /**
   * @param {DialogResult} result
   */
  const finish = (result) => {
    if (settled) return;
    settled = true;
    if (countdown != null) clearInterval(countdown);
    unbindTrap();
    document.removeEventListener("keydown", onKey);
    onAnswer?.(withTier(result));
  };
  choices.forEach((choice, index) => {
    const button = choiceButton(choice.label, index);
    button.addEventListener("click", () => finish(choice.result));
    actions.append(button);
  });
  bar.append(actions);
  const timeoutMs = requestTimeout(request);
  if (timeoutMs > 0) {
    const clock = document.createElement("span");
    clock.className = "approval-bar-timeout";
    const ends = Date.now() + timeoutMs;
    const paint = () => {
      const left = Math.max(0, Math.ceil((ends - Date.now()) / 1000));
      clock.textContent = `${left}s`;
      if (left <= 0) finish({ cancelled: true });
    };
    paint();
    countdown = setInterval(paint, 250);
    bar.append(clock);
  }
  root.append(bar);

  /**
   * @param {KeyboardEvent} event
   */
  const onKey = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      finish({ cancelled: true });
      return;
    }
    const index = Number(event.key) - 1;
    const choice = choices[index];
    if (!choice || index > 8) return;
    event.preventDefault();
    finish(choice.result);
  };
  document.addEventListener("keydown", onKey);
  unbindTrap = bindFocusTrap(bar);
  return {
    destroy() {
      if (countdown != null) clearInterval(countdown);
      unbindTrap();
      document.removeEventListener("keydown", onKey);
      root.replaceChildren();
    },
  };
}

/**
 * @param {unknown} request
 * @returns {number}
 */
function requestTimeout(request) {
  if (!request || typeof request !== "object" || !("timeout" in request)) return 0;
  const value = request.timeout;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * @param {HTMLElement} host
 * @param {boolean} open
 */
function setComposerReplaced(host, open) {
  const card = host.closest(".composer-card");
  if (!(card instanceof HTMLElement)) return;
  card.classList.toggle("composer-approval-open", open);
}

/**
 * Shows the docked bar when the composer host exists.
 * Returns null so the caller can fall through to the native dialog.
 *
 * @param {unknown} request
 * @param {{ dismissSignal?: Promise<void> }} [opts]
 * @returns {Promise<DialogResult> | null}
 */
export function openDockedApproval(request, opts = {}) {
  const host = composerChromeRefs().approvalBar;
  if (!(host instanceof HTMLElement)) return null;
  if (approvalChoices(request).length === 0) return null;
  host.classList.remove("hidden");
  setComposerReplaced(host, true);
  return new Promise((resolve) => {
    let settled = false;
    /** @type {() => void} */
    let stopResolved = () => {};
    /**
     * @param {DialogResult} result
     */
    const finish = (result) => {
      if (settled) return;
      settled = true;
      stopResolved();
      host.classList.add("hidden");
      setComposerReplaced(host, false);
      handle.destroy();
      resolve(result);
    };
    const handle = mountApprovalBar(host, request, { onAnswer: finish });
    stopResolved = closeWhenResolved(request, finish);
    opts.dismissSignal?.then(() => finish({ cancelled: true }));
  });
}

/**
 * Dock select and confirm prompts. Other methods keep the native dialog.
 *
 * @param {import("../extension-ui/dialog.js").ExtensionUiRequest} request
 * @param {HTMLElement | null | undefined} container
 * @param {{ dismissSignal?: Promise<void> }} [opts]
 * @returns {Promise<DialogResult>}
 */
export function showApprovalOrDialog(request, container, opts) {
  if (request?.kind === "phone_claim") {
    const host = document.createElement("div");
    (container || document.body).append(host);
    return new Promise((resolve) => {
      mountApprovalBar(host, request, {
        onAnswer: (result) => {
          host.remove();
          resolve(result);
        },
      });
    });
  }
  if (request?.method === "select" || request?.method === "confirm") {
    const docked = openDockedApproval(request, opts);
    if (docked) return docked;
  }
  return showNativeDialog(request, container, opts);
}
