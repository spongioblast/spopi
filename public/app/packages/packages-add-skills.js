// ABOUTME: Settings flow that installs skills from a folder the user picks.
// ABOUTME: The host only opens the dialog; Pi scans the folder and writes settings.

import { onLocaleChange, t } from "../i18n/i18n.js";
import { openDialog } from "../ui/dialog.js";
import { el } from "../ui/dom.js";
import { createLoadingPlaceholder } from "../ui/loading-placeholder.js";

/**
 * @typedef {{
 *   kind: string,
 *   id: string,
 *   name?: string,
 *   description?: string,
 *   children?: SkillInstallNode[],
 * }} SkillInstallNode
 *
 * @typedef {{
 *   kind?: string,
 *   id: string,
 * }} SkillInstallSelectionItem
 *
 * @typedef {{
 *   path?: string,
 *   tree?: SkillInstallNode[],
 *   defaultSelection?: SkillInstallSelectionItem[],
 *   diagnostics?: Array<{ path?: string, message: string }>,
 *   result?: {
 *     addedEntries?: unknown[],
 *     skippedEntries?: unknown[],
 *     reloaded?: boolean,
 *   },
 * }} SkillInstallScan
 *
 * @typedef {{
 *   path: string,
 *   scope: string,
 *   selection: SkillInstallSelectionItem[],
 * }} SkillInstallRequest
 *
 * @typedef {{
 *   pickSkillFolder: (workspaceId?: string | null) => Promise<{ path?: string | null } | null>,
 *   scanSkillFolder: (path: string) => Promise<SkillInstallScan>,
 *   addSkillFolder: (request: SkillInstallRequest) => Promise<SkillInstallScan["result"]>,
 * }} SkillsInstallTransport
 *
 * @typedef {{ close: () => void, element: HTMLElement }} SkillsInstallConfirmHandle
 */

/**
 * @param {SkillInstallNode[]} nodes
 * @returns {SkillInstallNode[]}
 */
function collectCandidates(nodes) {
  return nodes.flatMap((node) =>
    node.kind === "skill" ? [node] : collectCandidates(node.children ?? []),
  );
}

/**
 * @param {object} opts
 * @param {HTMLElement} opts.container
 * @param {SkillsInstallTransport} opts.transport
 * @param {(() => string | null) | undefined} [opts.getWorkspaceId]
 * @param {() => boolean} opts.isProjectTrusted
 * @param {((message: string) => void) | undefined} [opts.showSuccess]
 * @param {((message: string) => void) | undefined} [opts.showError]
 * @param {(() => void | Promise<void>) | undefined} [opts.onReloaded]
 */
export function mountSkillsInstallTab({
  container,
  transport,
  getWorkspaceId,
  isProjectTrusted,
  showSuccess,
  showError,
  onReloaded,
}) {
  let activated = false;
  let phase = "idle";
  /** @type {SkillInstallScan | null} */
  let scan = null;
  let scope = "global";
  const selection = new Set();
  /** @type {string | null} */
  let error = null;
  /** @type {SkillsInstallConfirmHandle | null} */
  let confirmHandle = null;
  /** Monotonic generation guard so a slow scan cannot overwrite a newer one. */
  let scanSeq = 0;
  /** Frozen snapshot captured at confirmation time; install submits this. */
  /** @type {SkillInstallRequest | null} */
  let pendingInstall = null;
  const unsubscribeLocale = onLocaleChange(() => render());
  /** Stable resolver for the Review button after a render rebuilds the DOM. */
  const reviewOpener = () => container.querySelector(".skills-install-review");

  function selectedItems() {
    const current = scan;
    if (!current) return [];
    /** @type {Map<string, SkillInstallNode>} */
    const nodes = new Map();
    /**
     * @param {SkillInstallNode[]} items
     */
    const visit = (items) =>
      items.forEach((item) => {
        nodes.set(item.id, item);
        if (item.kind === "group") visit(item.children ?? []);
      });
    visit(current.tree ?? []);
    return [...selection]
      .map((id) => nodes.get(id))
      .filter(Boolean)
      .map((item) => {
        const node = /** @type {SkillInstallNode} */ (item);
        return { kind: node.kind, id: node.id };
      });
  }

  /**
   * @param {SkillInstallNode} node
   */
  function candidateState(node) {
    const children = node.kind === "group" ? collectCandidates(node.children ?? []) : [node];
    const selected = children.filter((item) => selection.has(item.id)).length;
    return {
      checked: selected === children.length && selected > 0,
      indeterminate: selected > 0 && selected < children.length,
    };
  }

  /**
   * @param {SkillInstallNode} node
   * @param {boolean} checked
   */
  function toggleNode(node, checked) {
    const candidates = node.kind === "group" ? collectCandidates(node.children ?? []) : [node];
    for (const candidate of candidates) {
      if (checked) selection.add(candidate.id);
      else selection.delete(candidate.id);
    }
    render();
  }

  async function chooseSource() {
    const seq = ++scanSeq;
    phase = "scanning";
    error = null;
    render();
    try {
      const picked = await transport.pickSkillFolder(getWorkspaceId?.());
      if (seq !== scanSeq) return; // superseded by a newer chooseSource
      if (!picked?.path) {
        phase = "idle";
        render();
        return;
      }
      const folder = picked.path;
      const scanned = await transport.scanSkillFolder(folder);
      scan = { ...scanned, path: scanned.path || folder };
      if (seq !== scanSeq) return; // superseded while scanning
      selection.clear();
      for (const item of scan.defaultSelection ?? []) selection.add(item.id);
      phase = "selecting";
    } catch (cause) {
      if (seq !== scanSeq) return;
      phase = "error";
      error = cause instanceof Error ? cause.message : t("settings.installSkills.scanFailed");
      const message = error;
      if (message) showError?.(message);
    }
    render();
  }

  function closeConfirm() {
    const handle = confirmHandle;
    confirmHandle = null;
    handle?.close();
  }

  function beginConfirmation() {
    if (!scan || selection.size === 0 || confirmHandle) return;
    phase = "confirming";
    const body = document.createElement("p");
    body.className = "skills-install-confirmation";
    body.textContent = t("settings.installSkills.confirmation", {
      count: selection.size,
      scope: t(`settings.installSkills.${scope}`),
    });
    confirmHandle = openDialog({
      title: t("settings.installSkills.confirmationHeading"),
      body,
      closeOnBackdrop: false,
      actions: [
        {
          label: t("settings.installSkills.cancel"),
          className: "ui-button ui-button--sm ui-button--secondary skills-install-cancel",
          onClick: () => cancelConfirmation(),
        },
        {
          label: t("settings.installSkills.confirm"),
          className: "ui-button ui-button--sm ui-button--primary skills-install-confirm",
          onClick: () => {
            void install();
          },
        },
      ],
      onClose: () => {
        if (!confirmHandle) return;
        confirmHandle = null;
        if (phase === "confirming") cancelConfirmation();
      },
    });
    const confirmBtn = confirmHandle.element.querySelector(".skills-install-confirm");
    if (confirmBtn && "focus" in confirmBtn && typeof confirmBtn.focus === "function") {
      confirmBtn.focus();
    }
    render();
  }

  function cancelConfirmation() {
    if (phase !== "confirming") return;
    phase = "selecting";
    pendingInstall = null;
    closeConfirm();
    render();
    const reviewBtn = reviewOpener();
    if (reviewBtn && "focus" in reviewBtn && typeof reviewBtn.focus === "function") {
      reviewBtn.focus();
    }
  }

  async function install() {
    const current = scan;
    if (!current || selection.size === 0) return;
    // Freeze the request snapshot from the confirmation dialog so that any
    // later changes to scope/selection during the in-flight install cannot
    // desync the UI from what is actually submitted.
    /** @type {SkillInstallRequest} */
    const request = {
      path: String(current.path ?? ""),
      scope,
      selection: selectedItems(),
    };
    pendingInstall = request;
    phase = "installing";
    error = null;
    closeConfirm();
    render();
    try {
      const result = await transport.addSkillFolder(pendingInstall ?? request);
      phase = "done";
      scan = { ...current, result };
      showSuccess?.(
        result?.reloaded
          ? t("settings.installSkills.reloaded")
          : t("settings.installSkills.restartRequired"),
      );
      if (result?.reloaded) await onReloaded?.();
    } catch (cause) {
      phase = "error";
      error = cause instanceof Error ? cause.message : t("settings.installSkills.installFailed");
      const message = error;
      if (message) showError?.(message);
    }
    pendingInstall = null;
    render();
  }

  /**
   * @param {SkillInstallNode} node
   * @returns {HTMLElement | SVGElement}
   */
  function renderNode(node) {
    const state = candidateState(node);
    const inputNode = el("input", {
      type: "checkbox",
      class: "skills-install-checkbox",
      "aria-label": `${node.kind === "group" ? t("settings.installSkills.group") : t("settings.installSkills.skill")}: ${node.name}${node.kind === "skill" && node.description ? ` — ${node.description}` : ""}`,
      disabled: phase === "installing" ? "disabled" : undefined,
    });
    if (!("checked" in inputNode) || !("indeterminate" in inputNode)) {
      return el("div", { class: "skills-install-node", dataset: { installNode: node.id } });
    }
    const input = inputNode;
    input.checked = state.checked;
    input.indeterminate = state.indeterminate;
    input.addEventListener("change", () => toggleNode(node, Boolean(input.checked)));
    const row = el("div", { class: "skills-install-node", dataset: { installNode: node.id } }, [
      input,
      el("div", { class: "skills-install-node-text" }, [
        el("strong", { text: node.name }),
        node.kind === "skill" ? el("span", { text: node.description }) : null,
      ]),
    ]);
    if (node.kind !== "group") return row;
    return el("div", { class: "skills-install-group" }, [
      row,
      el("div", { class: "skills-install-children" }, (node.children ?? []).map(renderNode)),
    ]);
  }

  function renderScope() {
    const projectTrusted = isProjectTrusted();
    const locked = phase === "installing";
    const tabs = el("div", {
      class: "ui-tabs skills-scope-tabs",
      role: "group",
      aria: { label: t("settings.installSkills.title") },
    });
    for (const value of ["global", "project"]) {
      const active = value === scope;
      const disabled = locked || (value === "project" && !projectTrusted);
      tabs.appendChild(
        el(
          "button",
          {
            type: "button",
            class: `ui-tab skills-scope-tab${active ? " active" : ""}`,
            "aria-pressed": String(active),
            dataset: { scope: value },
            disabled: disabled ? true : undefined,
            onClick: () => {
              if (locked || value === scope) return;
              scope = value;
              render();
            },
          },
          [t(`settings.installSkills.${value}`)],
        ),
      );
    }
    if (!projectTrusted) {
      tabs.appendChild(
        el("span", {
          class: "skills-install-untrusted",
          text: t("settings.installSkills.projectUntrusted"),
        }),
      );
    }
    return tabs;
  }

  /**
   * @param {SkillInstallScan} current
   */
  function renderDiagnostics(current) {
    const diagnostics = current.diagnostics ?? [];
    if (diagnostics.length === 0) return null;
    const base = String(current.path ?? "");
    return el("div", { class: "skills-install-diagnostics" }, [
      el("strong", { text: t("settings.installSkills.skippedFiles") }),
      el(
        "ul",
        {},
        diagnostics.map((item) => {
          const path = item.path ?? "";
          const shown = base && path.startsWith(base) ? path.slice(base.length + 1) : path;
          return el("li", { text: shown ? `${shown}: ${item.message}` : item.message });
        }),
      ),
    ]);
  }

  function render() {
    const current = scan;
    const content = [
      el("div", { class: "skills-header" }, [
        el("div", {}, [
          el("div", {
            class: "settings-section-title",
            text: t("settings.installSkills.title"),
          }),
          el("p", {
            class: "settings-help skills-intro",
            text: t("settings.installSkills.description"),
          }),
        ]),
        el("button", {
          type: "button",
          class: "ui-button ui-button--sm ui-button--secondary skills-rescan skills-install-choose",
          text: t("settings.installSkills.chooseFolder"),
          disabled: phase === "scanning" || phase === "installing" ? "disabled" : undefined,
          onClick: () => void chooseSource(),
        }),
      ]),
    ];
    if (phase === "scanning")
      content.push(
        createLoadingPlaceholder({
          className: "skills-install-loading",
          label: t("settings.installSkills.scanning"),
        }),
      );
    if (phase === "error")
      content.push(
        el("div", {
          class: "skills-install-error",
          text: error || t("settings.installSkills.scanFailed"),
        }),
      );
    const view =
      current &&
      (phase === "selecting" ||
        phase === "confirming" ||
        phase === "installing" ||
        phase === "done")
        ? current
        : null;
    const found = (view?.tree ?? []).length > 0;
    if (view && !found) {
      content.push(
        el("p", { class: "skills-install-empty", text: t("settings.installSkills.noSkills") }),
      );
    }
    if (view && found) {
      content.push(renderScope());
      content.push(el("div", { class: "skills-install-tree" }, (view.tree ?? []).map(renderNode)));
    }
    const diagnostics = view ? renderDiagnostics(view) : null;
    if (diagnostics) content.push(diagnostics);
    if (view && found) {
      if (phase === "done") {
        const result = view.result ?? {};
        content.push(
          el("div", {
            class: "skills-install-result",
            text: t("settings.installSkills.complete", {
              added: result.addedEntries?.length ?? 0,
              skipped: result.skippedEntries?.length ?? 0,
            }),
          }),
        );
      } else if (phase !== "confirming") {
        content.push(
          el("button", {
            type: "button",
            class: "ui-button ui-button--sm ui-button--primary skills-install-review",
            text:
              phase === "installing"
                ? t("settings.installSkills.installing")
                : t("settings.installSkills.review"),
            disabled: selection.size === 0 || phase === "installing" ? "disabled" : undefined,
            onClick: beginConfirmation,
          }),
        );
      }
    }
    container.replaceChildren(...content);
  }

  async function activate() {
    if (activated) return;
    activated = true;
    render();
  }

  function destroy() {
    unsubscribeLocale?.();
    closeConfirm();
    container.replaceChildren();
  }

  render();
  return { activate, destroy };
}
