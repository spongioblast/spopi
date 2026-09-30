// ABOUTME: Tests normalizeIdleMinutes.
// ABOUTME: Includes "keeps a typed number, clamps the range, and defaults the rest".
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RUNTIME_IDLE_MINUTES,
  mountRuntimeIdleTimeout,
  normalizeIdleMinutes,
  RUNTIME_IDLE_TIMEOUT_KEY,
} from "./general-settings.js";

describe("normalizeIdleMinutes", () => {
  it("keeps a typed number, clamps the range, and defaults the rest", () => {
    expect(normalizeIdleMinutes(45)).toBe(45);
    expect(normalizeIdleMinutes("0")).toBe(0);
    expect(normalizeIdleMinutes(9000)).toBe(1440);
    expect(normalizeIdleMinutes("")).toBe(DEFAULT_RUNTIME_IDLE_MINUTES);
    expect(normalizeIdleMinutes(-2)).toBe(DEFAULT_RUNTIME_IDLE_MINUTES);
  });
});

describe("mountRuntimeIdleTimeout", () => {
  it("loads the stored minutes and saves a corrected value", async () => {
    document.body.innerHTML = `<input id="settings-runtime-idle-timeout" type="number" />`;
    const preferences = {
      get: vi.fn(async () => 15),
      set: vi.fn(async () => {}),
    };
    mountRuntimeIdleTimeout({ preferences });
    await vi.waitFor(() =>
      expect(document.getElementById("settings-runtime-idle-timeout").value).toBe("15"),
    );
    const input = document.getElementById("settings-runtime-idle-timeout");
    input.value = "99999";
    input.dispatchEvent(new Event("change"));
    expect(input.value).toBe("1440");
    expect(preferences.set).toHaveBeenCalledWith(RUNTIME_IDLE_TIMEOUT_KEY, 1440);
  });
});
