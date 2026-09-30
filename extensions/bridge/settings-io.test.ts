// ABOUTME: Two settings writers racing through the shared lock keep both updates.
// ABOUTME: The lock directory matches Pi's SettingsManager protocol.

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { updateSettingsFile } from "./settings-io";

describe("settings lock", () => {
  it("keeps both increments when two writers race", async () => {
    const dir = mkdtempSync(join(tmpdir(), "spopi-settings-lock-"));
    const settingsPath = join(dir, "settings.json");
    await Promise.all(
      [0, 1].map(() =>
        updateSettingsFile(settingsPath, (current) => ({
          ...current,
          n: Number(current.n ?? 0) + 1,
        })),
      ),
    );
    expect(JSON.parse(readFileSync(settingsPath, "utf8"))).toEqual({ n: 2 });
  });
});
