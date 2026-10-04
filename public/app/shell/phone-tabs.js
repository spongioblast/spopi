// ABOUTME: Bottom tab bar and More sheet for the phone layout; it sets data-phone-region.
// ABOUTME: phone-layout.css shows the region; the bar publishes its own height as --tabbar-h.

import { t } from "../i18n/i18n.js";
import { trapModal } from "../ui/dialog.js";

const TABS = [
  ["chat", "shell.phone.chat"],
  ["sessions", "shell.phone.sessions"],
  ["changes", "shell.phone.changes"],
  ["more", "shell.phone.more"],
];

/**
 * @param {HTMLElement} root
 * @param {{ onSettings?: () => void }} [options]
 */
export function mountPhoneTabs(root, { onSettings } = {}) {
  root.className = "phone-tabs";
  /** @type {HTMLElement | null} */
  let sheet = null;
  const closeSheet = () => {
    sheet?.remove();
    sheet = null;
  };
  root.replaceChildren(
    ...TABS.map(([region, key]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ui-button ui-button--ghost ui-button--sm";
      button.dataset.phoneRegion = region;
      button.dataset.i18n = key;
      button.textContent = t(key);
      button.addEventListener("click", () => {
        if (region === "more") {
          closeSheet();
          sheet = openMoreSheet(() => paint(root), onSettings);
          return;
        }
        selectRegion(region);
        paint(root);
      });
      return button;
    }),
  );
  if (!document.body.dataset.phoneRegion) document.body.dataset.phoneRegion = "chat";
  paint(root);
  const publishHeight = () => {
    const shown = root.isConnected && getComputedStyle(root).display !== "none";
    const height = shown ? Math.ceil(root.getBoundingClientRect().height) : 0;
    document.documentElement.style.setProperty("--tabbar-h", `${height}px`);
  };
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(publishHeight) : null;
  observer?.observe(root);
  publishHeight();
  // The bar is mounted in every layout, so a wider window must not move the phone's tab.
  const onPhone = () => document.body.dataset.layout === "phone";
  // Picking or starting a chat from the Sessions tab means the user wants to see it.
  const onSessionOpened = () => {
    if (!onPhone()) return;
    if (document.body.dataset.phoneRegion === "sessions") selectRegion("chat");
    paint(root);
  };
  document.addEventListener("spopi-session-opened", onSessionOpened);
  // A chat's file card opens Review in the center, which only the Changes tab shows.
  const onReviewShown = () => {
    if (!onPhone()) return;
    document.body.dataset.phoneRegion = "changes";
    paint(root);
  };
  document.addEventListener("spopi-review-shown", onReviewShown);
  return {
    destroy() {
      document.removeEventListener("spopi-session-opened", onSessionOpened);
      document.removeEventListener("spopi-review-shown", onReviewShown);
      observer?.disconnect();
      document.documentElement.style.setProperty("--tabbar-h", "0px");
      closeSheet();
      root.replaceChildren();
    },
  };
}

/** @param {string} region */
function selectRegion(region) {
  document.body.dataset.phoneRegion = region;
  if (region === "changes") {
    document.body.dataset.centerMode = "review";
    document.dispatchEvent(new CustomEvent("spopi-show-review"));
  }
}

/**
 * @param {() => void} repaintTabs
 * @param {(() => void) | undefined} onSettings
 */
function openMoreSheet(repaintTabs, onSettings) {
  const sheet = document.createElement("div");
  sheet.className = "phone-more-sheet";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-label", t("shell.phone.more"));
  /** @type {Array<[string, () => void]>} */
  const items = [
    [
      "dock.cockpit",
      () => {
        document.dispatchEvent(new CustomEvent("spopi-show-cockpit", { detail: { host: sheet } }));
      },
    ],
    ["settings.guard.title", () => document.dispatchEvent(new CustomEvent("spopi-open-guard"))],
    ["shell.phone.sessions", () => selectRegion("sessions")],
    ["settings.title", () => onSettings?.()],
  ];
  for (const [key, run] of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ui-button ui-button--ghost phone-more-item";
    button.dataset.i18n = key;
    button.textContent = t(key);
    button.addEventListener("click", () => {
      if (key !== "dock.cockpit") sheet.remove();
      run();
      repaintTabs();
    });
    sheet.append(button);
  }
  document.body.append(sheet);
  trapModal(sheet, { onClose: () => sheet.remove() });
  return sheet;
}

/** @param {HTMLElement} root */
function paint(root) {
  const current = document.body.dataset.phoneRegion || "chat";
  for (const button of root.querySelectorAll("button")) {
    const on = button.dataset.phoneRegion === current;
    button.classList.toggle("on", on);
    if (on) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
}
