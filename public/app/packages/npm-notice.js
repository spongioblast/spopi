// ABOUTME: Tells the Packages page that npm is not working.
// ABOUTME: The notice sits above Recommended and opens Dependencies.

import { t } from "../i18n/i18n.js";
import { el } from "../ui/dom.js";

/**
 * @param {HTMLElement | null | undefined} host
 * @param {{
 *   report?: { npm?: { state?: string } } | null,
 *   openSettings?: (tab: string) => void,
 * }} [options]
 */
export function mountNpmNotice(host, { report, openSettings } = {}) {
  if (!host) return;
  host.querySelector("[data-npm-notice]")?.remove();
  if (report?.npm?.state === "ok" || report?.npm?.state == null) return;
  const notice = el("div", { class: "dependencies-warn dependencies-npm-notice" }, [
    el("p", { text: t("settings.dependencies.packagesNotice") }),
    el("button", {
      type: "button",
      class: "ui-button ui-button--secondary ui-button--sm",
      text: t("settings.dependencies.openDependencies"),
      onClick: () => openSettings?.("dependencies"),
    }),
  ]);
  notice.dataset.npmNotice = "1";
  host.prepend(notice);
}
