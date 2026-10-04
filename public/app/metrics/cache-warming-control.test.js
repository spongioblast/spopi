// ABOUTME: Tests the Cockpit cache-warming setter.
// ABOUTME: Tests cache-warming-control.js.
import { describe, expect, it, vi } from "vitest";
import {
  cacheWarmingControl,
  cacheWarmingSegments,
  connectCacheWarming,
} from "./cache-warming-control.js";

describe("cache warming control", () => {
  it("writes set_cache_warming from the floating select", async () => {
    const configCall = vi.fn(async () => ({ ok: true, data: { mode: "streaming" } }));
    await connectCacheWarming(configCall);
    const select = cacheWarmingControl().querySelector("select");
    expect(select).toBeTruthy();
    if (!select) return;
    select.value = "off";
    select.dispatchEvent(new Event("change"));
    expect(configCall).toHaveBeenCalledWith("set_cache_warming", { mode: "off" });
  });

  it("writes set_cache_warming from a segment", async () => {
    const configCall = vi.fn(async () => ({ ok: true, data: { mode: "off" } }));
    await connectCacheWarming(configCall);
    const streaming = cacheWarmingSegments().querySelector('button[data-mode="streaming"]');
    streaming?.click();
    expect(configCall).toHaveBeenCalledWith("set_cache_warming", { mode: "streaming" });
    expect(streaming?.getAttribute("aria-pressed")).toBe("true");
  });
});
