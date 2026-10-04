// ABOUTME: package_health marks a package loaded, failed, or registered-nothing.
// ABOUTME: Grouping uses sourceInfo, not a peer range.
import { describe, expect, it } from "vitest";
import { classifyPackageHealth } from "./package-health";
import { handlers, registerPackageHealth } from "./package-health-handlers";

const ctx = {} as Parameters<(typeof handlers)["package_health"]>[0];

describe("classifyPackageHealth", () => {
  it("reports loaded, failed, and registered-nothing", () => {
    const rows = classifyPackageHealth({
      packages: [
        { source: "npm:pi-lens" },
        { source: "npm:pi-workspace-history" },
        { name: "pi-context-view" },
      ],
      commands: [{ name: "checkpoint", sourceInfo: { source: "npm:pi-workspace-history" } }],
      tools: [{ name: "lens", sourceInfo: { source: "npm:pi-lens" } }],
      errors: [{ packageName: "pi-lens", error: "peer mismatch" }],
    });
    expect(rows).toEqual([
      { name: "pi-lens", state: "failed", error: "peer mismatch", count: 1 },
      { name: "pi-workspace-history", state: "loaded", error: "", count: 1 },
      { name: "pi-context-view", state: "registered-nothing", error: "", count: 0 },
    ]);
  });

  it("does not treat a longer package name or an error sentence as a match", () => {
    const rows = classifyPackageHealth({
      packages: [{ source: "npm:pi-lens" }, { source: "npm:pi-context-view" }],
      commands: [{ name: "extra", sourceInfo: { source: "npm:pi-lens-extra" } }],
      errors: [
        {
          error: "failed while loading pi-lens",
          extensionPath: "C:/mods/node_modules/pi-context-view/index.js",
        },
      ],
    });
    expect(rows).toEqual([
      { name: "pi-lens", state: "registered-nothing", error: "", count: 0 },
      { name: "pi-context-view", state: "failed", error: "failed while loading pi-lens", count: 0 },
    ]);
  });

  it("matches a scoped package by path segments", () => {
    const rows = classifyPackageHealth({
      packages: [{ source: "npm:@ff-labs/pi-fff" }],
      tools: [
        {
          name: "fff",
          sourceInfo: { path: "C:/mods/node_modules/@ff-labs/pi-fff/index.js" },
        },
      ],
    });
    expect(rows[0]).toMatchObject({ name: "@ff-labs/pi-fff", state: "loaded", count: 1 });
  });

  it("reads live commands when the caller does not pass any", async () => {
    registerPackageHealth({
      getCommands: () => [{ name: "undo", sourceInfo: { source: "npm:pi-workspace-history" } }],
      getAllTools: () => [],
    } as never);
    await expect(
      handlers.package_health(ctx, { packages: [{ source: "npm:pi-workspace-history" }] }),
    ).resolves.toMatchObject({
      ok: true,
      data: { packages: [{ name: "pi-workspace-history", state: "loaded" }] },
    });
  });
});
