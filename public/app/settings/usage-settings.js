// ABOUTME: Settings → Usage embeds the cost dashboard.
// ABOUTME: The host fills the dashboard the first time the tab opens.

import { translateSubtree } from "../i18n/i18n.js";
import { el } from "../ui/dom.js";
import { settingsPage } from "../ui/settings-controls.js";

/**
 * @typedef {{ refresh: () => void, destroy: () => void }} UsageSettingsPage
 */

/**
 * @param {ParentNode | null | undefined} root
 * @returns {UsageSettingsPage}
 */
export function mountUsageSettings(root) {
  if (!root) return { refresh() {}, destroy() {} };
  root.replaceChildren(
    ...settingsPage("Usage", "settings.usage", [
      el("div", { class: "settings-usage-embed" }, [
        el("cost-dashboard", {
          id: "settings-cost-dashboard",
          "defer-load": "",
          embedded: "",
        }),
      ]),
    ]),
  );
  translateSubtree(root);
  return {
    refresh() {
      translateSubtree(root);
    },
    destroy() {
      root.replaceChildren();
    },
  };
}

/**
 * Elements this page creates. Callers use the refs instead of looking up ids.
 * @param {ParentNode | null | undefined} root
 * @returns {{ costDashboard: Element | null }}
 */
export function usageSettingsRefs(root) {
  return { costDashboard: root?.querySelector("#settings-cost-dashboard") ?? null };
}
