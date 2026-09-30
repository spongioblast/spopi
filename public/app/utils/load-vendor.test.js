// ABOUTME: The vendor loader caches one promise per URL.
// ABOUTME: Tests run in jsdom, which cannot fetch the real bundles.

import { describe, expect, it } from "vitest";
import { loadScriptOnce, loadStyleOnce } from "./load-vendor.js";

describe("load-vendor", () => {
  it("reuses one promise for a script and for a stylesheet", () => {
    const script = loadScriptOnce("vendor/chart.js");
    expect(loadScriptOnce("vendor/chart.js")).toBe(script);
    const style = loadStyleOnce("vendor/xterm.css");
    expect(loadStyleOnce("vendor/xterm.css")).toBe(style);
    return Promise.allSettled([script, style]);
  });
});
