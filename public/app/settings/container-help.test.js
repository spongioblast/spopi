// ABOUTME: Tests the isolation help body used by Settings → Guard.
// ABOUTME: The copy control is always there; the docs footer is optional.

import { describe, expect, it, vi } from "vitest";
import { containerHelpBody } from "./container-help.js";

describe("container help", () => {
  it("shows the sandbox notes and a docker snippet without a docs link by default", () => {
    const plain = containerHelpBody();
    expect(plain.textContent).toContain("settings.guard.container.guard");
    expect(plain.querySelector("code")?.textContent).toContain("docker run");
    expect(plain.querySelector("[data-i18n='settings.guard.container.docs']")).toBeNull();
    expect(plain.querySelector("a")).toBeNull();
  });

  it("copies the docker snippet and opens docs only when the host can", () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const openExternal = vi.fn();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const body = containerHelpBody({ openExternal });
    const copy = body.querySelector("[data-i18n='messages.copy']");
    if (!(copy instanceof HTMLButtonElement)) throw new Error("copy button missing");
    copy.click();
    expect(writeText).toHaveBeenCalledWith(body.querySelector("code")?.textContent);

    const docs = body.querySelector("[data-i18n='settings.guard.container.docs']");
    if (!(docs instanceof HTMLButtonElement)) throw new Error("docs button missing");
    docs.click();
    expect(open).toHaveBeenCalledWith(
      "https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/containerization.md",
      "_blank",
      "noopener",
    );
    expect(openExternal).not.toHaveBeenCalled();
    open.mockRestore();
    vi.unstubAllGlobals();
  });
});
