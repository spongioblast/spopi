// ABOUTME: Tests that extension errors stay with the runtime that reported them.
// ABOUTME: A second session does not inherit the first session's load failure.
import { describe, expect, it } from "vitest";
import { extensionErrors, noteExtensionError } from "./extension-errors.js";

describe("extensionErrors", () => {
  it("keeps each runtime's failures separate", () => {
    const first = { workspaceId: "ws", sessionId: "a", instanceId: "1" };
    const second = { workspaceId: "ws", sessionId: "b", instanceId: "1" };
    noteExtensionError(
      { error: "peer", extensionPath: "C:/mods/node_modules/pi-lens/index.js" },
      first,
    );
    expect(extensionErrors(first)).toHaveLength(1);
    expect(extensionErrors(second)).toEqual([]);
    expect(extensionErrors()).toEqual([]);
  });
});
