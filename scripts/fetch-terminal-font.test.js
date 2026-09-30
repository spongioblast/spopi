// ABOUTME: Verifies the terminal-font lockfile and every build path that must fetch it.
// ABOUTME: Keeps downloadable terminal assets pinned, checksummed, and distributable.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("terminal font distribution", () => {
  test("pins the FiraCode Nerd Font Mono release and its checksum", () => {
    const lock = JSON.parse(read("scripts/terminal-font-version.json"));

    expect(lock.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(lock.archiveName).toBe("FiraCode.zip");
    expect(lock.sha256).toMatch(/^[a-f0-9]{64}$/i);
    expect(lock.fontFiles).toEqual([
      "FiraCodeNerdFontMono-Regular.ttf",
      "FiraCodeNerdFontMono-Bold.ttf",
    ]);
    expect(lock.outputFiles).toEqual([
      "FiraCodeNerdFontMono-Regular.woff2",
      "FiraCodeNerdFontMono-Bold.woff2",
    ]);
  });

  test("fetches the font before Tauri dev and distributable builds", () => {
    expect(read("package.json")).toContain('"fetch:terminal-font"');
    expect(read("src-tauri/tauri.conf.json")).toContain("bun run fetch:terminal-font");
    expect(read("scripts/release-macos-dmg.sh")).toContain("fetch-terminal-font.js");
    expect(read("scripts/fetch-terminal-font.js")).toContain("ttf2woff2");
    expect(read("public/style.css")).toContain(".woff2");
    expect(read("package.json")).toContain('"ttf2woff2"');
  });
});
