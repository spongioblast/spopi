// ABOUTME: Settings page for phone access, pairing, and paired devices.
// ABOUTME: Reads /api/phone (loopback, never the phone); the rules are in phone-allow.js and phone-firewall.js.

import { t } from "../i18n/i18n.js";
import { canHere } from "../shell/capabilities.js";
import { confirmDialog } from "../ui/dialog.js";
import { el } from "../ui/dom.js";
import {
  numberField,
  row,
  select,
  settingsCard,
  settingsPage,
  textField,
  toggle,
} from "../ui/settings-controls.js";
import { allowProblem, defaultAllowCidrs, isDefaultAllow, parseAllowText } from "./phone-allow.js";
import { firewallState } from "./phone-firewall.js";

export const DEFAULT_PHONE_PORT = 57640;
export const PHONE_PORT_KEY = "ui.phone.port";
const ALLOW_KEY = "ui.phone.allow";
const IP_KEY = "ui.phone.ip";

/**
 * @typedef {{ ip: string, name: string, kind: string }} LocalAddress
 * @typedef {import("./phone-firewall.js").FirewallStatus} FirewallStatus
 */

/**
 * The host sends addresses best first. Older hosts sent bare strings.
 * @param {unknown} listed
 * @returns {LocalAddress[]}
 */
export function normalizeAddresses(listed) {
  if (!Array.isArray(listed)) return [];
  return listed
    .map((item) =>
      typeof item === "string"
        ? { ip: item, name: "", kind: "lan" }
        : {
            ip: String(item?.ip || ""),
            name: String(item?.name || ""),
            kind: String(item?.kind || "lan"),
          },
    )
    .filter((item) => item.ip);
}

/** @type {Record<string, string>} */
const KIND_KEYS = {
  main: "settings.phone.kind.main",
  lan: "settings.phone.kind.lan",
  tailscale: "settings.phone.kind.tailscale",
  vpn: "settings.phone.kind.vpn",
  virtual: "settings.phone.kind.virtual",
  loopback: "settings.phone.kind.loopback",
};

/** @param {LocalAddress} address */
export function addressLabel(address) {
  const kind = t(KIND_KEYS[address.kind] || KIND_KEYS.lan);
  const name = address.name ? ` · ${address.name}` : "";
  return `${address.ip}${name} (${kind})`;
}

/**
 * @param {{ error?: unknown, entry?: unknown, detail?: unknown }} body
 * @param {string} address
 */
function enableErrorText(body, address) {
  if (body.error === "allow_invalid") {
    return t("settings.phone.allowInvalid", { entry: String(body.entry || "") });
  }
  if (body.error === "allow_empty") return t("settings.phone.allowEmpty");
  return t("settings.phone.listenFailed", {
    address,
    error: String(body.detail || body.error || ""),
  });
}

/**
 * @param {Element} root
 * @param {{ preferences?: { get?: (key: string) => Promise<unknown>, set?: (key: string, value: unknown) => Promise<unknown> }, control?: { listLocalAddresses?: () => Promise<unknown[]> } }} [deps]
 */
export function mountPhoneSettings(root, deps = {}) {
  const qr = /** @type {HTMLElement} */ (el("div", { class: "phone-qr" }));
  const devices = /** @type {HTMLElement} */ (el("div", { class: "phone-devices" }));
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
    className: "phone-port-input",
    inputMode: "numeric",
  });
  const allowInput = textField({ label: t("settings.phone.allowSources"), value: "" });
  allowInput.classList.add("phone-allow-input");
  const connectionError = /** @type {HTMLElement} */ (
    el("p", { class: "settings-help phone-connection-error", role: "alert" })
  );
  connectionError.hidden = true;
  /** @param {string} text */
  const showError = (text) => {
    connectionError.textContent = text;
    connectionError.hidden = !text;
    allowInput.toggleAttribute("aria-invalid", Boolean(text));
  };
  const chosen = () => ({
    ip: iface.value || "127.0.0.1",
    port: Number(portInput.value) || DEFAULT_PHONE_PORT,
  });
  const isOn = () => enable.classList.contains("on");
  /** @returns {string[]} */
  const listedIps = () => Array.from(iface.options, (option) => option.value);
  /** Checks the field; saves and applies it only when it is valid. */
  const commitAllow = () => {
    const problem = allowProblem(allowInput.value);
    if (problem) {
      showError(t(problem.key, { entry: problem.entry || "" }));
      return false;
    }
    showError("");
    void deps.preferences?.set?.(ALLOW_KEY, parseAllowText(allowInput.value));
    paintFirewall();
    return true;
  };
  /** @param {boolean} enabled */
  const postEnable = async (enabled) => {
    const address = chosen();
    void deps.preferences?.set?.(PHONE_PORT_KEY, address.port);
    const body = await post("/api/phone/enable", {
      enabled,
      ip: address.ip,
      port: address.port,
      allow: parseAllowText(allowInput.value),
    });
    if (body.error) showError(enableErrorText(body, `${address.ip}:${address.port}`));
    else if (!allowProblem(allowInput.value)) showError("");
    return body;
  };
  const applyIfOn = () => {
    if (isOn()) void postEnable(true).then(() => refresh());
  };
  const enable = toggle({
    label: t("settings.phone.enable"),
    onChange: (/** @type {boolean} */ enabled) => {
      if (enabled && !commitAllow()) {
        enable.classList.remove("on");
        enable.setAttribute("aria-checked", "false");
        return;
      }
      if (!enabled) clearQr();
      void postEnable(enabled).then(() => refresh());
    },
  });
  allowInput.addEventListener("input", () => {
    if (!allowProblem(allowInput.value)) showError("");
  });
  allowInput.addEventListener("change", () => {
    if (commitAllow()) applyIfOn();
  });
  /** The interface the current list was filled in for. */
  let previousIp = "";
  iface.addEventListener("change", () => {
    void deps.preferences?.set?.(IP_KEY, iface.value);
    const current = parseAllowText(allowInput.value);
    if (isDefaultAllow(current, [previousIp, ...listedIps()])) {
      allowInput.value = defaultAllowCidrs(chosen().ip).join(", ");
    }
    previousIp = chosen().ip;
    clearQr();
    if (commitAllow()) applyIfOn();
  });
  portInput.addEventListener("change", () => {
    void deps.preferences?.set?.(PHONE_PORT_KEY, chosen().port);
    clearQr();
    applyIfOn();
  });
  /** @type {FirewallStatus | null} */
  let firewall = null;
  const firewallText = /** @type {HTMLElement} */ (el("span", { class: "settings-label-sub" }));
  const firewallButton = document.createElement("button");
  firewallButton.type = "button";
  firewallButton.className = "ui-button ui-button--secondary ui-button--sm phone-firewall-btn";
  const firewallRow = /** @type {HTMLElement} */ (
    el("div", { class: "phone-firewall" }, [
      el("div", { class: "settings-row" }, [
        el("span", { class: "settings-label settings-label-stack" }, [
          labelled("span", "settings-label-main", "settings.phone.firewall"),
          firewallText,
          labelled("span", "settings-label-sub", "settings.phone.firewallHelp"),
        ]),
        firewallButton,
      ]),
    ])
  );
  firewallRow.hidden = true;
  const paintFirewall = () => {
    const state = firewallState(firewall, chosen().port, parseAllowText(allowInput.value));
    firewallRow.hidden = !state;
    if (!state) return;
    firewallText.textContent = state.text;
    firewallButton.hidden = !state.button;
    firewallButton.textContent = state.button;
  };
  portInput.addEventListener("input", paintFirewall);
  firewallButton.addEventListener("click", () => {
    if (!commitAllow()) return;
    firewallButton.disabled = true;
    firewallText.textContent = t("settings.phone.firewallWaiting");
    void post("/api/phone/firewall", {
      port: chosen().port,
      allow: parseAllowText(allowInput.value),
    })
      .then(async (body) => {
        firewall = await get("/api/phone/firewall");
        paintFirewall();
        if (body.ok) return;
        firewallText.textContent =
          body.error === "cancelled"
            ? t("settings.phone.firewallCancelled")
            : t("settings.phone.firewallFailed", { error: String(body.error || "") });
      })
      .finally(() => {
        firewallButton.disabled = false;
      });
  });
  const pair = document.createElement("button");
  pair.type = "button";
  pair.className = "ui-button ui-button--primary ui-button--sm";
  pair.textContent = t("settings.phone.pair");
  const pairNote = /** @type {HTMLElement} */ (el("p", { class: "settings-help phone-pair-note" }));
  pairNote.hidden = true;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let qrTimer;
  /** @param {string} [note] */
  function clearQr(note = "") {
    clearTimeout(qrTimer);
    qr.replaceChildren();
    pairNote.textContent = note;
    pairNote.hidden = !note;
  }
  pair.addEventListener("click", () => {
    if (!isOn()) {
      clearQr(t("settings.phone.pairNeedsOn"));
      return;
    }
    const address = chosen();
    void post("/api/phone/pair", { host: address.ip, port: address.port }).then((body) => {
      if (typeof body.svg !== "string" || !body.svg) {
        clearQr();
        return;
      }
      const seconds = Number(body.expiresIn) || 300;
      clearQr(t("settings.phone.pairValid", { minutes: Math.round(seconds / 60) }));
      qr.innerHTML = body.svg;
      qrTimer = setTimeout(() => clearQr(t("settings.phone.pairExpired")), seconds * 1000);
    });
  });
  const noInterfaces = /** @type {HTMLElement} */ (el("p", { class: "settings-help" }));
  noInterfaces.hidden = true;
  noInterfaces.textContent = t("settings.phone.noInterfaces");
  const stack = /** @type {HTMLElement} */ (el("div", { class: "settings-stack phone-page" }));
  stack.append(
    card("settings.phone.connection", [
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
        description: t("settings.phone.allowHelp"),
        descriptionKey: "settings.phone.allowHelp",
        control: allowInput,
      }),
      connectionError,
      firewallRow,
    ]),
    card("settings.phone.pairTitle", [
      el("div", { class: "phone-pair" }, [
        el("div", { class: "phone-pair-text" }, [
          labelled("p", "settings-help", "settings.phone.pairHelp"),
          el("div", { class: "phone-actions" }, [pair]),
          pairNote,
        ]),
        qr,
      ]),
    ]),
    card("settings.phone.devices", [devices]),
  );
  root.replaceChildren(...settingsPage(t("settings.phone.title"), "settings.phone.title", [stack]));
  const reload = async () => {
    if (!canHere("devices")) {
      stack.replaceChildren(
        settingsCard("", "", [labelled("p", "settings-help", "settings.phone.desktopOnly")]),
      );
      return;
    }
    await Promise.all([
      loadAddresses().then(async () => {
        firewall = await get("/api/phone/firewall");
        paintFirewall();
      }),
      refresh(),
    ]);
  };
  void reload();
  // The list may have loaded while the host was down, and a restarted host
  // starts with phone access off and forgets the pairing code.
  const onReconnect = () => {
    clearQr();
    void reload();
  };
  document.addEventListener("spopi-host-reconnected", onReconnect);
  // The scanned code is used up, and an allowed phone joins Devices.
  const onClaimSettled = () => {
    clearQr();
    void refresh();
  };
  document.addEventListener("spopi-phone-claim-settled", onClaimSettled);
  return {
    // The page mounts at startup, often before the host connection is open,
    // so Settings reloads it each time the tab is shown.
    refresh: reload,
    destroy() {
      document.removeEventListener("spopi-host-reconnected", onReconnect);
      document.removeEventListener("spopi-phone-claim-settled", onClaimSettled);
      clearTimeout(qrTimer);
      root.replaceChildren();
    },
  };

  async function loadAddresses() {
    let listed = await deps.control?.listLocalAddresses?.().catch(() => null);
    if (!Array.isArray(listed) || listed.length === 0) {
      listed = await deps.control?.listLocalAddresses?.().catch(() => []);
    }
    const fromHost = normalizeAddresses(listed);
    noInterfaces.hidden = fromHost.length > 0;
    const addresses = fromHost.some((item) => item.ip === "127.0.0.1")
      ? fromHost
      : [...fromHost, { ip: "127.0.0.1", name: "", kind: "loopback" }];
    iface.replaceChildren(
      ...addresses.map((address) => {
        const option = document.createElement("option");
        option.value = address.ip;
        option.textContent = addressLabel(address);
        return option;
      }),
    );
    const storedIp = await deps.preferences?.get?.(IP_KEY).catch(() => null);
    if (typeof storedIp === "string" && addresses.some((item) => item.ip === storedIp)) {
      iface.value = storedIp;
    }
    const storedPort = await deps.preferences?.get?.(PHONE_PORT_KEY).catch(() => null);
    const port = Number(storedPort);
    if (Number.isInteger(port) && port > 0) portInput.value = String(port);
    const storedAllow = await deps.preferences?.get?.(ALLOW_KEY).catch(() => null);
    const saved = Array.isArray(storedAllow) ? storedAllow.map(String) : [];
    const ips = addresses.map((item) => item.ip);
    const own = saved.length > 0 && !isDefaultAllow(saved, ips);
    allowInput.value = (own ? saved : defaultAllowCidrs(chosen().ip)).join(", ");
    previousIp = chosen().ip;
    const problem = allowProblem(allowInput.value);
    showError(problem ? t(problem.key, { entry: problem.entry || "" }) : "");
  }

  async function refresh() {
    const status = await get("/api/phone/status");
    const on = status.enabled === true;
    enable.classList.toggle("on", on);
    enable.setAttribute("aria-checked", on ? "true" : "false");
    const body = await get("/api/phone/devices");
    const rows =
      /** @type {Array<{ id?: string, name?: string, tier?: string, revokedAt?: number | null }>} */ (
        Array.isArray(body.devices) ? body.devices : []
      ).filter((entry) => !entry.revokedAt);
    if (!rows.length) {
      devices.replaceChildren(labelled("p", "settings-help", "settings.phone.devicesEmpty"));
      return;
    }
    devices.replaceChildren(
      ...rows.map((entry) => {
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
        return row({
          label: entry.name || entry.id || "",
          description: entry.tier ? `${t("settings.phone.tier")}: ${entry.tier}` : undefined,
          control: revoke,
        });
      }),
    );
  }
}

/** @param {string} titleKey @param {Array<Node>} children */
function card(titleKey, children) {
  return settingsCard(t(titleKey), titleKey, children);
}

/** @param {string} tag @param {string} className @param {string} key */
function labelled(tag, className, key) {
  const node = /** @type {HTMLElement} */ (el(tag, { class: className, text: t(key) }));
  node.dataset.i18n = key;
  return node;
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
