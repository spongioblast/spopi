// ABOUTME: Tests /spopi-config dispatch, not the domain operations themselves.
// ABOUTME: Unknown names and thrown handler errors become { ok: false }.
// @vitest-environment node

import { describe, expect, it } from "vitest";
import { handleSpopiConfig } from "./spopi-config.ts";

describe("spopi config dispatch", () => {
  it("rejects an unknown operation", async () => {
    await expect(handleSpopiConfig("not_a_real_op", {}, {})).resolves.toEqual({
      ok: false,
      error: "Unknown configuration operation: not_a_real_op",
    });
  });

  it("turns a thrown handler error into ok: false", async () => {
    await expect(
      handleSpopiConfig("set_default_thinking_level", { level: "turbo" }, {}),
    ).resolves.toEqual({ ok: false, error: "Unsupported thinking level: turbo" });
  });
});
