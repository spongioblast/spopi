// ABOUTME: Tests the inverse bundled-extension switch and its state line.
// ABOUTME: Checked means the name is left out of the disabled list.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import {
  bundledState,
  mountBundledExtensions,
  noteInstalledPackages,
  ownCopyListed,
} from "./packages-bundled.js";

const STATE = {
  spopi: "SPOPI's copy",
  both: "Warning: SPOPI's copy and your install both load",
  own: "Pi loads your copy",
  off: "Off. No copy is loaded",
};

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

test("bundledState covers the four load combinations", () => {
  expect(bundledState(true, false)).toBe("spopi");
  expect(bundledState(true, true)).toBe("both");
  expect(bundledState(false, true)).toBe("own");
  expect(bundledState(false, false)).toBe("off");
});

test("ownCopyListed matches a package the page already loaded", () => {
  const packages = [
    { source: "npm:@gotgenes/pi-permission-system", packageName: "@gotgenes/pi-permission-system" },
    { source: "npm:spopi-verify", packageName: "spopi-verify", disabled: true },
    {
      source: "npm:other",
      resources: [{ name: "spopi-verify", relativePath: "extensions/spopi-verify/index.js" }],
    },
  ];
  expect(ownCopyListed(packages, "pi-permission-system")).toBe(true);
  expect(ownCopyListed(packages, "spopi-verify")).toBe(true);
  expect(ownCopyListed(packages, "spopi-bridge")).toBe(false);
  expect(ownCopyListed([{ source: "npm:unrelated" }], "spopi-verify")).toBe(false);
});

test("an existing disabled name turns Load SPOPI's copy off and writes the inverse", async () => {
  const posts = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) => {
      if (init?.method === "POST") posts.push(JSON.parse(init.body));
      return {
        ok: true,
        json: async () => ({ disabled: ["spopi-verify"] }),
      };
    }),
  );
  const dialogs = document.createElement("div");
  dialogs.id = "dialog-container";
  dialogs.className = "hidden";
  const host = document.createElement("div");
  document.body.append(dialogs, host);
  mountBundledExtensions(host);
  await new Promise((resolve) => setTimeout(resolve, 0));

  const permission = document.getElementById("load-spopi-pi-permission-system");
  const verify = document.getElementById("load-spopi-spopi-verify");
  expect(permission?.classList.contains("on")).toBe(true);
  expect(permission?.getAttribute("aria-label")).toBe("extensions.bundled.load");
  expect(verify?.classList.contains("on")).toBe(false);
  expect(stateOf("pi-permission-system")).toBe("spopi");
  expect(stateOf("spopi-verify")).toBe("off");
  expect(textOf("pi-permission-system")).toBe("extensions.bundled.stateSpopi");
  expect(textOf("spopi-verify")).toBe("extensions.bundled.stateOff");

  noteInstalledPackages([
    {
      source: "npm:@gotgenes/pi-permission-system",
      packageName: "@gotgenes/pi-permission-system",
    },
  ]);
  expect(stateOf("pi-permission-system")).toBe("both");
  expect(textOf("pi-permission-system")).toBe("extensions.bundled.stateBoth");
  expect(
    document.getElementById("bundled-state-pi-permission-system")?.classList.contains("is-warning"),
  ).toBe(true);

  permission?.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(posts.at(-1)).toEqual({ name: "pi-permission-system", enabled: true });
  expect(permission?.classList.contains("on")).toBe(false);
  expect(stateOf("pi-permission-system")).toBe("own");
  expect(textOf("pi-permission-system")).toBe("extensions.bundled.stateOwn");
  expect(document.getElementById("bundled-restart-pi-permission-system")?.hidden).toBe(false);
  expect(document.getElementById("bundled-restart-pi-permission-system")?.textContent).toBe(
    "extensions.bundled.restart",
  );
  expect(document.querySelector("[role='dialog'], dialog")).toBeTruthy();

  verify?.click();
  expect(posts.at(-1)).toEqual({ name: "spopi-verify", enabled: false });
  expect(verify?.classList.contains("on")).toBe(true);
  expect(stateOf("spopi-verify")).toBe("spopi");
  expect(document.getElementById("bundled-restart-spopi-verify")?.hidden).toBe(false);
});

test("locale catalogs carry the bundled switch copy", () => {
  for (const code of ["en", "de", "es", "it", "ja", "zh"]) {
    const messages = JSON.parse(
      readFileSync(join(process.cwd(), "public/locales", `${code}.json`), "utf8"),
    );
    const bundled = messages.extensions.bundled;
    expect(bundled.title.length).toBeGreaterThan(0);
    expect(bundled.load.length).toBeGreaterThan(0);
    expect(bundled.restart.length).toBeGreaterThan(0);
    if (code === "en") {
      expect(bundled.title).toBe("Bundled with SPOPI");
      expect(bundled.load).toBe("Load SPOPI's copy");
      expect(bundled.stateSpopi).toBe(STATE.spopi);
      expect(bundled.stateBoth).toBe(STATE.both);
      expect(bundled.stateOwn).toBe(STATE.own);
      expect(bundled.stateOff).toBe(STATE.off);
      expect(bundled.restart).toBe("Applies when Pi restarts");
    }
  }
});

/** @param {string} name */
function stateOf(name) {
  return document.getElementById(`bundled-state-${name}`)?.dataset.bundledState;
}

/** @param {string} name */
function textOf(name) {
  return document.getElementById(`bundled-state-${name}`)?.textContent;
}
