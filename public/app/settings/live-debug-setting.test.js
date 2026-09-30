// ABOUTME: Tests live-debug-setting: off by default, saves ui.modelLiveDebug, offers a restart after a change.
// ABOUTME: Includes "is disabled where WebView2 is not the engine".

import { describe, expect, it, vi } from "vitest";
import { LIVE_DEBUG_KEY, liveDebugRow, liveDebugSupported } from "./live-debug-setting.js";

function preferences(initial) {
  const store = new Map(initial === undefined ? [] : [[LIVE_DEBUG_KEY, initial]]);
  return {
    store,
    get: vi.fn(async (key) => store.get(key)),
    set: vi.fn(async (key, value) => {
      store.set(key, value);
    }),
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("live debugging setting", () => {
  it("is off by default and saves the preference when switched on", async () => {
    const prefs = preferences(undefined);
    const relaunch = vi.fn(async () => {});
    const row = liveDebugRow({ preferences: prefs, relaunch, supported: true });
    await flush();
    const control = row.querySelector("#toggle-live-debug");
    expect(control?.getAttribute("aria-checked")).toBe("false");
    expect(row.querySelector("#settings-live-debug-restart")?.hidden).toBe(true);

    control?.click();
    expect(prefs.set).toHaveBeenCalledWith(LIVE_DEBUG_KEY, true);
    expect(row.querySelector("#settings-live-debug-note")?.hidden).toBe(false);
    const restart = row.querySelector("#settings-live-debug-restart");
    expect(restart?.hidden).toBe(false);
    restart?.click();
    expect(relaunch).toHaveBeenCalled();
  });

  it("shows a saved preference as on", async () => {
    const row = liveDebugRow({ preferences: preferences(true), relaunch: null, supported: true });
    await flush();
    expect(row.querySelector("#toggle-live-debug")?.getAttribute("aria-checked")).toBe("true");
  });

  it("reads the preference again when Settings reopens", async () => {
    const prefs = preferences(undefined);
    /** @type {Array<() => Promise<unknown> | undefined>} */
    const loaders = [];
    const row = liveDebugRow({
      preferences: prefs,
      relaunch: null,
      supported: true,
      register: (load) => {
        loaders.push(load);
        void load();
      },
    });
    await flush();
    prefs.store.set(LIVE_DEBUG_KEY, true);
    for (const load of loaders) load();
    await flush();
    expect(row.querySelector("#toggle-live-debug")?.getAttribute("aria-checked")).toBe("true");
  });

  it("is disabled where WebView2 is not the engine", () => {
    const row = liveDebugRow({ preferences: preferences(undefined), supported: false });
    expect(row.querySelector("#toggle-live-debug")?.hasAttribute("disabled")).toBe(true);
    expect(liveDebugSupported("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/140")).toBe(true);
    expect(liveDebugSupported("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)")).toBe(false);
  });
});
