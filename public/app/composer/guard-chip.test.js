// ABOUTME: The guard chip cycles Ask, Auto-edit, and Full access.
// ABOUTME: The permission status from Pi repaints the chip.
import { describe, expect, it, vi } from "vitest";
import { mountComposerChrome } from "../shell/chrome/composer.js";
import { mountGuardChip, nextGuardMode, paintGuardChip } from "./guard-chip.js";

describe("guard chip", () => {
  it("cycles ask, auto-edit, and full", () => {
    expect(nextGuardMode("ask")).toBe("auto-edit");
    expect(nextGuardMode("auto-edit")).toBe("full");
    expect(nextGuardMode("full")).toBe("ask");
  });

  it("paints the mode from the permission status", () => {
    const root = document.createElement("div");
    document.body.append(root);
    mountComposerChrome(root);
    paintGuardChip({ status: { keys: { "pi-permission-system": "auto-edit" } } });
    expect(document.getElementById("guard-chip")?.textContent).toBe("Auto-edit");
    root.remove();
  });

  it("reads the saved mode on mount and writes clicks through the bridge", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    mountComposerChrome(root);
    const input = /** @type {HTMLTextAreaElement} */ (document.getElementById("message-input"));
    input.value = "draft stays";
    let saved = "full";
    const call = vi.fn(async (/** @type {string} */ op, /** @type {any} */ params) => {
      if (op === "set_permission_mode") saved = params.mode;
      return { ok: true, data: { mode: saved } };
    });
    mountGuardChip({ call });
    await vi.waitFor(() =>
      expect(document.getElementById("guard-chip")?.dataset.mode).toBe("full"),
    );

    document.getElementById("guard-chip")?.click();
    await vi.waitFor(() => expect(document.getElementById("guard-chip")?.dataset.mode).toBe("ask"));
    expect(call).toHaveBeenCalledWith("set_permission_mode", { mode: "ask" });
    expect(input.value).toBe("draft stays");

    paintGuardChip({ status: { keys: { "pi-permission-system": "full" } } });
    expect(document.getElementById("guard-chip")?.dataset.mode).toBe("full");
    root.remove();
  });
});
