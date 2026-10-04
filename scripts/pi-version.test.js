// ABOUTME: Checks the Pi pin that fetch-pi-binary verifies downloads against.
// ABOUTME: Every release archive SPOPI builds for needs a sha256 from the release's SHA256SUMS.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const pin = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "scripts", "pi-version.json"), "utf8"),
);

describe("pi-version.json", () => {
  test("pins a sha256 for each of the six release archives", () => {
    expect(Object.keys(pin.sha256).sort()).toEqual([
      "pi-darwin-arm64.tar.gz",
      "pi-darwin-x64.tar.gz",
      "pi-linux-arm64.tar.gz",
      "pi-linux-x64.tar.gz",
      "pi-windows-arm64.zip",
      "pi-windows-x64.zip",
    ]);
    for (const digest of Object.values(pin.sha256)) expect(digest).toMatch(/^[a-f0-9]{64}$/);
  });
});
