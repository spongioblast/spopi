// ABOUTME: Verifies the Pi RPC smoke test derives its fixture version from the embedded Pi lock.
// ABOUTME: Ensures every pinned Pi release has an audited RPC contract fixture.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const piVersion = JSON.parse(read("scripts/pi-version.json")).version;

describe("Pi RPC smoke contract", () => {
  test("derives the contract version and fixture path from the embedded Pi lock", () => {
    const smokeSource = read("scripts/smoke-pi-rpc.js");

    expect(smokeSource).toContain("pi-version.json");
    expect(smokeSource).not.toContain('"0.80.10"');
  });

  test("includes a contract fixture for the pinned embedded Pi version", () => {
    const fixture = path.join(root, "tests", "fixtures", "pi-rpc", piVersion, "contract.json");

    expect(fs.existsSync(fixture)).toBe(true);
    expect(JSON.parse(fs.readFileSync(fixture, "utf8")).version).toBe(piVersion);
  });
});
