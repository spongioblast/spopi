// ABOUTME: Tests the shared request-id factory.
// ABOUTME: Prefixes stay independent and start at 1.

import { describe, expect, test } from "vitest";
import { createRequestIds } from "./request-id.js";

describe("createRequestIds", () => {
  test("prefixes and increments independently", () => {
    const host = createRequestIds("host");
    const data = createRequestIds("data");
    expect(host()).toBe("host-1");
    expect(host()).toBe("host-2");
    expect(data()).toBe("data-1");
  });
});
