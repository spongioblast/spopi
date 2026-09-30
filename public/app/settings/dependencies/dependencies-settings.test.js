// ABOUTME: Tests the Dependencies page against a fake host report.
// ABOUTME: Covers Test all, a one-click npm install, and Linux copy commands.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "../../i18n/i18n.js";
import { renderDependencies } from "./dependencies-settings.js";

const enMessages = JSON.parse(readFileSync(join(process.cwd(), "public/locales/en.json"), "utf8"));

beforeEach(async () => {
  globalThis.fetch = vi.fn(async (input) => {
    if (String(input).includes("/locales/en.json")) {
      return new Response(JSON.stringify(enMessages));
    }
    return new Response("{}", { status: 404 });
  });
  await createI18n();
  document.body.replaceChildren();
});

function report(overrides = {}) {
  return {
    pi: { state: "ok", version: "0.87.1" },
    agentBrowser: { state: "ok", version: "0.38.1", enabled: true },
    npm: { state: "ok", version: "10.0.0" },
    browser: { state: "ok", path: "C:/Chrome/chrome.exe", source: "detected" },
    surf: { state: "not_installed", installed: false, enabled: false, browsers: [] },
    ...overrides,
  };
}

describe("dependencies page", () => {
  it("renders each state and Test all asks for a fresh report", () => {
    const page = document.createElement("div");
    const onReload = vi.fn();
    renderDependencies(page, report(), {
      preferences: { get: async () => undefined, set: async () => true },
      relaunch: null,
      onReload,
    });
    expect(page.textContent).toContain("Working");
    expect(page.textContent).toContain("Not installed");
    page.querySelector("button")?.dispatchEvent(new MouseEvent("click"));
    expect(onReload).toHaveBeenCalled();
  });

  it("starts a Node install when npm is missing and one click is offered", () => {
    const page = document.createElement("div");
    const onJob = vi.fn();
    renderDependencies(
      page,
      report({
        npm: {
          state: "missing",
          detail: "npm was not found on PATH",
          install: { oneClick: true, method: "winget" },
        },
      }),
      {
        preferences: { get: async () => undefined, set: async () => true },
        relaunch: null,
        onJob,
      },
    );
    const button = [...page.querySelectorAll("button")].find((node) =>
      node.textContent?.includes("Install Node.js"),
    );
    button?.dispatchEvent(new MouseEvent("click"));
    expect(onJob).toHaveBeenCalledWith("node", expect.any(HTMLElement));
  });

  it("shows a job that is already running", async () => {
    const page = document.createElement("div");
    const control = {
      dependencyInstallStatus: vi.fn(async () => ({ state: "running", lines: ["still going"] })),
      cancelDependencyInstall: vi.fn(async () => true),
      startDependencyInstall: vi.fn(async () => ({ state: "running" })),
    };
    renderDependencies(
      page,
      report({
        npm: {
          state: "missing",
          install: { oneClick: true, method: "winget" },
        },
      }),
      {
        control,
        preferences: { get: async () => undefined, set: async () => true },
        relaunch: null,
        runningJobs: { node: { state: "running" } },
      },
    );
    await vi.waitFor(() => expect(page.textContent).toContain("still going"));
    expect(page.textContent).toContain("Cancel");
  });

  it("shows copyable Linux package commands", () => {
    const page = document.createElement("div");
    renderDependencies(
      page,
      report({
        npm: {
          state: "missing",
          install: {
            oneClick: false,
            commands: ["sudo apt install -y nodejs npm"],
            link: "https://nodejs.org/en/download",
          },
        },
      }),
      {
        preferences: { get: async () => undefined, set: async () => true },
        relaunch: null,
        platform: "Linux",
      },
    );
    expect(page.textContent).toContain("sudo apt install -y nodejs npm");
    expect([...page.querySelectorAll("button")].some((node) => node.textContent === "Copy")).toBe(
      true,
    );
  });
});
