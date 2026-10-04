// ABOUTME: Verifies the Pi RPC smoke test reads its version from the embedded Pi lock.
// ABOUTME: The one RPC contract fixture must be recorded with the pinned Pi version.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const piVersion = JSON.parse(read("scripts/pi-version.json")).version;

describe("Pi RPC smoke contract", () => {
  test("derives the contract version from the embedded Pi lock", () => {
    const smokeSource = read("scripts/smoke-pi-rpc.js");

    expect(smokeSource).toContain("pi-version.json");
    expect(smokeSource).not.toContain('"0.80.10"');
  });

  test("the contract fixture was recorded with the pinned embedded Pi version", () => {
    const fixture = path.join(root, "tests", "fixtures", "pi-rpc", "contract.json");

    expect(fs.existsSync(fixture)).toBe(true);
    expect(JSON.parse(fs.readFileSync(fixture, "utf8")).version).toBe(piVersion);
  });
});
