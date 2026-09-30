// ABOUTME: Tests context drop filtering, boundary drafts, and restore.
// ABOUTME: A fake projection stands in for SessionManager.

import { describe, expect, it } from "vitest";
import { dropBoundaryDrafts, filterDroppedMessages, pendingDrops } from "./context-drop";

describe("context drop", () => {
  it("restores pending drops that were not persisted", () => {
    const pending = pendingDrops([
      { type: "custom", customType: "spopi-drop", data: { targetId: "a" } },
      { type: "custom", customType: "spopi-drop-done" },
      { type: "custom", customType: "spopi-drop", data: { targetId: "b" } },
      { type: "context_edit", targetId: "b", replacement: null },
      { type: "custom", customType: "spopi-drop", data: { targetId: "c" } },
    ]);
    expect([...pending]).toEqual(["c"]);
  });

  it("filters by object identity, then by index when lengths match", () => {
    const keep = { role: "user" };
    const drop = { role: "assistant" };
    const byIdentity = filterDroppedMessages(
      [keep, drop],
      {
        entries: [
          { sourceEntry: { id: "keep" }, messages: [keep] },
          { sourceEntry: { id: "drop" }, messages: [drop] },
        ],
      },
      new Set(["drop"]),
    );
    expect(byIdentity).toEqual([keep]);

    const byIndex = filterDroppedMessages(
      [{ role: "user" }, { role: "assistant" }],
      {
        entries: [
          { sourceEntry: { id: "keep" }, messages: [{ role: "user" }] },
          { sourceEntry: { id: "drop" }, messages: [{ role: "assistant" }] },
        ],
      },
      new Set(["drop"]),
    );
    expect(byIndex).toEqual([{ role: "user" }]);
  });

  it("returns null when a message cannot be mapped", () => {
    expect(
      filterDroppedMessages([{ role: "user" }], { entries: [] }, new Set(["missing"])),
    ).toBeNull();
  });

  it("appends context_edit drafts and clears the pending set", () => {
    const targets = new Set(["entry-9"]);
    const drafts = dropBoundaryDrafts([{ type: "custom" }], targets);
    expect(drafts).toEqual([
      { type: "custom" },
      { type: "context_edit", targetId: "entry-9", replacement: null },
    ]);
    expect(targets.size).toBe(0);
    expect(dropBoundaryDrafts([], targets)).toBeNull();
  });
});
