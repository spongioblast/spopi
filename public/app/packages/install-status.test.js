// ABOUTME: Tests package install failure status.
// ABOUTME: Includes "renders npm dependency guidance and the real error visibly".
import { beforeEach, describe, expect, test, vi } from "vitest";
import { createI18n } from "../i18n/i18n.js";
import {
  getPackageInstallFailure,
  renderPackageInstallFailure,
  summarizePackageError,
} from "./install-status.js";

beforeEach(async () => {
  global.fetch = vi.fn(async (url) => {
    const u = String(url);
    if (u.includes("/locales/en.json")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          extensions: {
            permissionDenied: "Permission denied in ~/.pi/agent/npm (check owner/permissions).",
            installFailed: "Install failed",
            uninstallFailed: "Uninstall failed",
            installFailedNote:
              "This extension requires npm. Make sure npm is installed and available to SPOPI, then try again.",
            uninstallFailedNote:
              "SPOPI could not remove this extension package. Check the error details, then try again.",
          },
        }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
  await createI18n();
});

describe("package install failure status", () => {
  test("renders npm dependency guidance and the real error visibly", () => {
    const status = document.createElement("div");
    const error = new Error("spawn npm ENOENT\nnpm executable was not found");

    renderPackageInstallFailure(status, error);

    expect(status.hidden).toBe(false);
    expect(status.classList.contains("is-error")).toBe(true);
    expect(status.textContent).toContain("Install failed");
    expect(status.textContent).toContain("This extension requires npm");
    expect(status.textContent).toContain("spawn npm ENOENT");
    expect(status.textContent).toContain("npm executable was not found");
  });

  test("labels uninstall failures as uninstall failures", () => {
    const status = document.createElement("div");
    const error = new Error("remove failed");

    renderPackageInstallFailure(status, error, "uninstall");

    expect(status.textContent).toContain("Uninstall failed");
    expect(status.textContent).not.toContain("Install failed");
    expect(status.textContent).not.toContain("This extension requires npm");
    expect(status.textContent).toContain("remove failed");
  });

  test("keeps permission errors actionable", () => {
    expect(summarizePackageError("EACCES: permission denied, open ~/.pi/agent/npm")).toBe(
      "Permission denied in ~/.pi/agent/npm (check owner/permissions).",
    );
  });

  test("returns reusable failure content for notifications", () => {
    expect(getPackageInstallFailure(new Error("remove failed"), "uninstall")).toEqual({
      title: "Uninstall failed",
      note: "SPOPI could not remove this extension package. Check the error details, then try again.",
      detail: "remove failed",
    });
  });

  test("does not truncate unknown install errors", () => {
    const longError = `install failed: ${"npm output ".repeat(40)}`;

    expect(summarizePackageError(longError)).toBe(longError);
  });
});
