// ABOUTME: Tests runtime frame routing.
// ABOUTME: The case titles in this file name what it checks.
import { describe, expect, it } from "vitest";
import { routeRuntimeFrame } from "./runtime-frame-routing.js";

const target = { workspaceId: "w", sessionId: "s", instanceId: "i" };

describe("runtime frame routing", () => {
  it("names a consumed config response on the open session as consumed-foreground", () => {
    const frame = { type: "runtime_event", target, sequence: 1, event: { type: "x" } };
    expect(routeRuntimeFrame({ frame, target, consumeConfigResponse: () => true })).toBe(
      "consumed-foreground",
    );
    expect(routeRuntimeFrame({ frame, target, consumeConfigResponse: () => false })).toBe(
      "foreground",
    );
  });

  it("routes another instance or session to the background", () => {
    const other = { ...target, instanceId: "j" };
    const frame = { type: "runtime_event", target: other, sequence: 1, event: { type: "x" } };
    expect(routeRuntimeFrame({ frame, target, consumeConfigResponse: () => false })).toBe(
      "background",
    );
    const otherSession = { target: { ...target, sessionId: "t" } };
    expect(
      routeRuntimeFrame({ frame: otherSession, target, consumeConfigResponse: () => true }),
    ).toBe("consumed-background");
  });
});
