// ABOUTME: Tests SPOPI project trust bridge.
// ABOUTME: The case titles in this file name what it checks.
import { describe, expect, it } from "vitest";
import projectTrust from "./project-trust";

function setup(choice: string | undefined, hasUI = true) {
  let handler: ((event: { cwd: string }, context: unknown) => Promise<unknown>) | null = null;
  const pi = {
    on(event: string, callback: typeof handler) {
      if (event === "project_trust") handler = callback;
    },
  };
  projectTrust(pi as never);
  const context = {
    hasUI,
    ui: {
      select: async () => choice,
      notify: () => {},
    },
  };
  return () => handler?.({ cwd: "/workspace" }, context);
}

describe("SPOPI project trust bridge", () => {
  it.each([
    ["Trust once", { trusted: "yes" }],
    ["Trust and remember", { trusted: "yes", remember: true }],
    ["Open untrusted", { trusted: "no" }],
    ["Cancel workspace opening", { trusted: "no" }],
  ])("maps %s to a Pi-owned trust decision", async (choice, expected) => {
    await expect(setup(choice)()).resolves.toEqual(expected);
  });

  it("defers to pi when UI is unavailable (preserves saved trust), and stays untrusted when cancelled", async () => {
    // No UI: we cannot ask, so defer to pi's trust resolution (trust.json /
    // defaultProjectTrust) rather than hard-forcing untrusted. This keeps
    // projects the user already trusted (e.g. from the web UI) trusted.
    await expect(setup("Trust once", false)()).resolves.toEqual({ trusted: "undecided" });
    // With a UI, an explicit cancel still maps to untrusted.
    await expect(setup("Cancel workspace opening")()).resolves.toEqual({ trusted: "no" });
    // With a UI and no choice (dismissed), stays untrusted.
    await expect(setup(undefined)()).resolves.toEqual({ trusted: "no" });
  });
});
