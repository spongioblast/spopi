// ABOUTME: Tests install-job polling, failure actions, and destroy.
// ABOUTME: Uses fake timers so a one-second poll does not wait.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "../../i18n/i18n.js";
import { mountInstallJob } from "./install-job.js";

const enMessages = JSON.parse(readFileSync(join(process.cwd(), "public/locales/en.json"), "utf8"));

beforeEach(async () => {
  vi.useFakeTimers();
  globalThis.fetch = vi.fn(async (input) => {
    if (String(input).includes("/locales/en.json")) {
      return new Response(JSON.stringify(enMessages));
    }
    return new Response("{}", { status: 404 });
  });
  await createI18n();
  document.body.replaceChildren();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(async () => {}) },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("install job", () => {
  it("polls while running and stops when the job succeeds", async () => {
    let calls = 0;
    const control = {
      startDependencyInstall: vi.fn(async () => ({ state: "running", lines: [] })),
      dependencyInstallStatus: vi.fn(async () => {
        calls += 1;
        return calls < 2
          ? { state: "running", lines: ["working"] }
          : { state: "succeeded", lines: ["done"] };
      }),
      cancelDependencyInstall: vi.fn(async () => true),
    };
    const host = document.createElement("div");
    const onDone = vi.fn();
    const handle = mountInstallJob(host, { control, kind: "node", onDone, autostart: true });
    await vi.waitFor(() => expect(calls).toBe(1));
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
    const before = calls;
    handle.destroy();
    await vi.advanceTimersByTimeAsync(3000);
    expect(calls).toBe(before);
  });

  it("offers Retry and Copy log when the job fails", async () => {
    const control = {
      startDependencyInstall: vi.fn(async () => ({ state: "running" })),
      dependencyInstallStatus: vi.fn(async () => ({ state: "failed", lines: ["no network"] })),
      cancelDependencyInstall: vi.fn(async () => true),
    };
    const host = document.createElement("div");
    mountInstallJob(host, { control, kind: "browser", autostart: true });
    await vi.waitFor(() => expect(host.textContent).toContain("Retry"));
    expect(host.textContent).toContain("Copy log");
    [...host.querySelectorAll("button")]
      .find((node) => node.textContent === "Copy log")
      ?.dispatchEvent(new MouseEvent("click"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("no network");
  });

  it("stops polling when destroyed", async () => {
    const control = {
      startDependencyInstall: vi.fn(async () => ({ state: "running" })),
      dependencyInstallStatus: vi.fn(async () => ({ state: "running", lines: ["..."] })),
      cancelDependencyInstall: vi.fn(async () => true),
    };
    const host = document.createElement("div");
    const handle = mountInstallJob(host, { control, kind: "surf", autostart: true });
    await vi.waitFor(() => expect(control.dependencyInstallStatus).toHaveBeenCalled());
    const before = control.dependencyInstallStatus.mock.calls.length;
    handle.destroy();
    await vi.advanceTimersByTimeAsync(5000);
    expect(control.dependencyInstallStatus.mock.calls.length).toBe(before);
  });
});
