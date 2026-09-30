// ABOUTME: Tests runtime frame routing.
// ABOUTME: The case titles in this file name what it checks.
import { describe, expect, it } from "vitest";
import { createSessionStore, reduceSessionState } from "../session/session-store.js";
import { routeRuntimeFrame } from "./runtime-frame-routing.js";

const target = { workspaceId: "w", sessionId: "s", instanceId: "i" };

describe("runtime frame routing", () => {
  it("advances the foreground sequence when a non-visual config response is consumed", () => {
    const configFrame = {
      type: "runtime_event",
      target,
      sequence: 1,
      event: { type: "extension_ui_request" },
    };
    const routedConfig = routeRuntimeFrame({
      frame: configFrame,
      target,
      store: createSessionStore(target),
      consumeConfigResponse: () => true,
      reduceForeground: reduceSessionState,
    });

    expect(routedConfig).toMatchObject({
      kind: "consumed-foreground",
      store: { sequence: 1, snapshotRequired: false },
    });

    const nextFrame = {
      type: "runtime_event",
      target,
      sequence: 2,
      event: { type: "message_update" },
    };
    const routedNext = routeRuntimeFrame({
      frame: nextFrame,
      target,
      store: routedConfig.store,
      consumeConfigResponse: () => false,
      reduceForeground: reduceSessionState,
    });

    expect(routedNext).toMatchObject({
      kind: "foreground",
      store: { sequence: 2, snapshotRequired: false },
    });
  });
});
