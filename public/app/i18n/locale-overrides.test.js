// ABOUTME: Locale overrides replace known keys and report unknown ones.
// ABOUTME: Tests mergeLocaleOverrides in i18n.js.

import { describe, expect, it } from "vitest";
import { mergeLocaleOverrides } from "./i18n.js";

describe("mergeLocaleOverrides", () => {
  it("replaces a known leaf and lists an unknown key", () => {
    const base = { settings: { general: "General" } };
    const unknown = mergeLocaleOverrides(base, {
      settings: { general: "General (mine)", missing: "x" },
    });
    expect(base.settings.general).toBe("General (mine)");
    expect(unknown).toEqual(["settings.missing"]);
  });
});
