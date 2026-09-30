// ABOUTME: ui-map.md lists every file under public/app and every top-level stylesheet.
// ABOUTME: Tests the generated map next to the spopi-customize skill.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const shipped = join(import.meta.dirname, "..", "..");
const map = readFileSync(
  join(shipped, "..", "src-tauri", "resources", "skills", "spopi-customize", "ui-map.md"),
  "utf8",
);

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, files);
    else if (name.endsWith(".js") || name.endsWith(".css"))
      files.push(relative(shipped, path).replaceAll("\\", "/"));
  }
  return files;
}

describe("ui-map", () => {
  it("names every app file and top-level stylesheet by its overlay path", () => {
    const files = walk(join(shipped, "app")).filter((rel) => !rel.endsWith(".test.js"));
    const styles = readdirSync(shipped).filter((name) => name.endsWith(".css"));
    const missing = [...files, ...styles].filter((rel) => !map.includes(`- \`${rel}\` — `));
    expect(missing).toEqual([]);
    expect(map).toContain("- `style-theme.css` — ");
  });

  it("leaves tests out", () => {
    expect(map).not.toMatch(/\.test\.js`/);
  });
});
