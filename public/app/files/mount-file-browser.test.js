// ABOUTME: Tests fileManagerPath.
// ABOUTME: Includes "opens the workspace root when nothing is selected".
import { describe, expect, it } from "vitest";
import { fileManagerPath, isHarmlessFileManagerExit } from "./mount-file-browser.js";

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
