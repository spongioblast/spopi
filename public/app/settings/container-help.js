// ABOUTME: Short isolation help for Settings → Guard.
// ABOUTME: Sandboxes and a Docker example. The Pi doc is optional.

import { t } from "../i18n/i18n.js";
import { copyText } from "../ui/clipboard.js";
import { el } from "../ui/dom.js";

const PI_CONTAINER_DOCS =
  "https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/containerization.md";

const DOCKER_RUN = 'docker run --rm -it -v "$PWD:/workspace" pi-sandbox';

/**
 * @param {string} label
 * @param {string} key
 * @param {string} [tag]
 */
function line(label, key, tag = "p") {
  return el(tag, { text: label, dataset: { i18n: key } });
}

/**
 * @param {string} label
 * @param {string} key
 * @param {string} className
 * @param {() => void} onClick
 */
function button(label, key, className, onClick) {
  return el("button", {
    type: "button",
    class: className,
    text: label,
    dataset: { i18n: key },
    onClick,
  });
}

/**
 * Isolation notes shown in the Guard popover.
 * A docs button is included only when the host already has `openExternal`.
 * @param {{
 *   openExternal?: ((url: string) => unknown) | null,
 * }} [options]
 * @returns {HTMLElement}
 */
export function containerHelpBody({ openExternal = null } = {}) {
  /** @type {Array<Node | null>} */
  const children = [
    line(t("settings.guard.container.guard"), "settings.guard.container.guard"),
    el("ul", {}, [
      line(t("settings.guard.container.docker"), "settings.guard.container.docker", "li"),
      line(t("settings.guard.container.sandboxes"), "settings.guard.container.sandboxes", "li"),
      line(t("settings.guard.container.openshell"), "settings.guard.container.openshell", "li"),
      line(t("settings.guard.container.gondolin"), "settings.guard.container.gondolin", "li"),
    ]),
    el("code", { text: DOCKER_RUN }),
    button(t("messages.copy"), "messages.copy", "ui-button ui-button--ghost ui-button--sm", () => {
      void copyText(DOCKER_RUN);
    }),
    line(t("settings.guard.container.mount"), "settings.guard.container.mount"),
    typeof openExternal === "function"
      ? button(
          t("settings.guard.container.docs"),
          "settings.guard.container.docs",
          "ui-button ui-button--ghost ui-button--sm",
          () => {
            window.open(PI_CONTAINER_DOCS, "_blank", "noopener");
          },
        )
      : null,
  ];
  return /** @type {HTMLElement} */ (el("div", { class: "container-help" }, children));
}
