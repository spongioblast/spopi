// ABOUTME: Tests the shared display formatters for money, counts, bytes, and duration.
// ABOUTME: Covers public/app/ui/formatters.js.

import { describe, expect, test } from "vitest";
import { formatBytes, formatDuration, formatUsd } from "./formatters.js";

describe("formatters", () => {
  test("formats money, bytes, and durations", () => {
    expect(formatUsd(1.2)).toBe("$1.20");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatDuration(3200)).toBe("3.2s");
    expect(formatDuration(null)).toBe("");
  });
});
