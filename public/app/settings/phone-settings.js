// ABOUTME: Settings page for phone access, pairing, and accepting the UI.
// ABOUTME: Reads /api/phone. The phone browser never calls these loopback routes.

import { t } from "../i18n/i18n.js";
import { confirmDialog } from "../ui/dialog.js";
import { el } from "../ui/dom.js";
import {
  numberField,
  row,
  sectionTitle,
  select,
  settingsPage,
  textField,
  toggle,
} from "../ui/settings-controls.js";

export const DEFAULT_PHONE_PORT = 57640;
export const PHONE_PORT_KEY = "ui.phone.port";
const ALLOW_KEY = "ui.phone.allow";

/**
 * Tailscale's CGNAT range is listed before LAN addresses.
 * @param {string[]} ips
 */
export function orderInterfaces(ips) {
  return [...ips].sort((a, b) => Number(isTailscale(b)) - Number(isTailscale(a)));
}

/**
 * Default allowlist for one interface address.
 * @param {string} ip
 * @returns {string[]}
 */
export function defaultAllowCidrs(ip) {
  const parts = String(ip).split(".").map(Number);
  const [a, b] = parts;
  if (a === 127) return ["127.0.0.1/32"];
  if (a === 100 && b >= 64 && b <= 127) return ["100.64.0.0/10"];
  const privateNet = a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
  if (privateNet && parts.length === 4) return [`${parts[0]}.${parts[1]}.${parts[2]}.0/24`];
  return [`${ip}/32`];
}

/** @param {string} text @returns {string[]} */
export function parseAllowText(text) {
  return String(text)
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** @param {string} ip */
function isTailscale(ip) {
  const [a, b] = ip.split(".").map(Number);
  return a === 100 && b >= 64 && b <= 127;
}

/**
 * @param {Element} root
 * @param {{ preferences?: { get?: (key: string) => Promise<unknown>, set?: (key: string, value: unknown) => Promise<unknown> }, control?: { listLocalAddresses?: () => Promise<string[]> } }} [deps]
 */
export function mountPhoneSettings(root, deps = {}) {
  const qr = /** @type {HTMLElement} */ (el("div", { class: "settings-stack" }));
  const changes = /** @type {HTMLElement} */ (el("div", { class: "settings-stack" }));
  const devices = /** @type {HTMLElement} */ (el("div", { class: "settings-stack" }));
  const iface = select({
    label: t("settings.phone.interface"),
    className: "ui-select",
  });
  const portInput = numberField({
    label: t("settings.phone.port"),
    labelKey: "settings.phone.port",
    value: DEFAULT_PHONE_PORT,
    min: 1,
    max: 65535,
  });
  let allowEdited = false;
  const allowInput = textField({
    label: t("settings.phone.allowSources"),
    value: "",
    onChange: (/** @type {string} */ value) => {
      allowEdited = true;
      const allow = parseAllowText(value);
      void deps.preferences?.set?.(ALLOW_KEY, allow);
      void postEnable(enable.classList.contains("on"));
    },
  });
  const chosen = () => ({
    ip: iface.value || "127.0.0.1",
    port: Number(portInput.value) || DEFAULT_PHONE_PORT,
  });
  /** @param {boolean} enabled */
  const postEnable = (enabled) => {
    const address = chosen();
    const allow = parseAllowText(allowInput.value);
    void deps.preferences?.set?.(PHONE_PORT_KEY, address.port);
    void deps.preferences?.set?.(ALLOW_KEY, allow);
    return post("/api/phone/enable", {
      enabled,
      ip: address.ip,
      port: address.port,
      allow,
    });
  };
  const enable = toggle({
    label: t("settings.phone.enable"),
    onChange: (/** @type {boolean} */ enabled) => {
      void postEnable(enabled).then(() => refresh());
    },
  });
  iface.addEventListener("change", () => {
    if (!allowEdited) allowInput.value = defaultAllowCidrs(iface.value || "127.0.0.1").join(", ");
  });
  const pair = document.createElement("button");
  pair.type = "button";
  pair.className = "ui-button ui-button--primary ui-button--sm";
  pair.textContent = t("settings.phone.pair");
  pair.addEventListener("click", () => {
    const address = chosen();
    void post("/api/phone/pair", { host: address.ip, port: address.port }).then((body) => {
      qr.innerHTML = typeof body.svg === "string" ? body.svg : "";
    });
  });
  const accept = document.createElement("button");
  accept.type = "button";
  accept.className = "ui-button ui-button--secondary ui-button--sm";
  accept.textContent = t("settings.phone.accept");
  accept.addEventListener("click", () => {
    void post("/api/phone/accept", {}).then(() => refresh());
  });
  const noInterfaces = /** @type {HTMLElement} */ (el("p", { class: "settings-help" }));
  noInterfaces.hidden = true;
  noInterfaces.textContent = t("settings.phone.noInterfaces");
  const summary = /** @type {HTMLElement} */ (el("p", { class: "settings-help" }));
  const details = document.createElement("details");
  const summaryLabel = document.createElement("summary");
  summaryLabel.textContent = t("settings.phone.changesList");
  details.append(summaryLabel, changes);
  root.replaceChildren(
    ...settingsPage(t("settings.phone.title"), "settings.phone.title", [
      el("div", { class: "settings-section" }, [
        row({
          label: t("settings.phone.enable"),
          labelKey: "settings.phone.enable",
          control: enable,
        }),
        row({
          label: t("settings.phone.interface"),
          labelKey: "settings.phone.interface",
          control: iface,
        }),
        noInterfaces,
        row({
          label: t("settings.phone.port"),
          labelKey: "settings.phone.port",
          control: portInput,
        }),
        row({
          label: t("settings.phone.allowSources"),
          labelKey: "settings.phone.allowSources",
          control: allowInput,
        }),
        el("p", { class: "settings-help" }, [
          t("settings.phone.allowHelp"),
          " · ",
          t("settings.phone.allow"),
          " · ",
          t("settings.phone.waiting"),
        ]),
        pair,
        qr,
        sectionTitle(t("settings.phone.accept"), { i18n: "settings.phone.accept" }),
        summary,
        details,
        accept,
        sectionTitle(t("settings.phone.devices"), { i18n: "settings.phone.devices" }),
        devices,
      ]),
    ]),
  );
  void loadAddresses();
  void refresh();
  return {
    destroy() {
      root.replaceChildren();
    },
  };

  async function loadAddresses() {
    let listed = await deps.control?.listLocalAddresses?.().catch(() => null);
    if (!Array.isArray(listed) || listed.length === 0) {
      listed = await deps.control?.listLocalAddresses?.().catch(() => []);
    }
    const fromHost = orderInterfaces(Array.isArray(listed) ? listed : []);
    noInterfaces.hidden = fromHost.length > 0;
    const addresses = fromHost.includes("127.0.0.1") ? fromHost : [...fromHost, "127.0.0.1"];
    iface.replaceChildren(
      ...addresses.map((ip) => {
        const option = document.createElement("option");
        option.value = ip;
        option.textContent = ip;
        return option;
      }),
    );
    const storedPort = await deps.preferences?.get?.(PHONE_PORT_KEY).catch(() => null);
    const port = Number(storedPort);
    if (Number.isInteger(port) && port > 0) portInput.value = String(port);
    const storedAllow = await deps.preferences?.get?.(ALLOW_KEY).catch(() => null);
    const saved = Array.isArray(storedAllow) ? storedAllow.map(String) : [];
    allowInput.value = (saved.length ? saved : defaultAllowCidrs(iface.value || "127.0.0.1")).join(
      ", ",
    );
    allowEdited = saved.length > 0;
  }

  async function refresh() {
    const status = await get("/api/phone/status");
    const on = status.enabled === true;
    enable.classList.toggle("on", on);
    enable.setAttribute("aria-checked", on ? "true" : "false");
    const list = /** @type {Array<{ path?: string, kind?: string }>} */ (
      Array.isArray(status.changes) ? status.changes : []
    );
    summary.hidden = list.length === 0;
    details.hidden = list.length === 0;
    accept.disabled = list.length === 0;
    summary.textContent = t("settings.phone.changesSummary", { count: list.length });
    changes.replaceChildren(
      ...list.map((entry) => {
        const rowEl = document.createElement("p");
        rowEl.textContent = `${entry.kind || ""} ${entry.path || ""}`.trim();
        return rowEl;
      }),
    );
    const body = await get("/api/phone/devices");
    const rows = /** @type {Array<{ id?: string, name?: string, tier?: string }>} */ (
      Array.isArray(body.devices) ? body.devices : []
    );
    devices.replaceChildren(
      ...rows.map((entry) => {
        const line = document.createElement("p");
        line.textContent = `${entry.name || ""} ${entry.tier || ""}`.trim();
        const revoke = document.createElement("button");
        revoke.type = "button";
        revoke.className = "ui-button ui-button--danger ui-button--sm";
        revoke.textContent = t("settings.phone.revoke");
        revoke.addEventListener("click", () => {
          const name = entry.name || entry.id || "";
          void confirmDialog({
            message: t("settings.confirmRemove", { name }),
            confirmLabel: t("settings.phone.revoke"),
          }).then((ok) => {
            if (ok) void post("/api/phone/revoke", { id: entry.id }).then(() => refresh());
          });
        });
        line.append(revoke);
        return line;
      }),
    );
  }
}

/** @param {string} url */
async function get(url) {
  const response = await fetch(url);
  if (!response.ok) return {};
  return response.json();
}

/** @param {string} url @param {object} body */
async function post(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) return {};
  return response.json();
}
