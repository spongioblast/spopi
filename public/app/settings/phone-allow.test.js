// ABOUTME: Tests the allowed-sources rules for phone access.
// ABOUTME: Covers phone-allow.js parsing, the IPv4 check, the masked form, and the interface default.

import { describe, expect, it } from "vitest";
import {
  allowProblem,
  canonicalCidr,
  defaultAllowCidrs,
  isAllowEntry,
  isDefaultAllow,
  parseAllowText,
} from "./phone-allow.js";

describe("phone allowed sources", () => {
  it("builds a default allowlist from the interface", () => {
    expect(defaultAllowCidrs("192.168.1.20")).toEqual(["192.168.1.0/24"]);
    expect(defaultAllowCidrs("10.0.0.5")).toEqual(["10.0.0.0/24"]);
    expect(defaultAllowCidrs("172.20.1.1")).toEqual(["172.20.1.0/24"]);
    expect(defaultAllowCidrs("100.100.1.1")).toEqual(["100.64.0.0/10"]);
    expect(defaultAllowCidrs("127.0.0.1")).toEqual(["127.0.0.1/32"]);
    expect(defaultAllowCidrs("8.8.8.8")).toEqual(["8.8.8.8/32"]);
    expect(parseAllowText("10.0.0.0/24, 192.168.1.0/24")).toEqual([
      "10.0.0.0/24",
      "192.168.1.0/24",
    ]);
  });

  it("accepts only IPv4 addresses and ranges, like the host", () => {
    expect(isAllowEntry("192.168.80.0/24")).toBe(true);
    expect(isAllowEntry("10.0.0.5")).toBe(true);
    expect(isAllowEntry("0.0.0.0/0")).toBe(true);
    for (const bad of [
      "192.168.8g0.1/32",
      "192.168.1.0/33",
      "192.168.1.0/",
      "01.2.3.4",
      "fe80::1",
    ]) {
      expect(isAllowEntry(bad)).toBe(false);
    }
    expect(allowProblem("192.168.1.0/24, 192.168.8g0.1/32")).toEqual({
      key: "settings.phone.allowInvalid",
      entry: "192.168.8g0.1/32",
    });
    expect(allowProblem("  ")).toEqual({ key: "settings.phone.allowEmpty" });
    expect(allowProblem("192.168.1.0/24")).toBeNull();
  });

  it("writes a range in the masked form the firewall reports", () => {
    expect(canonicalCidr("192.168.80.57/24")).toBe("192.168.80.0/24");
    expect(canonicalCidr("10.0.0.5")).toBe("10.0.0.5/32");
    expect(canonicalCidr("100.100.1.1/10")).toBe("100.64.0.0/10");
    expect(canonicalCidr("8.8.8.8/0")).toBe("0.0.0.0/0");
  });

  it("treats only SPOPI's own default as following the interface", () => {
    expect(isDefaultAllow([], ["192.168.80.57"])).toBe(true);
    expect(isDefaultAllow(["127.0.0.1/32"], ["192.168.80.57"])).toBe(true);
    expect(isDefaultAllow(["192.168.80.0/24"], ["192.168.80.57"])).toBe(true);
    expect(isDefaultAllow(["192.168.80.7/32"], ["192.168.80.57"])).toBe(false);
  });
});
