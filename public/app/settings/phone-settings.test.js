// ABOUTME: Tests the Settings → Phone access page.
// ABOUTME: Covers phone-settings.js: address labels, the allow field, the firewall row, pairing, and devices.

import { afterEach, describe, expect, it, vi } from "vitest";
import { applyCapabilities } from "../shell/capabilities.js";
import {
  addressLabel,
  DEFAULT_PHONE_PORT,
  mountPhoneSettings,
  normalizeAddresses,
  PHONE_PORT_KEY,
} from "./phone-settings.js";

describe("phone settings", () => {
  it("keeps the host's order and labels each adapter", () => {
    const listed = normalizeAddresses([
      { ip: "192.168.80.57", name: "Ethernet", kind: "main" },
      { ip: "172.26.112.1", name: "vEthernet (WSL)", kind: "virtual" },
      "10.0.0.4",
    ]);
    expect(listed.map((item) => item.ip)).toEqual(["192.168.80.57", "172.26.112.1", "10.0.0.4"]);
    expect(addressLabel(listed[0])).toBe("192.168.80.57 · Ethernet (settings.phone.kind.main)");
    expect(addressLabel(listed[2])).toBe("10.0.0.4 (settings.phone.kind.lan)");
    expect(DEFAULT_PHONE_PORT).toBeGreaterThan(1024);
    expect(PHONE_PORT_KEY).toBe("ui.phone.port");
  });

  it("posts the allow field and reflects the host toggle", async () => {
    const posts = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        if (init?.method === "POST") posts.push(JSON.parse(init.body));
        const path = String(url);
        if (path.endsWith("/status")) return json({ enabled: true, changes: [] });
        if (path.endsWith("/devices")) return json({ devices: [] });
        return json({});
      }),
    );
    const root = document.createElement("div");
    document.body.append(root);
    mountPhoneSettings(root, {
      control: { listLocalAddresses: async () => ["192.168.1.20"] },
      preferences: { get: async () => null, set: async () => null },
    });
    await settle();
    const toggle = root.querySelector(".settings-toggle");
    expect(toggle?.classList.contains("on")).toBe(true);
    expect(toggle?.getAttribute("aria-checked")).toBe("true");
    expect(root.textContent).toContain("settings.phone.devicesEmpty");
    expect(
      [
        ...root.querySelectorAll(
          ".phone-page > .settings-section.ui-card > .settings-section-title",
        ),
      ].map((node) => node.textContent),
    ).toEqual(["settings.phone.connection", "settings.phone.pairTitle", "settings.phone.devices"]);
    toggle?.click();
    await settle();
    expect(posts.at(-1)?.allow).toEqual(["192.168.1.0/24"]);
  });

  it("writes the firewall rule for the port and the allowed sources", async () => {
    const posts = [];
    let rule = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        const path = String(url);
        if (init?.method === "POST") {
          posts.push({ path, body: JSON.parse(init.body) });
          if (path.endsWith("/firewall")) rule = true;
          return json({ ok: true });
        }
        if (path.endsWith("/firewall")) {
          return json({ supported: true, rule, ports: rule ? ["57640"] : [], blocked: 0 });
        }
        if (path.endsWith("/status")) return json({ enabled: false, changes: [] });
        return json({ devices: [] });
      }),
    );
    const root = document.createElement("div");
    document.body.append(root);
    mountPhoneSettings(root, {
      control: {
        listLocalAddresses: async () => [{ ip: "192.168.80.57", name: "Ethernet", kind: "main" }],
      },
      preferences: { get: async () => null, set: async () => null },
    });
    await settle();
    const button = /** @type {HTMLButtonElement} */ (root.querySelector(".phone-firewall-btn"));
    expect(button.hidden).toBe(false);
    button.click();
    await settle();
    expect(posts.find((item) => item.path.endsWith("/firewall"))?.body).toEqual({
      port: DEFAULT_PHONE_PORT,
      allow: ["192.168.80.0/24"],
    });
    expect(button.hidden).toBe(true);
    expect(root.querySelector(".phone-firewall")?.textContent).toContain(
      "settings.phone.firewallOk",
    );
  });

  it("shows the fallback address and the empty-interface note", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        if (String(url).endsWith("/status")) return json({ enabled: false });
        return json({
          devices: [
            { id: "d1", name: "Pixel", tier: "control", revokedAt: null },
            { id: "d0", name: "Old phone", tier: "full", revokedAt: 1 },
          ],
        });
      }),
    );
    const root = document.createElement("div");
    document.body.append(root);
    mountPhoneSettings(root, {
      control: { listLocalAddresses: async () => [] },
      preferences: { get: async () => null, set: async () => null },
    });
    await settle();
    const values = [...root.querySelectorAll("option")].map((option) => option.value);
    expect(values).toContain("127.0.0.1");
    const note = [...root.querySelectorAll(".settings-help")].find((node) =>
      node.textContent?.includes("settings.phone.noInterfaces"),
    );
    expect(note?.hidden).toBe(false);
    const device = root.querySelector(".phone-devices .settings-row");
    expect(device?.querySelector(".settings-label-main")?.textContent).toBe("Pixel");
    expect(device?.querySelector(".settings-label-sub")?.textContent).toBe(
      "settings.phone.tier: control",
    );
    expect(device?.querySelector(".ui-button--danger")?.textContent).toBe("settings.phone.revoke");
    expect(root.querySelectorAll(".phone-devices .settings-row")).toHaveLength(1);
    root.remove();
  });

  it("on a phone says phone access is managed on the desktop and asks the host nothing", async () => {
    const fetchMock = vi.fn(async () => json({}));
    vi.stubGlobal("fetch", fetchMock);
    const listLocalAddresses = vi.fn(async () => []);
    applyCapabilities(["subscribe", "data_read", "host_read", "prompt", "settings_write"]);
    const root = document.createElement("div");
    document.body.append(root);
    mountPhoneSettings(root, {
      control: { listLocalAddresses },
      preferences: { get: async () => null, set: async () => null },
    });
    await settle();
    expect(root.textContent).toContain("settings.phone.desktopOnly");
    expect(root.querySelector(".phone-allow-input")).toBeNull();
    expect(listLocalAddresses).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    applyCapabilities(undefined);
    root.remove();
  });

  it("lists the adapters on refresh when the host was not connected at startup", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ enabled: false })),
    );
    let connected = false;
    const root = document.createElement("div");
    document.body.append(root);
    const page = mountPhoneSettings(root, {
      control: {
        listLocalAddresses: async () => {
          if (!connected) throw new Error("socket closed");
          return [{ ip: "192.168.80.57", name: "Ethernet", kind: "main" }];
        },
      },
      preferences: { get: async () => null, set: async () => null },
    });
    await settle();
    const values = () => [...root.querySelectorAll("option")].map((option) => option.value);
    expect(values()).toEqual(["127.0.0.1"]);
    connected = true;
    await page.refresh();
    expect(values()).toEqual(["192.168.80.57", "127.0.0.1"]);
    const note = [...root.querySelectorAll(".settings-help")].find((node) =>
      node.textContent?.includes("settings.phone.noInterfaces"),
    );
    expect(note?.hidden).toBe(true);
    root.remove();
  });

  it("reloads the adapters and the switch when the host connection comes back", async () => {
    let up = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) =>
        String(url).endsWith("/status") ? json({ enabled: up, changes: [] }) : json({}),
      ),
    );
    const root = document.createElement("div");
    document.body.append(root);
    mountPhoneSettings(root, {
      control: {
        listLocalAddresses: async () => {
          if (!up) throw new Error("socket closed");
          return [{ ip: "192.168.80.57", name: "Ethernet", kind: "main" }];
        },
      },
      preferences: { get: async () => null, set: async () => null },
    });
    await settle();
    expect([...root.querySelectorAll("option")].map((o) => o.value)).toEqual(["127.0.0.1"]);
    up = true;
    document.dispatchEvent(new CustomEvent("spopi-host-reconnected"));
    await settle();
    await settle();
    expect([...root.querySelectorAll("option")].map((o) => o.value)).toEqual([
      "192.168.80.57",
      "127.0.0.1",
    ]);
    expect(root.querySelector(".settings-toggle")?.classList.contains("on")).toBe(true);
  });

  it("lists a phone as soon as its pairing request is answered", async () => {
    let devices = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        const path = String(url);
        if (path.endsWith("/status")) return json({ enabled: true, changes: [] });
        if (path.endsWith("/devices")) return json({ devices });
        return json({});
      }),
    );
    const root = document.createElement("div");
    document.body.append(root);
    const page = mountPhoneSettings(root, {
      control: { listLocalAddresses: async () => [] },
      preferences: { get: async () => null, set: async () => null },
    });
    await settle();
    expect(root.textContent).not.toContain("Pixel");
    devices = [{ id: "d1", name: "Pixel", tier: "full", revokedAt: null }];
    document.dispatchEvent(new CustomEvent("spopi-phone-claim-settled"));
    await settle();
    await settle();
    expect(root.textContent).toContain("Pixel");
    page.destroy();
    root.remove();
  });

  it("replaces a saved loopback default with the interface's range", async () => {
    stubHost({ enabled: false });
    const root = mounted([{ ip: "192.168.80.57", name: "Ethernet", kind: "main" }], {
      "ui.phone.allow": ["127.0.0.1/32"],
    });
    await settle();
    expect(allowField(root).value).toBe("192.168.80.0/24");
  });

  it("follows the interface until the list is the user's own, and applies it while on", async () => {
    const posts = stubHost({ enabled: true });
    const root = mounted([
      { ip: "192.168.80.57", name: "Ethernet", kind: "main" },
      { ip: "100.101.1.2", name: "Tailscale", kind: "tailscale" },
    ]);
    await settle();
    const iface = /** @type {HTMLSelectElement} */ (root.querySelector("select"));
    iface.value = "100.101.1.2";
    iface.dispatchEvent(new Event("change"));
    await settle();
    expect(allowField(root).value).toBe("100.64.0.0/10");
    expect(posts.at(-1)).toMatchObject({
      enabled: true,
      ip: "100.101.1.2",
      allow: ["100.64.0.0/10"],
    });

    allowField(root).value = "100.101.1.9/32";
    allowField(root).dispatchEvent(new Event("change"));
    await settle();
    iface.value = "192.168.80.57";
    iface.dispatchEvent(new Event("change"));
    await settle();
    expect(allowField(root).value).toBe("100.101.1.9/32");
    expect(posts.at(-1)).toMatchObject({ ip: "192.168.80.57", allow: ["100.101.1.9/32"] });
  });

  it("refuses an invalid entry without saving or turning on", async () => {
    const posts = stubHost({ enabled: false });
    const saved = {};
    const root = mounted([{ ip: "192.168.80.57", name: "Ethernet", kind: "main" }], {}, saved);
    await settle();
    allowField(root).value = "192.168.8g0.1/32";
    allowField(root).dispatchEvent(new Event("change"));
    await settle();
    const error = /** @type {HTMLElement} */ (root.querySelector(".phone-connection-error"));
    expect(error.hidden).toBe(false);
    expect(error.textContent).toBe("settings.phone.allowInvalid");
    expect(allowField(root).hasAttribute("aria-invalid")).toBe(true);
    expect(saved["ui.phone.allow"]).toBeUndefined();
    const toggle = /** @type {HTMLButtonElement} */ (root.querySelector(".settings-toggle"));
    toggle.click();
    await settle();
    expect(toggle.classList.contains("on")).toBe(false);
    expect(posts.filter((body) => "enabled" in body)).toEqual([]);
  });

  it("shows why the host could not start phone access", async () => {
    stubHost({ enabled: false }, { error: "listen_failed", detail: "address in use" });
    const root = mounted([{ ip: "192.168.80.57", name: "Ethernet", kind: "main" }]);
    await settle();
    /** @type {HTMLButtonElement} */ (root.querySelector(".settings-toggle")).click();
    await settle();
    const error = /** @type {HTMLElement} */ (root.querySelector(".phone-connection-error"));
    expect(error.hidden).toBe(false);
    expect(error.textContent).toBe("settings.phone.listenFailed");
    expect(root.querySelector(".settings-toggle")?.classList.contains("on")).toBe(false);
  });

  it("draws a new pairing code only while phone access is on", async () => {
    let on = false;
    let codes = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        const path = String(url);
        if (path.endsWith("/pair")) {
          codes += 1;
          return json({ svg: `<svg data-code="${codes}"></svg>`, expiresIn: 300 });
        }
        if (path.endsWith("/status")) return json({ enabled: on, changes: [] });
        return json({ devices: [] });
      }),
    );
    const root = mounted([{ ip: "192.168.80.57", name: "Ethernet", kind: "main" }]);
    await settle();
    const pair = pairButton(root);
    pair?.click();
    await settle();
    expect(codes).toBe(0);
    expect(root.querySelector(".phone-pair-note")?.textContent).toBe("settings.phone.pairNeedsOn");
    on = true;
    root.querySelector(".settings-toggle")?.classList.add("on");
    pair?.click();
    await settle();
    pair?.click();
    await settle();
    expect(codes).toBe(2);
    expect(root.querySelectorAll(".phone-qr svg")).toHaveLength(1);
    expect(root.querySelector(".phone-qr svg")?.getAttribute("data-code")).toBe("2");
    expect(root.querySelector(".phone-pair-note")?.textContent).toBe("settings.phone.pairValid");
  });
});

/**
 * @param {{ enabled: boolean }} status
 * @param {object} [enableReply]
 */
function stubHost(status, enableReply = { ok: true }) {
  /** @type {Array<Record<string, unknown>>} */
  const posts = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, init) => {
      const path = String(url);
      if (init?.method === "POST") {
        const body = JSON.parse(init.body);
        posts.push(body);
        if (path.endsWith("/enable")) return json(enableReply);
        return json({ ok: true });
      }
      if (path.endsWith("/status")) return json({ ...status, changes: [] });
      return json({ devices: [] });
    }),
  );
  return posts;
}

/**
 * @param {unknown[]} addresses
 * @param {Record<string, unknown>} [stored]
 * @param {Record<string, unknown>} [saved]
 */
function mounted(addresses, stored = {}, saved = {}) {
  const root = document.createElement("div");
  document.body.append(root);
  mountPhoneSettings(root, {
    control: { listLocalAddresses: async () => addresses },
    preferences: {
      get: async (key) => stored[key] ?? null,
      set: async (key, value) => {
        saved[key] = value;
        return null;
      },
    },
  });
  return root;
}

/** @param {Element} root */
function allowField(root) {
  return /** @type {HTMLInputElement} */ (root.querySelector(".phone-allow-input"));
}

/** @param {Element} root */
function pairButton(root) {
  return /** @type {HTMLButtonElement | undefined} */ (
    [...root.querySelectorAll("button")].find(
      (button) => button.textContent === "settings.phone.pair",
    )
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

/** @param {unknown} body */
function json(body) {
  return { ok: true, json: async () => body };
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}
