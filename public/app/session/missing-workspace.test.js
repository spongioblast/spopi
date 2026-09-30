// ABOUTME: Tests the missing-folder card in the center pane.
// ABOUTME: Close project calls the host hide. Locate relinks on the desktop, else opens a folder.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  describeHostError,
  isProjectNotFound,
  resetMissingWorkspaces,
  showMissingWorkspace,
} from "./missing-workspace.js";
import "../editor/center-paint.js";

describe("missing workspace card", () => {
  beforeEach(() => {
    resetMissingWorkspaces();
    document.body.innerHTML = `
      <div id="sidebar"><button id="open-folder-btn" type="button"></button></div>
      <div id="spopi-home"></div>
    `;
  });

  it("paints the folder path and the two actions", () => {
    const onRemove = vi.fn();
    showMissingWorkspace({ path: "D:\\gone", onRemove });
    const card = document.querySelector(".workspace-missing");
    expect(card?.getAttribute("data-path")).toBe("D:\\gone");
    expect(card?.querySelector("[data-i18n='workspace.missing.title']")).not.toBeNull();
    expect(card?.querySelector("[data-i18n='workspace.missing.remove']")).not.toBeNull();
    expect(card?.querySelector("[data-i18n='workspace.missing.locate']")).not.toBeNull();
    card
      ?.querySelector("[data-i18n='workspace.missing.remove']")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onRemove).toHaveBeenCalled();
  });

  it("reads project_not_found from the host error object", () => {
    const body = { error: { code: "project_not_found" } };
    expect(describeHostError(body)).toBe("project_not_found");
    expect(isProjectNotFound(body)).toBe(true);
    const wrapped = /** @type {Error & { code?: string }} */ (new Error("[object Object]"));
    wrapped.code = "project_not_found";
    expect(isProjectNotFound(wrapped)).toBe(true);
    expect(describeHostError(wrapped)).toBe("project_not_found");
    expect(isProjectNotFound(new Error("Project folder no longer exists: D:\\gone"))).toBe(true);
    expect(describeHostError({ error: { code: "busy", message: "locked" } })).toBe("busy: locked");
    expect(isProjectNotFound(new Error("session missing"))).toBe(false);
  });

  it("asks the sidebar to open a folder when there is no desktop bridge", () => {
    const locate = vi.fn();
    document.querySelector("#open-folder-btn")?.addEventListener("click", locate);
    showMissingWorkspace({ path: "D:\\gone" });
    document
      .querySelector("[data-i18n='workspace.missing.locate']")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(locate).toHaveBeenCalled();
  });

  it("on the desktop, relinks the missing project to the folder the user picks", async () => {
    const invoke = vi.fn().mockResolvedValue("D:\\found");
    globalThis.__TAURI__ = { core: { invoke } };
    try {
      showMissingWorkspace({ path: "D:\\gone" });
      document
        .querySelector("[data-i18n='workspace.missing.locate']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await vi.waitFor(() =>
        expect(invoke).toHaveBeenCalledWith("locate_workspace", { fromPath: "D:\\gone" }),
      );
    } finally {
      delete globalThis.__TAURI__;
    }
  });
});
