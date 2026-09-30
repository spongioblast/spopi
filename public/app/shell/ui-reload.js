// ABOUTME: Applies a CSS overlay reload in place and asks before a full UI reload.
// ABOUTME: Sends ui_ready after mount so two missed starts fall back to safe mode.

import { t } from "../i18n/i18n.js";

/**
 * @param {{ onUiReload?: (listener: (frame: { kind?: string }) => void) => void }} adapter
 */
export function mountUiReload(adapter) {
  const banner = document.createElement("div");
  banner.className = "ui-reload-banner hidden";
  banner.hidden = true;
  document.body.append(banner);
  fetch("/api/ui/ready", { method: "POST" }).catch(() => {});
  fetch("/api/ui/overrides")
    .then((res) => (res.ok ? res.json() : null))
    .then((body) => {
      const stale =
        Array.isArray(body?.entries) &&
        body.entries.some((/** @type {{ status?: string }} */ e) => e.status === "stale");
      if (stale || body?.safe)
        show(
          banner,
          stale ? "settings.customizations.staleBanner" : "settings.customizations.safeBanner",
        );
    })
    .catch(() => {});
  adapter.onUiReload?.((frame) => {
    if (frame.kind === "css") {
      const link = document.querySelector('link[href="/user.css"], link[data-user-css]');
      if (link instanceof HTMLLinkElement) {
        link.addEventListener(
          "load",
          () => document.dispatchEvent(new CustomEvent("spopi-css-reload")),
          { once: true },
        );
        link.href = `/user.css?t=${Date.now()}`;
      }
      return;
    }
    show(banner, "settings.customizations.reloadBanner");
  });
  return {
    destroy() {
      banner.remove();
    },
  };
}

/** @param {HTMLElement} banner @param {string} key */
function show(banner, key) {
  banner.hidden = false;
  banner.classList.remove("hidden");
  banner.replaceChildren(document.createTextNode(t(key)));
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ui-button ui-button--sm";
  button.textContent = t("settings.customizations.reload");
  button.addEventListener("click", () => location.reload());
  banner.append(button);
}
