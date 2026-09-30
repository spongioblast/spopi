// ABOUTME: Bottom tab bar for the phone layout. It only sets data-phone-region.
// ABOUTME: CSS shows one existing region. This file does not duplicate a region.

import { t } from "../i18n/i18n.js";
import { bindModal } from "../ui/dialog.js";

const TABS = [
  ["chat", "shell.phone.chat"],
  ["sessions", "shell.phone.sessions"],
  ["changes", "shell.phone.changes"],
  ["more", "shell.phone.more"],
];

/**
 * @param {HTMLElement} root
 */
export function mountPhoneTabs(root) {
  root.className = "phone-tabs";
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
          openMoreSheet();
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
  return {
    destroy() {
      document.querySelector(".phone-more-sheet")?.remove();
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

function openMoreSheet() {
  document.querySelector(".phone-more-sheet")?.remove();
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
    [
      "settings.title",
      () => {
        const settings = document.querySelector("[data-action='settings']");
        if (settings instanceof HTMLElement) settings.click();
      },
    ],
  ];
  for (const [key, run] of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "phone-more-item";
    button.dataset.i18n = key;
    button.textContent = t(key);
    button.addEventListener("click", () => {
      if (key !== "dock.cockpit") sheet.remove();
      run();
      const tabs = document.querySelector(".phone-tabs");
      if (tabs instanceof HTMLElement) paint(tabs);
    });
    sheet.append(button);
  }
  document.body.append(sheet);
  bindModal(sheet, { onClose: () => sheet.remove() });
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
