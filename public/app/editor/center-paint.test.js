// ABOUTME: Tests the adaptive center paint.
// ABOUTME: A running turn with no touched files keeps the home actions.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { paintAdaptiveCenter } from "./center-paint.js";

describe("paintAdaptiveCenter", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="spopi-home" class="spopi-home"></div>';
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("keeps the home actions while a turn runs before any file is touched", () => {
    paintAdaptiveCenter({ status: { phase: "working" }, transcript: { turns: [] } });
    const home = document.getElementById("spopi-home");
    expect(home.dataset.mode).toBe("work");
    expect(home.querySelector(".spopi-home-actions")).not.toBeNull();
    expect(home.querySelector("[data-i18n='home.worktree']")?.title).toBe("home.worktreeHint");
  });

  it("lists touched files once the turn writes one", () => {
    paintAdaptiveCenter({
      status: { phase: "working" },
      transcript: { turns: [{ files: [{ path: "app.js" }] }] },
    });
    const home = document.getElementById("spopi-home");
    expect(home.querySelector(".spopi-home-actions")).toBeNull();
    expect(home.textContent).toContain("app.js");
  });
});
