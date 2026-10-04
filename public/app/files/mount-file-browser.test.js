// ABOUTME: Tests fileManagerPath and the hidden-files toggle's icon and tooltip.
// ABOUTME: Includes "opens the workspace root when nothing is selected".
import { describe, expect, it } from "vitest";
import {
  fileManagerPath,
  isHarmlessFileManagerExit,
  paintHiddenToggle,
} from "./mount-file-browser.js";

describe("paintHiddenToggle", () => {
  it("crosses the eye out while hidden files stay hidden and names the next action", () => {
    const button = document.createElement("button");
    paintHiddenToggle(button, false);
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.title).toBe("files.showHiddenFiles");
    expect(button.querySelectorAll("svg path")).toHaveLength(4);
    paintHiddenToggle(button, true);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.title).toBe("files.hideHiddenFiles");
    expect(button.dataset.i18nTitle).toBe("files.hideHiddenFiles");
    expect(button.querySelector("svg circle")).not.toBeNull();
  });
});

describe("fileManagerPath", () => {
  it("opens the workspace root when nothing is selected", () => {
    expect(fileManagerPath(null)).toBe(".");
    expect(fileManagerPath("")).toBe(".");
    expect(fileManagerPath("   ")).toBe(".");
  });

  it("opens the selected file or folder", () => {
    expect(fileManagerPath("_nfo_backup")).toBe("_nfo_backup");
    expect(fileManagerPath("update_nfo.py")).toBe("update_nfo.py");
  });

  it("ignores Explorer's normal exit code", () => {
    expect(
      isHarmlessFileManagerExit(new Error("File manager exited with status exit code: 1")),
    ).toBe(true);
    expect(isHarmlessFileManagerExit(new Error("path is required"))).toBe(false);
  });
});
