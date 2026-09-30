// ABOUTME: Tests capabilityState.
// ABOUTME: Includes "turns on checkpoints when workspace-history is enabled".
import { describe, expect, it } from "vitest";
import { capabilityState, createAffordances, missingRecommended } from "./packages-recommended.js";

describe("capabilityState", () => {
  it("turns on checkpoints when workspace-history is enabled", () => {
    expect(capabilityState([{ packageName: "pi-workspace-history" }]).checkpoints).toBe(true);
    expect(capabilityState([]).problems).toBe(false);
  });
});

describe("createAffordances", () => {
  it("returns the package to install for a missing feature", () => {
    expect(createAffordances("problems", []).name).toBe("pi-lens");
    expect(createAffordances("checkpoints", [{ packageName: "pi-workspace-history" }])).toBeNull();
  });
});

describe("missingRecommended", () => {
  it("lists packages that are not installed yet", () => {
    expect(missingRecommended([]).length).toBeGreaterThan(3);
  });
});
