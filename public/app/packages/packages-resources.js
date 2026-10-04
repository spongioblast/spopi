// ABOUTME: Packages → Resources: every Pi extension, skill, prompt, and theme with a toggle.
// ABOUTME: Reads list_resource_inventory and writes set_resource_enabled, the same filters as pi config.

import { onLocaleChange, t } from "../i18n/i18n.js";
import { el } from "../ui/dom.js";

const KINDS = ["extension", "skill", "prompt", "theme"];

/**
 * @typedef {{
 *   kind: string,
 *   id: string,
 *   name: string,
 *   description?: string,
 *   enabled?: boolean,
 *   ambiguous?: boolean,
 *   origin?: { label?: string },
 * }} ResourceItem
 *
 * @typedef {{
 *   items?: ResourceItem[],
 *   trusted?: boolean,
 * }} ResourceInventory
 *
 * @typedef {{
 *   success?: boolean,
 *   error?: string,
 *   data?: ResourceInventory & { inventory?: ResourceInventory, reloaded?: boolean },
 * }} ResourceRpcResponse
 */

/**
 * @param {object} [opts]
 * @param {Element | null} [opts.container]
 * @param {Element | null} [opts.installContainer]
 * @param {(command: { type: string } & Record<string, unknown>) => Promise<unknown>} [opts.rpcCommand]
 * @param {() => void} [opts.onAddSkills]
 * @param {(message: string) => void} [opts.showSuccess]
 * @param {(message: string) => void} [opts.showError]
 * @param {() => void | Promise<void>} [opts.onReloaded]
 */
export function mountResourcesTab({
  container,
  installContainer,
  rpcCommand,
  onAddSkills,
  showSuccess,
  showError,
  onReloaded,
} = {}) {
  if (!container) return { activate() {}, refresh() {} };
  const rootEl = container;
  let scope = "global";
  /** @type {ResourceInventory | null} */
  let inventory = null;
  let errorMessage = "";
  let statusMessage = "";
  let loadSeq = 0;
  const unsubscribe = onLocaleChange(() => render());

  /**
   * @param {string} [nextScope]
   */
  async function load(nextScope = scope) {
    scope = nextScope;
    errorMessage = "";
    const seq = ++loadSeq;
    rootEl.replaceChildren(
      el("p", { class: "settings-help", text: t("settings.resources.loading") }),
    );
    /** @type {ResourceRpcResponse | null | undefined} */
    let response;
    try {
      response = /** @type {ResourceRpcResponse | null | undefined} */ (
        await rpcCommand?.({ type: "list_resource_inventory", scope })
      );
    } catch (error) {
      if (seq !== loadSeq) return;
      inventory = null;
      errorMessage = error instanceof Error ? error.message : t("settings.resources.loadFailed");
      render();
      return;
    }
    if (seq !== loadSeq) return;
    if (!response?.success) {
      inventory = null;
      errorMessage = response?.error || t("settings.resources.loadFailed");
      render();
      return;
    }
    inventory = response.data ?? null;
    render();
  }

  /**
   * @param {ResourceItem} item
   */
  async function toggle(item) {
    statusMessage = "";
    const response = /** @type {ResourceRpcResponse | null | undefined} */ (
      await rpcCommand?.({
        type: "set_resource_enabled",
        scope,
        kind: item.kind,
        id: item.id,
        enabled: !item.enabled,
      })
    );
    if (!response?.success) {
      showError?.(response?.error || t("settings.resources.saveFailed"));
      return;
    }
    inventory = response.data?.inventory || inventory;
    statusMessage = response.data?.reloaded
      ? t("settings.resources.savedReloaded")
      : t("settings.resources.savedRestart");
    showSuccess?.(statusMessage);
    render();
    if (response.data?.reloaded) await onReloaded?.();
  }

  function render() {
    const current = inventory;
    const items = current?.items || [];
    const root = el("div", { class: "resources-tab" });
    root.append(
      el("div", { class: "resources-toolbar" }, [
        el("div", { class: "ui-tabs skills-scope-tabs", role: "group" }, [
          scopeButton("global"),
          scopeButton("project"),
        ]),
        el("button", {
          type: "button",
          class: "ui-button ui-button--sm",
          text: t("settings.resources.rescan"),
          onClick: () => void load(scope),
        }),
      ]),
    );
    if (current && current.trusted === false && scope === "project") {
      root.append(el("p", { class: "settings-help", text: t("settings.resources.untrusted") }));
    }
    if (errorMessage) root.append(el("p", { class: "settings-help", text: errorMessage }));
    if (statusMessage) root.append(el("p", { class: "settings-save-status", text: statusMessage }));
    for (const kind of KINDS) {
      const sectionItems = items.filter((item) => item.kind === kind);
      const section = el("section", { class: "resources-section", dataset: { kind } });
      section.append(
        el("h4", { class: "resources-heading", text: t(`settings.resources.${kind}`) }),
      );
      if (sectionItems.length === 0) {
        section.append(el("p", { class: "settings-help", text: t("settings.resources.empty") }));
      } else {
        for (const item of sectionItems) section.append(renderRow(item));
      }
      root.append(section);
    }
    root.append(
      el("button", {
        type: "button",
        class: "resources-add-skills",
        text: t("settings.resources.addSkills"),
        onClick: () => {
          installContainer?.classList.remove("hidden");
          onAddSkills?.();
        },
      }),
    );
    if (installContainer) root.append(installContainer);
    rootEl.replaceChildren(root);
  }

  /**
   * @param {string} name
   */
  function scopeButton(name) {
    return el("button", {
      type: "button",
      class: `ui-tab skills-scope-tab${scope === name ? " active" : ""}`,
      text: t(`settings.resources.${name}`),
      "aria-pressed": String(scope === name),
      onClick: () => {
        if (name !== scope) void load(name);
      },
    });
  }

  /**
   * @param {ResourceItem} item
   */
  function renderRow(item) {
    const toggleButton = el("button", {
      type: "button",
      class: `ui-toggle settings-toggle${item.enabled ? " on" : ""}`,
      role: "switch",
      "aria-checked": String(item.enabled),
      "aria-label": item.name,
      disabled: item.ambiguous ? "true" : undefined,
      onClick: () => void toggle(item),
    });
    return el("div", { class: "resources-row" }, [
      el("div", { class: "resources-copy" }, [
        el("div", { class: "resources-name", text: item.name }),
        el("div", {
          class: "resources-meta",
          text: [item.description, item.origin?.label].filter(Boolean).join(" · "),
        }),
      ]),
      toggleButton,
    ]);
  }

  return {
    activate: () => load(scope),
    refresh: () => load(scope),
    dispose: () => unsubscribe(),
  };
}
