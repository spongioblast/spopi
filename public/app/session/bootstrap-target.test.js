// ABOUTME: Tests bootstrap session target.
// ABOUTME: The case titles in this file name what it checks.
import { describe, expect, test } from "vitest";
import { reconcileSnapshotTarget } from "./bootstrap-target.js";

describe("bootstrap session target", () => {
  test("adopts the formal session returned by the initial snapshot before the first prompt", () => {
    const temporary = {
      workspaceId: "workspace-a",
      sessionId: "temporary-1",
      instanceId: "instance-a",
    };
    const formal = {
      workspaceId: "workspace-a",
      sessionId: "session-formal",
      instanceId: "instance-a",
    };

    expect(reconcileSnapshotTarget(temporary, formal)).toEqual(formal);
  });

  test("rejects a snapshot target belonging to another runtime", () => {
    const current = {
      workspaceId: "workspace-a",
      sessionId: "temporary-1",
      instanceId: "instance-a",
    };
    const unrelated = {
      workspaceId: "workspace-b",
      sessionId: "session-other",
      instanceId: "instance-b",
    };

    expect(() => reconcileSnapshotTarget(current, unrelated)).toThrow(
      "Snapshot target does not belong to the current runtime",
    );
  });
});
