// ABOUTME: Tests classifyMessage.
// ABOUTME: Includes "maps roles and custom types onto inspector buckets".
import { describe, expect, it } from "vitest";
import { bucketMessages, classifyMessage, sumBucketTokens } from "./context-inspector-model.js";

describe("classifyMessage", () => {
  it("maps roles and custom types onto inspector buckets", () => {
    expect(classifyMessage({ role: "system" })).toBe("system");
    expect(classifyMessage({ customType: "skill" })).toBe("agents");
    expect(classifyMessage({ role: "tool" })).toBe("tools");
    expect(classifyMessage({ role: "user" })).toBe("history");
  });
});

describe("bucketMessages", () => {
  it("sums tokens and sorts largest first", () => {
    const buckets = bucketMessages([
      { role: "system", tokens: 10 },
      { role: "user", tokens: 40 },
      { role: "tool", tokens: 5 },
    ]);
    expect(buckets[0].name).toBe("history");
    expect(sumBucketTokens(buckets)).toBe(55);
  });
});
