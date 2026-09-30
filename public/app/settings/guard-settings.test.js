// ABOUTME: The guard settings section states that the guard is not a sandbox.
// ABOUTME: Isolation help opens in a popover, and saving sends the mode through the bridge.
import { afterEach, describe, expect, it, vi } from "vitest";
import { guardSettingsSection } from "./guard-settings.js";

afterEach(() => {
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );
  document.body.innerHTML = "";
});

describe("guard settings", () => {
  it("opens isolation help from a button instead of an external link", () => {
    const root = document.createElement("div");
    document.body.append(root);
    root.append(guardSettingsSection(null));
    expect(root.textContent).toContain(
      "The guard asks before risky actions. It is not a sandbox: Pi runs with your user's permissions. For real isolation, run Pi in a container or VM.",
    );
    expect(root.querySelector("a")).toBeNull();
    const help = root.querySelector("#settings-guard-container");
    if (!(help instanceof HTMLButtonElement)) throw new Error("guard help button missing");
    expect(help.getAttribute("href")).toBeNull();
    help.click();
    const dialog = document.querySelector("[role='dialog']");
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("docker run");
    expect(document.querySelector("a[href*='containerization.md']")).toBeNull();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    expect(document.querySelector("[role='dialog']")).toBeNull();
    expect(document.activeElement).toBe(help);
  });

  it("writes the default mode through the bridge", async () => {
    const call = vi.fn(async () => ({ ok: true, data: {} }));
    const root = document.createElement("div");
    root.append(guardSettingsSection({ configGateway: { call } }));
    const mode = root.querySelector("#settings-guard-mode");
    if (!(mode instanceof HTMLSelectElement)) throw new Error("mode select missing");
    mode.value = "full";
    mode.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(call).toHaveBeenCalled());
    expect(call).toHaveBeenCalledWith("set_permission_mode", { mode: "full" });
  });
});
