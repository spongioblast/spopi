// ABOUTME: "Bundled with SPOPI" switches on the Packages page.
// ABOUTME: Checked means the name stays out of the disabled list, so SPOPI still passes its copy.

import { t } from "../i18n/i18n.js";
import { openDialog } from "../ui/dialog.js";
import { el } from "../ui/dom.js";
import { sectionTitle, toggle } from "../ui/settings-controls.js";

const BUNDLED = ["pi-permission-system", "spopi-verify", "spopi-tool-output"];

/** @type {Record<"spopi" | "both" | "own" | "off", string>} */
const STATE_KEYS = {
  spopi: "extensions.bundled.stateSpopi",
  both: "extensions.bundled.stateBoth",
  own: "extensions.bundled.stateOwn",
  off: "extensions.bundled.stateOff",
};

/** @type {Array<Record<string, unknown>>} */
let listed = [];
/** @type {Set<string>} */
let disabled = new Set();
/** @type {Set<string>} */
let dirty = new Set();
/** @type {ParentNode | null} */
let hostRoot = null;

/**
 * Checked loads SPOPI's copy. An own install is one the Packages page already listed.
 * @param {boolean} loadSpopi
 * @param {boolean} ownListed
 * @returns {"spopi" | "both" | "own" | "off"}
 */
export function bundledState(loadSpopi, ownListed) {
  if (loadSpopi && ownListed) return "both";
  if (loadSpopi) return "spopi";
  if (ownListed) return "own";
  return "off";
}

/**
 * @param {unknown} packages
 * @param {string} name
 */
export function ownCopyListed(packages, name) {
  if (!Array.isArray(packages)) return false;
  return packages.some((pkg) => packageMentions(pkg, name));
}

/**
 * @param {unknown} packages
 */
export function noteInstalledPackages(packages) {
  listed = Array.isArray(packages) ? packages.filter((pkg) => pkg && typeof pkg === "object") : [];
  paintAll();
}

/**
 * @param {ParentNode | null | undefined} host
 * @returns {{ refresh: () => Promise<void>, destroy: () => void }}
 */
export function mountBundledExtensions(host) {
  if (!host || !("replaceChildren" in host)) {
    return { async refresh() {}, destroy() {} };
  }
  hostRoot = host;
  listed = [];
  disabled = new Set();
  dirty = new Set();
  const section = el("div", { class: "pkg-bundled" }, [
    sectionTitle(t("extensions.bundled.title"), { i18n: "extensions.bundled.title" }),
    el(
      "div",
      { class: "pkg-bundled-list" },
      BUNDLED.map((name) => extensionRow(name)),
    ),
  ]);
  host.replaceChildren(section);
  void refreshDisabled();
  return {
    refresh: refreshDisabled,
    destroy() {
      host.replaceChildren();
      if (hostRoot === host) hostRoot = null;
    },
  };
}

async function refreshDisabled() {
  /** @type {string[]} */
  let names = [];
  try {
    const res = await fetch("/api/ui/overrides");
    if (res.ok) {
      const body = await res.json();
      names = Array.isArray(body.disabled)
        ? body.disabled.filter((/** @type {unknown} */ item) => typeof item === "string")
        : [];
    }
  } catch {
    names = [];
  }
  for (const name of BUNDLED) {
    if (dirty.has(name)) continue;
    if (names.includes(name)) disabled.add(name);
    else disabled.delete(name);
  }
  paintAll();
}

/**
 * @param {string} name
 * @param {boolean} loadSpopi
 */
function onToggle(name, loadSpopi) {
  dirty.add(name);
  if (loadSpopi) disabled.delete(name);
  else disabled.add(name);
  const restart = hostRoot?.querySelector(`#bundled-restart-${name}`);
  if (restart instanceof HTMLElement) restart.hidden = false;
  paintRow(name);
  // `enabled: true` stores the name in disabled, which drops SPOPI's copy at launch.
  void fetch("/api/ui/disabled", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, enabled: !loadSpopi }),
  });
  if (name === "pi-permission-system" && !loadSpopi) warnPermission();
}

function warnPermission() {
  const handle = openDialog({
    title: t("extensions.bundled.title"),
    body: el("p", { text: t("settings.customizations.guardWarning") }),
    actions: [
      {
        label: t("settings.customizations.close"),
        onClick: () => handle.close(),
      },
    ],
  });
}

/** @param {string} name */
function extensionRow(name) {
  const control = toggle({
    id: `load-spopi-${name}`,
    checked: true,
    label: t("extensions.bundled.load"),
    onChange: (loadSpopi) => onToggle(name, loadSpopi),
  });
  control.dataset.i18nAriaLabel = "extensions.bundled.load";
  control.title = t("extensions.bundled.load");
  control.dataset.i18nTitle = "extensions.bundled.load";
  const nameLine = el("span", { class: "pkg-bundled-name", text: name });
  const stateLine = el("span", {
    class: "pkg-bundled-state",
    id: `bundled-state-${name}`,
    text: t(STATE_KEYS.spopi),
  });
  stateLine.dataset.bundledState = "spopi";
  stateLine.dataset.i18n = STATE_KEYS.spopi;
  const restart = el("span", {
    class: "pkg-bundled-restart",
    id: `bundled-restart-${name}`,
    hidden: true,
    text: t("extensions.bundled.restart"),
  });
  restart.dataset.i18n = "extensions.bundled.restart";
  const label = el("span", { class: "pkg-bundled-label" }, [nameLine, stateLine, restart]);
  return el("div", { class: "pkg-bundled-row", id: `bundled-row-${name}` }, [label, control]);
}

function paintAll() {
  for (const name of BUNDLED) paintRow(name);
}

/** @param {string} name */
function paintRow(name) {
  const control = hostRoot?.querySelector(`#load-spopi-${name}`);
  const state = hostRoot?.querySelector(`#bundled-state-${name}`);
  if (!(control instanceof HTMLElement) || !(state instanceof HTMLElement)) return;
  const loadSpopi = !disabled.has(name);
  control.classList.toggle("on", loadSpopi);
  control.setAttribute("aria-checked", loadSpopi ? "true" : "false");
  const kind = bundledState(loadSpopi, ownCopyListed(listed, name));
  const key = STATE_KEYS[kind];
  state.dataset.bundledState = kind;
  state.dataset.i18n = key;
  state.textContent = t(key);
  state.classList.toggle("is-warning", kind === "both");
}

/**
 * @param {unknown} pkg
 * @param {string} name
 */
function packageMentions(pkg, name) {
  if (!pkg || typeof pkg !== "object") return false;
  const record = /** @type {Record<string, unknown>} */ (pkg);
  /** @type {unknown[]} */
  const values = [record.packageName, record.source, record.name];
  if (Array.isArray(record.resources)) {
    for (const resource of record.resources) {
      if (!resource || typeof resource !== "object") continue;
      const item = /** @type {Record<string, unknown>} */ (resource);
      values.push(item.name, item.relativePath);
    }
  }
  return values.some((value) => identifierMatches(value, name));
}

/**
 * @param {unknown} value
 * @param {string} name
 */
function identifierMatches(value, name) {
  if (typeof value !== "string" || !value || !name) return false;
  const parts = value.replace(/\\/g, "/").split("/");
  return parts.some((part) => {
    const bare = part.replace(/\.mjs$/i, "");
    if (bare === name) return true;
    const tail = bare.includes(":") ? bare.slice(bare.lastIndexOf(":") + 1) : bare;
    return tail === name;
  });
}
