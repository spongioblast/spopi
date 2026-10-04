// ABOUTME: Lists SPOPI UI overrides with revert, a three-way view for stale files, and safe mode.
// ABOUTME: Reads /api/ui. Bundled extension switches live on the Packages page.

import { t } from "../i18n/i18n.js";
import { confirmDialog, openDialog } from "../ui/dialog.js";
import { el } from "../ui/dom.js";
import { row, settingsCard, settingsPage, toggle } from "../ui/settings-controls.js";

const STATUS_KEYS = /** @type {Record<string, string>} */ ({
  added: "settings.customizations.statusAdded",
  ok: "settings.customizations.statusOk",
  stale: "settings.customizations.statusStale",
});

/**
 * @param {Element} root
 */
export function mountCustomizationsSettings(root) {
  const list = /** @type {HTMLElement} */ (el("div", { class: "customizations-list" }));
  const folder = /** @type {HTMLElement} */ (el("p", { class: "customizations-folder" }));
  const unknown = /** @type {HTMLElement} */ (el("p", { class: "settings-help" }));
  const autoNote = /** @type {HTMLElement} */ (el("p", { class: "settings-help" }));
  const safe = toggle({
    label: t("settings.customizations.safe"),
    onChange: (enabled) => {
      void fetch("/api/ui/safe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
    },
  });
  const parts = { list, folder, unknown, autoNote, safe };
  root.replaceChildren(
    ...settingsPage(t("settings.customizations.title"), "settings.customizations.title", [
      el("div", { class: "settings-stack customizations-page" }, [
        settingsCard(t("settings.customizations.overrides"), "settings.customizations.overrides", [
          help("settings.customizations.intro"),
          folder,
          list,
          unknown,
        ]),
        settingsCard(t("settings.customizations.safeTitle"), "settings.customizations.safeTitle", [
          row({
            label: t("settings.customizations.safe"),
            labelKey: "settings.customizations.safe",
            description: t("settings.customizations.safeHelp"),
            descriptionKey: "settings.customizations.safeHelp",
            control: safe,
          }),
          autoNote,
        ]),
      ]),
    ]),
  );
  void refresh(parts);
  return {
    refresh: () => refresh(parts),
    destroy() {
      root.replaceChildren();
    },
  };
}

/** @param {string} key */
function help(key) {
  const node = /** @type {HTMLElement} */ (el("p", { class: "settings-help", text: t(key) }));
  node.dataset.i18n = key;
  return node;
}

/**
 * @param {{ list: HTMLElement, folder: HTMLElement, unknown: HTMLElement, autoNote: HTMLElement, safe: HTMLButtonElement }} parts
 */
async function refresh(parts) {
  const { list, folder, unknown, autoNote, safe } = parts;
  const res = await fetch("/api/ui/overrides");
  if (!res.ok) return;
  const body = await res.json();
  safe.classList.toggle("on", Boolean(body.safe));
  safe.setAttribute("aria-checked", body.safe ? "true" : "false");
  const path = typeof body.root === "string" && body.root ? body.root : "%APPDATA%\\spopi\\ui";
  folder.replaceChildren(
    t("settings.customizations.folder"),
    " ",
    el("code", { text: path, title: path }),
  );
  const entries = /** @type {Array<{ path: string, status: string }>} */ (
    Array.isArray(body.entries) ? body.entries : []
  );
  list.replaceChildren(...entries.map((entry) => overrideRow(entry, () => refresh(parts))));
  if (!entries.length) list.append(help("settings.customizations.overridesEmpty"));
  const keys = Array.isArray(body.unknownLocaleKeys) ? body.unknownLocaleKeys : [];
  unknown.textContent = keys.length
    ? `${t("settings.customizations.unknown")}: ${keys.join(", ")}`
    : "";
  autoNote.textContent = body.autoSafe ? t("settings.customizations.autoSafe") : "";
}

/** @param {{ path: string, status: string }} entry @param {() => void} done */
function overrideRow(entry, done) {
  const buttons = el("span", { class: "customizations-actions" }, [
    button(
      "settings.customizations.revert",
      () => {
        void confirmDialog({
          message: t("settings.confirmRemove", { name: entry.path }),
          confirmLabel: t("settings.customizations.revert"),
        }).then((ok) => {
          if (ok) void post("/api/ui/revert", entry.path).then(done);
        });
      },
      "ui-button ui-button--sm ui-button--danger",
    ),
  ]);
  if (entry.status === "stale") {
    buttons.prepend(button("settings.customizations.threeWay", () => showThreeWay(entry.path)));
  }
  const statusKey = STATUS_KEYS[entry.status];
  const node = /** @type {HTMLElement} */ (
    row({
      label: entry.path,
      description: statusKey ? t(statusKey) : entry.status,
      descriptionKey: statusKey,
      control: buttons,
    })
  );
  node.classList.add("customizations-row");
  node.dataset.status = entry.status;
  return node;
}

/** @param {string} key @param {() => void} onClick @param {string} [className] */
function button(key, onClick, className = "ui-button ui-button--sm ui-button--secondary") {
  const node = /** @type {HTMLButtonElement} */ (
    el("button", { class: className, type: "button", text: t(key) })
  );
  node.dataset.i18n = key;
  node.addEventListener("click", onClick);
  return node;
}

/** @param {string} url @param {string} path */
async function post(url, path) {
  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path }),
  });
}

/** @param {string} path */
async function showThreeWay(path) {
  const res = await fetch(`/api/ui/three-way?path=${encodeURIComponent(path)}`);
  const body = await res.json();
  const pre = el("pre", {
    text: `base\n${body.base || ""}\n\nshipped\n${body.shipped || ""}\n\nyours\n${body.override || ""}`,
  });
  const handle = openDialog({
    title: path,
    body: pre,
    actions: [{ label: t("settings.customizations.close"), onClick: () => handle.close() }],
  });
}
