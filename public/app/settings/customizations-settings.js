// ABOUTME: Lists UI overrides with revert, a three-way view for stale files, and safe mode.
// ABOUTME: Reads /api/ui. Bundled extension switches live on the Packages page.

import { t } from "../i18n/i18n.js";
import { confirmDialog, openDialog } from "../ui/dialog.js";
import { el } from "../ui/dom.js";
import { row, sectionTitle, settingsPage, toggle } from "../ui/settings-controls.js";

/**
 * @param {Element} root
 */
export function mountCustomizationsSettings(root) {
  const list = /** @type {HTMLElement} */ (el("div", { class: "settings-stack" }));
  const unknown = /** @type {HTMLElement} */ (el("p", { class: "settings-help" }));
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
  root.replaceChildren(
    ...settingsPage(t("settings.customizations.title"), "settings.customizations.title", [
      el("div", { class: "settings-section" }, [
        sectionTitle(t("settings.customizations.safe"), { i18n: "settings.customizations.safe" }),
        row({
          label: t("settings.customizations.safe"),
          labelKey: "settings.customizations.safe",
          control: safe,
        }),
      ]),
      el("div", { class: "settings-section" }, [
        sectionTitle(t("settings.customizations.overrides"), {
          i18n: "settings.customizations.overrides",
        }),
        list,
        unknown,
      ]),
    ]),
  );
  void refresh(list, unknown, safe);
  return {
    refresh: () => refresh(list, unknown, safe),
    destroy() {
      root.replaceChildren();
    },
  };
}

/** @param {HTMLElement} list @param {HTMLElement} unknown @param {HTMLButtonElement} safe */
async function refresh(list, unknown, safe) {
  const res = await fetch("/api/ui/overrides");
  if (!res.ok) return;
  const body = await res.json();
  safe.classList.toggle("on", Boolean(body.safe));
  safe.setAttribute("aria-checked", body.safe ? "true" : "false");
  const entries = /** @type {Array<{ path: string, status: string }>} */ (
    Array.isArray(body.entries) ? body.entries : []
  );
  list.replaceChildren(
    ...entries.map((entry) => overrideRow(entry, () => refresh(list, unknown, safe))),
  );
  const keys = Array.isArray(body.unknownLocaleKeys) ? body.unknownLocaleKeys : [];
  unknown.textContent = keys.length
    ? `${t("settings.customizations.unknown")}: ${keys.join(", ")}`
    : "";
  if (!entries.length) {
    const empty = el("p", { class: "settings-help" });
    const root = typeof body.root === "string" && body.root ? body.root : "%APPDATA%\\spopi\\ui";
    empty.textContent = t("settings.customizations.overridesEmpty").replace(
      "%APPDATA%\\spopi\\ui",
      root,
    );
    list.append(empty);
  }
  if (body.autoSafe) {
    const note = el("p", { class: "settings-help", text: t("settings.customizations.autoSafe") });
    list.before(note);
  }
}

/** @param {{ path: string, status: string }} entry @param {() => void} done */
function overrideRow(entry, done) {
  const buttons = el("span", { class: "settings-inline" }, [
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
    buttons.append(button("settings.customizations.threeWay", () => showThreeWay(entry.path)));
  }
  return row({ label: `${entry.path} (${entry.status})`, control: buttons });
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
