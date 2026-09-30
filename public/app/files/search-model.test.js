// ABOUTME: Tests normalizeSearchQuery.
// ABOUTME: Includes "trims and rejects empty input".
import { describe, expect, it, vi } from "vitest";
import { groupHitsByFile, normalizeSearchQuery, searchWorkspace } from "./search-model.js";

describe("normalizeSearchQuery", () => {
  it("trims and rejects empty input", () => {
    expect(normalizeSearchQuery("  foo  ")).toBe("foo");
    expect(normalizeSearchQuery("   ")).toBe("");
  });
});

describe("groupHitsByFile", () => {
  it("groups consecutive hits from the same path", () => {
    const groups = groupHitsByFile([
      { path: "a.rs", line: 1 },
      { path: "a.rs", line: 4 },
      { path: "b.rs", line: 2 },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].hits).toHaveLength(2);
  });
});

describe("searchWorkspace", () => {
  it("skips the network for an empty query", async () => {
    const fetchImpl = vi.fn();
    const result = await searchWorkspace({ query: "  ", fetchImpl });
    expect(result.backend).toBe("none");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
