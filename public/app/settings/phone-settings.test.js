// ABOUTME: Phone settings lists Tailscale addresses before LAN addresses.
// ABOUTME: Tests phone-settings.js.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PHONE_PORT,
  defaultAllowCidrs,
  mountPhoneSettings,
  orderInterfaces,
  PHONE_PORT_KEY,
  parseAllowText,
} from "./phone-settings.js";

describe("phone settings", () => {
  it("lists a Tailscale address before a LAN address", () => {
    expect(orderInterfaces(["192.168.1.8", "100.64.0.2", "10.0.0.4"])).toEqual([
      "100.64.0.2",
      "192.168.1.8",
      "10.0.0.4",
    ]);
    expect(DEFAULT_PHONE_PORT).toBeGreaterThan(1024);
    expect(PHONE_PORT_KEY).toBe("ui.phone.port");
  });

  it("builds a default allowlist from the interface", () => {
    expect(defaultAllowCidrs("192.168.1.20")).toEqual(["192.168.1.0/24"]);
    expect(defaultAllowCidrs("10.0.0.5")).toEqual(["10.0.0.0/24"]);
    expect(defaultAllowCidrs("172.20.1.1")).toEqual(["172.20.1.0/24"]);
    expect(defaultAllowCidrs("100.100.1.1")).toEqual(["100.64.0.0/10"]);
    expect(defaultAllowCidrs("127.0.0.1")).toEqual(["127.0.0.1/32"]);
    expect(defaultAllowCidrs("8.8.8.8")).toEqual(["8.8.8.8/32"]);
    expect(parseAllowText("10.0.0.0/24, 192.168.1.0/24")).toEqual([
      "10.0.0.0/24",
      "192.168.1.0/24",
    ]);
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
    expect(root.querySelector("details")?.hidden).toBe(true);
    expect(root.querySelector(".ui-button--secondary")?.disabled).toBe(true);
    toggle?.click();
    await settle();
    expect(posts.at(-1)?.allow).toEqual(["192.168.1.0/24"]);
  });

  it("shows the fallback address and the empty-interface note", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        if (String(url).endsWith("/status"))
          return json({ enabled: false, changes: [{ path: "a.js", kind: "added" }] });
        return json({ devices: [] });
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
    expect(root.querySelector(".ui-button--secondary")?.disabled).toBe(false);
    root.remove();
  });
});

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
