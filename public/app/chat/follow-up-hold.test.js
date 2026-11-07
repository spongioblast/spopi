// ABOUTME: Tests the local follow-up hold that waits for the current run to settle.
// ABOUTME: Covers public/app/chat/follow-up-hold.js.
import { describe, expect, it } from "vitest";
import {
  drainHeldFollowUps,
  heldFollowUps,
  holdFollowUp,
  moveHeldFollowUp,
  removeHeldFollowUp,
  restoreFollowUp,
  takeNextFollowUp,
} from "./follow-up-hold.js";

describe("follow-up hold", () => {
  it("keeps follow-ups per session and releases one at a time", () => {
    holdFollowUp("s1", "first");
    holdFollowUp("s1", "second");
    holdFollowUp("s2", "other");

    expect(heldFollowUps("s1")).toEqual(["first", "second"]);
    expect(takeNextFollowUp("s1")?.message).toBe("first");
    expect(heldFollowUps("s1")).toEqual(["second"]);
    expect(heldFollowUps("s2")).toEqual(["other"]);
  });

  it("carries images on delivery but not in the display list", () => {
    holdFollowUp("s-img", "look", [{ data: "a" }]);
    expect(heldFollowUps("s-img")).toEqual(["look"]);
    const taken = takeNextFollowUp("s-img");
    expect(taken?.message).toBe("look");
    expect(taken?.images).toEqual([{ data: "a" }]);
  });

  it("drains every held message for a stopped run", () => {
    holdFollowUp("s-drain", "one");
    holdFollowUp("s-drain", "two");
    expect(drainHeldFollowUps("s-drain").map((entry) => entry.message)).toEqual(["one", "two"]);
    expect(heldFollowUps("s-drain")).toEqual([]);
  });

  it("removes and reorders only the held tail, after Pi's own follow-ups", () => {
    holdFollowUp("s3", "held-a");
    holdFollowUp("s3", "held-b");

    expect(removeHeldFollowUp("s3", 0, 1, "held-a")).toBe(false);
    expect(removeHeldFollowUp("s3", 1, 1, "held-a")).toBe(true);
    expect(heldFollowUps("s3")).toEqual(["held-b"]);

    holdFollowUp("s3", "held-c");
    expect(moveHeldFollowUp("s3", 2, 1, 1, "held-c")).toBe(true);
    expect(heldFollowUps("s3")).toEqual(["held-c", "held-b"]);
  });

  it("restores a failed send at the front", () => {
    holdFollowUp("s4", "later");
    restoreFollowUp("s4", { message: "now" });
    expect(takeNextFollowUp("s4")?.message).toBe("now");
  });
});
