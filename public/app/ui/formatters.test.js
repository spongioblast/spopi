// ABOUTME: Tests the shared display formatters for money, counts, bytes, and duration.
// ABOUTME: Covers public/app/ui/formatters.js.

import { describe, expect, test } from "vitest";
import { formatBytes, formatDuration, formatShortCount, formatUsd } from "./formatters.js";

describe("formatters", () => {
  test("formats money, bytes, and durations", () => {
    expect(formatUsd(1.2)).toBe("$1.20");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatDuration(3200)).toBe("3.2s");
    expect(formatDuration(null)).toBe("");
  });

  test("formats a duration as seconds, or minutes and seconds past a minute", () => {
    expect(formatDuration(320)).toBe("0.3s");
    expect(formatDuration(65_400)).toBe("1m 05s");
  });

  test("shows sub-cent costs with four digits and treats bad input as zero", () => {
    expect(formatUsd(0.00123, 4)).toBe("$0.0012");
    expect(formatUsd(Number.NaN, 4)).toBe("$0.0000");
    expect(formatUsd(undefined)).toBe("$0.00");
  });

  test("shortens token counts for tight rows", () => {
    expect(formatShortCount(950)).toBe("950");
    expect(formatShortCount(1234)).toBe("1.2k");
    expect(formatShortCount(12_345)).toBe("12k");
    expect(formatShortCount(1_500_000)).toBe("1.5M");
    expect(formatShortCount("x")).toBe("0");
  });

  test("returns an empty duration for missing or invalid input", () => {
    expect(formatDuration(undefined)).toBe("");
    expect(formatDuration(-5)).toBe("");
    expect(formatDuration(Number.NaN)).toBe("");
  });
});
