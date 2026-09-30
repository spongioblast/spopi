// ABOUTME: Tests the one-time note about an unusable Projects folder.
// ABOUTME: Includes "shows the folder that was used and clears the record".
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetUiStore, uiStore } from "../storage/ui-store.js";
import { showProjectsFolderFallback } from "./projects-folder-fallback.js";

describe("showProjectsFolderFallback", () => {
  beforeEach(() => resetUiStore());

  it("shows the folder that was used and clears the record", () => {
    uiStore.setItem(
      "ui.projectsFolderFallback",
      JSON.stringify({ wanted: "D:\\gone", used: "C:\\Users\\me\\SPOPI\\x", error: "no drive" }),
    );
    const notify = vi.fn();
    const openSettings = vi.fn();

    expect(showProjectsFolderFallback({ notify }, openSettings)).toBe(true);
    const notice = notify.mock.calls[0][0];
    expect(notice.type).toBe("warning");
    expect(notice.message).toBe("projects.fallbackUsed");
    notice.action.onClick();
    expect(openSettings).toHaveBeenCalled();
    expect(uiStore.getItem("ui.projectsFolderFallback")).toBeNull();
    expect(showProjectsFolderFallback({ notify })).toBe(false);
  });

  it("says nothing without a record", () => {
    const notify = vi.fn();
    expect(showProjectsFolderFallback({ notify })).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });
});
