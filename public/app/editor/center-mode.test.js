// ABOUTME: Tests the center mode choice.
// ABOUTME: Review and an open file beat a running turn.
import { describe, expect, it } from "vitest";
import { chooseCenterMode } from "./center-mode.js";

describe("chooseCenterMode", () => {
  it("uses home when nothing is open or running", () => {
    expect(chooseCenterMode({})).toBe("home");
  });

  it("uses work while a turn runs and no file is open", () => {
    expect(chooseCenterMode({ running: true })).toBe("work");
  });

  it("uses the editor when a file is open", () => {
    expect(chooseCenterMode({ running: true, fileOpen: true })).toBe("editor");
  });

  it("uses review when review is requested", () => {
    expect(chooseCenterMode({ fileOpen: true, review: true })).toBe("review");
  });

  it("shows a subagent's transcript when its tab is in front", () => {
    expect(chooseCenterMode({ fileOpen: true, subagent: true })).toBe("subagent");
  });
});
